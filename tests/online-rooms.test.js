// Chạy: node tests/online-rooms.test.js — luật Thi trực tiếp với đồng hồ giả, lưu trữ SQLite thật trong thư mục tạm.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../server/online/store.js');
const { OnlineService, OnlineError } = require('../server/online/service.js');
const { protocol, C, P, randomCubie, fromCubie } = require('../server/online/engine.js');

class FakeTime {
  constructor() { this.t = 1000; this.base = 1_800_000_000_000; this.queue = []; this.seq = 0; }
  now = () => this.t;
  wall = () => this.base + this.t;
  set = (fn, ms) => { const h = { at: this.t + Math.max(0, ms), fn, id: this.seq++ }; this.queue.push(h); return h; };
  clear = (h) => { const i = this.queue.indexOf(h); if (i >= 0) this.queue.splice(i, 1); };
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const h = this.queue[0];
      if (!h || h.at > end) break;
      this.queue.shift();
      this.t = h.at;
      h.fn();
    }
    this.t = end;
  }
}

class FakeWs {
  constructor() { this.sent = []; this.closed = null; }
  send(text) { this.sent.push(JSON.parse(text)); }
  close(code) { this.closed = code; }
  terminate() { this.closed = 'terminated'; }
  ping() {}
}

const SCRAMBLE = "R U F'";
const START = P.applyAll(Array.from(C.SOLVED), SCRAMBLE).join('');
const SOLUTION = ['F', "U'", "R'"];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-online-'));
const stores = [];
let nextCommand = 0;
let fileNo = 0;

function setup(config = {}, file = path.join(temp, `db-${fileNo++}.sqlite`)) {
  const time = new FakeTime();
  const store = new Store(file);
  stores.push(store);
  let maintenance = false;
  const service = new OnlineService({
    store, config, clock: time, timers: time, maintenance: () => maintenance,
    scrambler: { take: () => ({ scramble: SCRAMBLE, state: START, kind: 'test' }), ready: 1 },
  }).start();
  const sessions = [];
  const guest = () => { const s = service.ensureSession(null); sessions.push(s); return s.guestId; };
  let clientNo = 0;
  function client(guestId, roomId, clientId = `tab-${clientNo++}`) {
    const ws = new FakeWs();
    const conn = service.attach(guestId, ws);
    const c = {
      ws, conn, guestId, cmd: 0,
      send(msg) { service.receive(conn, JSON.stringify(msg)); },
      last(type) { for (let i = ws.sent.length - 1; i >= 0; i--) if (ws.sent[i].type === type) return ws.sent[i]; return null; },
      all(type) { return ws.sent.filter((m) => m.type === type); },
      snap() { return c.last('room.snapshot'); },
      command(type, extra = {}) {
        const commandId = `${type}-${nextCommand++}`;
        c.send({ type, commandId, ...extra });
        return ws.sent.slice().reverse().find((m) => m.commandId === commandId);
      },
      drop() { service.detach(conn); },
      state: null, seq: 0,
      // Gửi một nước theo trạng thái mình đang giữ (giống máy khách), trả về phản hồi của máy chủ.
      move(move, overrides = {}) {
        const snap = c.snap();
        const round = snap.round;
        const msg = {
          type: 'attempt.move', commandId: `mv-${nextCommand++}`, roundId: round.roundId, controlEpoch: snap.me.epoch,
          moveSeq: c.seq + 1, baseStateHash: protocol.stateHash(c.state), move, ...overrides,
        };
        c.send(msg);
        const reply = ws.sent[ws.sent.length - 1].commandId === msg.commandId ? ws.sent[ws.sent.length - 1]
          : ws.sent.slice().reverse().find((m) => m.commandId === msg.commandId);
        if (reply.type === 'move.ack' && !overrides.keep) { c.state = protocol.applyMove(c.state, move); c.seq = reply.moveSeq; }
        return { reply, msg };
      },
    };
    c.send({ type: 'hello', protocolVersion: protocol.PROTOCOL_VERSION, engineVersion: protocol.ENGINE_VERSION, roomId, clientId });
    return c;
  }
  return { time, store, service, guest, client, setMaintenance: (v) => { maintenance = v; } };
}

function expectError(fn, code) {
  assert.throws(fn, (e) => e instanceof OnlineError && e.code === code, `cần lỗi ${code}`);
}

// Hai người vào phòng, sẵn sàng, bắt đầu và tới lúc thi (T0).
function raceOf(env, names = ['An', 'Bình']) {
  const { service, guest, client, time } = env;
  const guests = names.map(() => guest());
  const { roomId, code } = service.createRoom(guests[0], names[0]);
  for (let i = 1; i < names.length; i++) { time.advance(1); service.joinRoom(guests[i], code, names[i]); }
  const clients = guests.map((g) => client(g, roomId));
  for (const c of clients.slice(1)) assert.equal(c.command('room.ready', { ready: true }).type, 'command.ok');
  assert.equal(clients[0].command('room.start').type, 'command.ok');
  const prep = clients[0].snap().round;
  for (const c of clients) c.send({ type: 'round.prepared', roundId: prep.roundId, engineVersion: protocol.ENGINE_VERSION });
  for (const c of clients) {
    const r = c.snap().round;
    assert.equal(r.status, 'INSPECTION');
    c.send({ type: 'round.inspectionAck', roundId: r.roundId, stateHash: r.startHash });
    c.state = r.startState;
    c.seq = 0;
  }
  time.advance(service.config.inspectionMs);
  for (const c of clients) assert.equal(c.snap().round.status, 'RUNNING');
  return { roomId, code, guests, clients, room: service.rooms.get(roomId) };
}

// ---------- 1. Mô hình, mã phòng, biệt danh ----------
{
  for (let i = 0; i < 200; i++) {
    const state = fromCubie(randomCubie());
    C.verifyCubie(C.toCubie(state));
    assert.equal(fromCubie(C.toCubie(state)), state);
  }
  assert(protocol.isMove('Rw') && protocol.isMove("M'") && protocol.isMove('S2') && protocol.isMove("Dw'"));
  for (const bad of ['x', 'R3', 'r', "R2'", 'R U', '', 'Rw2x', 5, null]) assert(!protocol.isMove(bad), String(bad));
  // Lớp giữa làm tâm đổi chỗ: máy chủ vẫn nhận ra đã giải (không đòi tâm ở hướng ban đầu).
  const moved = protocol.applyMove(protocol.applyMove(C.SOLVED, 'Rw'), "L'");
  assert(protocol.isSolved(moved) && moved !== C.SOLVED);
  assert.equal(protocol.normalizeNickname('  Hoàn   Nguyễn ').name, 'Hoàn Nguyễn');
  assert.equal(protocol.normalizeNickname('A'), null);
  assert.equal(protocol.normalizeNickname('x'.repeat(21)), null);
  assert.equal(protocol.normalizeNickname('An' + String.fromCodePoint(0x200b)), null);
  assert.equal(protocol.normalizeNickname('An' + String.fromCodePoint(0x7)), null);
  assert.equal(protocol.normalizeCode(' h7k9-q2xm '), 'H7K9Q2XM');
  assert(protocol.isCode('H7K9Q2XM') && !protocol.isCode('H7K9Q2X0') && !protocol.isCode('H7K9Q2X'));
  const ranked = OnlineService.rank([
    { status: 'FINISHED', elapsedMs: 58129, rankTime: 5812 }, { status: 'DNF', elapsedMs: null, rankTime: null },
    { status: 'FINISHED', elapsedMs: 58121, rankTime: 5812 }, { status: 'FINISHED', elapsedMs: 100070, rankTime: 10007 },
  ]);
  assert.deepEqual(ranked.map((a) => a.rank), [1, 1, 3, null]);
  console.log('✓ Mô hình/bộ tráo, nước hợp lệ, biệt danh, mã phòng, xếp hạng đồng hạng 1-1-3');
}

// ---------- 2. Phiên, tạo/vào phòng ----------
{
  const env = setup();
  const { service, guest, time } = env;
  const s = service.ensureSession(null);
  assert(s.token && service.resolveGuest(s.token) === s.guestId);
  assert.equal(service.ensureSession(s.token).token, null);
  time.advance(service.config.sessionTtlMs + 1);
  assert.equal(service.resolveGuest(s.token), null, 'phiên hết hạn sau 24 giờ không hoạt động');

  const a = guest(), b = guest(), c = guest();
  expectError(() => service.createRoom(a, 'A'), 'nickname_invalid');
  const { roomId, code } = service.createRoom(a, 'An');
  assert(protocol.isCode(code));
  expectError(() => service.createRoom(a, 'An khác'), 'session_in_other_room');
  expectError(() => service.joinRoom(b, 'ABC', 'Bình'), 'code_invalid');
  expectError(() => service.joinRoom(b, 'ZZZZZZZZ', 'Bình'), 'room_not_found');
  expectError(() => service.joinRoom(b, code.toLowerCase(), 'an'), 'nickname_taken');
  assert.equal(service.joinRoom(b, code.toLowerCase(), 'Bình').roomId, roomId);
  assert.equal(service.joinRoom(b, code, 'Tên khác').rejoined, true, 'cùng phiên vào lại khôi phục người cũ');
  expectError(() => service.roomSnapshot(c, roomId), 'room_not_found');
  for (let i = 0; i < 6; i++) service.joinRoom(guest(), code, `Người ${i}`);
  expectError(() => service.joinRoom(c, code, 'Chi'), 'room_full');
  env.setMaintenance(true);
  expectError(() => service.createRoom(c, 'Chi'), 'service_unavailable');
  console.log('✓ Phiên khách hết hạn, biệt danh trùng/sai, mã sai, đầy phòng, một phòng/phiên, bảo trì chặn tạo phòng');
}

// ---------- 3. Điều kiện bắt đầu, cùng đề, xác minh nước, chống trùng, hòa ----------
{
  const env = setup();
  const { service, guest, client, time, store } = env;
  const a = guest(), b = guest();
  const { roomId, code } = service.createRoom(a, 'An');
  const A = client(a, roomId);
  assert.equal(A.command('room.start').code, 'too_few_players');
  service.joinRoom(b, code, 'Bình');
  assert.equal(A.command('room.start').code, 'not_all_ready');
  assert.equal(A.snap().blockers[0].code, 'member_disconnected');
  const B = client(b, roomId);
  assert.deepEqual(A.snap().blockers.map((x) => x.code), ['member_unready']);
  assert.equal(B.command('room.start').code, 'not_host');
  B.command('room.ready', { ready: true });
  assert.equal(A.command('room.start').type, 'command.ok');
  const prep = B.snap().round;
  assert.equal(prep.status, 'PREPARING');
  assert.equal(prep.startState, null, 'chưa phát khối trước mốc quan sát (BR-09)');
  A.send({ type: 'round.prepared', roundId: prep.roundId, engineVersion: protocol.ENGINE_VERSION });
  B.send({ type: 'round.prepared', roundId: prep.roundId, engineVersion: protocol.ENGINE_VERSION });
  const ra = A.snap().round, rb = B.snap().round;
  assert.equal(ra.status, 'INSPECTION');
  assert.equal(ra.startState, rb.startState);
  assert.equal(ra.startHash, protocol.stateHash(START));
  assert.equal(ra.t0, rb.t0);
  assert.equal(ra.t0 - ra.ti, 15000);
  for (const [c, r] of [[A, ra], [B, rb]]) {
    c.send({ type: 'round.inspectionAck', roundId: r.roundId, stateHash: r.startHash });
    c.state = r.startState;
  }
  assert.equal(A.move(SOLUTION[0]).reply.code, 'round_not_running', 'không nhận nước trước giờ');
  time.advance(14999);
  assert.equal(A.snap().round.status, 'INSPECTION');
  time.advance(1);
  assert.equal(A.snap().round.status, 'RUNNING');

  time.advance(1000);
  const first = A.move(SOLUTION[0]);
  assert.equal(first.reply.type, 'move.ack');
  assert.equal(first.reply.moveSeq, 1);
  A.send(first.msg); // gửi lại do mất phản hồi
  assert.deepEqual({ ...A.ws.sent.at(-1), serverTime: 0 }, { ...first.reply, serverTime: 0 });
  assert.equal(service.rooms.get(roomId).round.attempts.get(A.snap().me.memberId).moveSeq, 1, 'gửi lại không xoay thêm');
  A.send({ ...first.msg, move: 'R' });
  assert.equal(A.ws.sent.at(-1).code, 'command_conflict');
  assert.equal(A.move('R', { moveSeq: 5, keep: true }).reply.code, 'seq_gap');
  assert.equal(A.move('R', { baseStateHash: '00000000', keep: true }).reply.code, 'state_mismatch');
  assert.equal(A.move('x', { keep: true }).reply.code, 'invalid_move');
  assert.equal(A.move('R', { controlEpoch: 99, keep: true }).reply.code, 'stale_epoch');
  assert.equal(A.move('R', { roundId: 'v_khac', keep: true }).reply.code, 'wrong_round');
  A.send({ type: 'attempt.solved', commandId: 'fake' });
  assert.equal(A.ws.sent.at(-1).code, 'malformed', 'không có lệnh tự khai đã giải (BR-15)');

  time.advance(2000);
  A.move(SOLUTION[1]);
  const finish = A.move(SOLUTION[2]).reply;
  assert.equal(finish.status, 'FINISHED');
  assert.equal(finish.elapsedMs, 3000);
  assert.equal(A.move('R', { keep: true }).reply.code, 'attempt_finished', 'kết quả ghi đúng một lần (BR-16)');
  const view = B.snap().round.attempts.find((x) => x.nickname === 'An');
  assert.equal(view.status, 'FINISHED');
  assert.equal(view.elapsedMs, 3000);
  assert.equal(B.snap().round.mine.state, START, 'đối thủ không nhận chuỗi nước/khối của nhau');

  // Bình xong ở 3,009 giây: cùng phần trăm giây 300 → đồng hạng.
  time.advance(7);
  B.move(SOLUTION[0]); B.move(SOLUTION[1]);
  time.advance(2);
  B.move(SOLUTION[2]);
  const res = A.snap();
  assert.equal(res.room.status, 'RESULTS');
  assert.equal(res.lastRound.status, 'FINALIZED');
  assert.deepEqual(res.lastRound.attempts.map((x) => [x.nickname, x.rank, x.elapsedMs, x.moveCount]), [['An', 1, 3000, 3], ['Bình', 1, 3009, 3]]);
  const saved = store.getRound(roomId, res.lastRound.roundId);
  assert.equal(saved.status, 'FINALIZED');
  assert.equal(saved.moves.length, 6);
  assert.equal(saved.attempts.length, 2);
  console.log('✓ Điều kiện bắt đầu, cùng khối/mốc, chặn nước trước T0, gửi lại/xung đột/thiếu thứ tự/lệch trạng thái, hòa phần trăm giây, lưu ván');
}

// ---------- 4. Hết giờ, bỏ cuộc, rời phòng khi đang thi, chủ rời → chuyển chủ ở RESULTS ----------
{
  const env = setup();
  const { service, time } = env;
  const { clients: [A, B, Cc], room } = raceOf(env, ['An', 'Bình', 'Chi']);
  assert.equal(B.command('attempt.surrender', { roundId: B.snap().round.roundId }).type, 'command.ok');
  const hostId = room.hostMemberId;
  assert.equal(A.command('room.leave').type, 'command.ok');
  assert.equal(A.last('room.removed').code, 'left');
  assert.equal(room.hostMemberId, hostId, 'không chuyển chủ giữa ván (BR-22)');
  assert.equal(Cc.snap().round.status, 'RUNNING', 'ván tiếp tục khi chủ rời');
  time.advance(service.config.solveLimitMs);
  const snap = Cc.snap();
  assert.equal(snap.room.status, 'RESULTS');
  assert.deepEqual(snap.lastRound.attempts.map((x) => [x.nickname, x.status, x.endReason]).sort(),
    [['An', 'DNF', 'left'], ['Bình', 'DNF', 'surrendered'], ['Chi', 'DNF', 'timeout']]);
  assert(snap.lastRound.attempts.every((x) => x.rank === null), 'tất cả DNF thì không có người thắng');
  assert.equal(snap.room.hostMemberId, B.snap().me.memberId, 'chủ mới là người còn kết nối vào sớm nhất');
  assert(B.snap().me.isHost);
  console.log('✓ Bỏ cuộc, rời khi đang thi = DNF, hết 600 giây = DNF, chủ rời giữa ván chỉ chuyển chủ khi có kết quả');
}

// ---------- 5. Mất kết nối cộng dồn (EX-20) và nối lại giữ giờ/khối (AC-05) ----------
{
  const env = setup();
  const { service, client, time } = env;
  const { clients: [A, B], roomId, guests } = raceOf(env);
  time.advance(1000);
  B.move(SOLUTION[0]);
  B.drop();
  assert.equal(A.snap().round.attempts.find((x) => x.nickname === 'Bình').disconnected, true);
  time.advance(10000);
  const B2 = client(guests[1], roomId, 'tab-b2');
  const mine = B2.snap().round.mine;
  assert.equal(mine.status, 'RACING');
  assert.equal(mine.moveSeq, 1, 'nối lại nhận trạng thái máy chủ, không về khối tráo');
  assert.equal(mine.reconnectUsedMs, 10000);
  assert.equal(B2.snap().serverTime - B2.snap().round.t0, 11000, 'đồng hồ vẫn chạy khi mất kết nối');
  B2.drop();
  time.advance(15000);
  const B3 = client(guests[1], roomId, 'tab-b3');
  assert.equal(B3.snap().round.mine.reconnectUsedMs, 25000);
  B3.drop();
  time.advance(34999);
  assert.equal(A.snap().round.attempts.find((x) => x.nickname === 'Bình').status, 'RACING');
  time.advance(1);
  const b = A.snap().round.attempts.find((x) => x.nickname === 'Bình');
  assert.equal(b.status, 'DNF');
  assert.equal(b.endReason, 'reconnect_timeout', 'tổng ngắt vượt 60 giây dù mỗi lần dưới hạn');
  const B4 = client(guests[1], roomId, 'tab-b4');
  assert.equal(B4.snap().round.mine.status, 'DNF', 'nối lại sau khi DNF chỉ xem, không tiếp tục');
  console.log('✓ Mất kết nối: giờ vẫn chạy, nối lại nhận khối máy chủ, ngắt cộng dồn 10+15+35 giây → DNF reconnect_timeout');
}

// ---------- 6. Hủy trước giờ, đếm hủy liên tiếp, bắt đầu không có người gây hủy ----------
{
  const env = setup();
  const { service, client, time, guest } = env;
  const a = guest(), b = guest(), c = guest();
  const { roomId, code } = service.createRoom(a, 'An');
  service.joinRoom(b, code, 'Bình');
  service.joinRoom(c, code, 'Chi');
  const A = client(a, roomId);
  let B = client(b, roomId);
  const Cc = client(c, roomId);
  for (let round = 1; round <= 2; round++) {
    B.command('room.ready', { ready: true });
    Cc.command('room.ready', { ready: true });
    assert.equal(A.command('room.start').type, 'command.ok');
    const r = A.snap().round;
    for (const x of [A, B, Cc]) x.send({ type: 'round.prepared', roundId: r.roundId, engineVersion: protocol.ENGINE_VERSION });
    assert.equal(A.snap().round.status, 'INSPECTION');
    B.drop();
    const snap = A.snap();
    assert.equal(snap.room.status, 'LOBBY');
    assert.equal(snap.lastRound.status, 'CANCELLED');
    assert.equal(snap.lastRound.reason, 'member_disconnected');
    assert(snap.members.every((m) => !m.ready), 'hủy chuẩn bị bỏ mọi sẵn sàng');
    B = client(b, roomId, `b-${round}`);
  }
  B.command('room.ready', { ready: false });
  Cc.command('room.ready', { ready: true });
  const bView = A.snap().members.find((m) => m.nickname === 'Bình');
  assert.equal(bView.cancelStreak, 2);
  assert.equal(bView.excludable, true);
  assert.equal(A.command('room.start').code, 'not_all_ready');
  assert.equal(A.command('room.start', { exclude: [bView.memberId] }).type, 'command.ok');
  const r = A.snap().round;
  assert.equal(r.participants.length, 2);
  assert.equal(B.snap().me.standing, 'WAITING_NEXT', 'người bị để sang ván sau chờ, không bị loại');
  // Thiếu xác nhận chuẩn bị trong 10 giây → hủy lý do timeout.
  A.send({ type: 'round.prepared', roundId: r.roundId, engineVersion: protocol.ENGINE_VERSION });
  time.advance(service.config.prepareTimeoutMs);
  assert.equal(A.snap().lastRound.reason, 'timeout');
  assert.equal(B.snap().me.standing, 'ACTIVE');
  // Phiên bản mô hình khác: chặn sẵn sàng (EX-15).
  const d = guest();
  service.joinRoom(d, code, 'Dũng');
  const D = env.client(d, roomId);
  D.send({ type: 'hello' }); // bỏ qua: đã chào
  const old = service.attach(d, new FakeWs());
  service.receive(old, JSON.stringify({ type: 'hello', protocolVersion: protocol.PROTOCOL_VERSION, engineVersion: 'pm0-cu', roomId, clientId: 'cu' }));
  service.receive(old, JSON.stringify({ type: 'control.claim' }));
  service.receive(old, JSON.stringify({ type: 'room.ready', commandId: 'r1', ready: true }));
  assert.equal(old.transport.sent.at(-1).code, 'version_mismatch');
  assert.equal(D.last('control.revoked').type, 'control.revoked');
  console.log('✓ Mất kết nối khi quan sát → CANCELLED, 2 lần hủy do cùng người → chủ bắt đầu không có người đó, hết hạn chuẩn bị, chặn bản cũ');
}

// ---------- 7. Hai tab, loại thành viên, chuyển chủ khi chủ vắng, người vào giữa ván ----------
{
  const env = setup();
  const { service, client, time, guest } = env;
  const { clients: [A, B], roomId, code, guests, room } = raceOf(env);
  const late = guest();
  assert.equal(service.joinRoom(late, code, 'Đến muộn').rejoined, false);
  const L = client(late, roomId);
  assert.equal(L.snap().me.standing, 'WAITING_NEXT');
  assert.equal(L.snap().round.mine, null, 'người vào giữa ván không có lượt');

  const B2 = client(guests[1], roomId, 'tab-khac');
  assert.equal(B2.last('welcome').controlling, false, 'tab mới không tự lấy quyền khi tab cũ còn kết nối');
  assert.equal(B2.command('room.ready', { ready: true }).code, 'stale_epoch');
  B2.send({ type: 'control.claim' });
  assert.equal(B.last('control.revoked').type, 'control.revoked');
  time.advance(500);
  assert.equal(B.move(SOLUTION[0]).reply.code, 'stale_epoch', 'tab cũ hết quyền gửi nước (BR-03)');

  assert.equal(A.command('room.kick', { memberId: L.snap().me.memberId }).code, 'wrong_room_state', 'không loại khi đang thi');
  for (const c of [A, B2]) c.state = c.snap().round.startState;
  for (const c of [A, B2]) for (const m of SOLUTION) c.move(m);
  assert.equal(A.snap().room.status, 'RESULTS');
  assert.equal(L.snap().me.standing, 'WAITING_NEXT');
  assert.equal(A.command('room.next').type, 'command.ok');
  assert.equal(L.snap().me.standing, 'ACTIVE');
  assert.equal(A.command('room.kick', { memberId: A.snap().me.memberId }).code, 'member_not_eligible');
  assert.equal(A.command('room.kick', { memberId: L.snap().me.memberId }).type, 'command.ok');
  assert.equal(L.last('room.removed').code, 'room_banned');
  expectError(() => service.joinRoom(late, code, 'Tên mới'), 'room_banned');
  expectError(() => service.roomSnapshot(late, roomId), 'room_banned');
  assert(!A.snap().members.some((m) => m.nickname === 'Đến muộn'));

  assert.equal(B2.command('room.rename', { nickname: 'an' }).code, 'nickname_taken');
  assert.equal(B2.command('room.rename', { nickname: 'Bình mới' }).type, 'command.ok');
  A.drop();
  time.advance(service.config.hostAwayMs - 1000);
  assert.equal(room.hostMemberId, A.snap().me.memberId);
  time.advance(2000);
  assert.equal(B2.snap().room.hostMemberId, B2.snap().me.memberId, 'chủ mất kết nối quá 60 giây thì chuyển');
  console.log('✓ Người vào giữa ván chờ ván sau, tab mới phải lấy quyền, loại/chặn chỉ ngoài ván, đổi tên, chủ vắng 60 giây thì chuyển');
}

// ---------- 8. Khởi động lại dịch vụ (BR-25) và lỗi lưu khi chốt ván ----------
{
  const file = path.join(temp, 'restart.sqlite');
  const env = setup({}, file);
  const { clients: [A, B], roomId } = raceOf(env);
  for (const m of SOLUTION) { A.move(m); B.move(m); }
  const finalized = A.snap().lastRound.roundId;
  assert.equal(A.command('room.next').type, 'command.ok');
  B.command('room.ready', { ready: true });
  A.command('room.start');
  let r = A.snap().round;
  for (const c of [A, B]) c.send({ type: 'round.prepared', roundId: r.roundId, engineVersion: protocol.ENGINE_VERSION });
  r = A.snap().round;
  for (const c of [A, B]) { c.send({ type: 'round.inspectionAck', roundId: r.roundId, stateHash: r.startHash }); c.state = r.startState; c.seq = 0; }
  env.time.advance(env.service.config.inspectionMs + 500);
  A.move(SOLUTION[0]);
  const running = A.snap().round.roundId;

  // "Khởi động lại": tiến trình mới mở cùng tệp dữ liệu.
  const env2 = setup({}, file);
  const room = env2.service.rooms.get(roomId);
  assert.equal(room.status, 'RESULTS');
  assert.equal(room.lastRound.status, 'VOID');
  assert.equal(room.lastRound.reason, 'service_restart');
  assert.equal(env2.store.getRound(roomId, running).status, 'VOID');
  assert.equal(env2.store.getRound(roomId, finalized).attempts.length, 2, 'ván đã chốt trước sự cố giữ nguyên');

  const env3 = setup();
  const race = raceOf(env3);
  for (const m of SOLUTION) race.clients[0].move(m);
  env3.store.failWrites = 1;
  for (const m of SOLUTION) race.clients[1].move(m);
  const snap = race.clients[0].snap();
  assert.equal(snap.lastRound.status, 'VOID');
  assert.equal(snap.lastRound.reason, 'storage_failure');
  assert.equal(snap.lastRound.attempts.length, 0, 'không công bố bảng hạng khi không lưu được');
  console.log('✓ Khởi động lại: ván đang thi VOID, ván đã chốt giữ nguyên; lỗi ghi khi chốt → VOID storage_failure');
}

// ---------- 9. Giới hạn tốc độ nước, đóng phòng, dọn phòng vắng ----------
{
  const env = setup({ roomIdleMs: 60000 });
  const { service, time, guest } = env;
  const { clients: [A], room } = raceOf(env);
  let limited = 0;
  for (let i = 0; i < 60; i++) {
    const m = i % 2 ? "R'" : 'R';
    if (A.move(m).reply.code === 'rate_limited') limited++;
  }
  assert(limited >= 19, 'dồn quá 40 nước tức thì bị giới hạn');
  time.advance(service.config.solveLimitMs);
  assert.equal(A.snap().room.status, 'RESULTS');
  assert.equal(A.command('room.close').type, 'command.ok');
  assert.equal(A.last('room.removed').code, 'room_closed');
  assert(!service.rooms.has(room.id));
  const g = guest();
  const { roomId } = service.createRoom(g, 'Vắng');
  time.advance(60000);
  service.sweep();
  assert(!service.rooms.has(roomId), 'phòng không ai kết nối quá hạn thì đóng');
  console.log('✓ Giới hạn dồn nước, đóng phòng, dọn phòng vắng');
}

// ---------- 10. Hồi quy sau rà soát: giới hạn tài nguyên, ghi lỗi giữa chừng, ranh giới T0, hủy liên tiếp ----------
{
  const env = setup();
  const { service, client, time, guest, store } = env;
  const { clients: [A, B], roomId, guests, room } = raceOf(env);
  // Biên nhận nước có giới hạn và không giữ trường thừa.
  for (let i = 0; i < 100; i++) {
    time.advance(60);
    const reply = A.move(i % 2 ? "R'" : 'R', { padding: 'x'.repeat(3000) }).reply;
    assert.equal(reply.type, 'move.ack');
  }
  const attempt = room.round.attempts.get(A.snap().me.memberId);
  assert(attempt.receipts.size <= service.config.moveReceiptLimit, 'chỉ nhớ phản hồi các nước gần nhất');
  assert(![...attempt.receipts.values()].some((r) => r.fingerprint.length > 120), 'không lưu trường thừa');
  // Hai tab tranh quyền liên tục: bị giới hạn, không phát bản chụp vô hạn cho cả phòng.
  const B2 = client(guests[1], roomId, 'tab-b-flood');
  const before = A.ws.sent.length;
  let limited = 0;
  for (let i = 0; i < 60; i++) {
    for (const X of [B2, B]) { X.send({ type: 'control.claim' }); if (X.ws.sent.at(-1).code === 'rate_limited') limited++; }
    B.send({ type: 'room.sync' });
  }
  assert(limited > 40, 'lấy quyền/đồng bộ dồn dập bị giới hạn');
  assert(A.ws.sent.length - before < 60, 'người khác không bị dội bản chụp');
  // Mất kết nối ngay sau T0 nhưng trước khi bộ hẹn giờ chạy: áp luật ván đang thi, không hủy ván.
  time.advance(service.config.solveLimitMs);
  A.command('room.next');
  const Bc = client(guests[1], roomId, 'tab-b-new');
  Bc.send({ type: 'control.claim' });
  assert.equal(Bc.command('room.ready', { ready: true }).type, 'command.ok');
  A.command('room.start');
  let r = A.snap().round;
  for (const X of [A, Bc]) X.send({ type: 'round.prepared', roundId: r.roundId, engineVersion: protocol.ENGINE_VERSION });
  r = A.snap().round;
  for (const X of [A, Bc]) X.send({ type: 'round.inspectionAck', roundId: r.roundId, stateHash: r.startHash });
  time.t = r.t0 + 3; // bộ hẹn giờ trễ
  Bc.drop();
  const after = A.snap().round;
  assert.equal(after.status, 'RUNNING', 'mất kết nối sau T0 không hủy ván (EX-05)');
  assert.equal(after.attempts.find((x) => x.nickname === 'Bình').disconnected, true);
  time.advance(1);
  console.log('✓ Biên nhận có giới hạn, chống dội lấy quyền/đồng bộ, mất kết nối đúng sau T0 theo luật ván đang thi');
}
{
  const env = setup();
  const { service, client, time, guest, store } = env;
  const a = guest(), b = guest(), c = guest();
  const { roomId, code } = service.createRoom(a, 'An');
  time.advance(1); service.joinRoom(b, code, 'Bình');
  time.advance(1); service.joinRoom(c, code, 'Chi');
  const A = client(a, roomId), B = client(b, roomId), Cc = client(c, roomId);
  // Ghi hỏng đúng lúc hủy ván: lần bắt đầu sau vẫn được (đóng ván cũ còn "đang chạy" trong tệp).
  const cancelWith = (blame, failCancelWrite = false) => {
    B.command('room.ready', { ready: true }); Cc.command('room.ready', { ready: true });
    assert.equal(A.command('room.start').type, 'command.ok');
    const r = A.snap().round;
    for (const X of [A, B, Cc]) if (X !== blame) X.send({ type: 'round.prepared', roundId: r.roundId, engineVersion: protocol.ENGINE_VERSION });
    if (failCancelWrite) store.failWrites = 1;
    time.advance(service.config.prepareTimeoutMs);
    assert.equal(A.snap().lastRound.reason, 'timeout');
  };
  cancelWith(B, true);
  assert.equal(store.get("SELECT COUNT(*) AS n FROM rounds WHERE status IN ('PREPARING','INSPECTION','RUNNING')").n, 1, 'tệp còn ván dang dở vì ghi hỏng');
  cancelWith(Cc);
  assert.equal(store.get("SELECT COUNT(*) AS n FROM rounds WHERE status IN ('PREPARING','INSPECTION','RUNNING')").n, 0);
  cancelWith(B);
  const streak = (name) => A.snap().members.find((m) => m.nickname === name).cancelStreak;
  assert.equal(streak('Bình'), 1, 'B, C, B không phải hai lần liên tiếp do B (BR-11)');
  assert.equal(streak('Chi'), 0);
  cancelWith(B);
  assert.equal(streak('Bình'), 2);
  // Kết nối không chào vào phòng thì bị đóng; một phiên không giữ quá nhiều kết nối.
  const idle = service.attach(a, new FakeWs());
  time.advance(service.config.helloTimeoutMs + 1);
  service.heartbeat();
  assert(!service.conns.has(idle), 'kết nối không gửi hello bị đóng');
  const many = Array.from({ length: 9 }, () => service.attach(c, new FakeWs()));
  assert.equal([...service.conns].filter((x) => x.guestId === c).length, service.config.maxConnsPerGuest);
  assert(many.slice(-service.config.maxConnsPerGuest).every((x) => service.conns.has(x)), 'giữ các kết nối mới nhất');
  console.log('✓ Ghi hỏng khi hủy ván không khóa phòng, hủy liên tiếp đúng nghĩa, đóng kết nối không chào, giới hạn kết nối mỗi phiên');
}

for (const s of stores) s.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log('Thi trực tiếp: luật phòng/ván/lượt PASS');
