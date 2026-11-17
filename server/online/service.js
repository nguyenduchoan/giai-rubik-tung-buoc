/*
 * Nghiệp vụ Thi trực tiếp (docs/ke-hoach-phong-thi-dau-online.md): phòng, thành viên, ván, lượt giải và đồng hồ.
 * Máy chủ là nơi duy nhất quyết định giờ và kết quả: áp dụng từng nước lên bản sao khối, tự nhận biết khối đã giải.
 * Mọi lệnh của một tiến trình được xử lý tuần tự (JavaScript đơn luồng, lưu trữ đồng bộ), nên không có hai lệnh của
 * cùng phòng chạy đồng thời. Ván đang chạy sống trong bộ nhớ; chỉ ghi bền vững ở ranh giới phòng/ván (D-10).
 * Đồng hồ (clock.now đơn điệu, clock.wall giờ hệ thống) và bộ hẹn giờ được truyền vào để kiểm thử điều khiển thời gian.
 */
'use strict';
const crypto = require('node:crypto');
const { protocol } = require('./engine.js');
const { StoreError } = require('./store.js');

const DEFAULT_CONFIG = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  inspectionMs: 15000,
  countdownMs: 3000,
  solveLimitMs: 600000,
  prepareTimeoutMs: 10000,
  inspectionAckMs: 5000,
  heartbeatMs: 5000,
  disconnectAfterMs: 10000,
  reconnectBudgetMs: 60000,
  hostAwayMs: 60000,
  absentExcludeMs: 60000,
  excludeAfterCancels: 2,
  roomIdleMs: 30 * 60000,
  roomMaxAgeMs: 4 * 3600000,
  sessionTtlMs: 24 * 3600000,
  sessionTouchMs: 10 * 60000,
  retentionMs: 7 * 24 * 3600000,
  maxRooms: 200,
  maxConnections: 600,
  moveRate: 20,
  moveBurst: 40,
  commandRate: 5,
  commandBurst: 20,
  receiptLimit: 256,
  moveReceiptLimit: 64,
  pingRate: 10,
  pingBurst: 20,
  helloTimeoutMs: 5000,
  maxConnsPerGuest: 6,
});
// Luật được khóa vào từng ván và gửi cho máy khách.
const RULE_KEYS = ['minPlayers', 'maxPlayers', 'inspectionMs', 'countdownMs', 'solveLimitMs', 'reconnectBudgetMs'];
const ATTRIBUTED = new Set(['timeout', 'member_disconnected', 'engine_mismatch']);

class OnlineError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const realClock = { now: () => performance.now(), wall: () => Date.now() };
const realTimers = { set: (fn, ms) => setTimeout(fn, Math.max(0, ms)), clear: (handle) => clearTimeout(handle) };

class Bucket {
  constructor(rate, burst, now) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = now; }
  take(now) {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class OnlineService {
  constructor({ store, scrambler, config = {}, clock = realClock, timers = realTimers, log = () => {}, maintenance = () => false }) {
    this.store = store;
    this.scrambler = scrambler;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.clock = clock;
    this.timers = timers;
    this.log = log;
    this.maintenance = maintenance;
    this.rooms = new Map();
    this.codes = new Map();
    this.conns = new Set();
    this.touchedAt = new Map();
    this.lastPurge = -Infinity;
  }

  get rules() {
    return Object.fromEntries(RULE_KEYS.map((k) => [k, this.config[k]]));
  }

  // Khởi động: chốt các ván dang dở của lần chạy trước (BR-25) rồi nạp phòng còn mở.
  start() {
    const recovered = this.store.recoverInterrupted(this.clock.wall());
    if (recovered) this.log('recovered_rounds', { count: recovered });
    for (const row of this.store.loadOpenRooms()) this.loadRoom(row);
    return this;
  }

  loadRoom(row) {
    const now = this.clock.now();
    const room = {
      id: row.id, code: row.code, status: row.status, hostMemberId: row.hostMemberId, config: row.config,
      roundSeq: row.roundSeq, createdAt: row.createdAt, members: new Map(), round: null,
      lastRound: row.lastRound || null, version: 0, timers: new Map(), idleSince: now, lastStartState: null,
    };
    for (const m of row.members) room.members.set(m.id, this.memberObject(m, now));
    this.rooms.set(room.id, room);
    this.codes.set(room.code, room.id);
    return room;
  }

  memberObject(data, now) {
    return {
      ...data, ready: false, controller: null, conns: new Set(), epoch: 0, disconnectedAt: now,
      cancelStreak: 0, receipts: new Map(), engineOk: true,
    };
  }

  // ---------- Phiên khách ----------
  resolveGuest(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = this.store.findSession(hashToken(token));
    if (!row) return null;
    const wall = this.clock.wall();
    const last = Math.max(row.lastSeenAt, this.touchedAt.get(row.id) || 0);
    if (wall - last > this.config.sessionTtlMs) return null;
    return row.id;
  }

  touch(guestId, force = false) {
    const wall = this.clock.wall();
    const last = this.touchedAt.get(guestId) || 0;
    if (!force && wall - last < this.config.sessionTouchMs) return;
    this.touchedAt.set(guestId, wall);
    try { this.store.touchSessions([guestId], wall); } catch (e) { this.log('session_touch_failed', { message: e.message }); }
  }

  ensureSession(token) {
    const existing = this.resolveGuest(token);
    if (existing) {
      this.touch(existing);
      return { guestId: existing, token: null, activeRoom: this.activeRoomSummary(existing) };
    }
    const fresh = crypto.randomBytes(32).toString('base64url');
    const guestId = newId('g');
    this.guarded(() => this.store.createSession(guestId, hashToken(fresh), this.clock.wall()));
    this.touchedAt.set(guestId, this.clock.wall());
    return { guestId, token: fresh, activeRoom: null };
  }

  // Lỗi ghi ở ranh giới cấp phòng: từ chối lệnh, không đổi trạng thái trong bộ nhớ.
  guarded(fn) {
    try { return fn(); } catch (error) {
      if (error instanceof StoreError) {
        this.log('storage_error', { message: error.message });
        throw new OnlineError('service_unavailable', 503);
      }
      throw error;
    }
  }

  persist(fn) { return this.guarded(() => this.store.write(fn)); }

  activeRoomOf(guestId) {
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) {
        if (m.guestId === guestId && m.standing !== 'LEFT' && !m.banned) return { room, member: m };
      }
    }
    return null;
  }

  activeRoomSummary(guestId) {
    const found = this.activeRoomOf(guestId);
    return found ? { roomId: found.room.id, code: found.room.code, nickname: found.member.nickname } : null;
  }

  // ---------- Tạo/vào/rời phòng qua HTTP ----------
  createRoom(guestId, nicknameRaw) {
    if (this.maintenance()) throw new OnlineError('service_unavailable', 503);
    const nick = protocol.normalizeNickname(nicknameRaw);
    if (!nick) throw new OnlineError('nickname_invalid');
    const current = this.activeRoomSummary(guestId);
    if (current) throw new OnlineError('session_in_other_room', 409, { activeRoom: current });
    if (this.rooms.size >= this.config.maxRooms) throw new OnlineError('service_unavailable', 503);
    const now = this.clock.now();
    const wall = this.clock.wall();
    const code = this.newCode();
    const host = { id: newId('m'), guestId, nickname: nick.name, nicknameKey: nick.key, standing: 'ACTIVE', banned: false, joinedAt: wall, leftAt: null };
    const row = { id: newId('r'), code, status: 'LOBBY', hostMemberId: host.id, config: this.rules, roundSeq: 0, createdAt: wall };
    this.persist(() => {
      this.store.insertRoom(row);
      this.store.insertMember(host, row.id);
      this.store.event(row.id, 'room.created', { memberId: host.id }, wall);
    });
    const room = this.loadRoom({ ...row, members: [host], lastRound: null });
    room.members.get(host.id).disconnectedAt = now;
    this.log('room_created', { roomId: room.id });
    return { roomId: room.id, code };
  }

  newCode() {
    const A = protocol.CODE_ALPHABET;
    for (let i = 0; i < 50; i++) {
      let code = '';
      for (let k = 0; k < protocol.CODE_LENGTH; k++) code += A[crypto.randomInt(A.length)];
      if (!this.codes.has(code) && !this.store.roomCodeExists(code)) return code;
    }
    throw new OnlineError('service_unavailable', 503);
  }

  joinRoom(guestId, codeRaw, nicknameRaw) {
    const code = protocol.normalizeCode(codeRaw);
    if (!protocol.isCode(code)) throw new OnlineError('code_invalid');
    const roomId = this.codes.get(code);
    const room = roomId && this.rooms.get(roomId);
    if (!room) throw new OnlineError(this.store.roomCodeExists(code) ? 'room_closed' : 'room_not_found', 404);
    const existing = [...room.members.values()].find((m) => m.guestId === guestId);
    if (existing?.banned) throw new OnlineError('room_banned', 403);
    if (existing && existing.standing !== 'LEFT') return { roomId: room.id, code: room.code, rejoined: true };
    const current = this.activeRoomSummary(guestId);
    if (current) throw new OnlineError('session_in_other_room', 409, { activeRoom: current });
    const nick = protocol.normalizeNickname(nicknameRaw);
    if (!nick) throw new OnlineError('nickname_invalid');
    this.assertNicknameFree(room, nick.key, null);
    const present = [...room.members.values()].filter((m) => m.standing !== 'LEFT').length;
    if (present >= this.config.maxPlayers) throw new OnlineError('room_full', 409);
    const wall = this.clock.wall();
    const data = {
      id: existing?.id || newId('m'), guestId, nickname: nick.name, nicknameKey: nick.key,
      standing: room.status === 'IN_ROUND' ? 'WAITING_NEXT' : 'ACTIVE', banned: false, joinedAt: wall, leftAt: null,
    };
    this.persist(() => {
      if (existing) this.store.saveMember(data);
      else this.store.insertMember(data, room.id);
      this.store.event(room.id, 'member.joined', { memberId: data.id }, wall);
    });
    if (existing) Object.assign(existing, data, { ready: false, cancelStreak: 0 });
    else room.members.set(data.id, this.memberObject(data, this.clock.now()));
    this.broadcast(room, 'member.joined');
    return { roomId: room.id, code: room.code, rejoined: false };
  }

  assertNicknameFree(room, key, selfId) {
    for (const m of room.members.values()) {
      if (m.id !== selfId && m.standing !== 'LEFT' && m.nicknameKey === key) throw new OnlineError('nickname_taken', 409);
    }
  }

  memberFor(guestId, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      const row = typeof roomId === 'string' && this.store.membership(roomId, guestId);
      throw new OnlineError(row && !row.banned ? 'room_closed' : 'room_not_found', 404);
    }
    const member = [...room.members.values()].find((m) => m.guestId === guestId);
    if (!member) throw new OnlineError('room_not_found', 404);
    if (member.banned) throw new OnlineError('room_banned', 403);
    if (member.standing === 'LEFT') throw new OnlineError('not_member', 403);
    return { room, member };
  }

  roomSnapshot(guestId, roomId) {
    const { room, member } = this.memberFor(guestId, roomId);
    return this.snapshotFor(room, member, null, 'http');
  }

  leaveHttp(guestId, roomId) {
    const { room, member } = this.memberFor(guestId, roomId);
    this.leave(room, member);
    return { ok: true };
  }

  // Lịch sử ván trong hạn lưu: chỉ thành viên chưa bị loại (kể cả đã tự rời) được đọc.
  historyAccess(guestId, roomId) {
    const row = typeof roomId === 'string' && this.store.membership(roomId, guestId);
    if (!row) throw new OnlineError('room_not_found', 404);
    if (row.banned) throw new OnlineError('room_banned', 403);
  }

  listRounds(guestId, roomId) {
    this.historyAccess(guestId, roomId);
    return { rounds: this.store.listRounds(roomId).map(({ config, participants, ...round }) => ({ ...round, players: participants.length })) };
  }

  getRound(guestId, roomId, roundId) {
    this.historyAccess(guestId, roomId);
    const round = typeof roundId === 'string' && this.store.getRound(roomId, roundId);
    if (!round) throw new OnlineError('not_found', 404);
    return { round };
  }

  meta() {
    return {
      ok: true, protocolVersion: protocol.PROTOCOL_VERSION, engineVersion: protocol.ENGINE_VERSION,
      maintenance: !!this.maintenance(), rules: this.rules, available: this.rooms.size < this.config.maxRooms,
    };
  }

  health() {
    return { ok: this.store.healthy(), rooms: this.rooms.size, connections: this.conns.size, scrambles: this.scrambler?.ready ?? 0 };
  }

  // ---------- Kết nối WebSocket ----------
  canAccept() { return this.conns.size < this.config.maxConnections; }

  attach(guestId, transport) {
    const now = this.clock.now();
    // Mỗi phiên khách giữ tối đa vài kết nối (tab cũ chưa bị phát hiện đứt khi tải lại): vượt thì đóng kết nối cũ nhất.
    const mine = [...this.conns].filter((c) => c.guestId === guestId);
    for (const old of mine.slice(0, Math.max(0, mine.length - this.config.maxConnsPerGuest + 1))) {
      old.transport.terminate();
      this.detach(old);
    }
    const conn = {
      id: newId('c'), guestId, transport, room: null, member: null, clientId: null, controlling: false,
      openedAt: now, lastSeen: now, closed: false, engineOk: false,
      moveBucket: new Bucket(this.config.moveRate, this.config.moveBurst, now),
      cmdBucket: new Bucket(this.config.commandRate, this.config.commandBurst, now),
      pingBucket: new Bucket(this.config.pingRate, this.config.pingBurst, now),
    };
    this.conns.add(conn);
    return conn;
  }

  seen(conn) { conn.lastSeen = this.clock.now(); }

  send(conn, message) {
    if (conn.closed) return;
    try { conn.transport.send(JSON.stringify({ ...message, serverTime: this.clock.now() })); } catch (e) { /* kết nối đã đóng */ }
  }

  detach(conn) {
    if (conn.closed) return;
    conn.closed = true;
    this.conns.delete(conn);
    const { room, member } = conn;
    if (!member) return;
    member.conns.delete(conn);
    if (member.controller === conn) {
      member.controller = null;
      conn.controlling = false;
      this.safely(room, () => this.becameDisconnected(room, member));
    }
  }

  // Kiểm tra sống mỗi heartbeatMs: im lặng quá disconnectAfterMs thì cắt kết nối (máy chủ xác định mất kết nối).
  heartbeat() {
    const now = this.clock.now();
    for (const conn of [...this.conns]) {
      // Kết nối không chào vào phòng nào trong vài giây thì không giữ chỗ.
      if (now - conn.lastSeen > this.config.disconnectAfterMs || (!conn.member && now - conn.openedAt > this.config.helloTimeoutMs)) {
        conn.transport.terminate();
        this.detach(conn);
      } else {
        try { conn.transport.ping(); } catch (e) { /* đã đóng */ }
      }
    }
  }

  receive(conn, text) {
    const receivedAt = this.clock.now();
    conn.lastSeen = receivedAt;
    let msg;
    try { msg = JSON.parse(text); } catch (e) { msg = null; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
      this.send(conn, { type: 'command.rejected', code: 'malformed' });
      return;
    }
    if (msg.type === 'time.ping') {
      if (conn.pingBucket.take(receivedAt)) this.send(conn, { type: 'time.pong', t: typeof msg.t === 'number' ? msg.t : null });
      return;
    }
    if (msg.type === 'hello') { this.hello(conn, msg); return; }
    if (!conn.member) { this.reject(conn, msg, 'not_member'); return; }
    const room = conn.room;
    this.safely(room, () => {
      try {
        this.catchUp(room, receivedAt);
        this.dispatch(conn, room, conn.member, msg, receivedAt);
      } catch (error) {
        if (!(error instanceof OnlineError)) throw error;
        this.reject(conn, msg, error.code, error.extra);
      }
    }, () => this.reject(conn, msg, 'service_unavailable'));
  }

  // Lỗi ngoài dự kiến chỉ ảnh hưởng một lệnh/phòng, không làm dừng tiến trình đang chạy các phòng khác (R-11).
  safely(room, fn, onError) {
    try { fn(); } catch (error) {
      this.log('room_error', { roomId: room?.id, message: error.message, stack: error.stack });
      if (onError) onError(error);
    }
  }

  reject(conn, msg, code, extra = {}) {
    const type = msg.type === 'attempt.move' ? 'move.rejected' : 'command.rejected';
    this.send(conn, { type, commandId: typeof msg.commandId === 'string' ? msg.commandId : null, for: msg.type, code, ...extra });
  }

  hello(conn, msg) {
    if (conn.member) return;
    if (msg.protocolVersion !== protocol.PROTOCOL_VERSION) {
      this.send(conn, { type: 'room.removed', code: 'version_mismatch' });
      conn.transport.close(4000, 'version');
      return;
    }
    const room = typeof msg.roomId === 'string' && this.rooms.get(msg.roomId);
    let member = room && [...room.members.values()].find((m) => m.guestId === conn.guestId);
    let code = null;
    if (!room) code = typeof msg.roomId === 'string' && this.store.membership(msg.roomId, conn.guestId) ? 'room_closed' : 'not_member';
    else if (!member) code = 'not_member';
    else if (member.banned) code = 'room_banned';
    else if (member.standing === 'LEFT') code = 'not_member';
    if (code) {
      this.send(conn, { type: 'room.removed', code });
      conn.transport.close(4001, code);
      return;
    }
    conn.room = room;
    conn.member = member;
    conn.clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : newId('t');
    conn.engineOk = msg.engineVersion === protocol.ENGINE_VERSION;
    member.conns.add(conn);
    this.touch(conn.guestId);
    this.safely(room, () => {
      const current = member.controller;
      if (!current || current.closed || current.clientId === conn.clientId) this.claim(room, member, conn, false);
      this.send(conn, {
        type: 'welcome', memberId: member.id, controlling: conn.controlling, epoch: member.epoch,
        protocolVersion: protocol.PROTOCOL_VERSION, engineVersion: protocol.ENGINE_VERSION, engineOk: conn.engineOk,
      });
      if (conn.controlling) this.broadcast(room, 'member.connected');
      else this.send(conn, this.snapshotFor(room, member, conn, 'welcome'));
    });
  }

  // BR-03: một kết nối điều khiển cho mỗi thành viên; lấy quyền làm tăng controlEpoch, tab cũ hết quyền gửi nước.
  claim(room, member, conn, announce = true) {
    const previous = member.controller;
    const wasConnected = !!previous && !previous.closed;
    member.epoch += 1;
    member.controller = conn;
    member.engineOk = conn.engineOk;
    conn.controlling = true;
    if (previous && previous !== conn) {
      previous.controlling = false;
      this.send(previous, { type: 'control.revoked', epoch: member.epoch });
    }
    if (!wasConnected) this.becameConnected(room, member);
    if (announce) this.broadcast(room, 'control.claimed');
  }

  dispatch(conn, room, member, msg, receivedAt) {
    // Đồng bộ và lấy quyền đều tốn bản chụp (lấy quyền còn phát cho cả phòng): cùng giới hạn với lệnh phòng.
    if ((msg.type === 'room.sync' || msg.type === 'control.claim') && !conn.cmdBucket.take(receivedAt)) {
      throw new OnlineError('rate_limited', 429);
    }
    if (msg.type === 'room.sync') { this.send(conn, this.snapshotFor(room, member, conn, 'sync')); return; }
    if (msg.type === 'control.claim') {
      if (!conn.controlling) this.claim(room, member, conn);
      this.send(conn, { type: 'command.ok', commandId: msg.commandId ?? null, for: msg.type, result: { epoch: member.epoch } });
      return;
    }
    if (room.closed) throw new OnlineError('room_closed', 404);
    if (!conn.controlling) throw new OnlineError('stale_epoch', 409);
    if (msg.type === 'attempt.move') { this.move(conn, room, member, msg, receivedAt); return; }
    if (msg.type === 'round.prepared') { this.prepared(room, member, msg); return; }
    if (msg.type === 'round.inspectionAck') { this.inspectionAck(room, member, msg); return; }

    let after = null; // việc làm sau khi đã trả lời (rời phòng: đóng kết nối của chính người gửi)
    const handlers = {
      'room.ready': () => this.setReady(room, member, msg.ready === true),
      'room.start': () => this.startRound(room, member, Array.isArray(msg.exclude) ? msg.exclude.slice(0, 8) : []),
      'room.leave': () => { after = this.leave(room, member, true).close; return { left: true }; },
      'room.kick': () => this.kick(room, member, msg.memberId),
      'room.transferHost': () => this.transferHost(room, member, msg.memberId),
      'room.rename': () => this.rename(room, member, msg.nickname),
      'room.next': () => this.nextRound(room, member),
      'room.close': () => { after = this.closeRoom(room, member, 'host', true).close; return { closed: true }; },
      'attempt.surrender': () => this.surrender(room, member, msg.roundId),
    };
    const handler = handlers[msg.type];
    if (!handler) throw new OnlineError('malformed');
    if (typeof msg.commandId !== 'string' || !msg.commandId || msg.commandId.length > 64) throw new OnlineError('malformed');
    // Chống lặp: cùng mã/cùng nội dung trả lại kết quả cũ; cùng mã khác nội dung bị từ chối.
    // Dấu vân tay chỉ lấy các trường đã biết (giới hạn độ dài) để trường thừa không phình bộ nhớ.
    const { commandId } = msg;
    const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    const fingerprint = JSON.stringify([msg.type, msg.ready === true, Array.isArray(msg.exclude) ? msg.exclude.slice(0, 8).map((x) => short(x, 40)) : null,
      short(msg.memberId, 40), short(msg.nickname, 80), short(msg.roundId, 40)]);
    const receipt = member.receipts.get(commandId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new OnlineError('command_conflict', 409);
      this.send(conn, receipt.response);
      return;
    }
    if (!conn.cmdBucket.take(receivedAt)) throw new OnlineError('rate_limited', 429);
    const result = handler() || {};
    const response = { type: 'command.ok', commandId, for: msg.type, result };
    member.receipts.set(commandId, { fingerprint, response });
    if (member.receipts.size > this.config.receiptLimit) member.receipts.delete(member.receipts.keys().next().value);
    this.send(conn, response);
    if (after) after();
  }

  // ---------- Phòng chờ ----------
  requireHost(room, member) {
    if (room.hostMemberId !== member.id) throw new OnlineError('not_host', 403);
  }
  requireStatus(room, ...statuses) {
    if (!statuses.includes(room.status)) throw new OnlineError('wrong_room_state', 409);
  }
  connected(member) { return !!member.controller && !member.controller.closed; }

  setReady(room, member, ready) {
    this.requireStatus(room, 'LOBBY');
    if (member.standing !== 'ACTIVE') throw new OnlineError('wrong_room_state', 409);
    if (ready && !member.engineOk) throw new OnlineError('version_mismatch', 409);
    if (member.ready !== ready) {
      member.ready = ready;
      this.broadcast(room, 'member.ready');
    }
    return { ready };
  }

  excludable(room, m, now = this.clock.now()) {
    if (m.id === room.hostMemberId) return false;
    if (m.cancelStreak >= this.config.excludeAfterCancels) return true;
    return !this.connected(m) && m.disconnectedAt !== null && now - m.disconnectedAt >= this.config.absentExcludeMs;
  }

  /*
   * Điều kiện bắt đầu (BR-04, BR-11): mọi người ACTIVE phải kết nối, đúng phiên bản và sẵn sàng (chủ phòng bấm Bắt
   * đầu là sẵn sàng). Người bị hủy chuẩn bị 2 lần liên tiếp hoặc vắng quá 60 giây có thể được chủ để sang ván sau.
   */
  evaluateStart(room, exclude = []) {
    const now = this.clock.now();
    const active = [...room.members.values()].filter((m) => m.standing === 'ACTIVE' && !m.banned);
    const excluded = new Set(exclude.filter((id) => {
      const m = room.members.get(id);
      return m && active.includes(m) && this.excludable(room, m, now);
    }));
    const participants = active.filter((m) => !excluded.has(m.id));
    const blockers = [];
    if (participants.length < this.config.minPlayers) blockers.push({ code: 'too_few_players' });
    for (const m of participants) {
      if (!this.connected(m)) blockers.push({ code: 'member_disconnected', memberId: m.id, excludable: this.excludable(room, m, now) });
      else if (!m.engineOk) blockers.push({ code: 'engine_mismatch', memberId: m.id, excludable: this.excludable(room, m, now) });
      else if (m.id !== room.hostMemberId && !m.ready) blockers.push({ code: 'member_unready', memberId: m.id, excludable: this.excludable(room, m, now) });
    }
    return { participants, blockers, excluded: [...excluded] };
  }

  startRound(room, member, exclude) {
    this.requireHost(room, member);
    this.requireStatus(room, 'LOBBY');
    if (this.maintenance()) throw new OnlineError('service_unavailable', 503);
    if (this.clock.wall() - room.createdAt >= this.config.roomMaxAgeMs) throw new OnlineError('room_expired', 409);
    const { participants, blockers, excluded } = this.evaluateStart(room, exclude);
    if (blockers.length) {
      throw new OnlineError(blockers[0].code === 'too_few_players' ? 'too_few_players' : 'not_all_ready', 409, { blockers });
    }
    const item = this.scrambler.take(room.lastStartState);
    const wall = this.clock.wall();
    const round = {
      id: newId('v'), roomId: room.id, seq: room.roundSeq + 1, status: 'PREPARING', reason: null,
      config: this.rules, participants: participants.map((m) => m.id), engineVersion: protocol.ENGINE_VERSION,
      scramble: item.scramble, scrambleKind: item.kind, startState: item.state, startHash: protocol.stateHash(item.state),
      createdAt: wall, prepareDeadline: this.clock.now() + this.config.prepareTimeoutMs,
      prepared: new Set(), acked: new Set(), ti: null, t0: null, td: null, timers: new Map(), attempts: new Map(),
      storageFailed: false,
    };
    for (const m of participants) {
      round.attempts.set(m.id, {
        memberId: m.id, nickname: m.nickname, status: 'PENDING', endReason: null, state: item.state, stateHash: round.startHash,
        moveSeq: 0, moves: [], receipts: new Map(), elapsedMs: null, rankTime: null, rank: null, disconnectUsedMs: 0, disconnectedAt: null,
      });
    }
    const waiting = excluded.map((id) => room.members.get(id));
    this.persist(() => {
      // Một lần ghi hỏng trước đó có thể để ván cũ còn "đang chạy" trong tệp; ván đó không còn trong bộ nhớ nên đóng lại.
      this.store.closeStaleRounds(room.id, wall);
      this.store.insertRound(round);
      for (const m of waiting) this.store.saveMember({ ...m, standing: 'WAITING_NEXT' });
      this.store.saveRoom({ ...room, status: 'IN_ROUND', roundSeq: round.seq });
      this.store.event(room.id, 'round.locked', { roundId: round.id, participants: round.participants, excluded }, wall);
    });
    for (const m of waiting) m.standing = 'WAITING_NEXT';
    room.status = 'IN_ROUND';
    room.roundSeq = round.seq;
    room.round = round;
    room.lastStartState = item.state;
    for (const m of room.members.values()) m.ready = false;
    this.setRoundTimer(room, round, 'prepare', this.config.prepareTimeoutMs, () => {
      const missing = round.participants.filter((id) => !round.prepared.has(id));
      this.cancelRound(room, round, 'timeout', missing);
    });
    this.broadcast(room, 'round.prepare');
    return { roundId: round.id };
  }

  setRoundTimer(room, round, key, ms, fn) {
    const old = round.timers.get(key);
    if (old) this.timers.clear(old);
    round.timers.set(key, this.timers.set(() => {
      round.timers.delete(key);
      if (room.round !== round) return;
      this.safely(room, fn);
    }, ms));
  }

  clearRoundTimers(round) {
    for (const handle of round.timers.values()) this.timers.clear(handle);
    round.timers.clear();
  }

  setRoomTimer(room, key, ms, fn) {
    const old = room.timers.get(key);
    if (old) this.timers.clear(old);
    room.timers.set(key, this.timers.set(() => {
      room.timers.delete(key);
      if (room.closed) return;
      this.safely(room, fn);
    }, ms));
  }

  prepared(room, member, msg) {
    const round = room.round;
    if (!round || round.id !== msg.roundId || round.status !== 'PREPARING' || !round.attempts.has(member.id)) return;
    if (msg.engineVersion !== protocol.ENGINE_VERSION) { this.cancelRound(room, round, 'engine_mismatch', [member.id]); return; }
    round.prepared.add(member.id);
    if (round.prepared.size === round.participants.length) this.beginInspection(room, round);
  }

  // BR-09: chỉ đến mốc quan sát mới phát khối; mọi người cùng mốc bắt đầu T0 = Ti + 15 giây do máy chủ quyết định.
  beginInspection(room, round) {
    this.clearRoundTimers(round);
    const now = this.clock.now();
    round.status = 'INSPECTION';
    round.ti = now;
    round.t0 = now + this.config.inspectionMs;
    round.td = round.t0 + this.config.solveLimitMs;
    this.setRoundTimer(room, round, 'ack', this.config.inspectionAckMs, () => {
      const missing = round.participants.filter((id) => !round.acked.has(id));
      if (missing.length) this.cancelRound(room, round, 'timeout', missing);
    });
    this.setRoundTimer(room, round, 'start', this.config.inspectionMs, () => this.startRunning(room, round));
    this.broadcast(room, 'round.inspect');
  }

  inspectionAck(room, member, msg) {
    const round = room.round;
    if (!round || round.id !== msg.roundId || round.status !== 'INSPECTION' || !round.attempts.has(member.id)) return;
    if (msg.stateHash !== round.startHash) { this.cancelRound(room, round, 'engine_mismatch', [member.id]); return; }
    round.acked.add(member.id);
  }

  // Bộ hẹn giờ có thể chạy sớm/muộn vài mi-li-giây: sự kiện nhận sau T0 thì coi như ván đã bắt đầu.
  catchUp(room, now = this.clock.now()) {
    const round = room?.round;
    if (round?.status === 'INSPECTION' && now >= round.t0) this.startRunning(room, round);
  }

  startRunning(room, round) {
    if (round.status !== 'INSPECTION') return;
    const early = round.t0 - this.clock.now();
    if (early > 0) { this.setRoundTimer(room, round, 'start', early, () => this.startRunning(room, round)); return; }
    const missing = round.participants.filter((id) => !round.acked.has(id));
    if (missing.length) { this.cancelRound(room, round, 'timeout', missing); return; }
    round.status = 'RUNNING';
    for (const a of round.attempts.values()) a.status = 'RACING';
    for (const id of round.participants) {
      const m = room.members.get(id);
      if (m) m.cancelStreak = 0;
      // Mất kết nối đúng lúc chuyển sang thi (chưa kịp hủy ván): áp dụng luật nối lại của ván đang thi.
      if (m && !this.connected(m)) this.attemptDisconnected(room, round, m);
    }
    try {
      this.store.write(() => this.store.markRoundStarted(round.id, this.clock.wall()));
    } catch (error) {
      round.storageFailed = true;
      this.log('storage_error', { message: error.message, at: 'round_started' });
    }
    this.setRoundTimer(room, round, 'deadline', round.td - this.clock.now(), () => this.deadline(room, round));
    this.broadcast(room, 'round.started');
  }

  // Hết 600 giây: các lượt còn đang giải là DNF hết giờ, rồi chốt ván.
  deadline(room, round) {
    const early = round.td - this.clock.now();
    if (early > 0) { this.setRoundTimer(room, round, 'deadline', early, () => this.deadline(room, round)); return; }
    for (const a of round.attempts.values()) {
      if (a.status === 'RACING') this.endAttempt(room, round, a, 'DNF', 'timeout');
    }
    this.checkRoundEnd(room, round);
  }

  cancelRound(room, round, reason, memberIds = []) {
    if (room.round !== round) return;
    this.clearRoundTimers(round);
    const wall = this.clock.wall();
    round.status = 'CANCELLED';
    round.reason = reason;
    round.endedAt = wall;
    // "2 lần hủy liên tiếp do cùng một người" (BR-11): lần hủy do người khác hoặc lý do khác cắt chuỗi.
    const blamed = new Set(ATTRIBUTED.has(reason) ? memberIds : []);
    for (const m of room.members.values()) m.cancelStreak = blamed.has(m.id) ? m.cancelStreak + 1 : 0;
    room.status = 'LOBBY';
    room.round = null;
    const waiting = [...room.members.values()].filter((m) => m.standing === 'WAITING_NEXT');
    for (const m of room.members.values()) {
      m.ready = false;
      if (m.standing === 'WAITING_NEXT') m.standing = 'ACTIVE';
    }
    room.lastRound = {
      roundId: round.id, seq: round.seq, status: 'CANCELLED', reason, scrambleKind: round.scrambleKind, attempts: [],
      affected: memberIds.map((id) => room.members.get(id)?.nickname).filter(Boolean),
    };
    try {
      this.store.write(() => {
        this.store.endRound(round);
        for (const m of waiting) this.store.saveMember(m);
        this.store.saveRoom(room);
        this.store.event(room.id, 'round.cancelled', { roundId: round.id, reason, members: memberIds }, wall);
      });
    } catch (error) {
      this.log('storage_error', { message: error.message, at: 'round_cancelled' });
    }
    this.maybeTransferHost(room);
    this.broadcast(room, 'round.cancelled');
  }

  // ---------- Thi ----------
  move(conn, room, member, msg, receivedAt) {
    const round = room.round;
    const fail = (code) => {
      const a = round?.attempts.get(member.id);
      this.reject(conn, msg, code, {
        roundId: round?.id ?? null, lastAcceptedMoveSeq: a?.moveSeq ?? null, stateHash: a?.stateHash ?? null,
      });
    };
    if (typeof msg.commandId !== 'string' || !msg.commandId || msg.commandId.length > 64 ||
        !Number.isSafeInteger(msg.moveSeq) || typeof msg.baseStateHash !== 'string' || msg.baseStateHash.length > 16 ||
        typeof msg.move !== 'string' || msg.move.length > 4 || (msg.roundId !== undefined && (typeof msg.roundId !== 'string' || msg.roundId.length > 40))) {
      fail('malformed');
      return;
    }
    const attempt = round && round.id === msg.roundId ? round.attempts.get(member.id) : null;
    const { commandId } = msg;
    const fingerprint = `${msg.roundId}|${msg.moveSeq}|${msg.baseStateHash}|${msg.move}`;
    const receipt = attempt?.receipts.get(commandId);
    if (receipt) {
      if (receipt.fingerprint === fingerprint) this.send(conn, receipt.response);
      else fail('command_conflict');
      return;
    }
    if (!round || round.id !== msg.roundId) { fail('wrong_round'); return; }
    if (msg.controlEpoch !== member.epoch) { fail('stale_epoch'); return; }
    if (!attempt) { fail('not_participant'); return; }
    // Nước đến sau T0 nhưng trước khi bộ hẹn giờ kịp chạy: chuyển sang thi ngay tại mốc nhận.
    if (round.status === 'INSPECTION' && receivedAt >= round.t0) this.startRunning(room, round);
    if (room.round !== round || round.status !== 'RUNNING' || receivedAt < round.t0 || receivedAt >= round.td) { fail('round_not_running'); return; }
    if (attempt.status !== 'RACING') { fail('attempt_finished'); return; }
    if (!conn.moveBucket.take(receivedAt)) { fail('rate_limited'); return; }
    if (!protocol.isMove(msg.move)) { fail('invalid_move'); return; }
    if (msg.moveSeq !== attempt.moveSeq + 1) { fail('seq_gap'); return; }
    if (msg.baseStateHash !== attempt.stateHash) { fail('state_mismatch'); return; }
    attempt.state = protocol.applyMove(attempt.state, msg.move);
    attempt.stateHash = protocol.stateHash(attempt.state);
    attempt.moveSeq += 1;
    attempt.moves.push({ seq: attempt.moveSeq, move: msg.move, atMs: Math.floor(receivedAt - round.t0), hash: attempt.stateHash });
    const solved = protocol.isSolved(attempt.state);
    if (solved) this.endAttempt(room, round, attempt, 'FINISHED', 'solved', receivedAt);
    const response = {
      type: 'move.ack', commandId, roundId: round.id, moveSeq: attempt.moveSeq, stateHash: attempt.stateHash,
      status: attempt.status, elapsedMs: attempt.elapsedMs,
    };
    attempt.receipts.set(commandId, { fingerprint, response });
    // Máy khách giữ tối đa 8 nước chờ: chỉ cần nhớ phản hồi của các nước gần nhất.
    if (attempt.receipts.size > this.config.moveReceiptLimit) attempt.receipts.delete(attempt.receipts.keys().next().value);
    this.send(conn, response);
    if (solved) {
      this.broadcast(room, 'attempt.finished');
      this.checkRoundEnd(room, round);
    }
  }

  // BR-16/17: kết thúc lượt đúng một lần; thời gian chính thức = thời điểm máy chủ nhận nước hoàn thành − T0.
  endAttempt(room, round, attempt, status, reason, at = this.clock.now()) {
    if (attempt.status === 'FINISHED' || attempt.status === 'DNF') return;
    if (attempt.disconnectedAt !== null) {
      attempt.disconnectUsedMs += Math.max(0, at - attempt.disconnectedAt);
      attempt.disconnectedAt = null;
    }
    const timer = round.timers.get('reconnect:' + attempt.memberId);
    if (timer) { this.timers.clear(timer); round.timers.delete('reconnect:' + attempt.memberId); }
    attempt.status = status;
    attempt.endReason = reason;
    if (status === 'FINISHED') {
      attempt.elapsedMs = Math.floor(at - round.t0);
      attempt.rankTime = Math.floor(attempt.elapsedMs / 10);
    }
  }

  surrender(room, member, roundId) {
    const round = room.round;
    if (!round || round.id !== roundId) throw new OnlineError('wrong_round', 409);
    const attempt = round.attempts.get(member.id);
    if (!attempt) throw new OnlineError('not_participant', 403);
    if (round.status !== 'RUNNING') throw new OnlineError('round_not_running', 409);
    if (attempt.status !== 'RACING') throw new OnlineError('attempt_finished', 409);
    this.endAttempt(room, round, attempt, 'DNF', 'surrendered');
    this.broadcast(room, 'attempt.dnf');
    this.checkRoundEnd(room, round);
    return { status: 'DNF' };
  }

  checkRoundEnd(room, round) {
    if (room.round !== round || round.status !== 'RUNNING') return;
    if ([...round.attempts.values()].every((a) => a.status === 'FINISHED' || a.status === 'DNF')) this.finalize(room, round);
  }

  // BR-18: thời gian thấp hơn đứng trước; cùng phần trăm giây thì đồng hạng (1, 1, 3); DNF không có hạng.
  static rank(attempts) {
    const finished = attempts.filter((a) => a.status === 'FINISHED');
    for (const a of finished) a.rank = 1 + finished.filter((b) => b.rankTime < a.rankTime).length;
    for (const a of attempts) if (a.status !== 'FINISHED') a.rank = null;
    return [...attempts].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity));
  }

  finalize(room, round) {
    this.clearRoundTimers(round);
    const wall = this.clock.wall();
    round.endedAt = wall;
    const attempts = OnlineService.rank([...round.attempts.values()]);
    const rows = attempts.map((a) => ({
      memberId: a.memberId, nickname: a.nickname, status: a.status, endReason: a.endReason, elapsedMs: a.elapsedMs,
      rankTime: a.rankTime, rank: a.rank, moveCount: a.moveSeq, disconnectMs: Math.round(a.disconnectUsedMs), stateHash: a.stateHash,
      moves: a.moves,
    }));
    round.status = 'FINALIZED';
    round.reason = null;
    try {
      if (round.storageFailed) throw new StoreError('Không ghi được mốc bắt đầu ván');
      this.store.write(() => {
        this.store.endRound(round);
        this.store.insertAttempts(round.id, rows);
        this.store.saveRoom({ ...room, status: 'RESULTS' });
        this.store.event(room.id, 'round.finalized', { roundId: round.id }, wall);
      });
    } catch (error) {
      // BR-25/11.3: không chốt được thì cả ván VOID, không công bố bảng hạng.
      this.log('storage_error', { message: error.message, at: 'round_finalize' });
      round.status = 'VOID';
      round.reason = 'storage_failure';
      try {
        this.store.write(() => {
          this.store.endRound(round);
          this.store.saveRoom({ ...room, status: 'RESULTS' });
          this.store.event(room.id, 'round.void', { roundId: round.id, reason: round.reason }, wall);
        });
      } catch (e) { /* vẫn thông báo VOID cho người chơi */ }
    }
    room.status = 'RESULTS';
    room.round = null;
    room.lastRound = {
      roundId: round.id, seq: round.seq, status: round.status, reason: round.reason, scrambleKind: round.scrambleKind,
      scramble: round.scramble,
      attempts: round.status === 'FINALIZED' ? rows.map(({ moves, stateHash, ...row }) => row) : [],
    };
    this.maybeTransferHost(room, true);
    this.broadcast(room, round.status === 'FINALIZED' ? 'round.finalized' : 'round.void');
  }

  // ---------- Kết nối của thành viên ----------
  becameConnected(room, member) {
    const now = this.clock.now();
    member.disconnectedAt = null;
    room.idleSince = null;
    const round = room.round;
    const attempt = round?.attempts.get(member.id);
    if (round?.status === 'RUNNING' && attempt?.status === 'RACING' && attempt.disconnectedAt !== null) {
      attempt.disconnectUsedMs += now - attempt.disconnectedAt;
      attempt.disconnectedAt = null;
      const timer = round.timers.get('reconnect:' + member.id);
      if (timer) { this.timers.clear(timer); round.timers.delete('reconnect:' + member.id); }
      if (attempt.disconnectUsedMs > this.config.reconnectBudgetMs) {
        this.endAttempt(room, round, attempt, 'DNF', 'reconnect_timeout');
        this.checkRoundEnd(room, round);
      }
    }
    this.maybeTransferHost(room);
  }

  becameDisconnected(room, member) {
    const now = this.clock.now();
    this.catchUp(room, now);
    member.disconnectedAt = now;
    const round = room.round;
    if (round && round.attempts.has(member.id)) {
      if (round.status === 'PREPARING' || round.status === 'INSPECTION') {
        this.cancelRound(room, round, 'member_disconnected', [member.id]);
      } else if (round.status === 'RUNNING') {
        this.attemptDisconnected(room, round, member);
      }
    }
    if (![...room.members.values()].some((m) => this.connected(m))) room.idleSince = now;
    if (member.id === room.hostMemberId) this.setRoomTimer(room, 'host', this.config.hostAwayMs + 1, () => this.maybeTransferHost(room));
    if (!room.closed) this.broadcast(room, 'member.disconnected');
  }

  // BR-19: thời gian ngắt cộng dồn trên cả lượt; vượt 60 giây thì DNF reconnect_timeout. Đồng hồ thi vẫn chạy.
  attemptDisconnected(room, round, member) {
    const attempt = round.attempts.get(member.id);
    if (!attempt || attempt.status !== 'RACING' || attempt.disconnectedAt !== null) return;
    attempt.disconnectedAt = this.clock.now();
    const left = this.config.reconnectBudgetMs - attempt.disconnectUsedMs;
    this.setRoundTimer(room, round, 'reconnect:' + member.id, Math.max(0, left), () => {
      if (attempt.status !== 'RACING') return;
      this.endAttempt(room, round, attempt, 'DNF', 'reconnect_timeout');
      this.broadcast(room, 'attempt.dnf');
      this.checkRoundEnd(room, round);
    });
  }

  /*
   * BR-22: chỉ chuyển chủ ở LOBBY/RESULTS. Chủ đã rời, hoặc mất kết nối quá 60 giây (vào RESULTS thì chuyển ngay nếu
   * chủ không còn kết nối), chủ mới là thành viên còn kết nối vào phòng sớm nhất. Không còn ai thì chờ.
   */
  maybeTransferHost(room, immediate = false) {
    if (room.closed || !['LOBBY', 'RESULTS'].includes(room.status)) return;
    const now = this.clock.now();
    const host = room.members.get(room.hostMemberId);
    if (host && host.standing !== 'LEFT' && !host.banned) {
      if (this.connected(host)) return;
      const away = host.disconnectedAt === null ? 0 : now - host.disconnectedAt;
      if (!immediate && away < this.config.hostAwayMs) {
        this.setRoomTimer(room, 'host', this.config.hostAwayMs - away + 1, () => this.maybeTransferHost(room));
        return;
      }
    }
    const candidate = [...room.members.values()]
      .filter((m) => m.standing !== 'LEFT' && !m.banned && this.connected(m) && m.id !== room.hostMemberId)
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))[0];
    if (!candidate) return;
    const wall = this.clock.wall();
    try {
      this.store.write(() => {
        this.store.saveRoom({ ...room, hostMemberId: candidate.id });
        this.store.event(room.id, 'host.transferred', { from: room.hostMemberId, to: candidate.id, auto: true }, wall);
      });
    } catch (error) {
      this.log('storage_error', { message: error.message, at: 'host_transfer' });
      return;
    }
    room.hostMemberId = candidate.id;
    this.broadcast(room, 'host.changed');
  }

  // ---------- Rời, loại, chuyển chủ, đổi tên, ván tiếp, đóng phòng ----------
  // BR-21: tự rời khi đang thi tương đương bỏ cuộc; rời khi đang chuẩn bị/quan sát thì hủy ván cho cả phòng.
  leave(room, member, deferClose = false) {
    this.catchUp(room);
    const wall = this.clock.wall();
    const leftState = { ...member, standing: 'LEFT', leftAt: wall };
    const round = room.round;
    this.persist(() => {
      this.store.saveMember(leftState);
      this.store.event(room.id, 'member.left', { memberId: member.id }, wall);
    });
    if (round && round.attempts.has(member.id)) {
      if (round.status === 'PREPARING' || round.status === 'INSPECTION') this.cancelRound(room, round, 'member_left', [member.id]);
      else if (round.status === 'RUNNING') this.endAttempt(room, round, round.attempts.get(member.id), 'DNF', 'left');
    }
    member.standing = 'LEFT';
    member.leftAt = wall;
    member.ready = false;
    const conns = [...member.conns];
    member.controller = null;
    member.conns.clear();
    member.disconnectedAt = this.clock.now();
    // Kết nối của người rời không còn thuộc phòng (không nhận bản chụp); đóng sau khi đã trả lời lệnh rời.
    for (const c of conns) this.conns.delete(c);
    const close = () => {
      for (const c of conns) {
        this.send(c, { type: 'room.removed', code: 'left' });
        c.closed = true;
        c.transport.close(4002, 'left');
      }
    };
    if (!deferClose) close();
    if (round && room.round === round) this.checkRoundEnd(room, round);
    // Chủ tự rời ở phòng chờ/kết quả (kể cả khi ván vừa bị hủy vì chính lần rời này) thì chuyển ngay.
    if (member.id === room.hostMemberId) this.maybeTransferHost(room, true);
    if (![...room.members.values()].some((m) => this.connected(m))) room.idleSince = this.clock.now();
    this.broadcast(room, 'member.left');
    return { left: true, close: deferClose ? close : null };
  }

  targetMember(room, memberId) {
    const target = typeof memberId === 'string' && room.members.get(memberId);
    if (!target || target.standing === 'LEFT' || target.banned) throw new OnlineError('member_not_eligible', 409);
    return target;
  }

  // BR-27: chỉ ở LOBBY/RESULTS, không tự loại mình; phiên bị loại vào danh sách chặn của phòng.
  kick(room, host, memberId) {
    this.requireHost(room, host);
    this.requireStatus(room, 'LOBBY', 'RESULTS');
    const target = this.targetMember(room, memberId);
    if (target.id === host.id) throw new OnlineError('member_not_eligible', 409);
    const wall = this.clock.wall();
    this.persist(() => {
      this.store.saveMember({ ...target, standing: 'LEFT', banned: true, leftAt: wall });
      this.store.event(room.id, 'member.kicked', { memberId: target.id, by: host.id }, wall);
    });
    target.standing = 'LEFT';
    target.banned = true;
    target.leftAt = wall;
    target.ready = false;
    const conns = [...target.conns];
    target.controller = null;
    target.conns.clear();
    for (const c of conns) {
      this.send(c, { type: 'room.removed', code: 'room_banned' });
      c.closed = true;
      this.conns.delete(c);
      c.transport.close(4003, 'banned');
    }
    this.broadcast(room, 'member.kicked');
    return { kicked: target.id };
  }

  transferHost(room, host, memberId) {
    this.requireHost(room, host);
    this.requireStatus(room, 'LOBBY', 'RESULTS');
    const target = this.targetMember(room, memberId);
    if (target.id === host.id || !this.connected(target)) throw new OnlineError('member_not_eligible', 409);
    const wall = this.clock.wall();
    this.persist(() => {
      this.store.saveRoom({ ...room, hostMemberId: target.id });
      this.store.event(room.id, 'host.transferred', { from: host.id, to: target.id, auto: false }, wall);
    });
    room.hostMemberId = target.id;
    this.broadcast(room, 'host.changed');
    return { hostMemberId: target.id };
  }

  rename(room, member, nicknameRaw) {
    this.requireStatus(room, 'LOBBY', 'RESULTS');
    const nick = protocol.normalizeNickname(nicknameRaw);
    if (!nick) throw new OnlineError('nickname_invalid');
    this.assertNicknameFree(room, nick.key, member.id);
    this.persist(() => this.store.saveMember({ ...member, nickname: nick.name, nicknameKey: nick.key }));
    member.nickname = nick.name;
    member.nicknameKey = nick.key;
    this.broadcast(room, 'member.renamed');
    return { nickname: nick.name };
  }

  // Thi lại: về phòng chờ, hủy mọi sẵn sàng cũ; người chờ ván sau được vào danh sách.
  nextRound(room, host) {
    this.requireHost(room, host);
    this.requireStatus(room, 'RESULTS');
    const waiting = [...room.members.values()].filter((m) => m.standing === 'WAITING_NEXT');
    this.persist(() => {
      for (const m of waiting) this.store.saveMember({ ...m, standing: 'ACTIVE' });
      this.store.saveRoom({ ...room, status: 'LOBBY' });
      this.store.event(room.id, 'room.lobby', null, this.clock.wall());
    });
    for (const m of room.members.values()) {
      m.ready = false;
      if (m.standing === 'WAITING_NEXT') m.standing = 'ACTIVE';
    }
    room.status = 'LOBBY';
    this.broadcast(room, 'room.lobby');
    return { status: 'LOBBY' };
  }

  closeRoom(room, host, reason = 'host', deferClose = false) {
    if (host) {
      this.requireHost(room, host);
      this.requireStatus(room, 'LOBBY', 'RESULTS');
    }
    const wall = this.clock.wall();
    this.persist(() => {
      this.store.saveRoom({ ...room, status: 'CLOSED', closedAt: wall, closeReason: reason });
      this.store.event(room.id, 'room.closed', { reason }, wall);
    });
    room.status = 'CLOSED';
    room.closed = true;
    for (const handle of room.timers.values()) this.timers.clear(handle);
    room.timers.clear();
    this.rooms.delete(room.id);
    this.codes.delete(room.code);
    const conns = [];
    for (const m of room.members.values()) {
      conns.push(...m.conns);
      m.conns.clear();
      m.controller = null;
    }
    for (const c of conns) this.conns.delete(c);
    const close = () => {
      for (const c of conns) {
        this.send(c, { type: 'room.removed', code: 'room_closed' });
        c.closed = true;
        c.transport.close(4004, 'closed');
      }
    };
    if (!deferClose) close();
    this.log('room_closed', { roomId: room.id, reason });
    return { closed: true, close: deferClose ? close : null };
  }

  // Dọn định kỳ: đóng phòng vắng 30 phút hoặc quá 4 giờ khi không có ván, giữ phiên đang kết nối, xóa dữ liệu quá hạn.
  sweep() {
    const now = this.clock.now();
    const wall = this.clock.wall();
    for (const room of [...this.rooms.values()]) {
      if (room.status === 'IN_ROUND') continue;
      const anyone = [...room.members.values()].some((m) => this.connected(m));
      const idle = !anyone && room.idleSince !== null && now - room.idleSince >= this.config.roomIdleMs;
      const expired = wall - room.createdAt >= this.config.roomMaxAgeMs && !anyone;
      if (idle || expired) {
        try { this.closeRoom(room, null, idle ? 'idle' : 'expired'); } catch (error) { this.log('sweep_error', { message: error.message }); }
      }
    }
    const guests = new Set([...this.conns].filter((c) => c.member).map((c) => c.guestId));
    const stale = [...guests].filter((g) => wall - (this.touchedAt.get(g) || 0) >= this.config.sessionTouchMs);
    if (stale.length) {
      for (const g of stale) this.touchedAt.set(g, wall);
      try { this.store.touchSessions(stale, wall); } catch (e) { this.log('session_touch_failed', { message: e.message }); }
    }
    if (wall - this.lastPurge >= 3600000) {
      this.lastPurge = wall;
      try {
        const removed = this.store.purge(wall, { retentionMs: this.config.retentionMs, sessionTtlMs: this.config.sessionTtlMs });
        if (removed.rounds || removed.rooms || removed.sessions) this.log('purged', removed);
      } catch (e) { this.log('purge_failed', { message: e.message }); }
    }
  }

  // Ngừng dịch vụ: các ván đang chạy sẽ thành VOID khi khởi động lại (BR-25); báo cho người chơi biết.
  shutdown() {
    for (const conn of [...this.conns]) {
      this.send(conn, { type: 'service.restarting' });
      try { conn.transport.close(1001, 'restart'); } catch (e) { /* đã đóng */ }
    }
    for (const room of this.rooms.values()) {
      for (const handle of room.timers.values()) this.timers.clear(handle);
      if (room.round) this.clearRoundTimers(room.round);
    }
  }

  // ---------- Bản chụp cho từng người ----------
  broadcast(room, cause) {
    if (room.closed) return;
    room.version += 1;
    for (const m of room.members.values()) {
      for (const c of m.conns) this.send(c, this.snapshotFor(room, m, c, cause));
    }
  }

  snapshotFor(room, me, conn, cause) {
    const now = this.clock.now();
    const members = [...room.members.values()]
      .filter((m) => m.standing !== 'LEFT')
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
      .map((m) => ({
        memberId: m.id, nickname: m.nickname, standing: m.standing, connected: this.connected(m), ready: m.ready,
        isHost: m.id === room.hostMemberId, engineOk: m.engineOk, cancelStreak: m.cancelStreak,
        excludable: room.status === 'LOBBY' && this.excludable(room, m, now),
      }));
    const evaluation = room.status === 'LOBBY' ? this.evaluateStart(room) : null;
    const round = room.round;
    let roundView = null;
    if (round) {
      const revealed = round.status !== 'PREPARING';
      const attempts = round.participants.map((id) => {
        const a = round.attempts.get(id);
        const disconnected = a.disconnectedAt !== null;
        return {
          memberId: id, nickname: a.nickname, status: a.status, endReason: a.endReason,
          elapsedMs: a.status === 'FINISHED' ? a.elapsedMs : null, disconnected,
          reconnectLeftMs: disconnected ? Math.max(0, this.config.reconnectBudgetMs - a.disconnectUsedMs - (now - a.disconnectedAt)) : null,
        };
      });
      const mine = round.attempts.get(me.id);
      roundView = {
        roundId: round.id, seq: round.seq, status: round.status, participants: round.participants,
        engineVersion: round.engineVersion, scrambleKind: round.scrambleKind, rules: round.config,
        prepareDeadline: round.prepareDeadline, prepared: [...round.prepared],
        ti: round.ti, t0: round.t0, td: round.td,
        startState: revealed ? round.startState : null, startHash: revealed ? round.startHash : null,
        scramble: revealed ? round.scramble : null, attempts,
        mine: mine ? {
          status: mine.status, endReason: mine.endReason, state: revealed ? mine.state : null, stateHash: revealed ? mine.stateHash : null,
          moveSeq: mine.moveSeq, elapsedMs: mine.elapsedMs, reconnectUsedMs: Math.round(mine.disconnectUsedMs),
          acked: round.acked.has(me.id), prepared: round.prepared.has(me.id),
        } : null,
      };
    }
    return {
      type: 'room.snapshot', cause, roomVersion: room.version,
      room: {
        roomId: room.id, code: room.code, status: room.status, hostMemberId: room.hostMemberId, createdAt: room.createdAt,
        rules: this.rules, expired: this.clock.wall() - room.createdAt >= this.config.roomMaxAgeMs,
        maintenance: !!this.maintenance(),
      },
      me: {
        memberId: me.id, nickname: me.nickname, standing: me.standing, ready: me.ready, isHost: me.id === room.hostMemberId,
        controlling: conn ? conn.controlling : false, epoch: me.epoch, engineOk: conn ? conn.engineOk : me.engineOk,
      },
      members,
      blockers: evaluation ? evaluation.blockers : [],
      round: roundView,
      lastRound: room.lastRound,
    };
  }
}

module.exports = { OnlineService, OnlineError, DEFAULT_CONFIG, hashToken, Bucket };
