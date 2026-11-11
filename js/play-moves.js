/*
 * Nước xoay của Chơi tự do: lớp ngoài U D L R F B, lớp giữa M E S và hai lớp Uw Dw Lw Rw Fw Bw.
 * Mỗi kiểu xoay có một mô tả chung { axis, layers, dir } dùng cho tính màu, tô sáng và hoạt ảnh:
 *   axis: 0 = x (R), 1 = y (U), 2 = z (F); layers: toạ độ các lớp trên trục đó (-1, 0, 1);
 *   dir: +1 xoay như mặt R/U/F, -1 xoay như mặt L/D/B (chiều kim đồng hồ khi nhìn từ mặt đó).
 * Quy ước lớp giữa: M theo L, E theo D, S theo F. Không xử lý xoay cả khối x/y/z.
 */
(function (root) {
  'use strict';

  const C = root.Rubik.cube;
  const BASES = {
    U: { axis: 1, layers: [1], dir: 1 },
    D: { axis: 1, layers: [-1], dir: -1 },
    R: { axis: 0, layers: [1], dir: 1 },
    L: { axis: 0, layers: [-1], dir: -1 },
    F: { axis: 2, layers: [1], dir: 1 },
    B: { axis: 2, layers: [-1], dir: -1 },
    M: { axis: 0, layers: [0], dir: -1 },
    E: { axis: 1, layers: [0], dir: -1 },
    S: { axis: 2, layers: [0], dir: 1 },
  };
  for (const face of C.FACES) {
    BASES[face + 'w'] = { ...BASES[face], layers: [BASES[face].layers[0], 0] };
  }
  const NAMES = {
    U: 'Trên', D: 'Dưới', R: 'Phải', L: 'Trái', F: 'Trước', B: 'Sau',
    M: 'Giữa L–R', E: 'Giữa U–D', S: 'Giữa F–B',
  };
  for (const face of C.FACES) NAMES[face + 'w'] = `${NAMES[face]} + giữa`;
  const SLICES = ['M', 'E', 'S'];

  const index = new Map(C.FACELETS.map((f) => [f.pos.join(',') + '|' + f.normal.join(','), f.index]));
  const unit = (axis, sign) => [0, 1, 2].map((i) => (i === axis ? sign : 0));
  // Quay 90° theo chiều kim đồng hồ khi nhìn từ phía vectơ a (cùng công thức với cube.js).
  const rotate = (v, a) => {
    const c = [a[1] * v[2] - a[2] * v[1], a[2] * v[0] - a[0] * v[2], a[0] * v[1] - a[1] * v[0]];
    const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    return [0, 1, 2].map((i) => a[i] * d - c[i] + 0);
  };

  // PERM[base][dest] = src: sau một lần xoay 90°, ô dest nhận màu của ô src.
  const PERM = {};
  for (const [base, spec] of Object.entries(BASES)) {
    const a = unit(spec.axis, spec.dir);
    const perm = Array.from({ length: 54 }, (_, i) => i);
    for (const f of C.FACELETS) {
      if (!spec.layers.includes(f.pos[spec.axis])) continue;
      perm[index.get(rotate(f.pos, a).join(',') + '|' + rotate(f.normal, a).join(','))] = f.index;
    }
    PERM[base] = perm;
  }

  const TOKEN = /^(?:([URFDLB])w|([URFDLBMES])|([urfdlb]))(2'|2|')?$/;
  function parse(token) {
    if (token && typeof token === 'object' && BASES[token.base] && [1, 2, 3].includes(token.power)) return token;
    const m = TOKEN.exec(String(token).trim());
    if (!m) throw new Error('Ký hiệu xoay không hợp lệ: ' + token);
    const base = m[1] ? m[1] + 'w' : m[2] || m[3].toUpperCase() + 'w';
    return { base, power: m[4] === "'" ? 3 : m[4] ? 2 : 1 };
  }

  // Đọc cả công thức; một ký hiệu sai làm hỏng toàn bộ (không chạy dở).
  function parseSequence(text) {
    return String(text).replace(/[’′‘`´]/g, "'").trim().split(/\s+/).filter(Boolean).map(parse);
  }

  const toString = (move) => {
    const m = parse(move);
    return m.base + (m.power === 1 ? '' : m.power === 2 ? '2' : "'");
  };
  const normalize = (token) => toString(parse(token));
  const inverse = (move) => {
    const m = parse(move);
    return { base: m.base, power: (4 - m.power) % 4 || 4 };
  };

  function apply(state, move) {
    const m = parse(move);
    const perm = PERM[m.base];
    let cur = Array.from(state);
    for (let k = 0; k < m.power; k++) cur = perm.map((src) => cur[src]);
    return cur;
  }
  const applyAll = (state, moves) => (typeof moves === 'string' ? parseSequence(moves) : moves)
    .reduce((s, m) => apply(s, m), Array.from(state));

  // Mô tả cho hoạt ảnh/tô sáng.
  const describe = (move) => {
    const m = parse(move);
    return { ...BASES[m.base], layers: BASES[m.base].layers.slice(), power: m.power };
  };

  /*
   * Ký hiệu cho một lớp trên trục axis tại toạ độ layer, xoay dương (sign > 0) nghĩa là theo chiều kim đồng hồ khi
   * nhìn từ mặt R/U/F của trục. wide = true: lớp ngoài cùng lớp giữa kề nó. Trả về null nếu không có ký hiệu
   * (ví dụ hai lớp mà mốc nằm ở lớp giữa).
   */
  function fromLayer(axis, layer, sign, wide = false) {
    const face = layer === 0 ? null : C.FACES.find((f) => BASES[f].axis === axis && BASES[f].layers[0] === layer);
    const base = layer === 0 ? (wide ? null : SLICES[axis]) : face + (wide ? 'w' : '');
    if (!base) return null;
    return toString({ base, power: sign * BASES[base].dir > 0 ? 1 : 3 });
  }

  // Sáu ô tâm (U R F D L B) phải là một trong 24 hướng cầm của khối chuẩn, không phải ảnh gương.
  const centersValid = (colors) => C.findOrientation(colors, (centers) => centers.join('') === C.FACES.join('')) !== null;
  const isSolved = (colors) => C.FACES.every((_, f) => {
    for (let i = 0; i < 9; i++) if (colors[f * 9 + i] !== colors[f * 9 + 4]) return false;
    return true;
  });

  root.Rubik = root.Rubik || {};
  root.Rubik.playMoves = {
    BASES, NAMES, SLICES, PERM,
    parse, parseSequence, toString, normalize, inverse, apply, applyAll, describe, fromLayer,
    centersValid, isSolved,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
