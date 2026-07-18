// Tiny zero-dependency static file server for the docs/ folder.
// Serves /home/z/my-project/docs/ on http://localhost:3100/
// Run: node /home/z/my-project/scripts/serve-docs.js
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const PORT = process.env.PORT || 3100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.ico' : 'image/x-icon',
  '.md'  : 'text/plain; charset=utf-8',
  '.txt' : 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    // Prevent path traversal
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end('500 ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log('nbody-fold docs/ served on http://localhost:' + PORT + '/');
  console.log('  tour auto-start:  http://localhost:' + PORT + '/?tour=1');
  console.log('  root dir:         ' + ROOT);
});
