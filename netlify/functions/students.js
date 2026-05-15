const SHEET_ID = process.env.GOOGLE_SHEET_ID || '11HHSbLyNWPKeZdFbS89uulmfBbcE7O64Xxh6IswNdhI';
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'students';
const { requireApproved } = require('../../lib/auth');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
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

exports.handler = async (event) => {
  try {
    const auth = await requireApproved(event.headers);
    if (!auth.ok) return json(auth.statusCode, { error: auth.error, user: auth.user, role: auth.role });

    const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`);
    url.searchParams.set('tqx', 'out:csv');
    url.searchParams.set('sheet', SHEET_NAME);

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`구글 스프레드시트를 읽지 못했습니다. (${response.status})`);

    const csv = await response.text();
    const students = studentsFromCsv(csv);
    if (students.length === 0) throw new Error('구글 스프레드시트에 학생 데이터가 없습니다.');

    return json(200, {
      students,
      source: `google-sheets:${SHEET_ID}/${SHEET_NAME}`
    });
  } catch (error) {
    return json(500, { error: error.message || '학생 데이터를 읽지 못했습니다.' });
  }
};
