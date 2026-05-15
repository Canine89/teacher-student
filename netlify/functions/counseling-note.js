const MODEL = 'gpt-4.1-mini';
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireApproved(event.headers);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error, user: auth.user, role: auth.role });

  if (!process.env.OPENAI_API_KEY) {
    return json(500, {
      error: 'OPENAI_API_KEY 환경변수가 없습니다. Netlify 환경변수에 등록해 주세요.'
    });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const student = payload.student || {};
    const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
    const prompt = String(payload.prompt || '').trim();

    if (!student.name || (!prompt && keywords.length === 0)) {
      return json(400, { error: '학생 정보와 생성 요청을 확인해 주세요.' });
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
      return json(apiResponse.status, {
        error: data.error?.message || 'OpenAI API 요청에 실패했습니다.'
      });
    }

    const note = extractResponseText(data);
    if (!note) return json(502, { error: '생성된 상담 기록이 비어 있습니다.' });

    return json(200, { note, model: MODEL });
  } catch (error) {
    return json(500, { error: error.message || '서버 오류가 발생했습니다.' });
  }
};
