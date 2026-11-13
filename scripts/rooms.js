// Phòng giao hữu: tin số liệu trình duyệt, chỉ lưu đề/người chơi/kết quả cuối.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomInt, randomUUID } = require('node:crypto');
require('../js/cube.js');
const C = globalThis.Rubik.cube;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, text = '';
    req.setEncoding('utf8');
    req.on('data', (part) => {
      size += Buffer.byteLength(part);
      if (size > 4096) { text = ''; reject(new ApiError(413, 'Dữ liệu gửi quá dài.')); }
      else text += part;
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > 4096) return;
      try {
        const body = JSON.parse(text);
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
        resolve(body);
      } catch (error) { reject(new ApiError(400, 'Dữ liệu gửi không hợp lệ.')); }
    });
  });
}

function nickname(value) {
  if (typeof value !== 'string') throw new ApiError(400, 'Nhập biệt danh từ 1 đến 24 ký tự.');
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > 24 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError(400, 'Nhập biệt danh từ 1 đến 24 ký tự.');
  }
  return name;
}

const positive = (n) => Number.isSafeInteger(n) && n > 0;
const publicRoom = (room) => ({
  code: room.code, scramble: room.scramble, createdAt: room.createdAt,
  players: room.players.map(({ playerId, nickname: name, result }) => ({ playerId, nickname: name, result })),
});

async function createRoomApi(dataDir) {
  const file = path.join(dataDir, 'rooms.json');
  let data = { version: 1, rooms: {} };
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.version !== 1 || !data.rooms || typeof data.rooms !== 'object' || Array.isArray(data.rooms)) throw new Error();
    for (const [code, room] of Object.entries(data.rooms)) {
      if (!/^[A-Z0-9]{6}$/.test(code) || room.code !== code || typeof room.scramble !== 'string' ||
          !C.parseMoves(room.scramble).length || !Array.isArray(room.players)) throw new Error();
      for (const player of room.players) {
        if (typeof player.playerId !== 'string' || typeof player.playerToken !== 'string' || nickname(player.nickname) !== player.nickname ||
            (player.result !== null && (!positive(player.result?.moveCount) || !positive(player.result?.durationMs)))) throw new Error();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Không đọc được dữ liệu phòng; giữ nguyên tệp để kiểm tra.');
  }

  // Một hàng đợi cho cả tệp: mọi thay đổi đọc từ bản mới nhất, chỉ công bố sau khi ghi thành công.
  let queue = Promise.resolve();
  function update(change) {
    const operation = queue.then(async () => {
      const next = structuredClone(data);
      const result = change(next);
      if (result.unchanged) return result.value;
      const temp = path.join(dataDir, `.rooms-${randomUUID()}.tmp`);
      try {
        await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
        await fs.writeFile(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        await fs.rename(temp, file);
      } catch (error) {
        await fs.unlink(temp).catch(() => {});
        throw new ApiError(503, 'Chưa lưu được dữ liệu. Vui lòng gửi lại.');
      }
      data = next;
      return result.value;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  function getRoom(state, code) {
    if (!Object.hasOwn(state.rooms, code)) throw new ApiError(404, 'Không tìm thấy phòng. Kiểm tra lại mã mời.');
    return state.rooms[code];
  }
  function addPlayer(room, name) {
    if (room.players.some((p) => p.nickname.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) {
      throw new ApiError(409, 'Biệt danh đã có trong phòng. Hãy chọn tên khác.');
    }
    const player = { playerId: randomUUID(), playerToken: randomBytes(24).toString('hex'), nickname: name, result: null };
    room.players.push(player);
    return { room: publicRoom(room), player: { playerId: player.playerId, playerToken: player.playerToken, nickname: name } };
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(res, 200, { ok: true });
        return true;
      }
      const match = /^\/api\/rooms(?:\/([a-z0-9]{6})(?:\/(join|result))?)?\/?$/i.exec(url.pathname);
      if (!match) throw new ApiError(404, 'Không tìm thấy chức năng này.');
      const code = match[1]?.toUpperCase(), action = match[2]?.toLowerCase();
      if (req.method === 'GET' && code && !action) {
        send(res, 200, { room: publicRoom(getRoom(data, code)) });
        return true;
      }
      if (req.method !== 'POST' || (code && !action)) throw new ApiError(405, 'Cách gọi không được hỗ trợ.');
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        throw new ApiError(415, 'Hãy gửi dữ liệu JSON.');
      }
      const body = await readBody(req);
      const result = await update((state) => {
        if (!code) {
          const name = nickname(body.nickname);
          const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          let newCode;
          do { newCode = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
          while (Object.hasOwn(state.rooms, newCode));
          let moves;
          do { moves = C.randomScramble(20); }
          while (C.applyMoves(C.SOLVED, moves).every((c, i) => c === C.SOLVED[i]));
          const room = { code: newCode, scramble: moves.map(C.moveToString).join(' '), createdAt: new Date().toISOString(), players: [] };
          state.rooms[newCode] = room;
          return { value: addPlayer(room, name) };
        }
        const room = getRoom(state, code);
        if (action === 'join') return { value: addPlayer(room, nickname(body.nickname)) };
        const player = room.players.find((p) => p.playerId === body.playerId && p.playerToken === body.playerToken);
        if (!player) throw new ApiError(403, 'Thông tin người chơi không khớp. Hãy vào lại phòng.');
        if (!positive(body.moveCount) || !positive(body.durationMs)) throw new ApiError(400, 'Số bước và thời gian phải là số nguyên dương.');
        if (player.result) return { unchanged: true, value: { room: publicRoom(room), result: player.result } };
        player.result = { moveCount: body.moveCount, durationMs: body.durationMs, finishedAt: new Date().toISOString() };
        return { value: { room: publicRoom(room), result: player.result } };
      });
      send(res, code ? 200 : 201, result);
    } catch (error) {
      send(res, error.status || 500, { error: error.status ? error.message : 'Không xử lý được yêu cầu. Vui lòng thử lại.' });
    }
    return true;
  };
}

module.exports = { createRoomApi };
