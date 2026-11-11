// Kiểm chứng tác dụng công thức và điều kiện khối mẫu trong lộ trình học.
'use strict';
const assert = require('node:assert/strict');
require('../js/cube.js');
require('../js/lessons.js');
const { cube: C, lessons: { levels, lessons, formulas, exampleStart } } = globalThis.Rubik;
const solved = C.toCubie(C.SOLVED);
const effect = (id) => C.toCubie(C.applyMoves(C.SOLVED, formulas[id].sequence));
const sample = (id) => C.toCubie(exampleStart(formulas[id]));
const fixed = (state, indices) => indices.every((i) => state[i] === C.SOLVED[i]);
const lowerTwoLayers = C.FACELETS.filter((facelet) => facelet.pos[1] < 1).map((facelet) => facelet.index);
const whiteCross = [4, 5, 6, 7].flatMap((i) => C.EDGE_FACELET[i]);

assert.equal(new Set(lessons.map((lesson) => lesson.id)).size, lessons.length);
for (const lesson of lessons) {
  assert(levels.some((level) => level.id === lesson.level), lesson.id);
  for (const id of lesson.formulas) assert(formulas[id], `${lesson.id}: thiếu ${id}`);
}
for (const [id, formula] of Object.entries(formulas)) {
  assert.deepEqual(C.parseMoves(formula.chunks.join(' ')), C.parseMoves(formula.sequence), `${id}: cụm nhớ sai thứ tự`);
  const start = exampleStart(formula);
  assert(C.validateColors(start).ok, `${id}: khối mẫu phải là trạng thái vật lý hợp lệ`);
  if (!formula.motion) assert.equal(C.applyMoves(start, formula.sequence).join(''), C.SOLVED, `${id}: mẫu phải giải xong`);
}

// Công thức tầng cuối phải giữ nguyên hai tầng đã giải, kể cả bài tập xoay đủ hai góc.
for (const id of ['yellowCross', 'yellowEdges', 'yellowCorners', 'finishCorners', 'sune', 'antiSune', 't', 'ua', 'ub']) {
  assert(fixed(C.applyMoves(C.SOLVED, formulas[id].sequence), lowerTwoLayers), `${id}: phá hai tầng dưới`);
}
for (const id of ['right', 'left', 'pair', 'middleRight', 'middleLeft']) {
  assert(fixed(C.applyMoves(C.SOLVED, formulas[id].sequence), whiteCross), `${id}: phá dấu cộng trắng`);
}
for (const id of ['middleRight', 'middleLeft']) {
  const cubie = effect(id);
  assert.deepEqual(cubie.cp.slice(4), solved.cp.slice(4), `${id}: phải giữ bốn góc trắng`);
  assert.deepEqual(cubie.co.slice(4), [0, 0, 0, 0]);
}

// Kiểm tra mẫu đúng mô tả nhận dạng, không chỉ là một chuỗi xoay hợp lệ.
const rightSample = sample('middleRight');
assert.equal(rightSample.ep[1], 8, 'Cạnh FR phải ở vị trí UF trước khi chèn sang phải');
const leftSample = sample('middleLeft');
assert.equal(leftSample.ep[1], 9, 'Cạnh FL phải ở vị trí UF trước khi chèn sang trái');
assert.equal(sample('pair').cp.indexOf(4) < 4, true, 'Góc trắng của cặp mẫu phải ở tầng trên');
assert.equal(sample('pair').ep.indexOf(8) < 4, true, 'Cạnh của cặp mẫu phải ở tầng trên');
const line = exampleStart(formulas.yellowCross);
assert.equal(line[3], 'U'); assert.equal(line[5], 'U');
assert.notEqual(line[1], 'U'); assert.notEqual(line[7], 'U');
const sune = exampleStart(formulas.sune);
assert.deepEqual([0, 2, 6, 8].filter((i) => sune[i] === 'U'), [6], 'Sune: góc vàng trên ở trước–trái');
assert.equal(sune[20], 'U', 'Sune: ô vàng của góc trước–phải hướng ra trước');
const anti = exampleStart(formulas.antiSune);
assert.deepEqual([0, 2, 6, 8].filter((i) => anti[i] === 'U'), [2], 'Anti-Sune: góc vàng trên ở sau–phải');
assert.equal(anti[9], 'U', 'Anti-Sune: ô vàng của góc trước–phải hướng sang phải');

assert.deepEqual(effect('yellowEdges').ep, [0, 2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'Đổi cạnh trước/trái');
assert.equal(effect('yellowCorners').cp[0], 0, 'Giữ nguyên góc trước–phải');
assert.deepEqual(effect('yellowCorners').ep, solved.ep, 'Không đổi cạnh khi xếp góc');
assert.deepEqual(effect('finishCorners').cp, solved.cp, 'Xoay hướng, không đổi vị trí góc');
assert.deepEqual(effect('finishCorners').ep, solved.ep, 'Bài xoay góc phải phục hồi các cạnh');
assert.deepEqual(effect('t').cp, [3, 1, 2, 0, 4, 5, 6, 7], 'T-perm đổi hai góc bên phải');
assert.deepEqual(effect('t').ep, [2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'T-perm đổi cạnh trái/phải');
for (const id of ['t', 'ua', 'ub']) {
  assert.deepEqual(effect(id).co, solved.co, `${id}: giữ hướng góc`);
  assert.deepEqual(effect(id).eo, solved.eo, `${id}: giữ hướng cạnh`);
}
assert.equal(C.applyMoves(C.SOLVED, `${formulas.ua.sequence} ${formulas.ub.sequence}`).join(''), C.SOLVED, 'Ua và Ub phải ngược nhau');
assert.equal(C.applyMoves(C.SOLVED, Array(6).fill(formulas.right.sequence).join(' ')).join(''), C.SOLVED, 'Chuỗi tay phải 6 lần về ban đầu');
console.log(`Lộ trình: ${lessons.length} bài, ${levels.length} mức, ${Object.keys(formulas).length} công thức/mẫu. Tất cả test PASS`);
