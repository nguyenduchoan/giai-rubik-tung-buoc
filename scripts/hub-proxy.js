// Gắn vào API Hub trước bộ đọc JSON: chỉ chuyển tuyến Rubik đến một đích loopback cố định.
// HTTP: /api/rubik/... → dịch vụ /api/...; WebSocket Thi trực tiếp: /api/rubik/online/ws → /api/online/ws.
'use strict';
const http = require('node:http');

const PREFIX = /^\/api\/rubik(?:\/|\?|$)/;
const COOKIE = 'rubik_guest=';

const LOOPBACK = /^(?:127\.|::1$|::ffff:127\.)/;
// IP người dùng: Express đã tính req.ip theo trust proxy; yêu cầu nâng cấp WebSocket không qua Express nên tự lấy
// địa chỉ không phải loopback gần nhất trong chuỗi X-Forwarded-For (cloudflared/nginx đứng trước API Hub).
function clientIp(req) {
  if (req.ip) return req.ip;
  const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  chain.push(req.socket.remoteAddress || '');
  for (let i = chain.length - 1; i >= 0; i--) if (!LOOPBACK.test(chain[i])) return chain[i];
  return chain[0] || '';
}

function forwardHeaders(req, websocket = false) {
  const headers = {};
  for (const key of ['content-type', 'content-length', 'accept', 'origin']) if (req.headers[key]) headers[key] = req.headers[key];
  // Chỉ chuyển cookie phiên khách Rubik; không gửi cookie đăng nhập Hub sang dịch vụ phòng.
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(COOKIE)).join('; ');
  if (cookie) headers.cookie = cookie;
  headers['x-forwarded-host'] = String(req.headers.host || '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  headers['x-forwarded-proto'] = proto === 'https' || req.socket.encrypted ? 'https' : 'http';
  headers['x-forwarded-for'] = clientIp(req);
  if (websocket) {
    for (const key of ['sec-websocket-key', 'sec-websocket-version']) if (req.headers[key]) headers[key] = req.headers[key];
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
  }
  return headers;
}

function createRubikProxy({ port = 3002 } = {}) {
  return (req, res, next) => {
    const url = req.originalUrl || req.url;
    if (!PREFIX.test(url)) return next();
    const upstream = http.request({ host: '127.0.0.1', port, path: url.replace(/^\/api\/rubik/, '/api'),
      method: req.method, headers: forwardHeaders(req), timeout: 15000 }, (incoming) => {
      res.writeHead(incoming.statusCode, incoming.headers);
      incoming.on('error', () => res.destroy());
      incoming.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 'service_unavailable', error: 'Dịch vụ phòng đang khởi động. Vui lòng thử lại.' }));
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };
}

// Trả về true nếu đã xử lý yêu cầu nâng cấp (đường Rubik); false để API Hub chuyển cho bộ xử lý khác (Web CLI).
function createRubikUpgrade({ port = 3002, maxTunnels = 800 } = {}) {
  const tunnels = new Set();
  return function upgrade(req, socket, head) {
    const pathname = (req.url || '').split('?')[0];
    if (!PREFIX.test(pathname)) return false;
    if (pathname !== '/api/rubik/online/ws' || req.method !== 'GET') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return true;
    }
    if (tunnels.size >= maxTunnels) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return true;
    }
    const upstream = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/api/online/ws', headers: forwardHeaders(req, true), timeout: 10000 });
    let peer = null;
    let finished = false;
    const tunnel = {};
    const cleanup = () => {
      if (finished) return;
      finished = true;
      tunnels.delete(tunnel);
      upstream.destroy();
      peer?.destroy();
      socket.destroy();
    };
    tunnels.add(tunnel);
    socket.once('close', cleanup);
    socket.once('error', cleanup);
    upstream.on('timeout', cleanup);
    upstream.on('error', cleanup);
    upstream.on('response', (response) => {
      response.resume();
      socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);
    });
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      peer = upstreamSocket;
      upstream.setTimeout(0);
      if (socket.destroyed) { cleanup(); return; }
      let lines = 'HTTP/1.1 101 Switching Protocols\r\n';
      for (const [name, value] of Object.entries(response.headers)) lines += `${name}: ${value}\r\n`;
      socket.write(lines + '\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.once('error', cleanup);
      peer.once('close', cleanup);
      socket.setNoDelay(true);
      peer.setNoDelay(true);
      socket.pipe(peer).pipe(socket);
    });
    upstream.end();
    return true;
  };
}

module.exports = { createRubikProxy, createRubikUpgrade, clientIp };
