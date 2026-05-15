const { handler } = require('../netlify/functions/auth');
const { runNetlifyFunction } = require('./_run-netlify-function');

module.exports = async (req, res) => {
  await runNetlifyFunction(req, res, handler);
};
