/*
 * Lưu bền vững của Thi trực tiếp bằng node:sqlite (một tệp, ngoài vùng công khai). Chỉ ghi ở ranh giới phòng/ván
 * (D-10): phiên khách, phòng, thành viên, khóa ván, chốt ván kèm lượt và chuỗi nước. Không ghi từng nước khi đang thi.
 * Mọi thao tác là đồng bộ, mỗi ranh giới là một giao dịch; lỗi ghi ném StoreError để lớp nghiệp vụ xử lý.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync;
function sqlite() {
  if (!DatabaseSync) {
    // node:sqlite còn ở mức thử nghiệm trên Node 22/24 và in cảnh báo một lần khi nạp; không ảnh hưởng chức năng.
    const original = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
      if (String(warning).includes('SQLite')) return;
      original.call(process, warning, ...rest);
    };
    try { ({ DatabaseSync } = require('node:sqlite')); } finally { process.emitWarning = original; }
  }
  return DatabaseSync;
}

class StoreError extends Error {}

const SCHEMA = [
  `CREATE TABLE guest_sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`,
  `CREATE TABLE rooms (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, status TEXT NOT NULL, host_member_id TEXT, config TEXT NOT NULL,
    round_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, closed_at INTEGER, close_reason TEXT)`,
  `CREATE TABLE room_members (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, guest_id TEXT NOT NULL,
    nickname TEXT NOT NULL, nickname_key TEXT NOT NULL, standing TEXT NOT NULL, banned INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL, left_at INTEGER, UNIQUE (room_id, guest_id))`,
  `CREATE UNIQUE INDEX room_members_nickname ON room_members (room_id, nickname_key) WHERE standing <> 'LEFT'`,
  `CREATE INDEX room_members_guest ON room_members (guest_id)`,
  `CREATE TABLE rounds (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
    status TEXT NOT NULL, reason TEXT, config TEXT NOT NULL, participants TEXT NOT NULL, engine_version TEXT NOT NULL,
    scramble TEXT NOT NULL, scramble_kind TEXT NOT NULL, start_state TEXT NOT NULL, created_at INTEGER NOT NULL,
    started_at INTEGER, ended_at INTEGER, UNIQUE (room_id, seq))`,
  `CREATE UNIQUE INDEX rounds_one_active ON rounds (room_id) WHERE status IN ('PREPARING', 'INSPECTION', 'RUNNING')`,
  `CREATE TABLE attempts (
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE, member_id TEXT NOT NULL, nickname TEXT NOT NULL,
    status TEXT NOT NULL, end_reason TEXT, elapsed_ms INTEGER, rank_time INTEGER, rank INTEGER,
    move_count INTEGER NOT NULL, disconnect_ms INTEGER NOT NULL, final_state_hash TEXT,
    PRIMARY KEY (round_id, member_id))`,
  `CREATE TABLE moves (
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE, member_id TEXT NOT NULL, seq INTEGER NOT NULL,
    move TEXT NOT NULL, at_ms INTEGER NOT NULL, state_hash TEXT NOT NULL, PRIMARY KEY (round_id, member_id, seq))`,
  `CREATE TABLE room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, type TEXT NOT NULL, data TEXT)`,
  `CREATE INDEX room_events_room ON room_events (room_id, id)`,
];
const MIGRATIONS = [SCHEMA];

const ACTIVE_ROUND = ['PREPARING', 'INSPECTION', 'RUNNING'];

class Store {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const Database = sqlite();
    this.db = new Database(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000; PRAGMA synchronous = NORMAL;');
    if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch (e) { /* hệ thống tệp không hỗ trợ */ } }
    this.failWrites = 0; // kiểm thử: số lần ghi kế tiếp sẽ thất bại
    this.migrate();
    this.cache = new Map();
  }

  migrate() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > MIGRATIONS.length) throw new StoreError(`Dữ liệu thuộc phiên bản mới hơn (${version}); không ghi đè.`);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const sql of MIGRATIONS[v]) this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  run(sql, ...args) { return this.stmt(sql).run(...args); }
  get(sql, ...args) { return this.stmt(sql).get(...args); }
  all(sql, ...args) { return this.stmt(sql).all(...args); }

  // Một ranh giới ghi: thành công toàn bộ hoặc không thay đổi gì.
  write(fn) {
    if (this.failWrites > 0) { this.failWrites--; throw new StoreError('Lỗi ghi giả lập'); }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (e) { /* đã hủy */ }
      if (error instanceof StoreError) throw error;
      const wrapped = new StoreError(error.message);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  healthy() {
    try { return this.get('SELECT 1 AS ok').ok === 1; } catch (e) { return false; }
  }

  // ---------- Phiên khách ----------
  createSession(id, tokenHash, now) {
    this.write(() => this.run('INSERT INTO guest_sessions (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)', id, tokenHash, now, now));
  }
  findSession(tokenHash) {
    return this.get('SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt FROM guest_sessions WHERE token_hash = ?', tokenHash) || null;
  }
  touchSessions(ids, now) {
    if (!ids.length) return;
    this.write(() => { for (const id of ids) this.run('UPDATE guest_sessions SET last_seen_at = ? WHERE id = ?', now, id); });
  }

  // ---------- Phòng và thành viên ----------
  event(roomId, type, data, at) {
    this.run('INSERT INTO room_events (room_id, at, type, data) VALUES (?, ?, ?, ?)', roomId, at, type, data ? JSON.stringify(data) : null);
  }
  insertRoom(room) {
    this.run(`INSERT INTO rooms (id, code, status, host_member_id, config, round_seq, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, room.id, room.code, room.status, room.hostMemberId, JSON.stringify(room.config), room.roundSeq, room.createdAt);
  }
  saveRoom(room) {
    this.run('UPDATE rooms SET status = ?, host_member_id = ?, round_seq = ?, closed_at = ?, close_reason = ? WHERE id = ?',
      room.status, room.hostMemberId, room.roundSeq, room.closedAt ?? null, room.closeReason ?? null, room.id);
  }
  insertMember(m, roomId) {
    this.run(`INSERT INTO room_members (id, room_id, guest_id, nickname, nickname_key, standing, banned, joined_at, left_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, m.id, roomId, m.guestId, m.nickname, m.nicknameKey, m.standing, m.banned ? 1 : 0, m.joinedAt, m.leftAt ?? null);
  }
  saveMember(m) {
    this.run('UPDATE room_members SET nickname = ?, nickname_key = ?, standing = ?, banned = ?, joined_at = ?, left_at = ? WHERE id = ?',
      m.nickname, m.nicknameKey, m.standing, m.banned ? 1 : 0, m.joinedAt, m.leftAt ?? null, m.id);
  }
  roomCodeExists(code) { return !!this.get('SELECT 1 AS x FROM rooms WHERE code = ?', code); }

  loadOpenRooms() {
    const rooms = this.all(`SELECT id, code, status, host_member_id AS hostMemberId, config, round_seq AS roundSeq,
      created_at AS createdAt FROM rooms WHERE status <> 'CLOSED'`);
    for (const room of rooms) {
      room.config = JSON.parse(room.config);
      room.members = this.all(`SELECT id, guest_id AS guestId, nickname, nickname_key AS nicknameKey, standing, banned,
        joined_at AS joinedAt, left_at AS leftAt FROM room_members WHERE room_id = ? ORDER BY joined_at, id`, room.id)
        .map((m) => ({ ...m, banned: !!m.banned }));
      room.lastRound = this.latestRound(room.id);
    }
    return rooms;
  }

  // Phòng của một khách (kể cả đã đóng) để đọc lịch sử trong hạn lưu.
  membership(roomId, guestId) {
    return this.get(`SELECT m.id, m.standing, m.banned, r.status AS roomStatus FROM room_members m JOIN rooms r ON r.id = m.room_id
      WHERE m.room_id = ? AND m.guest_id = ?`, roomId, guestId) || null;
  }

  // ---------- Ván ----------
  insertRound(round) {
    this.run(`INSERT INTO rounds (id, room_id, seq, status, config, participants, engine_version, scramble, scramble_kind,
      start_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, round.id, round.roomId, round.seq, round.status,
    JSON.stringify(round.config), JSON.stringify(round.participants), round.engineVersion, round.scramble, round.scrambleKind,
    round.startState, round.createdAt);
  }
  closeStaleRounds(roomId, at) {
    this.run(`UPDATE rounds SET status = CASE status WHEN 'RUNNING' THEN 'VOID' ELSE 'CANCELLED' END,
      reason = COALESCE(reason, 'storage_failure'), ended_at = ? WHERE room_id = ? AND status IN ('PREPARING', 'INSPECTION', 'RUNNING')`, at, roomId);
  }
  markRoundStarted(roundId, at) {
    this.run("UPDATE rounds SET status = 'RUNNING', started_at = ? WHERE id = ?", at, roundId);
  }
  endRound(round) {
    this.run('UPDATE rounds SET status = ?, reason = ?, ended_at = ? WHERE id = ?', round.status, round.reason ?? null, round.endedAt, round.id);
  }
  insertAttempts(roundId, attempts) {
    for (const a of attempts) {
      this.run(`INSERT INTO attempts (round_id, member_id, nickname, status, end_reason, elapsed_ms, rank_time, rank, move_count,
        disconnect_ms, final_state_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, roundId, a.memberId, a.nickname, a.status,
      a.endReason ?? null, a.elapsedMs ?? null, a.rankTime ?? null, a.rank ?? null, a.moveCount, a.disconnectMs, a.stateHash ?? null);
      for (const m of a.moves || []) {
        this.run('INSERT INTO moves (round_id, member_id, seq, move, at_ms, state_hash) VALUES (?, ?, ?, ?, ?, ?)',
          roundId, a.memberId, m.seq, m.move, m.atMs, m.hash);
      }
    }
  }

  roundRow(row) {
    if (!row) return null;
    return {
      roundId: row.id, seq: row.seq, status: row.status, reason: row.reason, scrambleKind: row.scramble_kind,
      scramble: row.scramble, createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at,
      config: JSON.parse(row.config), participants: JSON.parse(row.participants),
    };
  }
  attemptsOf(roundId) {
    return this.all(`SELECT member_id AS memberId, nickname, status, end_reason AS endReason, elapsed_ms AS elapsedMs,
      rank_time AS rankTime, rank, move_count AS moveCount, disconnect_ms AS disconnectMs FROM attempts WHERE round_id = ?
      ORDER BY rank IS NULL, rank, rank_time, nickname`, roundId);
  }
  latestRound(roomId) {
    const row = this.get("SELECT * FROM rounds WHERE room_id = ? AND status NOT IN ('PREPARING', 'INSPECTION', 'RUNNING') ORDER BY seq DESC LIMIT 1", roomId);
    const round = this.roundRow(row);
    if (round) round.attempts = this.attemptsOf(round.roundId);
    return round;
  }
  listRounds(roomId) {
    return this.all('SELECT * FROM rounds WHERE room_id = ? AND ended_at IS NOT NULL ORDER BY seq DESC LIMIT 50', roomId)
      .map((row) => this.roundRow(row));
  }
  getRound(roomId, roundId) {
    const round = this.roundRow(this.get('SELECT * FROM rounds WHERE room_id = ? AND id = ? AND ended_at IS NOT NULL', roomId, roundId));
    if (!round) return null;
    round.attempts = this.attemptsOf(roundId);
    round.moves = this.all('SELECT member_id AS memberId, seq, move, at_ms AS atMs FROM moves WHERE round_id = ? ORDER BY member_id, seq', roundId);
    return round;
  }

  /*
   * Khởi động lại dịch vụ (BR-25): ván đã RUNNING → VOID, ván chuẩn bị/quan sát → CANCELLED; phòng về RESULTS/LOBBY.
   * Không bao giờ tiếp tục một ván từ dữ liệu đã ghi.
   */
  recoverInterrupted(now) {
    return this.write(() => {
      const rows = this.all(`SELECT id, room_id, status FROM rounds WHERE status IN (${ACTIVE_ROUND.map(() => '?').join(', ')})`, ...ACTIVE_ROUND);
      for (const row of rows) {
        const running = row.status === 'RUNNING';
        this.run('UPDATE rounds SET status = ?, reason = ?, ended_at = ? WHERE id = ?', running ? 'VOID' : 'CANCELLED', 'service_restart', now, row.id);
        this.run("UPDATE rooms SET status = ? WHERE id = ? AND status <> 'CLOSED'", running ? 'RESULTS' : 'LOBBY', row.room_id);
        this.run("UPDATE room_members SET standing = 'ACTIVE' WHERE room_id = ? AND standing = 'WAITING_NEXT'", row.room_id);
        this.event(row.room_id, running ? 'round.void' : 'round.cancelled', { roundId: row.id, reason: 'service_restart' }, now);
      }
      // Phòng bị kẹt IN_ROUND mà không có ván hoạt động (không nên xảy ra) cũng trở về phòng chờ.
      this.run(`UPDATE rooms SET status = 'LOBBY' WHERE status = 'IN_ROUND' AND id NOT IN
        (SELECT room_id FROM rounds WHERE status IN ('PREPARING', 'INSPECTION', 'RUNNING'))`);
      return rows.length;
    });
  }

  // Xóa dữ liệu quá hạn lưu (7 ngày) và phiên khách không hoạt động không còn thuộc phòng mở nào.
  purge(now, { retentionMs, sessionTtlMs }) {
    return this.write(() => {
      const before = now - retentionMs;
      const rounds = this.run('DELETE FROM rounds WHERE ended_at IS NOT NULL AND ended_at < ?', before).changes;
      const rooms = this.run("DELETE FROM rooms WHERE status = 'CLOSED' AND closed_at < ?", before).changes;
      this.run('DELETE FROM room_events WHERE at < ?', before);
      const sessions = this.run(`DELETE FROM guest_sessions WHERE last_seen_at < ? AND id NOT IN
        (SELECT m.guest_id FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE r.status <> 'CLOSED' AND m.standing <> 'LEFT')`,
      now - sessionTtlMs).changes;
      return { rounds, rooms, sessions };
    });
  }

  close() { try { this.db.close(); } catch (e) { /* đã đóng */ } }
}

module.exports = { Store, StoreError, ACTIVE_ROUND };
