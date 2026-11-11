'use strict';
const assert = require('node:assert/strict');
require('../js/cube.js');
require('../js/play-state.js');
require('../js/cube3d.js');
const { cube: C, PlayState, Cube3D } = globalThis.Rubik;

for (const face of C.FACES) for (const suffix of ['', "'", '2']) {
  const state = new PlayState();
  state.move(face + suffix);
  const moved = state.colors.slice();
  assert(C.validateColors(moved).ok);
  assert(!state.solved);
  state.undo();
  assert(state.solved, `Hoàn tác ${face + suffix}`);
  state.redo();
  assert.deepEqual(state.colors, moved, `Làm lại ${face + suffix}`);
}
const state = new PlayState();
const tokens = C.randomScramble(40).map(C.moveToString);
tokens.forEach((token) => state.move(token));
const scrambled = state.colors.slice();
for (let i = 0; i < tokens.length; i++) state.undo();
assert(state.solved);
for (let i = 0; i < tokens.length; i++) state.redo();
assert.deepEqual(state.colors, scrambled);
state.undo();
const restored = new PlayState(JSON.parse(JSON.stringify(state.snapshot())));
assert.deepEqual(restored.snapshot(), state.snapshot(), 'Tải lại giữ khối và cả hai ngăn lịch sử');
restored.redo();
assert.deepEqual(restored.colors, scrambled);
state.move('U');
assert.equal(state.future.length, 0, 'Nước mới sau hoàn tác phải bỏ nhánh làm lại');
assert.throws(() => state.move('R X'), 'Không chấp nhận công thức như một nước đơn');
const before = state.snapshot();
assert.throws(() => state.move('bad'));
assert.deepEqual(state.snapshot(), before, 'Nước không hợp lệ không được sửa trạng thái');
const copy = state.snapshot();
copy.colors[0] = '?'; copy.past.length = 0;
assert.deepEqual(state.snapshot(), before, 'Ảnh chụp trạng thái phải độc lập');
for (const bad of [null, 3, {}, { ...before, colors: [] }, { ...before, past: ['X'] },
  { ...before, colors: C.applyMove(C.SOLVED, 'R').map(() => 'U') }, { ...before, future: Array(201).fill('R') }]) {
  assert(new PlayState(bad).solved, 'Dữ liệu lưu hỏng phải quay về khối hợp lệ');
}
const bounded = new PlayState();
for (let i = 0; i < 250; i++) bounded.move(i % 2 ? 'U' : 'R');
assert.equal(bounded.past.length, 200);
const boundedRestored = new PlayState(bounded.snapshot());
assert.deepEqual(boundedRestored.colors, bounded.colors, 'Cắt lịch sử không được đổi khối');
for (let i = 0; i < 200; i++) boundedRestored.undo();
assert.deepEqual(boundedRestored.colors, C.applyMoves(C.SOLVED, Array.from({ length: 50 }, (_, i) => i % 2 ? 'U' : 'R')));
bounded.reset();
bounded.undo(); bounded.redo();
assert(bounded.solved);
assert.deepEqual(bounded.past, []);

// Các thao tác từ hướng nhìn trực diện mặt trước: đúng lớp và đúng chiều theo mô hình.
const view = Object.create(Cube3D.prototype);
view.size = 48;
view.view = { rx: 0, ry: 0 };
assert.deepEqual(view.moveForDrag(19, -50, 0), { face: 'U', power: 1 });
assert.deepEqual(view.moveForDrag(19, 50, 0), { face: 'U', power: 3 });
assert.deepEqual(view.moveForDrag(25, 50, 0), { face: 'D', power: 1 });
assert.deepEqual(view.moveForDrag(21, 0, 50), { face: 'L', power: 1 });
assert.deepEqual(view.moveForDrag(23, 0, -50), { face: 'R', power: 1 });
assert.equal(view.moveForDrag(22, 50, 0), null, 'Ô tâm dùng đổi góc nhìn');
assert.equal(view.moveForDrag(19, 2, 0), null, 'Chạm nhẹ không được xoay lớp');
assert.equal(view.moveForDrag(19, 0, 50), null, 'Không đoán một lớp giữa chưa được hỗ trợ');
view.view = { rx: 0, ry: 180 };
assert.deepEqual(view.moveForDrag(46, -50, 0), { face: 'U', power: 1 }, 'Giữ chiều đúng khi nhìn từ phía sau');
console.log('Rubik tự chơi: 18 nước xoay, hoàn tác/làm lại, lưu trạng thái, lịch sử và hướng vuốt PASS');
