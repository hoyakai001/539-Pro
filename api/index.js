const app = require('../backend/dist/server').default;

module.exports = (req, res) => app(req, res);
