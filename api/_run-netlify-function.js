function setHeaders(res, headers = {}) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

async function runNetlifyFunction(req, res, handler) {
  const result = await handler({
    httpMethod: req.method,
    headers: req.headers,
    body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  });

  setHeaders(res, result.headers);
  res.status(result.statusCode || 200).send(result.body || '');
}

module.exports = { runNetlifyFunction };
