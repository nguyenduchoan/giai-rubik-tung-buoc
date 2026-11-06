// Chạy: node tests/solver.test.js
'use strict';
const assert = require('assert');
require('../js/cube.js');
require('../js/solver.js');

const { cube: C, solver: S } = globalThis.Rubik;

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// 1. Mỗi bước xoay lặp 4 lần trở về trạng thái ban đầu; X X' = identity.
for (const f of C.FACES) {
  assert.strictEqual(C.applyMoves(C.SOLVED, `${f} ${f} ${f} ${f}`).join(''), C.SOLVED);
  assert.strictEqual(C.applyMoves(C.SOLVED, `${f} ${f}'`).join(''), C.SOLVED);
  assert.strictEqual(C.applyMoves(C.SOLVED, `${f}2 ${f}2`).join(''), C.SOLVED);
}

// 2. Chu kỳ (R U R' U') lặp 6 lần = identity (kiểm tra chiều xoay và sự nhất quán).
assert.strictEqual(C.applyMoves(C.SOLVED, "R U R' U' ".repeat(6)).join(''), C.SOLVED);

// 3. Kiểm tra chiều kim đồng hồ: U đưa sticker mặt F sang mặt L.
{
  const s = C.applyMove(C.SOLVED, 'U');
  assert.deepStrictEqual(s.slice(36, 39), ['F', 'F', 'F'], 'U: hàng trên của L phải nhận màu F');
  const r = C.applyMove(C.SOLVED, 'R');
  assert.deepStrictEqual([r[2], r[5], r[8]], ['F', 'F', 'F'], 'R: cột phải của U phải nhận màu F');
}

// 4. Phép nhân cubie khớp với mô hình sticker.
{
  const { multiply, MOVE_CUBE, SOLVED_CUBIE } = S._internal;
  const rng = seeded(7);
  for (let k = 0; k < 50; k++) {
    const moves = C.randomScramble(20, rng);
    let c = SOLVED_CUBIE;
    for (const m of moves) c = multiply(c, MOVE_CUBE[C.FACES.indexOf(m.face) * 3 + m.power - 1]);
    const fromFacelets = C.toCubie(C.applyMoves(C.SOLVED, moves).join(''));
    assert.deepStrictEqual(c, fromFacelets);
  }
}

// 5. Kiểm tra hợp lệ phát hiện lỗi.
{
  const colors = Array.from(C.applyMoves(C.SOLVED, "R U F' D2 L B'"));
  assert.ok(C.validateColors(colors).ok);
  const twisted = colors.slice();
  // Vặn một góc (URF): hoán vị vòng 3 sticker.
  const [a, b, c] = C.CORNER_FACELET[0];
  [twisted[a], twisted[b], twisted[c]] = [colors[b], colors[c], colors[a]];
  assert.ok(!C.validateColors(twisted).ok);
  const flipped = colors.slice();
  const [e1, e2] = C.EDGE_FACELET[0];
  [flipped[e1], flipped[e2]] = [colors[e2], colors[e1]];
  assert.ok(!C.validateColors(flipped).ok);
  const wrongCount = colors.slice();
  wrongCount[0] = wrongCount[0] === 'U' ? 'R' : 'U';
  assert.ok(!C.validateColors(wrongCount).ok);
  // Đổi U9 <-> D3 trên khối đã giải: góc (D,R,F) và (U,F,R) không tồn tại, không được coi là URF/DFR.
  const swapped = Array.from(C.SOLVED);
  [swapped[8], swapped[29]] = [swapped[29], swapped[8]];
  assert.ok(!C.validateColors(swapped).ok, 'U9<->D3 phải bị báo không hợp lệ');
}

// 5b. Đổi chỗ hai ô bất kỳ khác màu (không phải tâm) trên khối hợp lệ luôn ra khối không hợp lệ.
{
  const rng = seeded(3);
  let pairs = 0;
  for (let k = 0; k < 10; k++) {
    const colors = Array.from(C.applyMoves(C.SOLVED, C.randomScramble(25, rng)));
    for (let a = 0; a < 54; a++) {
      for (let b = a + 1; b < 54; b++) {
        if (a % 9 === 4 || b % 9 === 4 || colors[a] === colors[b]) continue;
        const s = colors.slice();
        [s[a], s[b]] = [s[b], s[a]];
        assert.ok(!C.validateColors(s).ok, `Đổi ô ${a} <-> ${b} vẫn báo hợp lệ`);
        pairs++;
      }
    }
  }
  console.log(`Đổi 2 ô khác màu: ${pairs}/${pairs} trường hợp bị báo không hợp lệ`);
}

// 6. Giải các trạng thái ngẫu nhiên.
let t0 = Date.now();
S.init();
console.log(`Khởi tạo bảng: ${Date.now() - t0} ms`);

assert.deepStrictEqual(S.solve(C.SOLVED), []);

const rng = seeded(42);
const lengths = [];
let maxTime = 0;
for (let k = 0; k < 40; k++) {
  const scramble = C.randomScramble(30, rng);
  const state = C.applyMoves(C.SOLVED, scramble).join('');
  t0 = Date.now();
  const sol = S.solve(state, { timeLimit: 1000 });
  maxTime = Math.max(maxTime, Date.now() - t0);
  assert.strictEqual(C.applyMoves(state, sol).join(''), C.SOLVED, 'Lời giải không đưa khối về trạng thái đã giải');
  lengths.push(sol.length);
}
console.log(`40 lần giải OK. Số bước: min ${Math.min(...lengths)}, max ${Math.max(...lengths)}, ` +
  `TB ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)}; thời gian tối đa ${maxTime} ms`);
console.log('Tất cả test PASS');
