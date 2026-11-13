'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
require('../js/play-moves.js');
require('../js/play-state.js');
require('../js/room-attempt.js');
const { RoomAttempt, PlayState } = globalThis.Rubik;

// Đếm nước độc lập lịch sử; chỉ chốt nước đã thực hiện, giữ nguyên kết quả khi giải xong.
let time = 100;
const attempt = new RoomAttempt('F', () => time);
assert.equal(attempt.moveCount, 0);
assert.equal(attempt.elapsed, 0);
assert.equal(attempt.model.past.length, 0, 'Không tính nước tráo');
const two = attempt.begin("R L'");
assert.equal(attempt.moveCount, 0, 'Chưa chốt thì chưa tính bước');
time = 220;
attempt.commit(two);
assert.equal(attempt.moveCount, 2);
assert.equal(attempt.elapsed, 120);
for (const entry of ['U2', 'M2', 'Rw2']) { attempt.commit(attempt.begin(entry)); }
assert.equal(attempt.moveCount, 5, '180 độ, lớp giữa, hai lớp đều tính một nước');
const long = new RoomAttempt('R', () => time);
for (let i = 0; i < 251; i++) long.commit(long.begin('U'));
assert.equal(long.moveCount, 251);
assert.equal(long.model.past.length, PlayState.LIMIT);
const finish = new RoomAttempt('R', () => time);
const inverse = finish.begin("R'"); time += 1234; finish.commit(inverse);
assert.deepEqual(finish.result, { moveCount: 1, durationMs: 1234 });
time += 2000;
assert.equal(finish.elapsed, 1234);
assert.equal(finish.begin('U'), null);
finish.commit('U');
assert.equal(finish.moveCount, 1);
assert.throws(() => new RoomAttempt('F').begin('invalid'));
console.log('✓ Bộ đếm, đồng hồ và nhận biết hoàn thành độc lập Chơi tự do');

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-rooms-'));
  const dataDir = path.join(base, 'data');
  let server;
  const open = async () => { server = await start(0, '127.0.0.1', base, { dataDir }); };
  const close = () => new Promise((resolve) => server.close(resolve));
  const request = async (route, body, status = 200) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    assert.equal(res.status, status, JSON.stringify(data));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return data;
  };
  try {
    await open();
    await request('health');
    await request('rooms', { nickname: '  ' }, 400);
    const created = await request('rooms', { nickname: '  An  ' }, 201);
    const { code, scramble } = created.room;
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.equal(scramble.split(' ').length, 20);
    assert.equal(created.player.nickname, 'An');
    await request('rooms/ZZZZZZ', undefined, 404);
    await request(`rooms/${code}/join`, { nickname: 'an' }, 409);
    const joined = await Promise.all(['Bình', 'Chi', 'Dung', 'Em'].map((nickname) => request(`rooms/${code.toLowerCase()}/join`, { nickname })));
    assert(joined.every((j) => j.room.scramble === scramble));
    const current = await request('rooms/' + code);
    assert.equal(current.room.players.length, 5, 'Ghi đồng thời không mất thành viên');
    assert(!JSON.stringify(current).includes(created.player.playerToken));
    const result = { playerId: created.player.playerId, playerToken: created.player.playerToken, moveCount: 350, durationMs: 9876 };
    await request(`rooms/${code}/result`, { ...result, playerToken: 'wrong' }, 403);
    for (const moveCount of [0, -1, 1.5, '20', null, Number.MAX_SAFE_INTEGER + 1]) {
      await request(`rooms/${code}/result`, { ...result, moveCount }, 400);
    }
    await request(`rooms/${code}/result`, { ...result, durationMs: 0 }, 400);
    const saved = await request(`rooms/${code}/result`, result);
    const duplicate = await request(`rooms/${code}/result`, { ...result, moveCount: 1, durationMs: 1 });
    assert.deepEqual(duplicate.result, saved.result, 'Gửi lại không sửa/thêm kết quả');
    // Chấp nhận kết quả do client tự báo, không yêu cầu chuỗi nước hay bằng chứng giải.
    const other = joined[0].player;
    await request(`rooms/${code}/result`, { ...other, moveCount: 1, durationMs: 1 });
    const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8'));
    assert.equal(disk.rooms[code].players.filter((p) => p.result).length, 2);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/data/rooms.json`)).status, 404, 'Không phục vụ tệp dữ liệu');
    assert.equal((fs.statSync(path.join(dataDir, 'rooms.json')).mode & 0o777), 0o600);
    // Giả lập đĩa không ghi được; trạng thái công bố không được đổi trước khi ghi thành công.
    fs.renameSync(dataDir, dataDir + '-backup'); fs.writeFileSync(dataDir, 'blocked');
    await request(`rooms/${code}/join`, { nickname: 'Thử lỗi ghi' }, 503);
    await request(`rooms/${code}/result`, { ...joined[1].player, moveCount: 20, durationMs: 1000 }, 503);
    assert.equal((await request('rooms/' + code)).room.players[2].result, null, 'Lỗi ghi không công bố kết quả');
    assert.equal((await request('rooms/' + code)).room.players.length, 5);
    fs.unlinkSync(dataDir); fs.renameSync(dataDir + '-backup', dataDir);
    await request(`rooms/${code}/join`, { nickname: 'Thử lỗi ghi' });
    await close(); await open();
    const restored = await request('rooms/' + code);
    assert.equal(restored.room.players.length, 6);
    assert.deepEqual(restored.room.players[0].result, saved.result);
    const oversized = await fetch(`http://127.0.0.1:${server.address().port}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'x'.repeat(5000) }),
    });
    assert.equal(oversized.status, 413);
    await close(); server = null;
    fs.writeFileSync(path.join(dataDir, 'rooms.json'), '{broken');
    await assert.rejects(open, /Không đọc được dữ liệu phòng/);
    assert.equal(fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8'), '{broken');
    console.log('✓ API: tạo/vào, cùng đề, ghi đồng thời, gửi lại, lỗi ghi, lưu qua khởi động và giữ tệp hỏng');
  } finally {
    if (server) await close();
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
