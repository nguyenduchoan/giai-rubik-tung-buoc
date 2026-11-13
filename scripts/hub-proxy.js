// Gắn vào API Hub trước bộ đọc JSON: chỉ chuyển tuyến Rubik đến một đích loopback cố định.
'use strict';
const http = require('node:http');
function createRubikProxy({ port = 3002 } = {}) {
  return (req, res, next) => {
    const url = req.originalUrl || req.url;
    if (!/^\/api\/rubik(?:\/|\?|$)/.test(url)) return next();
    const headers = {};
    for (const key of ['content-type', 'content-length', 'accept']) if (req.headers[key]) headers[key] = req.headers[key];
    const upstream = http.request({ host: '127.0.0.1', port, path: url.replace(/^\/api\/rubik/, '/api'),
      method: req.method, headers, timeout: 15000 }, (incoming) => {
      res.writeHead(incoming.statusCode, incoming.headers);
      incoming.on('error', () => res.destroy());
      incoming.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Dịch vụ phòng đang khởi động. Vui lòng thử lại.' }));
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}
module.exports = { createRubikProxy };
