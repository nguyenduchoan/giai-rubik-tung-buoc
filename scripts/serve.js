#!/usr/bin/env node
/*
 * Máy chủ tĩnh tối giản (không phụ thuộc thư viện) để chạy thử trên máy.
 *   node scripts/serve.js            # http://127.0.0.1:8000/
 *   node scripts/serve.js 3000       # đổi cổng
 *   HOST=0.0.0.0 node scripts/serve.js   # cho máy khác trong mạng LAN truy cập (camera vẫn cần HTTPS)
 * Không phục vụ file/thư mục bắt đầu bằng dấu chấm (.git, .local...).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const handler = (root) => (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || rel.split('/').some((part) => part.startsWith('.'))) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
};

// root: thư mục phục vụ (mặc định thư mục dự án; kiểm thử dùng bản sao tạm để giả lập phiên bản mới).
function start(port = 8000, host = '127.0.0.1', root = ROOT) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler(path.resolve(root)));
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 8000);
  const host = process.env.HOST || '127.0.0.1';
  start(port, host).then(() => {
    console.log(`Đang chạy tại http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/  (Ctrl+C để dừng)`);
  }, (err) => {
    console.error(`Không mở được cổng ${port}: ${err.message}`);
    process.exitCode = 1;
  });
}
