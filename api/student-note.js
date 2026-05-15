const { handler } = require('../netlify/functions/student-note');
const { runNetlifyFunction } = require('./_run-netlify-function');

module.exports = async (req, res) => {
  await runNetlifyFunction(req, res, handler);
};
