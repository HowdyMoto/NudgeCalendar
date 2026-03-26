const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function createStaticServer(dir) {
  const resolvedDir = path.resolve(dir);

  return http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.resolve(resolvedDir, urlPath === '/' ? 'index.html' : '.' + urlPath);

    if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    const ext = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(data);
    });
  });
}

module.exports = { createStaticServer };
