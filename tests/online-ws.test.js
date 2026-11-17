// Chạy: node tests/online-ws.test.js — HTTP + WebSocket thật, cookie riêng từng người, qua lớp chuyển tiếp như Hub.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { createRubikProxy, createRubikUpgrade, clientIp } = require('../scripts/hub-proxy.js');
const { protocol, C, P } = require('../server/online/engine.js');
const { encodeFrame } = require('../server/online/ws.js');

const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFIG = { inspectionMs: 600, prepareTimeoutMs: 3000, inspectionAckMs: 400, solveLimitMs: 20000 };

async function boot(dataDir) {
  const backend = await start(0, '127.0.0.1', root, { dataDir, online: { config: CONFIG, log: () => {} } });
  const port = backend.address().port;
  const proxy = createRubikProxy({ port });
  const upgrade = createRubikUpgrade({ port });
  const front = http.createServer((req, res) => proxy(req, res, () => { res.writeHead(404); res.end(); }));
  front.on('upgrade', (req, socket, head) => { if (!upgrade(req, socket, head)) socket.destroy(); });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  return { backend, front, port, frontPort: front.address().port };
}

function client(base, origin) {
  const jar = { cookie: '' };
  async function request(method, route, body, extraHeaders = {}) {
    const response = await fetch(base + route, {
      method, headers: { 'Content-Type': 'application/json', origin, ...(jar.cookie ? { cookie: jar.cookie } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = response.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0];
    return { status: response.status, data: await response.json(), setCookie: set };
  }
  return { jar, request };
}

function openWs(url, cookie, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
    const messages = [];
    const waiters = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      messages.push(msg);
      for (const w of [...waiters]) if (w.test(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    });
    const api = {
      ws, messages, closed: null,
      send: (msg) => ws.send(JSON.stringify(msg)),
      wait(test, ms = 4000) {
        const found = messages.find(test);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const w = { test, resolve: res };
          waiters.push(w);
          setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('Hết thời gian chờ bản tin')); } }, ms);
        });
      },
      next(test, ms) { messages.length = 0; return api.wait(test, ms); },
      snap() { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].type === 'room.snapshot') return messages[i]; return null; },
    };
    ws.addEventListener('close', (e) => { api.closed = e.code; });
    ws.addEventListener('open', () => resolve(api), { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket bị từ chối')), { once: true });
  });
}

// Gửi khung thô (kiểm tra giới hạn kích thước/khung nhị phân) qua socket TCP tự bắt tay.
function rawFrameTest(port, cookie, frame) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        upgraded = true;
        buffer = buffer.subarray(end + 4);
        socket.write(frame);
      }
      if (buffer.length >= 4 && (buffer[0] & 0x0f) === 0x8) { resolve(buffer.readUInt16BE(2)); socket.destroy(); }
    });
    socket.on('error', () => resolve(null));
    socket.write(['GET /api/online/ws HTTP/1.1', `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', `Cookie: ${cookie}`, '', ''].join('\r\n'));
  });
}
function masked(opcode, payload, fin = true) {
  const frame = encodeFrame(opcode, payload);
  const headerLen = frame.length - payload.length;
  const out = Buffer.alloc(frame.length + 4);
  frame.copy(out, 0, 0, headerLen);
  out[0] = (fin ? 0x80 : 0) | opcode;
  out[1] |= 0x80;
  const mask = Buffer.from([1, 2, 3, 4]);
  mask.copy(out, headerLen);
  for (let i = 0; i < payload.length; i++) out[headerLen + 4 + i] = payload[i] ^ mask[i & 3];
  return out;
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-online-ws-'));
  let env = await boot(temp);
  try {
    const base = `http://127.0.0.1:${env.frontPort}/api/rubik/online`;
    const origin = `http://127.0.0.1:${env.frontPort}`;
    const wsUrl = `ws://127.0.0.1:${env.frontPort}/api/rubik/online/ws`;
    const a = client(base, origin), b = client(base, origin), stranger = client(base, origin);

    // ---- HTTP: phiên, nguồn trang, tạo/vào, quyền đọc ----
    const meta = await a.request('GET', '/meta');
    assert.equal(meta.data.engineVersion, protocol.ENGINE_VERSION);
    assert.equal((await a.request('POST', '/rooms', { nickname: 'An' })).data.code, 'session_invalid');
    const session = await a.request('POST', '/session');
    assert.match(session.setCookie, /^rubik_guest=[^;]+; Path=\/api; Max-Age=\d+; HttpOnly; SameSite=Lax$/);
    await b.request('POST', '/session');
    await stranger.request('POST', '/session');
    const evil = await a.request('POST', '/rooms', { nickname: 'An' }, { origin: 'http://evil.example' });
    assert.equal(evil.status, 403, 'POST từ trang lạ bị chặn');
    const created = await a.request('POST', '/rooms', { nickname: 'An' });
    assert.equal(created.status, 200);
    const { roomId, code } = created.data;
    assert.equal((await b.request('POST', '/rooms/join', { code: code.toLowerCase(), nickname: 'an' })).data.code, 'nickname_taken');
    assert.equal((await b.request('POST', '/rooms/join', { code, nickname: 'Bình' })).status, 200);
    assert.equal((await stranger.request('GET', `/rooms/${roomId}`)).status, 404, 'người ngoài không đọc được phòng');
    assert.equal((await b.request('POST', '/session')).data.activeRoom.code, code);
    const big = await a.request('POST', '/rooms/join', { code, nickname: 'x'.repeat(5000) });
    assert.equal(big.status, 413);

    // IP thật cho giới hạn tần suất: yêu cầu nâng cấp không qua Express nên lấy từ chuỗi X-Forwarded-For.
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.5' }, socket: { remoteAddress: '127.0.0.1' } }), '203.0.113.5');
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '198.51.100.7' } }), '198.51.100.7');
    assert.equal(clientIp({ ip: '192.0.2.1', headers: { 'x-forwarded-for': '203.0.113.5' }, socket: { remoteAddress: '127.0.0.1' } }), '192.0.2.1');

    // ---- WebSocket: từ chối không cookie / trang lạ ----
    await assert.rejects(openWs(wsUrl, null, origin));
    await assert.rejects(openWs(wsUrl, a.jar.cookie, 'http://evil.example'));
    assert.equal(await rawFrameTest(env.port, a.jar.cookie, masked(0x1, Buffer.alloc(5000, 0x61))), 1009, 'bản tin quá 4 KiB bị đóng 1009');
    assert.equal(await rawFrameTest(env.port, a.jar.cookie, masked(0x2, Buffer.from([1, 2]))), 1003, 'khung nhị phân bị đóng 1003');

    // ---- Ván thật qua WebSocket ----
    const hello = (roomIdArg, clientId) => ({ type: 'hello', protocolVersion: protocol.PROTOCOL_VERSION, engineVersion: protocol.ENGINE_VERSION, roomId: roomIdArg, clientId });
    const A = await openWs(wsUrl, a.jar.cookie, origin);
    const B = await openWs(wsUrl, b.jar.cookie, origin);
    A.send(hello(roomId, 'a1'));
    B.send(hello(roomId, 'b1'));
    const welcome = await A.wait((m) => m.type === 'welcome');
    assert.equal(welcome.controlling, true);
    await B.wait((m) => m.type === 'welcome');
    A.send({ type: 'time.ping', t: 123 });
    const pong = await A.wait((m) => m.type === 'time.pong');
    assert.equal(pong.t, 123);
    assert.equal(typeof pong.serverTime, 'number');
    B.send({ type: 'room.ready', commandId: 'b-ready', ready: true });
    await B.wait((m) => m.commandId === 'b-ready' && m.type === 'command.ok');
    A.send({ type: 'room.start', commandId: 'a-start' });
    await A.wait((m) => m.commandId === 'a-start' && m.type === 'command.ok');
    const prepare = await B.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'PREPARING');
    assert.equal(prepare.round.startState, null);
    for (const X of [A, B]) X.send({ type: 'round.prepared', roundId: prepare.round.roundId, engineVersion: protocol.ENGINE_VERSION });
    const inspA = await A.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'INSPECTION');
    const inspB = await B.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'INSPECTION');
    assert.equal(inspA.round.startState, inspB.round.startState);
    assert.equal(inspA.round.t0, inspB.round.t0);
    assert(['random-state', 'random-moves'].includes(inspA.round.scrambleKind));
    assert.equal(P.applyAll(Array.from(C.SOLVED), inspA.round.scramble).join(''), inspA.round.startState, 'chuỗi tráo khớp khối phát ra');
    for (const X of [A, B]) X.send({ type: 'round.inspectionAck', roundId: inspA.round.roundId, stateHash: inspA.round.startHash });
    await A.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'RUNNING', 3000);

    // Lời giải: đảo chuỗi tráo (mỗi nước 180° là một nước).
    const solution = P.parseSequence(inspA.round.scramble).reverse().map((m) => P.toString(P.inverse(m)));
    async function solve(X, epoch, prefix, moves = solution) {
      let state = inspA.round.startState;
      let seq = 0;
      let last;
      for (const move of moves) {
        seq += 1;
        X.send({ type: 'attempt.move', commandId: `${prefix}-${seq}`, roundId: inspA.round.roundId, controlEpoch: epoch, moveSeq: seq, baseStateHash: protocol.stateHash(state), move });
        last = await X.wait((m) => m.commandId === `${prefix}-${seq}`);
        assert.equal(last.type, 'move.ack', JSON.stringify(last));
        state = protocol.applyMove(state, move);
      }
      return last;
    }
    const doneA = await solve(A, welcome.epoch, 'a');
    assert.equal(doneA.status, 'FINISHED');
    assert(doneA.elapsedMs > 0);

    // Bình mất kết nối giữa chừng, nối lại bằng cùng phiên (tab tải lại): nhận lại trạng thái máy chủ.
    const half = solution.slice(0, 3);
    const bWelcome = B.messages.find((m) => m.type === 'welcome');
    await solve(B, bWelcome.epoch, 'b', half);
    B.ws.close();
    await A.wait((m) => m.type === 'room.snapshot' && m.round?.attempts.some((x) => x.nickname === 'Bình' && x.disconnected));
    const B2 = await openWs(wsUrl, b.jar.cookie, origin);
    B2.send(hello(roomId, 'b1'));
    const bw2 = await B2.wait((m) => m.type === 'welcome');
    const resumed = await B2.wait((m) => m.type === 'room.snapshot');
    assert.equal(resumed.round.mine.moveSeq, 3);
    assert.equal(resumed.round.mine.state, half.reduce((s, m) => protocol.applyMove(s, m), inspA.round.startState));
    let state = resumed.round.mine.state;
    let seq = 3;
    for (const move of solution.slice(3)) {
      seq += 1;
      B2.send({ type: 'attempt.move', commandId: `b2-${seq}`, roundId: inspA.round.roundId, controlEpoch: bw2.epoch, moveSeq: seq, baseStateHash: protocol.stateHash(state), move });
      const ack = await B2.wait((m) => m.commandId === `b2-${seq}`);
      assert.equal(ack.type, 'move.ack');
      state = protocol.applyMove(state, move);
    }
    const final = await A.wait((m) => m.type === 'room.snapshot' && m.room.status === 'RESULTS');
    assert.equal(final.lastRound.status, 'FINALIZED');
    assert.equal(final.lastRound.attempts[0].nickname, 'An');
    assert.equal(final.lastRound.attempts[0].rank, 1);
    const history = await b.request('GET', `/rooms/${roomId}/rounds`);
    assert.equal(history.data.rounds.length, 1);
    const detail = await b.request('GET', `/rooms/${roomId}/rounds/${final.lastRound.roundId}`);
    assert.equal(detail.data.round.moves.length, solution.length * 2);
    assert.equal((await stranger.request('GET', `/rooms/${roomId}/rounds`)).status, 404);
    console.log('✓ HTTP/WebSocket qua lớp chuyển tiếp Hub: cookie phiên, chặn trang lạ, giới hạn khung, ván hai người, nối lại, lịch sử');

    // ---- Khởi động lại giữa ván: VOID cho cả phòng ----
    A.send({ type: 'room.next', commandId: 'a-next' });
    await A.wait((m) => m.commandId === 'a-next');
    B2.send({ type: 'room.ready', commandId: 'b2-ready', ready: true });
    await B2.wait((m) => m.commandId === 'b2-ready');
    A.send({ type: 'room.start', commandId: 'a-start-2' });
    const prep2 = await B2.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'PREPARING' && m.round.seq === 2);
    for (const X of [A, B2]) X.send({ type: 'round.prepared', roundId: prep2.round.roundId, engineVersion: protocol.ENGINE_VERSION });
    const insp2 = await A.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'INSPECTION' && m.round.seq === 2);
    for (const X of [A, B2]) X.send({ type: 'round.inspectionAck', roundId: insp2.round.roundId, stateHash: insp2.round.startHash });
    await A.wait((m) => m.type === 'room.snapshot' && m.round?.status === 'RUNNING' && m.round.seq === 2, 3000);
    const closedA = A.wait((m) => m.type === 'service.restarting');
    await new Promise((r) => { env.backend.close(r); env.backend.closeAllConnections(); });
    await closedA;
    await new Promise((r) => { env.front.close(r); env.front.closeAllConnections(); });
    await sleep(100);
    env = await boot(temp);
    const base2 = `http://127.0.0.1:${env.frontPort}/api/rubik/online`;
    const after = await fetch(`${base2}/rooms/${roomId}`, { headers: { cookie: a.jar.cookie } }).then((r) => r.json());
    assert.equal(after.room.status, 'RESULTS');
    assert.equal(after.lastRound.status, 'VOID');
    assert.equal(after.lastRound.reason, 'service_restart');
    const kept = await fetch(`${base2}/rooms/${roomId}/rounds/${final.lastRound.roundId}`, { headers: { cookie: a.jar.cookie } }).then((r) => r.json());
    assert.equal(kept.round.status, 'FINALIZED');
    console.log('✓ Khởi động lại tiến trình giữa ván: ván đang thi VOID service_restart, ván đã chốt đọc lại được');
    console.log('Thi trực tiếp: giao thức HTTP/WebSocket PASS');
  } finally {
    env.front.close();
    env.backend.close();
    env.backend.closeAllConnections?.();
    await sleep(100);
    fs.rmSync(temp, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
