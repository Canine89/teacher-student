const http = require('http');
const fs = require('fs');
const path = require('path');
const { requireApproved, verifyApprovedCredential } = require('./lib/auth');

const PORT = Number(process.env.PORT || 9876);
const ROOT = __dirname;
const MODEL = 'gpt-4.1-mini';
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '11HHSbLyNWPKeZdFbS89uulmfBbcE7O64Xxh6IswNdhI';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'students';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error('요청이 너무 큽니다.'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function extractResponseText(data) {
  if (typeof data.output_text === 'string') return data.output_text.trim();

  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function stringifyCsv(rows) {
  return rows.map((row) => row.map((field) => {
    const value = String(field ?? '');
    if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
    return value;
  }).join(',')).join('\n') + '\n';
}

function normalizeGender(value) {
  const gender = String(value || '').trim().toUpperCase();
  if (gender === '남' || gender === 'M' || gender === 'MALE') return 'M';
  if (gender === '여' || gender === 'F' || gender === 'FEMALE') return 'F';
  return gender || 'M';
}

function parseNotesCell(value) {
  return String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)$/);
      if (match) return { date: match[1], content: match[2].trim() };
      return { date: new Date().toISOString().slice(0, 10), content: line };
    });
}

function studentsFromCsv(text) {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header || rows.length === 0) return [];

  return rows.map((row) => {
    const student = Object.fromEntries(header.map((column, index) => [column.trim(), (row[index] || '').trim()]));
    const allergyText = student['알레르기/특이사항'] || student.allergies || '';
    return {
      id: Number(student['번호'] || student.id),
      name: student['이름'] || student.name,
      gender: normalizeGender(student['성별'] || student.gender || ''),
      birthday: student['생일'] || student.birthday,
      guardian: student['보호자 연락처'] || student.guardian || '',
      allergies: allergyText
        ? allergyText.split(/[;|/·]/).map((item) => item.trim()).filter(Boolean)
        : [],
      notes: parseNotesCell(student['상담기록'] || '')
    };
  }).filter((student) => student.id && student.name);
}

async function fetchSheetStudents() {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
  url.searchParams.set('tqx', 'out:csv');
  url.searchParams.set('sheet', SHEET_NAME);

  const sheetResponse = await fetch(url, { cache: 'no-store' });
  if (!sheetResponse.ok) {
    throw new Error(`구글 스프레드시트를 읽지 못했습니다. (${sheetResponse.status})`);
  }

  const csv = await sheetResponse.text();
  const students = studentsFromCsv(csv);
  if (students.length === 0) throw new Error('구글 스프레드시트에 학생 데이터가 없습니다.');
  return students;
}

async function handleStudents(request, response) {
  try {
    const auth = await requireApproved(request.headers);
    if (!auth.ok) {
      sendJson(response, auth.statusCode, { error: auth.error, user: auth.user, role: auth.role });
      return;
    }

    const students = await fetchSheetStudents();
    sendJson(response, 200, {
      students,
      source: `google-sheets:${SHEET_ID}/${SHEET_NAME}`
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || '학생 데이터를 읽지 못했습니다.' });
  }
}

async function handleAuth(request, response) {
  try {
    const payload = JSON.parse(await readRequestBody(request) || '{}');
    const result = await verifyApprovedCredential(payload.credential);

    if (!result.approved) {
      sendJson(response, 403, {
        approved: false,
        role: result.role,
        user: result.user,
        error: `${result.user.email} 계정은 아직 관리자 승인을 받지 않았습니다.`
      });
      return;
    }

    sendJson(response, 200, {
      approved: true,
      role: result.role,
      user: result.user
    });
  } catch (error) {
    sendJson(response, 401, { approved: false, error: error.message || 'Google 로그인을 확인하지 못했습니다.' });
  }
}

async function handleSaveStudentNote(request, response) {
  const auth = await requireApproved(request.headers);
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { error: auth.error, user: auth.user, role: auth.role });
    return;
  }

  sendJson(response, 501, {
    error: '구글 스프레드시트 저장은 아직 연결되지 않았습니다. 화면에는 세션 메모로 저장됩니다.'
  });
}

async function handleCounselingNote(request, response) {
  const auth = await requireApproved(request.headers);
  if (!auth.ok) {
    sendJson(response, auth.statusCode, { error: auth.error, user: auth.user, role: auth.role });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 500, {
      error: 'OPENAI_API_KEY 환경변수가 없습니다. 서버를 API 키와 함께 다시 실행해 주세요.'
    });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body || '{}');
    const student = payload.student || {};
    const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
    const prompt = String(payload.prompt || '').trim();

    if (!student.name || (!prompt && keywords.length === 0)) {
      sendJson(response, 400, { error: '학생 정보와 생성 요청을 확인해 주세요.' });
      return;
    }

    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.35,
        max_output_tokens: 520,
        instructions: [
          '너는 초등학교 담임교사의 상담 기록 작성을 돕는 보조자다.',
          '출력은 한국어 상담 기록 본문만 작성한다.',
          '반드시 관찰 가능한 사실과 교육적 지원 중심으로 쓴다.',
          '학부모가 보기에 성의 있고 따뜻하되 과장하거나 보장하지 않는다.',
          '학생을 낙인찍는 표현, 진단명 단정, 처벌 암시, 비교, 개인정보 과다 노출, 차별적 표현을 피한다.',
          '교육청 민원 소지가 생기지 않도록 중립적이고 검토 가능한 표현을 사용한다.',
          '문장은 4~6문장, 250~420자 정도로 작성한다.',
          '마지막 문장은 가정과 학교의 협력 또는 지속 관찰 계획으로 마무리한다.'
        ].join('\n'),
        input: [
          `학생: ${student.name} (${student.id || ''}번, ${student.gender || '성별 미기재'})`,
          `알레르기/특이사항: ${(student.allergies || []).join(', ') || '없음'}`,
          `선택 키워드: ${keywords.join(', ') || '없음'}`,
          `교사 입력: ${prompt || '키워드를 바탕으로 작성'}`
        ].join('\n')
      })
    });

    const data = await apiResponse.json();
    if (!apiResponse.ok) {
      sendJson(response, apiResponse.status, {
        error: data.error?.message || 'OpenAI API 요청에 실패했습니다.'
      });
      return;
    }

    const note = extractResponseText(data);
    if (!note) {
      sendJson(response, 502, { error: '생성된 상담 기록이 비어 있습니다.' });
      return;
    }

    sendJson(response, 200, { note, model: MODEL });
  } catch (error) {
    sendJson(response, 500, { error: error.message || '서버 오류가 발생했습니다.' });
  }
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': contentType.includes('text/html') ? 'no-store' : 'public, max-age=60'
    });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api/auth') {
    handleAuth(request, response);
    return;
  }

  if (request.method === 'GET' && request.url === '/api/students') {
    handleStudents(request, response);
    return;
  }

  if (request.method === 'POST' && request.url === '/api/counseling-note') {
    handleCounselingNote(request, response);
    return;
  }

  if (request.method === 'POST' && request.url === '/api/student-note') {
    handleSaveStudentNote(request, response);
    return;
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Method not allowed');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Class manager running at http://127.0.0.1:${PORT}/`);
});
