const { verifyApprovedCredential } = require('../../lib/auth');

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const result = await verifyApprovedCredential(payload.credential);

    if (!result.approved) {
      return json(403, {
        approved: false,
        role: result.role,
        user: result.user,
        error: `${result.user.email} 계정은 아직 관리자 승인을 받지 않았습니다.`
      });
    }

    return json(200, {
      approved: true,
      role: result.role,
      user: result.user
    });
  } catch (error) {
    return json(401, { approved: false, error: error.message || 'Google 로그인을 확인하지 못했습니다.' });
  }
};
