'use strict';
const assert = require('node:assert/strict');
require('../js/cube.js');
require('../js/play-moves.js');
require('../js/play-gesture.js');
require('../js/play-state.js');
require('../js/cube3d.js');
const { cube: C, playMoves: P, PlayGesture, PlayState, Cube3D } = globalThis.Rubik;
const SOLVED = Array.from(C.SOLVED);
const same = (a, b) => a.join('') === b.join('');
const x = (s) => C.rotateWholeCube(s, 'R'), y = (s) => C.rotateWholeCube(s, 'U'), z = (s) => C.rotateWholeCube(s, 'F');

// ---------- Mô hình xoay: đối chiếu với phép biến đổi độc lập ----------
const scrambled = C.applyMoves(SOLVED, C.randomScramble(40, (() => { let seed = 7; return () => (seed = (seed * 16807) % 2147483647) / 2147483647; })()));
for (const face of C.FACES) for (const suffix of ['', "'", '2']) {
  assert(same(P.apply(scrambled, face + suffix), C.applyMove(scrambled, face + suffix)), `Lớp ngoài ${face + suffix} trùng cube.js`);
}
// Lớp giữa so với xoay cả khối của cube.js: R L' M' = x, U D' E' = y, F S B' = z.
assert(same(P.apply(scrambled, "M'"), x(P.applyAll(scrambled, "L R'"))), "M' = L R' x");
assert(same(P.apply(scrambled, "E'"), y(P.applyAll(scrambled, "D U'"))), "E' = D U' y");
assert(same(P.apply(scrambled, 'S'), z(P.applyAll(scrambled, "F' B"))), "S = F' B z");
for (const [w, sequence] of [['Rw', "R M'"], ['Lw', 'L M'], ['Uw', "U E'"], ['Dw', 'D E'], ['Fw', 'F S'], ['Bw', "B S'"]]) {
  assert(same(P.apply(scrambled, w), P.applyAll(scrambled, sequence)), `${w} = ${sequence}`);
}
for (const base of Object.keys(P.BASES)) {
  assert(same(P.applyAll(scrambled, Array(4).fill(base).join(' ')), scrambled), `${base} bốn lần trả về ban đầu`);
  assert(same(P.applyAll(scrambled, `${base}2 ${base}2`), scrambled), `${base}2 hai lần trả về ban đầu`);
  assert(same(P.apply(P.apply(scrambled, base), P.inverse(base)), scrambled), `${base} rồi nghịch đảo`);
  assert(same(P.apply(scrambled, base + "'"), P.applyAll(scrambled, `${base} ${base} ${base}`)), `${base}' = ba lần ${base}`);
}
assert.equal(P.parseSequence("R U R’ U’ M2 r u2' Rw' E S2").map(P.toString).join(' '), "R U R' U' M2 Rw Uw2 Rw' E S2",
  'Chuẩn hoá chữ thường thành hai lớp, dấu phẩy tiếng Việt và 2\'');
assert.throws(() => P.parseSequence('R X U'), 'Ký hiệu sai làm hỏng cả công thức');
for (const bad of ['Mw', 'm', 'x', 'R3', "R''", 'Rw w', '']) assert.throws(() => P.parse(bad), `Không nhận ${bad}`);
assert.equal(P.fromLayer(0, 0, 1), "M'", 'Xoay dương quanh trục x ở lớp giữa là M\'');
assert.equal(P.fromLayer(1, -1, 1, true), "Dw'");
assert.equal(P.fromLayer(2, 0, 1, true), null, 'Hai lớp không có mốc ở lớp giữa');
const mixed = "R U R' U' M2 Rw U2 Rw'";
assert(C.validateColors(P.applyAll(SOLVED, mixed)).ok, 'Công thức hỗn hợp tạo khối hợp lệ');
console.log('✓ Mô hình xoay: 18 nước ngoài, M/E/S, 6 kiểu hai lớp khớp phép biến đổi độc lập');

// ---------- Trạng thái, lịch sử, lưu và nhận biết đã giải ----------
for (const base of Object.keys(P.BASES)) for (const suffix of ['', "'", '2']) {
  const state = new PlayState();
  state.move(base + suffix);
  const moved = state.colors.slice();
  assert(C.validateColors(moved).ok && PlayState.validColors(moved), `${base + suffix} giữ khối hợp lệ`);
  assert(!state.solved);
  state.undo();
  assert(state.solved, `Hoàn tác ${base + suffix}`);
  state.redo();
  assert.deepEqual(state.colors, moved, `Làm lại ${base + suffix}`);
  const restored = new PlayState(JSON.parse(JSON.stringify(state.snapshot())));
  assert(restored.restored, `Tải lại sau ${base + suffix} không mất khối`);
  assert.deepEqual(restored.snapshot(), state.snapshot());
}
const state = new PlayState();
const tokens = C.randomScramble(40).map(C.moveToString).concat(['M', "Rw'", 'E2', 'Fw', "S'"]);
tokens.forEach((token) => state.move(token));
const scrambledState = state.colors.slice();
for (let i = 0; i < tokens.length; i++) state.undo();
assert(state.solved);
for (let i = 0; i < tokens.length; i++) state.redo();
assert.deepEqual(state.colors, scrambledState);
state.undo();
const restored = new PlayState(JSON.parse(JSON.stringify(state.snapshot())));
assert.deepEqual(restored.snapshot(), state.snapshot(), 'Tải lại giữ khối và cả hai ngăn lịch sử');
assert.equal(restored.snapshot().version, 3);
restored.redo();
assert.deepEqual(restored.colors, scrambledState);
state.move('u');
assert.equal(state.past.at(-1), 'Uw', 'Lịch sử lưu dạng chuẩn Uw');
assert.equal(state.future.length, 0, 'Nước mới sau hoàn tác phải bỏ nhánh làm lại');
assert.throws(() => state.move('R X'), 'Ký hiệu sai làm hỏng cả lượt');
assert.throws(() => state.move("R U R'"), 'Không chấp nhận công thức như một lượt');
const before = state.snapshot();
assert.throws(() => state.move('bad'));
assert.deepEqual(state.snapshot(), before, 'Nước không hợp lệ không được sửa trạng thái');
const copy = state.snapshot();
copy.colors[0] = '?'; copy.past.length = 0;
assert.deepEqual(state.snapshot(), before, 'Ảnh chụp trạng thái phải độc lập');

const rotated = new PlayState();
["R", "L'", "M'"].forEach((token) => rotated.move(token));
assert.notEqual(rotated.colors[4], 'U', 'R L\' M\' (= x) làm tâm đổi chỗ');
assert(rotated.solved, 'Khối đã giải ở hướng cầm khác vẫn là đã giải');
assert.equal(rotated.past.length, 3);

// Bản lưu cũ (rubik-play-v1: không có version, tâm cố định) vẫn đọc được.
const legacy = { colors: C.applyMoves(SOLVED, "R U R' U'"), past: ['R', 'U', "R'", "U'"], future: [] };
const migrated = new PlayState(legacy);
assert(migrated.restored && migrated.past.length === 4 && same(migrated.colors, legacy.colors), 'Chuyển bản lưu cũ');
// Ảnh gương của khối (đổi chỗ tâm L/R cùng mọi ô) qua được kiểm tra theo tâm nhưng không phải hướng cầm hợp lệ.
const mirror = SOLVED.map((color) => (color === 'R' ? 'L' : color === 'L' ? 'R' : color));
assert(C.validateColors(mirror).ok, 'Bộ kiểm tra theo tâm không phát hiện ảnh gương');
assert(!new PlayState({ ...before, colors: mirror }).restored, 'Từ chối ảnh gương của khối');
for (const bad of [null, 3, {}, { ...before, colors: [] }, { ...before, past: ['X'] }, { ...before, version: 4 }, { ...before, past: ['R U'] },
  { ...before, colors: C.applyMove(SOLVED, 'R').map(() => 'U') }, { ...before, colors: SOLVED.map((c) => c.toLowerCase()) },
  { ...before, future: Array(201).fill('R') }, { ...before, past: Array(150).fill('M'), future: Array(51).fill('R') }]) {
  const broken = new PlayState(bad);
  assert(broken.solved && !broken.restored, 'Dữ liệu lưu hỏng phải quay về khối hợp lệ');
}
const bounded = new PlayState();
for (let i = 0; i < 250; i++) bounded.move(['R', 'M', 'Uw'][i % 3]);
assert.equal(bounded.past.length, 200);
const boundedRestored = new PlayState(bounded.snapshot());
assert.deepEqual(boundedRestored.colors, bounded.colors, 'Cắt lịch sử không được đổi khối');
for (let i = 0; i < 200; i++) boundedRestored.undo();
assert.deepEqual(boundedRestored.colors, P.applyAll(SOLVED, Array.from({ length: 50 }, (_, i) => ['R', 'M', 'Uw'][i % 3]).join(' ')));
bounded.reset();
bounded.undo(); bounded.redo();
assert(bounded.solved);
assert.deepEqual(bounded.past, []);

// Lượt hai ngón: hai nước trên hai lớp song song ghi thành một mục; hoàn tác/làm lại một lần cho cả lượt.
const pair = new PlayState();
pair.move(['R', "L'"]);
pair.move('U  E2');
assert.deepEqual(pair.past, ["R L'", 'U E2'], 'Lượt hai ngón ghi hai nước trong một mục');
assert.deepEqual(pair.colors, P.applyAll(SOLVED, "R L' U E2"));
pair.undo();
assert.deepEqual(pair.colors, P.applyAll(SOLVED, "R L'"), 'Hoàn tác một lần lùi cả hai lớp');
assert.deepEqual(pair.future, ['U E2']);
pair.undo();
assert(pair.solved);
pair.redo();
assert.deepEqual(pair.colors, P.applyAll(SOLVED, "R L'"), 'Làm lại một lần tiến cả hai lớp');
pair.redo();
const pairSaved = new PlayState(JSON.parse(JSON.stringify(pair.snapshot())));
assert(pairSaved.restored && pairSaved.snapshot().version === 3);
assert.deepEqual(pairSaved.snapshot(), pair.snapshot(), 'Tải lại giữ lượt hai ngón');
const pairBefore = pair.snapshot();
for (const bad of ['R U', 'R R', 'Rw M', 'M S', "R L' U", ' ', ['R', 'F']]) {
  assert.throws(() => pair.move(bad), `Không phải một lượt hợp lệ: ${bad}`);
}
assert.deepEqual(pair.snapshot(), pairBefore, 'Lượt không hợp lệ không sửa trạng thái');
assert.equal(P.entryToString(['Rw', 'L2']), 'Rw L2', 'Hai lớp kề nhau + lớp ngoài đối diện không chung viên');
assert.deepEqual(P.inverseEntry("R L'").map(P.toString), ['L', "R'"], 'Nghịch đảo một lượt: đảo thứ tự và chiều');
const version2 = { version: 2, colors: P.applyAll(SOLVED, "R U M"), past: ['R', 'U', 'M'], future: ['F'] };
const fromVersion2 = new PlayState(version2);
assert(fromVersion2.restored && fromVersion2.past.length === 3 && fromVersion2.snapshot().version === 3, 'Đọc được bản lưu phiên bản 2');
console.log('✓ Trạng thái: 45 kiểu nước, lượt hai lớp song song, hoàn tác/làm lại, tải lại, bản lưu cũ, ảnh gương, giới hạn 200 lượt');

// ---------- Chọn lớp theo hướng kéo, nhìn trực diện mặt trước ----------
const view = Object.create(Cube3D.prototype);
view.size = 48;
view.scale = 1;
view.view = { rx: 0, ry: 0 };
assert.equal(view.moveForDrag(19, -50, 0), 'U');
assert.equal(view.moveForDrag(19, 50, 0), "U'");
assert.equal(view.moveForDrag(25, 50, 0), 'D');
assert.equal(view.moveForDrag(21, 0, 50), 'L');
assert.equal(view.moveForDrag(23, 0, -50), 'R');
assert.equal(view.moveForDrag(19, 0, 50), 'M', 'Kéo cột giữa xuống là M (theo L)');
assert.equal(view.moveForDrag(22, 50, 0), 'E', 'Kéo ô tâm sang phải là E (theo D)');
assert.equal(view.moveForDrag(22, 0, -50), "M'", 'Kéo ô tâm lên là M\'');
assert.equal(view.moveForDrag(19, 2, 0), null, 'Chạm nhẹ không được xoay lớp');
assert.equal(view.moveForDrag(19, 40, 40), null, 'Hướng chéo mơ hồ không xoay');
assert.equal(view.moveForDrag(19, -50, 0, 2), 'Uw', 'Hai lớp từ hàng trên');
assert.equal(view.moveForDrag(23, 0, -50, 2), 'Rw', 'Hai lớp từ cột phải');
assert(view.moveForDrag(19, 0, 50, 2).error, 'Mốc ở cột giữa không tự đoán hai lớp');
view.view = { rx: 0, ry: -90 };
assert.equal(view.moveForDrag(13, 0, 50), 'S', 'Nhìn mặt phải: kéo tâm xuống là S (theo F)');
view.view = { rx: 0, ry: 180 };
assert.equal(view.moveForDrag(46, -50, 0), 'U', 'Giữ chiều đúng khi nhìn từ phía sau');
view.view = { rx: -89, ry: 0 };
assert.equal(view.moveForDrag(4, 50, 0), "S", 'Nhìn từ trên: kéo tâm U sang phải là S');
view.view = { rx: -26, ry: -36 }; // góc nhìn mặc định: đủ sáu kiểu hai lớp từ mặt trước và mặt phải
for (const [index, dx, dy, token] of [[19, -50, 0, 'Uw'], [25, 50, 0, 'Dw'], [21, 0, 50, 'Lw'], [23, 0, -50, 'Rw'],
  [9, 0, 50, 'Fw'], [11, 0, -50, 'Bw']]) {
  assert.equal(view.moveForDrag(index, dx, dy, 2), token, `Hai lớp ${token} từ ô ${index}`);
}
// Quét nhiều góc nhìn: vuốt dọc theo hướng của từng lớp trên mọi ô nhìn rõ phải chọn đúng trục của lớp đó.
let sweep = 0;
for (const angles of [{ rx: -26, ry: -36 }, { rx: -40, ry: 30 }, { rx: 20, ry: -120 }, { rx: -60, ry: 150 }, { rx: 0, ry: 0 },
  { rx: -80, ry: 10 }, { rx: 45, ry: 200 }]) {
  view.view = angles;
  const rx = angles.rx * Math.PI / 180, ry = angles.ry * Math.PI / 180;
  for (const f of C.FACELETS) {
    const n = f.normal;
    const facing = -n[1] * Math.sin(rx) + (-n[0] * Math.sin(ry) + n[2] * Math.cos(ry)) * Math.cos(rx);
    if (facing < 0.4) continue; // mặt quay đi hoặc nghiêng gần song song hướng nhìn
    const point = f.pos.map((v, i) => v + 0.5 * n[i]);
    const from = view.projectPoint(point);
    for (let axis = 0; axis < 3; axis++) {
      if (n[axis]) continue;
      const a = [0, 0, 0]; a[axis] = 1;
      const along = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
      const to = view.projectPoint(point.map((v, i) => v - 0.05 * along[i]));
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const dx = 60 * (to[0] - from[0]) / length, dy = 60 * (to[1] - from[1]) / length;
      const expected = P.fromLayer(axis, f.pos[axis], 1);
      assert.equal(view.moveForDrag(f.index, dx, dy), expected, `Góc ${angles.rx}/${angles.ry}, ô ${f.index}, trục ${axis}`);
      assert.equal(view.moveForDrag(f.index, -dx, -dy), P.toString(P.inverse(expected)));
      sweep++;
    }
  }
}
assert(sweep >= 200, `Quét quá ít hướng: ${sweep}`);
console.log(`✓ Hướng vuốt chọn đúng lớp ngoài, lớp giữa và hai lớp ở nhiều góc nhìn (${sweep} hướng ở 7 góc nhìn)`);


// ---------- Bộ nhận cử chỉ ----------
// Mô phỏng nhìn trực diện mặt trước (ô 18–26): kéo ngang chọn hàng (trục y: U/E/D), kéo dọc chọn cột (trục x: L/M/R);
// chiều dương là sang phải/xuống. options.pick thay bằng hình học thật khi cần.
function recorder({ canTurn = true, pick } = {}) {
  const log = { commits: [], taps: [], hints: [], orbit: [], previews: [], touches: [], cancels: 0, status: '' };
  const handler = {
    canTurn: () => canTurn,
    pick: pick || ((facelet, dx, dy, layers) => {
      if (facelet === 99) return { error: 'mốc giữa' };
      if (Math.abs(dx) < Math.abs(dy) * 1.2 && Math.abs(dy) < Math.abs(dx) * 1.2) return null;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const row = Math.floor((facelet - 18) / 3), col = (facelet - 18) % 3;
      const axis = horizontal ? 1 : 0, layer = horizontal ? 1 - row : col - 1;
      const name = (horizontal ? ['D', 'E', 'U'] : ['L', 'M', 'R'])[layer + 1] + (layers === 2 ? 'w' : '');
      return { axis, layer, tx: horizontal ? 1 : 0, ty: horizontal ? 0 : 1, tokens: [name, name + "'"], spec: { axis, layers: [layer] } };
    }),
    preview: (specs) => log.previews.push(specs),
    touch: (facelets) => log.touches.push(facelets.slice()),
    orbitStart: () => log.orbit.push('start'),
    orbit: (dx, dy) => log.orbit.push([Math.round(dx), Math.round(dy)]),
    orbitCancel: () => { log.cancels++; },
    orbitEnd: () => log.orbit.push('end'),
    commit: (tokens) => log.commits.push(tokens.join(' ')),
    tap: (facelet) => log.taps.push(facelet),
    hint: (text) => log.hints.push(text),
    status: (info) => { log.status = info.text; },
  };
  return { gesture: new PlayGesture(handler), log };
}
const touch = (id, x, y, t, facelet = null, primary = false) => ({ id, x, y, t, kind: 'touch', facelet, primary });
const mouse = (x, y, t, facelet = null, mode = 'layer1') => ({ id: 1, x, y, t, kind: 'mouse', facelet, primary: true, mode });
// Đặt các ngón (mỗi ngón [id, x, y, ô]) rồi kéo mỗi ngón theo vectơ riêng qua vài bước; trả về vị trí cuối.
function place(g, fingers, t = 0) {
  fingers.forEach(([id, x, y, facelet], i) => g.down(touch(id, x, y, t + i * 10, facelet, i === 0)));
}
function drag(g, fingers, vectors, t = 200, steps = 4) {
  for (let s = 1; s <= steps; s++) {
    fingers.forEach(([id, x, y], i) => g.move(touch(id, x + vectors[i][0] * s / steps, y + vectors[i][1] * s / steps, t + s * 16)));
  }
  return fingers.map(([id, x, y], i) => [id, x + vectors[i][0], y + vectors[i][1]]);
}
const lift = (g, ends, t = 400) => ends.forEach(([id, x, y], i) => g.up(touch(id, x, y, t + i * 10)));

{ // Một ngón: tô viên khi đặt, tô cả hàng khi rõ hướng; chiều theo vị trí lúc nhấc.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  assert.deepEqual(log.touches.at(-1), [19], 'Đặt ngón tô sáng viên đang chạm');
  g.move(touch(1, 110, 100, 50));
  assert.equal(log.commits.length, 0);
  g.move(touch(1, 160, 100, 200));
  assert.equal(g.phase, 'locked');
  assert.deepEqual(log.previews.at(-1), [{ axis: 1, layers: [1] }], 'Rõ hướng: tô cả hàng');
  assert.deepEqual(log.touches.at(-1), [], 'Rõ hướng: bỏ tô viên');
  assert.match(log.status, /1 ngón · U$/);
  g.up(touch(1, 160, 100, 260));
  assert.deepEqual(log.commits, ['U']);
  assert.equal(log.previews.at(-1), null);
  assert.equal(g.phase, 'idle');
}
{ // Kéo ngược về gần điểm đầu thì bỏ lượt.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  g.move(touch(1, 160, 100, 200));
  g.move(touch(1, 104, 100, 300));
  g.up(touch(1, 104, 100, 320));
  assert.deepEqual(log.commits, []);
  assert.equal(log.status, 'Đã bỏ lượt');
}
{ // Vuốt nhanh, nhấc tay trước khi hết khoảng ghép ngón vẫn được chốt; chạm nhẹ là chọn mặt.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  g.move(touch(1, 80, 100, 40));
  g.up(touch(1, 40, 100, 80));
  assert.deepEqual(log.commits, ["U'"]);
  g.down(touch(2, 100, 100, 500, 21, true));
  g.up(touch(2, 103, 101, 560));
  assert.deepEqual(log.taps, [21]);
  assert.deepEqual(log.touches.at(-1), [], 'Nhấc tay bỏ tô viên');
}
{ // Chỉ 3 ngón đổi góc nhìn: một ngón kéo ở vùng nền không xoay, không đổi góc nhìn, có gợi ý.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, null, true));
  assert.deepEqual(log.touches.at(-1), []);
  g.move(touch(1, 160, 100, 200));
  g.up(touch(1, 160, 100, 250));
  assert.deepEqual(log.orbit, []);
  assert.deepEqual(log.commits, []);
  assert.match(log.hints.at(-1), /3 ngón để đổi góc nhìn/);
  assert.match(log.status, /ngoài khối/);
}
{ // Hai ngón ngược chiều trên hai cột: mỗi ngón một lớp, một chiều; trung bình gần 0 vẫn khóa; một lượt hai nước.
  const { gesture: g, log } = recorder();
  const fingers = [[1, 100, 100, 21], [2, 200, 100, 23]];
  place(g, fingers);
  assert.deepEqual(log.touches.at(-1), [21, 23], 'Đặt hai ngón tô hai viên');
  g.move(touch(1, 100, 130, 220));
  assert.equal(g.phase, 'locked');
  assert.deepEqual(log.previews.at(-1), [{ axis: 0, layers: [-1] }], 'Ngón rõ hướng trước được tô cả cột');
  assert.deepEqual(log.touches.at(-1), [23], 'Ngón kia vẫn tô viên');
  assert.match(log.status, /2 ngón · L …/);
  g.move(touch(2, 200, 70, 230));
  assert.deepEqual(log.previews.at(-1), [{ axis: 0, layers: [-1] }, { axis: 0, layers: [1] }], 'Cả hai cột được tô');
  assert.deepEqual(log.touches.at(-1), []);
  assert.match(log.status, /2 ngón · L R'$/);
  g.move(touch(1, 100, 160, 260)); g.move(touch(2, 200, 40, 260));
  g.up(touch(2, 200, 40, 300));
  assert.deepEqual(log.commits, ["L R'"], 'Thứ tự theo ngón đặt xuống');
  assert.equal(g.phase, 'wait');
  g.move(touch(1, 100, 220, 320));
  g.up(touch(1, 100, 220, 340));
  assert.deepEqual(log.commits, ["L R'"], 'Ngón còn lại không tạo thêm nước');
  assert.equal(g.phase, 'idle');
}
{ // Hai ngón cùng chiều trên hai hàng; ngón đặt trước đứng trước; vuốt nhanh trước khoảng ghép ngón vẫn chốt.
  const { gesture: g, log } = recorder();
  const fingers = [[1, 100, 300, 25], [2, 100, 100, 19]];
  place(g, fingers);
  lift(g, drag(g, fingers, [[50, 0], [50, 0]], 30, 2), 70);
  assert.deepEqual(log.commits, ['D U']);
}
{ // Đặt thêm ngón trước khi khóa: đo lại từ đầu, không xoay sớm theo ngón thứ nhất.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  g.move(touch(1, 112, 100, 60));
  g.down(touch(2, 200, 100, 100, 23));
  g.move(touch(1, 113, 100, 180));
  g.move(touch(2, 201, 100, 180));
  assert.equal(g.phase, 'collect', 'Chưa khóa vì độ dịch chuyển đo lại từ lúc thêm ngón');
  g.move(touch(1, 113, 130, 300));
  g.move(touch(2, 201, 130, 300));
  g.up(touch(1, 113, 130, 320));
  assert.deepEqual(log.commits, ['M R']);
}
for (const [label, fingers, vectors, hint] of [
  ['Hai ngón trên cùng một cột', [[1, 100, 100, 19], [2, 100, 200, 22]], [[0, 60], [0, 60]], /hai hàng hoặc hai cột khác nhau/],
  ['Hai ngón ngược chiều trên cùng một cột', [[1, 100, 100, 19], [2, 100, 200, 22]], [[0, 60], [0, -60]], /hai hàng hoặc hai cột khác nhau/],
  ['Một ngón kéo hàng, ngón kia kéo cột', [[1, 100, 100, 18], [2, 200, 300, 26]], [[60, 0], [0, 60]], /song song/],
  ['Một ngón ở vùng nền', [[1, 100, 100, 21], [2, 400, 100, null]], [[0, 60], [0, -60]], /cả hai ngón lên khối/],
  ['Một ngón chưa kéo đủ xa', [[1, 100, 100, 21], [2, 200, 100, 23]], [[0, 60], [0, -5]], /cả hai ngón đủ xa/],
  ['Một ngón kéo chéo mơ hồ', [[1, 100, 100, 21], [2, 200, 100, 23]], [[0, 60], [40, 40]], /cả hai ngón đủ xa/],
]) {
  const { gesture: g, log } = recorder();
  place(g, fingers);
  lift(g, drag(g, fingers, vectors));
  assert.deepEqual(log.commits, [], `${label}: không xoay`);
  assert.match(log.hints.at(-1), hint, `${label}: gợi ý đúng`);
  assert.equal(log.previews.at(-1), null, `${label}: bỏ tô sáng`);
  assert.deepEqual(log.touches.at(-1), [], `${label}: bỏ tô viên`);
  assert.equal(g.phase, 'idle');
}
{ // Thêm ngón sau khi khóa: hủy lượt, không đổi sang kiểu khác.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  g.move(touch(1, 140, 100, 200));
  assert.equal(g.phase, 'locked');
  g.down(touch(2, 300, 300, 260, 23));
  assert.equal(g.phase, 'wait');
  g.move(touch(1, 200, 100, 300));
  g.up(touch(1, 200, 100, 320));
  g.up(touch(2, 300, 300, 330));
  assert.deepEqual(log.commits, []);
  assert.equal(log.previews.at(-1), null, 'Bỏ tô sáng khi hủy');
  assert.deepEqual(log.touches.at(-1), []);
  assert.equal(g.phase, 'idle');
}
{ // Ba ngón đổi góc nhìn, kể cả bắt đầu ở vùng nền; ngón thứ ba bỏ tô viên; nhấc từng ngón không tạo nước.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, null, true));
  g.down(touch(2, 150, 100, 20, 19));
  assert.deepEqual(log.touches.at(-1), [19]);
  g.down(touch(3, 200, 100, 40, 23));
  assert.deepEqual(log.touches.at(-1), [], 'Ba ngón không tô viên');
  g.move(touch(1, 130, 120, 220)); g.move(touch(2, 180, 120, 220)); g.move(touch(3, 230, 120, 220));
  assert.equal(log.orbit[0], 'start');
  assert.match(log.status, /3 ngón · đổi góc nhìn/);
  g.up(touch(3, 230, 120, 300));
  g.move(touch(1, 200, 200, 320)); g.move(touch(2, 250, 200, 320));
  g.up(touch(2, 250, 200, 340)); g.up(touch(1, 200, 200, 340));
  assert.deepEqual(log.commits, []);
  assert.equal(log.orbit.at(-1), 'end');
  assert.equal(log.cancels, 0);
  assert(log.previews.every((specs) => specs === null), 'Ba ngón không tô lớp');
}
{ // Ba ngón bị ngắt chạm: đưa góc nhìn về đầu cử chỉ.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, null, true)); g.down(touch(2, 150, 100, 10)); g.down(touch(3, 200, 100, 20));
  g.move(touch(1, 140, 100, 220)); g.move(touch(2, 190, 100, 220)); g.move(touch(3, 240, 100, 220));
  g.cancel(2);
  assert.equal(log.cancels, 1);
  g.up(touch(1, 140, 100, 300)); g.up(touch(3, 240, 100, 300));
  assert.deepEqual(log.commits, []);
}
{ // Ba ngón chụm/phóng to (độ dịch chuyển trung bình gần 0) không khóa và không xoay lớp.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true)); g.down(touch(2, 200, 100, 10, 23)); g.down(touch(3, 150, 200, 20));
  for (let step = 1; step <= 4; step++) { // các ngón di chuyển xen kẽ như khi chụm tay thật
    const t = 200 + step * 16;
    g.move(touch(1, 100 - 10 * step, 100 - 5 * step, t)); g.move(touch(2, 200 + 10 * step, 100 - 5 * step, t));
    g.move(touch(3, 150, 200 + 10 * step, t));
  }
  g.up(touch(1, 60, 80, 300)); g.up(touch(2, 240, 80, 300)); g.up(touch(3, 150, 240, 300));
  assert.deepEqual(log.commits, []);
  assert.deepEqual(log.orbit, []);
}
{ // Bốn ngón: không xoay, chờ nhấc hết tay.
  const { gesture: g, log } = recorder();
  for (let id = 1; id <= 4; id++) g.down(touch(id, id * 50, 100, id * 10, 19, id === 1));
  assert.equal(g.phase, 'wait');
  assert.deepEqual(log.touches.at(-1), []);
  for (let id = 1; id <= 4; id++) g.move(touch(id, id * 50 + 80, 100, 300));
  for (let id = 1; id <= 4; id++) g.up(touch(id, id * 50 + 80, 100, 320));
  assert.deepEqual(log.commits, []);
  assert.deepEqual(log.orbit, []);
  assert.equal(g.phase, 'idle');
}
{ // Đang bận thì không xoay lớp.
  const { gesture: g, log } = recorder({ canTurn: false });
  g.down(touch(1, 100, 100, 400, 19, true));
  g.move(touch(1, 160, 100, 600));
  g.up(touch(1, 160, 100, 650));
  assert.deepEqual(log.commits, []);
  assert.match(log.hints.at(-1), /Chờ/);
}
{ // Đổi kích thước/ẩn trang khi đang kéo: hủy, các sự kiện sau đó bị bỏ qua.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  g.move(touch(1, 160, 100, 200));
  g.abort('Đã hủy');
  g.up(touch(1, 200, 100, 260));
  assert.deepEqual(log.commits, []);
  assert.equal(log.status, 'Đã hủy');
  assert.deepEqual(log.touches.at(-1), []);
}
{ // Sự kiện nhấc tay bị mất: ngón chính mới bắt đầu lại từ đầu.
  const { gesture: g, log } = recorder();
  g.down(touch(1, 100, 100, 0, 19, true));
  g.down(touch(7, 100, 100, 1000, 19, true));
  g.move(touch(7, 160, 100, 1200));
  g.up(touch(7, 160, 100, 1250));
  assert.deepEqual(log.commits, ['U']);
}
{ // Chuột theo chế độ đang chọn: 1 lớp, 2 lớp, góc nhìn; kéo vùng nền vẫn đổi góc nhìn; mốc 2 lớp ở lớp giữa bị từ chối.
  const { gesture: g, log } = recorder();
  g.down(mouse(100, 100, 0, 19)); g.move(mouse(140, 100, 10)); g.up(mouse(140, 100, 20));
  g.down(mouse(100, 100, 100, 21, 'layer2')); g.move(mouse(100, 60, 110)); g.up(mouse(100, 60, 120));
  g.down(mouse(100, 100, 200, 19, 'view')); g.move(mouse(140, 100, 210)); g.up(mouse(140, 100, 220));
  assert.deepEqual(log.commits, ['U', "Lw'"]);
  assert.equal(log.orbit[0], 'start');
  log.orbit.length = 0;
  g.down(mouse(100, 100, 300, null)); g.move(mouse(140, 100, 310)); g.up(mouse(140, 100, 320));
  assert.equal(log.orbit[0], 'start', 'Chuột kéo vùng nền đổi góc nhìn');
  g.down(mouse(100, 100, 400, 99, 'layer2')); g.move(mouse(100, 160, 410)); g.up(mouse(100, 160, 420));
  assert.equal(log.hints.at(-1), 'mốc giữa');
  assert.deepEqual(log.commits, ['U', "Lw'"]);
}
console.log('✓ Cử chỉ: 1 ngón một lớp, 2 ngón hai lớp song song mỗi ngón một chiều, chỉ 3 ngón đổi góc nhìn, tô viên/lớp, ghép/thêm/nhấc ngón, 4 ngón, hủy, chuột');

// ---------- Hai ngón với hình học thật: nhìn trực diện mặt trước ----------
view.view = { rx: 0, ry: 0 };
for (const [label, fingers, vectors, entry] of [
  ['Cột trái xuống, cột phải lên (ngược chiều)', [[1, 100, 100, 21], [2, 200, 100, 23]], [[0, 60], [0, -60]], 'L R'],
  ['Cột trái lên, cột phải xuống', [[1, 100, 100, 21], [2, 200, 100, 23]], [[0, -60], [0, 60]], "L' R'"],
  ['Hàng trên và hàng dưới cùng sang trái', [[1, 100, 100, 19], [2, 100, 300, 25]], [[-60, 0], [-60, 0]], "U D'"],
  ['Hàng trên sang trái, hàng giữa sang phải', [[1, 100, 100, 19], [2, 100, 200, 22]], [[-60, 0], [60, 0]], 'U E'],
  ['Cột giữa và cột phải cùng lên', [[1, 100, 100, 19], [2, 200, 100, 23]], [[0, -60], [0, -60]], "M' R"],
]) {
  const { gesture: g, log } = recorder({ pick: (facelet, dx, dy, layers) => view.pickLayer(facelet, dx, dy, layers) });
  place(g, fingers);
  lift(g, drag(g, fingers, vectors));
  assert.deepEqual(log.commits, [entry], label);
  const played = new PlayState();
  played.move(entry);
  assert.deepEqual(played.colors, P.applyAll(SOLVED, entry), `${label}: khối đổi đúng`);
  played.undo();
  assert(played.solved, `${label}: hoàn tác một lần`);
}
console.log('✓ Hai ngón với hình học thật: L R, L\' R\', U D\', U E, M\' R');

// ---------- Mang khối đang chơi sang Hướng dẫn giải ----------
require('../js/vision.js');
require('../js/solver.js');
const { vision: V, solver: S } = globalThis.Rubik;
const centerNames = (colors) => C.FACES.map((_, f) => V.PALETTE[colors[f * 9 + 4]].name);
assert.deepEqual(centerNames(new PlayState().paletteColors()), ['Vàng', 'Cam', 'Xanh lá', 'Trắng', 'Đỏ', 'Xanh dương'],
  'Khối đã giải: vàng trên, cam phải, xanh lá trước, trắng dưới, đỏ trái, xanh dương sau');
for (const sequence of ["R U R' U' F2 D L' B2 U'", "M E S Rw U2 Fw' r M2 D", "Uw' S' R E2 Bw L M' F D2 Lw"]) {
  const played = new PlayState();
  P.parseSequence(sequence).forEach((move) => played.move(P.toString(move)));
  const colors = played.paletteColors();
  const checked = C.validateColors(colors);
  assert(checked.ok, `${sequence}: khối mang sang hợp lệ cho bộ giải (${checked.error || ''})`);
  const solution = S.solve(checked.facelets, { targetLength: 22, timeLimit: 400 });
  const done = C.applyMoves(colors, solution);
  assert(P.isSolved(done), `${sequence}: lời giải đưa đúng khối mang sang về đã giải`);
  assert.deepEqual(centerNames(done), centerNames(colors), `${sequence}: giữ nguyên hướng cầm của sân chơi`);
}
console.log('✓ Mang sang Hướng dẫn giải: đúng màu, giữ hướng cầm kể cả khi lớp giữa/hai lớp đã dời tâm, lời giải đưa về đã giải');
console.log('Rubik tự chơi: mô hình xoay, trạng thái, hướng vuốt và bộ nhận cử chỉ PASS');
