const path = require('path');
const { createStaticServer } = require('./lib/static-server');

const PORT = 8080;
const DIR = path.join(__dirname, 'dist');

const server = createStaticServer(DIR);

server.listen(PORT, () => {
  console.log(`\n  Serving dist/ at http://localhost:${PORT}\n`);
});
