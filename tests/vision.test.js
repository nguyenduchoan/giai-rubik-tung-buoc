// Chạy: node tests/vision.test.js
'use strict';
const assert = require('assert');
require('../js/cube.js');
require('../js/vision.js');

const { cube: C, vision: V } = globalThis.Rubik;

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Màu "thật" chụp dưới đèn hơi vàng, có nhiễu và độ sáng thay đổi.
const CAMERA_RGB = {
  0: [205, 210, 200], // trắng
  1: [200, 200, 40], // vàng
  2: [170, 25, 35], // đỏ
  3: [230, 95, 25], // cam
  4: [25, 70, 160], // xanh dương
  5: [30, 150, 80], // xanh lá
};
const STANDARD = { U: 0, R: 2, F: 5, D: 1, L: 3, B: 4 };
const SOLVED_COLORS = C.FACES.flatMap((f) => new Array(9).fill(STANDARD[f]));

const rng = seeded(1);
function shoot(truth) {
  const warm = [1 + rng() * 0.15, 1, 1 - rng() * 0.2];
  return truth.map((id) => {
    const bright = 0.75 + rng() * 0.35;
    return CAMERA_RGB[id].map((v, ch) =>
      Math.max(0, Math.min(255, Math.round(v * bright * warm[ch] + (rng() - 0.5) * 30))));
  });
}

let perfect = 0;
let falseDup = 0;
const trials = 200;
for (let t = 0; t < trials; t++) {
  const truth = C.applyMoves(SOLVED_COLORS, C.randomScramble(25, rng));
  const rgbs = shoot(truth);
  const got = V.classifyAll(rgbs);
  if (got.every((c, i) => c === truth[i])) perfect++;
  if (V.duplicateCenters(rgbs)) falseDup++;
}
console.log(`Nhận diện đúng hoàn toàn: ${perfect}/${trials}; báo nhầm chụp trùng: ${falseDup}/${trials}`);
assert.ok(perfect / trials >= 0.95, 'Tỷ lệ nhận diện quá thấp');
assert.strictEqual(falseDup, 0, 'Báo nhầm chụp trùng mặt khi 6 mặt khác nhau');

// Chụp trùng một mặt (ảnh q là chụp lại mặt p, có thể lệch chiều): phải phát hiện từ màu ảnh gốc,
// dù classifyAll vẫn ép ra 6 tâm khác màu. Gồm cả ca khối đã giải: trắng-vàng-đỏ-cam-xanh dương-trắng.
{
  let found = 0;
  const T = 60;
  for (let t = 0; t < T; t++) {
    const truth = t === 0 ? SOLVED_COLORS.slice() : C.applyMoves(SOLVED_COLORS, C.randomScramble(25, rng));
    const p = t === 0 ? 0 : Math.floor(rng() * 6);
    let q = t === 0 ? 5 : Math.floor(rng() * 5);
    if (t !== 0 && q >= p) q++;
    const shot = truth.slice();
    C.rotateFaceArray(truth.slice(p * 9, p * 9 + 9), Math.floor(rng() * 4)).forEach((c, k) => { shot[q * 9 + k] = c; });
    const rgbs = shoot(shot);
    const centers = new Set([4, 13, 22, 31, 40, 49].map((i) => V.classifyAll(rgbs)[i]));
    assert.strictEqual(centers.size, 6, 'classifyAll luôn ép 6 tâm khác màu (lý do phải kiểm tra trước)');
    const dup = V.duplicateCenters(rgbs);
    if (dup && dup.join() === [Math.min(p, q), Math.max(p, q)].join()) found++;
  }
  console.log(`Phát hiện chụp trùng mặt: ${found}/${T}`);
  assert.strictEqual(found, T);
}

// Phân loại heuristic cho màu chuẩn.
V.PALETTE.forEach((p) => assert.strictEqual(V.classifyHeuristic(p.ref), p.id, p.name));

// Chống nhầm Đỏ↔Cam và Vàng↔Xanh lá/Xanh dương dưới ánh sáng vàng ấm hoặc đèn LED/ánh sáng lạnh:
{
  // Đỏ dưới đèn vàng (h ~ 11–14°, g/r thấp) vẫn phải là Đỏ (2); Cam ấm (h ~ 38–42°) vẫn là Cam (3).
  assert.strictEqual(V.classifyHeuristic([200, 58, 25]), 2, 'Đỏ dưới đèn ấm không được nhầm thành Cam');
  assert.strictEqual(V.classifyHeuristic([245, 165, 25]), 3, 'Cam ấm không được nhầm thành Vàng');
  // Vàng ánh xanh chanh trên speedcube/camera (h ~ 75–83°) vẫn phải là Vàng (1), không nhầm thành Xanh lá (5).
  assert.strictEqual(V.classifyHeuristic([175, 220, 45]), 1, 'Vàng chanh không được nhầm thành Xanh lá');
  // Xanh lá hơi ngả lam dưới đèn lạnh (h ~ 172°) vẫn phải là Xanh lá (5), không nhầm thành Xanh dương (4).
  assert.strictEqual(V.classifyHeuristic([20, 175, 155]), 5, 'Xanh lá ánh lạnh không được nhầm thành Xanh dương');

  // Khi trên cùng 1 mặt có cả Đỏ và Cam bị lệch sáng mạnh, classifyGrid phải tách đúng Đỏ (2) và Cam (3).
  const mixedFace = [
    [205, 72, 22], [245, 140, 25], [235, 235, 235],
    [202, 70, 24], [242, 138, 28], [20, 80, 190],
    [175, 220, 45], [30, 160, 80], [235, 235, 235],
  ];
  const gridClassified = V.classifyGrid(mixedFace);
  assert.strictEqual(gridClassified[0], 2, 'classifyGrid: ô Đỏ trên mặt trộn');
  assert.strictEqual(gridClassified[1], 3, 'classifyGrid: ô Cam trên mặt trộn');
  assert.strictEqual(gridClassified[6], 1, 'classifyGrid: ô Vàng trên mặt trộn');
  assert.strictEqual(gridClassified[7], 5, 'classifyGrid: ô Xanh lá trên mặt trộn');

  // classifyAll không bao giờ được đảo cụm Đỏ↔Cam hay Vàng↔Xanh lá khi ánh sáng lệch màu.
  const shiftedCube = [
    ...new Array(9).fill([230, 230, 220]), // Trắng (0)
    ...new Array(9).fill([200, 58, 25]),   // Đỏ (2)
    ...new Array(9).fill([20, 175, 155]),  // Xanh lá (5)
    ...new Array(9).fill([175, 220, 45]),  // Vàng (1)
    ...new Array(9).fill([245, 165, 25]),  // Cam (3)
    ...new Array(9).fill([25, 75, 185]),   // Xanh dương (4)
  ];
  const allRes = V.classifyAll(shiftedCube);
  const centerColors = [4, 13, 22, 31, 40, 49].map((i) => allRes[i]);
  assert.deepStrictEqual(centerColors, [0, 2, 5, 1, 3, 4], 'classifyAll phải giữ đúng thứ tự 6 màu');
}
console.log('Tất cả test PASS');
