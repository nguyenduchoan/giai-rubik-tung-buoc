/*
 * Điểm giao tiếp HTTP và WebSocket của Thi trực tiếp, gắn vào máy chủ Node hiện có (scripts/serve.js).
 *   GET  {prefix}/meta | /health
 *   POST {prefix}/session                      tạo/nhận diện phiên khách (cookie HttpOnly)
 *   POST {prefix}/rooms                        { nickname }            tạo phòng
 *   POST {prefix}/rooms/join                   { code, nickname }      vào phòng
 *   GET  {prefix}/rooms/:roomId                bản chụp phòng (thành viên)
 *   POST {prefix}/rooms/:roomId/leave          rời phòng
 *   GET  {prefix}/rooms/:roomId/rounds[/:roundId]  lịch sử ván trong hạn lưu
 *   WS   {prefix}/ws                           sự kiện, sẵn sàng, nước xoay
 * Trên Hub, API Hub chuyển /api/rubik/... đến /api/... của dịch vụ này (scripts/hub-proxy.js).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { acceptUpgrade, rejectUpgrade } = require('./ws.js');
const { Store } = require('./store.js');
const { Scrambler } = require('./scrambler.js');
const { OnlineService, OnlineError } = require('./service.js');
const { protocol } = require('./engine.js');

const COOKIE = 'rubik_guest';
const MAX_BODY = 4096;

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function json(res, status, data, headers = {}) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function fail(res, error) {
  const code = error.code || 'service_unavailable';
  json(res, error.status || 500, { code, message: protocol.message(code), ...(error.extra || {}) });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (part) => {
      size += part.length;
      // Quá giới hạn: trả 413 ngay, phần còn lại chỉ đọc bỏ (hủy socket làm lớp chuyển tiếp báo 502).
      if (size > MAX_BODY) { parts.length = 0; reject(new OnlineError('payload_too_large', 413)); return; }
      parts.push(part);
    });
    req.on('error', () => reject(new OnlineError('malformed')));
    req.on('end', () => {
      if (size > MAX_BODY) return;
      if (!size) { resolve({}); return; }
      try {
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch (e) { reject(new OnlineError('malformed')); }
    });
  });
}

// Giới hạn đơn giản theo cửa sổ cố định; khóa gồm loại thao tác và phiên/địa chỉ.
class Limiter {
  constructor() { this.hits = new Map(); }
  allow(key, max, windowMs, now = Date.now()) {
    const entry = this.hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (now - v.start >= windowMs) this.hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  }
}

function clientAddress(req) {
  const remote = req.socket.remoteAddress || '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const forwarded = loopback && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || remote;
}

// Chỉ nhận yêu cầu thay đổi và WebSocket từ đúng trang (chống trang lạ dùng cookie của người chơi).
function originAllowed(req, allowed) {
  const origin = req.headers.origin;
  if (!origin) return true; // trình duyệt luôn gửi Origin với POST/WebSocket; công cụ khác không có cookie của người chơi
  let host;
  try { host = new URL(origin).host; } catch (e) { return false; }
  if (allowed && allowed.length) return allowed.includes(origin);
  const expected = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return !!expected && host === expected;
}

function createOnlineHttp(service, { prefix = '/api/online', allowedOrigins = null } = {}) {
  const limiter = new Limiter();
  const cookieHeader = (req, token) => {
    const secure = req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `${COOKIE}=${token}; Path=/api; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  };
  const guestOf = (req) => service.resolveGuest(readCookie(req, COOKIE));
  const requireGuest = (req) => {
    const guestId = guestOf(req);
    if (!guestId) throw new OnlineError('session_invalid', 401);
    return guestId;
  };
  const limit = (req, kind, max, windowMs, guestId) => {
    const ok = limiter.allow(`${kind}:${guestId || ''}:${clientAddress(req)}`, max, windowMs) &&
      limiter.allow(`${kind}:ip:${clientAddress(req)}`, max * 6, windowMs);
    if (!ok) throw new OnlineError('rate_limited', 429);
  };

  async function route(req, res, pathname) {
    const parts = pathname.slice(prefix.length).split('/').filter(Boolean);
    const method = req.method;
    if (method === 'POST' && !originAllowed(req, allowedOrigins)) throw new OnlineError('forbidden_origin', 403);
    if (method === 'GET' && parts.length === 1 && parts[0] === 'meta') return json(res, 200, service.meta());
    if (method === 'GET' && parts.length === 1 && parts[0] === 'health') {
      const health = service.health();
      return json(res, health.ok ? 200 : 503, health);
    }
    if (method === 'POST' && parts.length === 1 && parts[0] === 'session') {
      await readBody(req);
      limit(req, 'session', 60, 10 * 60000);
      const session = service.ensureSession(readCookie(req, COOKIE));
      return json(res, 200, { guestId: session.guestId, activeRoom: session.activeRoom },
        session.token ? { 'Set-Cookie': cookieHeader(req, session.token) } : {});
    }
    if (parts[0] !== 'rooms') throw new OnlineError('not_found', 404);
    if (method === 'POST' && parts.length === 1) {
      const body = await readBody(req);
      const guestId = requireGuest(req);
      limit(req, 'create', 10, 10 * 60000, guestId);
      return json(res, 200, service.createRoom(guestId, body.nickname));
    }
    if (method === 'POST' && parts.length === 2 && parts[1] === 'join') {
      const body = await readBody(req);
      const guestId = requireGuest(req);
      limit(req, 'join', 30, 5 * 60000, guestId);
      return json(res, 200, service.joinRoom(guestId, body.code, body.nickname));
    }
    const roomId = parts[1];
    if (method === 'GET' && parts.length === 2) return json(res, 200, service.roomSnapshot(requireGuest(req), roomId));
    if (method === 'POST' && parts.length === 3 && parts[2] === 'leave') {
      await readBody(req);
      return json(res, 200, service.leaveHttp(requireGuest(req), roomId));
    }
    if (method === 'GET' && parts.length === 3 && parts[2] === 'rounds') return json(res, 200, service.listRounds(requireGuest(req), roomId));
    if (method === 'GET' && parts.length === 4 && parts[2] === 'rounds') {
      return json(res, 200, service.getRound(requireGuest(req), roomId, parts[3]));
    }
    throw new OnlineError('not_found', 404);
  }

  async function handle(req, res) {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { return false; }
    if (pathname !== prefix && !pathname.startsWith(prefix + '/')) return false;
    try {
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new OnlineError('not_found', 405);
      await route(req, res, pathname);
    } catch (error) {
      if (!(error instanceof OnlineError)) service.log('http_error', { message: error.message, stack: error.stack });
      fail(res, error instanceof OnlineError ? error : new OnlineError('service_unavailable', 500));
    }
    return true;
  }

  function upgrade(req, socket, head) {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { return false; }
    if (pathname !== prefix + '/ws') return false;
    socket.on('error', () => socket.destroy());
    if (!originAllowed(req, allowedOrigins)) { rejectUpgrade(socket, 403, 'Forbidden'); return true; }
    let guestId;
    try { guestId = guestOf(req); } catch (e) { guestId = null; }
    if (!guestId) { rejectUpgrade(socket, 401, 'Unauthorized'); return true; }
    // Theo từng phiên (nối lại bình thường vài lần/phút) và từng địa chỉ (cả nhóm bạn dùng chung Wi-Fi).
    if (!service.canAccept() || !limiter.allow(`ws:g:${guestId}`, 30, 60000) || !limiter.allow(`ws:ip:${clientAddress(req)}`, 300, 60000)) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return true;
    }
    const ws = acceptUpgrade(req, socket, head, { maxPayload: 4096 });
    if (!ws) return true;
    const conn = service.attach(guestId, ws);
    ws.on('activity', () => service.seen(conn));
    ws.on('message', (text) => service.receive(conn, text));
    ws.on('close', () => service.detach(conn));
    return true;
  }

  return { handle, upgrade };
}

// Khóa tệp để không có hai tiến trình cùng làm chủ dữ liệu phòng (mục 11.3).
function acquireLock(dataDir) {
  const file = path.join(dataDir, 'online.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
      return () => { try { if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); } catch (e) { /* đã xóa */ } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      let alive = false;
      try { if (pid && pid !== process.pid) { process.kill(pid, 0); alive = true; } } catch (e) { alive = e.code === 'EPERM'; }
      if (alive) throw new Error(`Dữ liệu Thi trực tiếp đang được tiến trình ${pid} sử dụng.`);
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error('Không lấy được khóa dữ liệu Thi trực tiếp.');
}

/*
 * Dựng toàn bộ dịch vụ trong một tiến trình. options.config ghi đè thời hạn (kiểm thử dùng giá trị ngắn);
 * options.scrambler = false dùng bộ tráo dự phòng (không mở luồng phụ).
 */
function createOnline(dataDir, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const release = options.lock === false ? () => {} : acquireLock(dataDir);
  const log = options.log || ((event, data) => {
    if (process.env.NODE_ENV === 'test') return;
    console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
  });
  let store;
  let scrambler;
  try {
    store = new Store(path.join(dataDir, 'online.sqlite'));
    scrambler = new Scrambler({ worker: options.scrambler !== false, log });
  } catch (error) {
    release();
    store?.close();
    throw error;
  }
  const maintenanceFile = path.join(dataDir, 'maintenance');
  const service = new OnlineService({
    store, scrambler, config: options.config, log, clock: options.clock, timers: options.timers,
    maintenance: () => process.env.ONLINE_MAINTENANCE === '1' || fs.existsSync(maintenanceFile),
  }).start();
  const http = createOnlineHttp(service, {
    prefix: options.prefix,
    allowedOrigins: (process.env.ONLINE_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  const intervals = options.intervals === false ? [] : [
    setInterval(() => service.heartbeat(), service.config.heartbeatMs),
    setInterval(() => service.sweep(), 60000),
  ];
  for (const handle of intervals) handle.unref();
  let closed = false;
  return {
    service, store, scrambler, handle: http.handle, upgrade: http.upgrade,
    async close() {
      if (closed) return;
      closed = true;
      for (const handle of intervals) clearInterval(handle);
      service.shutdown();
      await scrambler.close();
      store.close();
      release();
    },
  };
}

module.exports = { createOnline, createOnlineHttp, readCookie, originAllowed, COOKIE };
