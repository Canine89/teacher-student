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

exports.handler = async () => {
  return json(501, {
    error: '구글 스프레드시트 저장은 아직 연결되지 않았습니다. 화면에는 세션 메모로 저장됩니다.'
  });
};
