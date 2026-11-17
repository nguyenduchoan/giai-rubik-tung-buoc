#!/usr/bin/env node
/*
 * Máy chủ tĩnh tối giản (không phụ thuộc thư viện) để chạy thử trên máy.
 *   node scripts/serve.js            # http://127.0.0.1:8000/
 *   node scripts/serve.js 3000       # đổi cổng
 *   HOST=0.0.0.0 node scripts/serve.js   # cho máy khác trong mạng LAN truy cập (camera vẫn cần HTTPS)
 * Không phục vụ file/thư mục bắt đầu bằng dấu chấm (.git, .local...) hay file nằm ngoài thư mục gốc
 * (kể cả qua symlink). Yêu cầu lỗi chỉ nhận mã 4xx/5xx, không bao giờ làm dừng tiến trình.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRoomApi } = require('./rooms.js');
const { createOnline } = require('../server/online/http.js');

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

function send(res, status, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}

// Đường dẫn trong thư mục gốc mà yêu cầu trỏ tới, hoặc { status } nếu phải từ chối.
function resolveRequest(root, url) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch (e) {
    return { status: 400 };
  }
  // NUL làm fs ném lỗi đồng bộ; \ là dấu phân cách trên Windows.
  if (rel.includes('\0') || rel.includes('\\')) return { status: 400 };
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel.split('/').some((part) => part.startsWith('.'))) return { status: 404 };
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) return { status: 404 };
  return { file };
}

const handler = (root, roomApi, dataDir, online) => async (req, res) => {
  try {
    if (online && await online.handle(req, res)) return;
    if (!online && /^\/api\/online(?:\/|$)/.test(req.url)) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 'service_unavailable', message: 'Dịch vụ thi trực tiếp đang tạm dừng.' }));
      return;
    }
    if (await roomApi(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      send(res, 405, 'Method not allowed');
      return;
    }
    const { file, status } = resolveRequest(root, req.url);
    if (status) { send(res, status, status === 400 ? 'Bad request' : 'Not found'); return; }
    let real;
    try {
      real = await fs.promises.realpath(file);
    } catch (e) {
      send(res, 404, 'Not found');
      return;
    }
    // Symlink có thể trỏ ra ngoài thư mục gốc hoặc vào file ẩn bên trong (vd. .local/): kiểm tra lại trên đường dẫn thật.
    const realRel = path.relative(root, real);
    if (!real.startsWith(root + path.sep) || realRel.split(path.sep).some((part) => part.startsWith('.')) ||
        real === dataDir || real.startsWith(dataDir + path.sep)) {
      send(res, 404, 'Not found');
      return;
    }
    const data = await fs.promises.readFile(real).catch(() => null);
    if (!data) { send(res, 404, 'Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (err) {
    send(res, 500, 'Internal server error');
  }
};

/*
 * root: thư mục phục vụ (mặc định thư mục dự án; kiểm thử dùng bản sao tạm để giả lập phiên bản mới).
 * options.online: false để tắt Thi trực tiếp, hoặc tùy chọn cho createOnline (config, scrambler...).
 * Thi trực tiếp lỗi khởi động (ví dụ dữ liệu đang bị tiến trình khác giữ) không làm dừng các phần còn lại.
 */
async function start(port = 8000, host = '127.0.0.1', root = ROOT, options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.ROOM_DATA_DIR || path.join(root, '.local', 'room-data'));
  const roomApi = await createRoomApi(dataDir);
  let online = null;
  if (options.online !== false) {
    try {
      online = createOnline(path.join(dataDir, 'online'), options.online || {});
    } catch (err) {
      console.error(`Thi trực tiếp chưa chạy được: ${err.message}`);
    }
  }
  return new Promise((resolve, reject) => {
    let realRoot;
    try {
      realRoot = fs.realpathSync(path.resolve(root));
    } catch (err) {
      reject(err);
      return;
    }
    const server = http.createServer(handler(realRoot, roomApi, dataDir, online));
    server.online = online;
    server.on('upgrade', (req, socket, head) => {
      if (!online || !online.upgrade(req, socket, head)) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    });
    // Đóng máy chủ thì báo và đóng các kết nối WebSocket trước, nếu không server.close() chờ chúng mãi.
    const closeServer = server.close.bind(server);
    server.close = (callback) => {
      if (online) online.service.shutdown();
      return closeServer(callback);
    };
    server.on('close', () => { if (online) void online.close(); });
    server.once('error', (err) => { if (online) void online.close(); reject(err); });
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 8000);
  const host = process.env.HOST || '127.0.0.1';
  start(port, host).then((server) => {
    console.log(`Đang chạy tại http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/  (Ctrl+C để dừng)`);
    // Dừng có kiểm soát: báo người chơi, nhả khóa dữ liệu; ván đang chạy sẽ là VOID khi khởi động lại (BR-25).
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        const done = () => process.exit(0);
        Promise.resolve(server.online && server.online.close()).then(done, done);
        setTimeout(done, 1500).unref();
      });
    }
  }, (err) => {
    console.error(`Không mở được cổng ${port}: ${err.message}`);
    process.exitCode = 1;
  });
}
