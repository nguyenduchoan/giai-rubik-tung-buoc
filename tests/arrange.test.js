// Chạy: node tests/arrange.test.js
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

const ST = { U: 0, R: 2, F: 5, D: 1, L: 3, B: 4 };
const SOLVED_COLORS = C.FACES.flatMap((f) => new Array(9).fill(ST[f]));

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Xoay mặt: 4 lần = giữ nguyên.
{
  const f = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepStrictEqual(C.rotateFaceArray(f, 4), f);
  assert.deepStrictEqual(C.rotateFaceArray(f, 1), [6, 3, 0, 7, 4, 1, 8, 5, 2]);
}

// Đã đúng sẵn -> cost 0, giữ nguyên.
{
  const colors = C.applyMoves(SOLVED_COLORS, "R U F' L2 D B");
  const res = C.autoArrange(colors);
  assert.ok(res.ok);
  assert.strictEqual(res.cost, 0);
  assert.deepStrictEqual(res.colors, colors);
}

// Hai mặt cùng màu tâm -> báo chụp trùng.
{
  const colors = C.applyMoves(SOLVED_COLORS, "R U F'");
  const dup = colors.slice();
  for (let i = 0; i < 9; i++) dup[9 + i] = colors[18 + i]; // R chép từ F
  const res = C.autoArrange(dup);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'duplicate-center');
}

// Đổi chỗ / xoay ngẫu nhiên các mặt rồi tự sửa.
const rng = seeded(11);
let maxMs = 0;
let totalMs = 0;
const N = 150;
for (let t = 0; t < N; t++) {
  const truth = C.applyMoves(SOLVED_COLORS, C.randomScramble(25, rng));
  // Nhầm ngẫu nhiên: đôi khi đổi chỗ toàn bộ, đôi khi chỉ vài mặt bị xoay.
  const perm = rng() < 0.5 ? shuffle([0, 1, 2, 3, 4, 5], rng) : [0, 1, 2, 3, 4, 5];
  const arrangement = perm.map((src) => ({ src, rot: rng() < 0.5 ? Math.floor(rng() * 4) : 0 }));
  const messed = C.applyArrangement(truth, arrangement);
  // Chi phí để đưa về đúng như cũ: vị trí q của ảnh nhầm phải lấy ảnh ở vị trí perm.indexOf(q), xoay ngược lại.
  const mistakes = [0, 1, 2, 3, 4, 5].reduce((sum, q) => {
    const src = perm.indexOf(q);
    return sum + C.arrangeCost(q, src, (4 - arrangement[src].rot) % 4);
  }, 0);

  const t0 = Date.now();
  const res = C.autoArrange(messed);
  const ms = Date.now() - t0;
  maxMs = Math.max(maxMs, ms);
  totalMs += ms;

  assert.ok(res.ok, `Lần ${t}: không tự sửa được (${res.reason})`);
  assert.ok(C.validateColors(res.colors).ok);
  assert.ok(res.cost <= mistakes, `Lần ${t}: cost ${res.cost} > số lỗi ${mistakes}`);
  // Bố trí tìm được phải là cùng một khối (giải được bằng lời giải hợp lệ).
  const sol = S.solve(res.facelets, { timeLimit: 200 });
  assert.strictEqual(C.applyMoves(res.facelets, sol).join(''), C.SOLVED);
  if (mistakes === 0) assert.strictEqual(res.cost, 0);
  // Khi mặt TRÊN và TRƯỚC chụp đúng chỗ thì kết quả phải trùng đúng khối gốc (giữ cách cầm).
  if (perm[0] === 0 && perm[2] === 2) assert.deepStrictEqual(res.colors, truth, `Lần ${t}: sai hướng cầm`);
}
console.log(`Tự sắp xếp/xoay: ${N}/${N} OK; TB ${(totalMs / N).toFixed(1)} ms, tối đa ${maxMs} ms`);

// Xoay cả khối: 4 lần = giữ nguyên, giữ tính hợp lệ, và tìm được hướng cầm mong muốn.
{
  const colors = C.applyMoves(SOLVED_COLORS, "R U F' L2 D B R2");
  for (const f of C.FACES) {
    assert.deepStrictEqual(C.applyCubeRotations(colors, [f, f, f, f]), colors);
    assert.ok(C.validateColors(C.rotateWholeCube(colors, f)).ok);
  }
  // Xóa hướng: xoay ngẫu nhiên rồi tìm lại hướng "trắng trên, xanh lá trước".
  const r2 = seeded(5);
  for (let t = 0; t < 30; t++) {
    const rots = Array.from({ length: 6 }, () => C.FACES[Math.floor(r2() * 6)]);
    const turned = C.applyCubeRotations(colors, rots);
    const back = C.applyCubeRotations(turned, C.findOrientation(turned, (c) => c[0] === 0 && c[2] === 5));
    assert.deepStrictEqual(back, colors);
    // Lời giải của khối đã xoay hướng vẫn đúng.
    const v = C.validateColors(turned);
    const sol = S.solve(v.facelets, { timeLimit: 100 });
    assert.strictEqual(C.applyMoves(v.facelets, sol).join(''), C.SOLVED);
  }
}

// Chụp 6 mặt theo thứ tự và chiều hoàn toàn ngẫu nhiên vẫn ghép được đúng khối.
{
  const r3 = seeded(99);
  for (let t = 0; t < 100; t++) {
    const truth = C.applyMoves(SOLVED_COLORS, C.randomScramble(25, r3));
    const perm = shuffle([0, 1, 2, 3, 4, 5], r3);
    const messed = C.applyArrangement(truth, perm.map((src) => ({ src, rot: Math.floor(r3() * 4) })));
    const res = C.autoArrange(messed);
    assert.ok(res.ok, `Ngẫu nhiên ${t}: không ghép được`);
    // Đưa về cùng hướng cầm chuẩn thì phải trùng khối gốc.
    const canon = C.applyCubeRotations(res.colors, C.findOrientation(res.colors, (c) => c[0] === 0 && c[2] === 5));
    assert.deepStrictEqual(canon, truth, `Ngẫu nhiên ${t}: ghép sai khối`);
  }
  console.log('Chụp 6 mặt thứ tự/chiều ngẫu nhiên: 100/100 ghép đúng khối');
}

// Ca thật từ người dùng (06/11): mặt TRÊN/DƯỚI bị chụp lệch 90° (lật khối từ mặt TRÁI thay vì từ mặt TRƯỚC).
{
  const N = { W: 0, Y: 1, R: 2, O: 3, B: 4, G: 5 };
  const face = (s) => s.replace(/\s+/g, '').split('').map((c) => N[c]);
  const colors = [
    ...face('OYG BBW OGW'), ...face('RRY GYB OOB'), ...face('BBY WRY WOB'),
    ...face('RRG BGG RYY'), ...face('BWR OWR WGO'), ...face('GRW YOW YOG'),
  ];
  assert.strictEqual(C.validateColors(colors).ok, false);
  const res = C.autoArrange(colors);
  assert.ok(res.ok);
  assert.deepStrictEqual(res.arrangement.map((a) => a.rot), [1, 0, 0, 3, 0, 0]);
  assert.ok(res.arrangement.every((a, p) => a.src === p));
  const sol = S.solve(res.facelets);
  assert.strictEqual(C.applyMoves(res.facelets, sol).join(''), C.SOLVED);
  assert.ok(sol.length <= 10, 'Khối thật chỉ bị tráo ít bước');
  console.log(`Ca thật (U/D lệch 90°): sửa được, lời giải ${sol.length} bước`);
}

// Hai ô bị nhận nhầm màu cho nhau (đỏ↔cam dưới ánh sáng xấu) + ảnh chụp lệch chiều:
// ô nghi ngờ phải đứng đầu danh sách và findSwapFix phải tìm ra cách sửa.
{
  require('../js/vision.js');
  const V = globalThis.Rubik.vision;
  const CAM = { 0: [215, 212, 195], 1: [210, 200, 45], 2: [175, 30, 40], 3: [235, 105, 35], 4: [30, 75, 165], 5: [35, 155, 85] };
  const r4 = seeded(2024);
  let found = 0, flagged = 0;
  const T = 30;
  for (let t = 0; t < T; t++) {
    const truth = C.applyMoves(SOLVED_COLORS, C.randomScramble(25, r4));
    const arrangement = shuffle([0, 1, 2, 3, 4, 5], r4).map((src) => ({ src, rot: Math.floor(r4() * 4) }));
    const seen = C.applyArrangement(truth, arrangement);
    const rgbs = seen.map((id) => CAM[id].map((v) => Math.max(0, Math.min(255, v + (r4() - 0.5) * 20))));
    // Chọn 1 ô đỏ và 1 ô cam (không phải tâm), cho màu chụp được lập lờng và nhận nhầm cho nhau.
    const pick = (c) => seen.findIndex((x, i) => x === c && i % 9 !== 4 && r4() < 0.4);
    let a = pick(2), b = pick(3);
    if (a < 0 || b < 0) { t--; continue; }
    rgbs[a] = [215, 70, 38];
    rgbs[b] = [200, 62, 37];
    const colors = seen.slice();
    [colors[a], colors[b]] = [colors[b], colors[a]];
    if (C.autoArrange(colors).ok) continue; // hiếm: đổi màu vẫn ra khối hợp lệ
    const suspects = V.suspectCells(rgbs, colors);
    const top = suspects.slice(0, 6).map((s) => s.index);
    if (top.includes(a) && top.includes(b)) flagged++;
    const fix = C.findSwapFix(colors, suspects);
    if (fix && C.applyCubeRotations(fix.result.colors,
      C.findOrientation(fix.result.colors, (c) => c[0] === 0 && c[2] === 5)).join() === truth.join()) found++;
  }
  console.log(`Ô nhận nhầm màu: đánh dấu đúng ${flagged}/${T}, tự tìm được cách sửa ${found}/${T}`);
  assert.ok(flagged >= T * 0.9 && found >= T * 0.9);
}

// Không có cách sửa bằng 1 cặp (3 ô bị đổi vòng): findSwapFix chạy trên luồng giao diện nên phải dừng
// trong giới hạn thời gian thay vì thử hết 30 cặp (~2 giây trên máy tính, lâu hơn nhiều trên điện thoại).
{
  require('../js/vision.js');
  const V = globalThis.Rubik.vision;
  const CAM = { 0: [215, 212, 195], 1: [210, 200, 45], 2: [175, 30, 40], 3: [235, 105, 35], 4: [30, 75, 165], 5: [35, 155, 85] };
  const r5 = seeded(9);
  let worst = 0;
  for (let t = 0; t < 5; t++) {
    const truth = C.applyMoves(SOLVED_COLORS, C.randomScramble(25, r5));
    const rgbs = truth.map((id) => CAM[id].map((v) => v + (r5() - 0.5) * 20));
    const c = truth.slice();
    const idx = [];
    while (idx.length < 3) {
      const i = Math.floor(r5() * 54);
      if (i % 9 !== 4 && !idx.includes(i) && !idx.some((j) => c[j] === c[i])) idx.push(i);
    }
    [c[idx[0]], c[idx[1]], c[idx[2]]] = [c[idx[1]], c[idx[2]], c[idx[0]]];
    const t0 = Date.now();
    C.findSwapFix(c, V.suspectCells(rgbs, c), { timeBudget: 300 });
    worst = Math.max(worst, Date.now() - t0);
  }
  console.log(`Gợi ý sửa khi không có cách sửa: tối đa ${worst} ms (giới hạn 300 ms + 1 lần thử)`);
  assert.ok(worst < 300 + 400, 'findSwapFix vượt giới hạn thời gian');
}

// Có sticker bị nhận sai màu (không thể sửa bằng xoay/đổi chỗ) -> trả về not-found nhanh.
{
  const colors = C.applyMoves(SOLVED_COLORS, "R U F' L2 D B R2");
  const bad = colors.slice();
  const k = bad.findIndex((c, i) => i % 9 !== 4 && c !== bad[i + 1] && i + 1 < 54 && (i + 1) % 9 !== 4);
  [bad[k], bad[k + 1]] = [bad[k + 1], bad[k]];
  if (!C.validateColors(bad).ok) {
    const t0 = Date.now();
    const res = C.autoArrange(bad);
    console.log(`Dữ liệu sai màu: ok=${res.ok} (${res.reason || 'đã sửa'}), ${Date.now() - t0} ms`);
  }
}
console.log('Tất cả test PASS');
