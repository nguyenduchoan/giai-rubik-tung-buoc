/*
 * Mô hình khối Rubik 3x3.
 *
 * Trạng thái sticker (facelet) gồm 54 phần tử theo thứ tự chuẩn Kociemba:
 *   U1..U9, R1..R9, F1..F9, D1..D9, L1..L9, B1..B9
 * Mỗi mặt đọc theo hàng (trái -> phải, trên -> dưới) khi nhìn thẳng vào mặt đó với:
 *   U: mặt B ở phía trên ảnh, F ở phía dưới
 *   R, F, L, B: mặt U ở phía trên
 *   D: mặt F ở phía trên ảnh, B ở phía dưới
 *
 * Hệ toạ độ 3D (toán học): x sang phải (R), y lên trên (U), z hướng về người xem (F).
 */
(function (root) {
  'use strict';

  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  const NORMALS = {
    U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
    D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
  };

  function faceletPosition(face, r, c) {
    switch (face) {
      case 'U': return [c - 1, 1, r - 1];
      case 'R': return [1, 1 - r, 1 - c];
      case 'F': return [c - 1, 1 - r, 1];
      case 'D': return [c - 1, -1, 1 - r];
      case 'L': return [-1, 1 - r, c - 1];
      case 'B': return [1 - c, 1 - r, -1];
      default: throw new Error('Mặt không hợp lệ: ' + face);
    }
  }

  const FACELETS = [];
  const KEY_TO_INDEX = new Map();
  const vkey = (p, n) => p.join(',') + '|' + n.join(',');

  FACES.forEach((face, fi) => {
    for (let i = 0; i < 9; i++) {
      const pos = faceletPosition(face, Math.floor(i / 3), i % 3);
      const normal = NORMALS[face];
      const index = fi * 9 + i;
      FACELETS.push({ face, index, pos, normal });
      KEY_TO_INDEX.set(vkey(pos, normal), index);
    }
  });

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  // Quay 90° theo chiều kim đồng hồ khi nhìn từ phía pháp tuyến ngoài `a`.
  function rotateCW(v, a) {
    const c = cross(a, v);
    const d = dot(a, v);
    return [a[0] * d - c[0], a[1] * d - c[1], a[2] * d - c[2]].map((x) => x + 0);
  }

  // MOVE_PERM[face][dest] = src  =>  sau khi xoay: state[dest] = cũ[src]
  const MOVE_PERM = {};
  FACES.forEach((face) => {
    const axis = NORMALS[face];
    const perm = new Array(54);
    for (let i = 0; i < 54; i++) perm[i] = i;
    FACELETS.forEach((f) => {
      if (dot(f.pos, axis) !== 1) return;
      const dest = KEY_TO_INDEX.get(vkey(rotateCW(f.pos, axis), rotateCW(f.normal, axis)));
      perm[dest] = f.index;
    });
    MOVE_PERM[face] = perm;
  });

  // Xoay CẢ KHỐI 90° theo chiều kim đồng hồ khi nhìn từ mặt `face` (mọi sticker cùng di chuyển).
  const CUBE_ROT_PERM = {};
  FACES.forEach((face) => {
    const axis = NORMALS[face];
    const perm = new Array(54);
    FACELETS.forEach((f) => {
      perm[KEY_TO_INDEX.get(vkey(rotateCW(f.pos, axis), rotateCW(f.normal, axis)))] = f.index;
    });
    CUBE_ROT_PERM[face] = perm;
  });

  function rotateWholeCube(state, face) {
    const perm = CUBE_ROT_PERM[face];
    return perm.map((src) => state[src]);
  }

  function applyCubeRotations(state, rotations) {
    return rotations.reduce((s, f) => rotateWholeCube(s, f), Array.from(state));
  }

  /*
   * Tìm dãy xoay cả khối (tối đa 24 hướng) để ô tâm thỏa `accept(centers)`;
   * centers = [U, R, F, D, L, B]. Trả về mảng tên mặt ('R' = xoay quanh trục R, 'U' = quanh trục U) hoặc null.
   */
  function findOrientation(state, accept) {
    const centersOf = (s) => FACES.map((_, i) => s[i * 9 + 4]);
    const seen = new Set();
    const queue = [{ s: Array.from(state), rots: [] }];
    while (queue.length) {
      const { s, rots } = queue.shift();
      const centers = centersOf(s);
      const key = centers.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      if (accept(centers)) return rots;
      queue.push({ s: rotateWholeCube(s, 'R'), rots: rots.concat('R') });
      queue.push({ s: rotateWholeCube(s, 'U'), rots: rots.concat('U') });
    }
    return null;
  }

  function parseMove(token) {
    const m = /^([URFDLB])(2|'|2')?$/.exec(token.trim());
    if (!m) throw new Error('Ký hiệu xoay không hợp lệ: ' + token);
    const power = m[2] === "'" ? 3 : m[2] ? 2 : 1;
    return { face: m[1], power };
  }

  function parseMoves(str) {
    return str.trim().split(/\s+/).filter(Boolean).map(parseMove);
  }

  function moveToString(move) {
    return move.face + (move.power === 1 ? '' : move.power === 2 ? '2' : "'");
  }

  function inverseMove(move) {
    return { face: move.face, power: (4 - move.power) % 4 || 4 };
  }

  // Áp dụng một bước xoay lên mảng 54 phần tử (giá trị bất kỳ), trả về mảng mới.
  function applyMove(state, move) {
    if (typeof move === 'string') move = parseMove(move);
    let cur = Array.from(state);
    const perm = MOVE_PERM[move.face];
    for (let k = 0; k < move.power; k++) {
      const next = new Array(54);
      for (let i = 0; i < 54; i++) next[i] = cur[perm[i]];
      cur = next;
    }
    return cur;
  }

  function applyMoves(state, moves) {
    if (typeof moves === 'string') moves = parseMoves(moves);
    return moves.reduce((s, m) => applyMove(s, m), Array.from(state));
  }

  const SOLVED = FACES.map((f) => f.repeat(9)).join('');

  // ---------- Facelet <-> cubie ----------
  // Góc: URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB
  const CORNER_FACELET = [
    [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
  ];
  const CORNER_COLOR = [
    'URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB',
  ];
  // Cạnh: UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR
  const EDGE_FACELET = [
    [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
    [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
  ];
  const EDGE_COLOR = [
    'UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR',
  ];

  class CubeError extends Error {}

  function permParity(p) {
    let parity = 0;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) parity ^= 1;
    }
    return parity;
  }

  // Chuyển chuỗi 54 ký tự (URFDLB) sang dạng cubie {cp, co, ep, eo}. Ném CubeError nếu sai.
  function toCubie(facelets) {
    const f = Array.from(facelets);
    const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);

    for (let i = 0; i < 8; i++) {
      const fl = CORNER_FACELET[i];
      let ori = 0;
      while (ori < 3 && f[fl[ori]] !== 'U' && f[fl[ori]] !== 'D') ori++;
      if (ori === 3) throw new CubeError('Một viên góc không có màu của mặt Trên/Dưới.');
      const c0 = f[fl[ori]];
      const c1 = f[fl[(ori + 1) % 3]];
      const c2 = f[fl[(ori + 2) % 3]];
      // Phải khớp đủ ba màu: nếu bỏ qua c0 thì góc (D,R,F) bị nhận nhầm là URF.
      const j = CORNER_COLOR.findIndex((cc) => cc[0] === c0 && cc[1] === c1 && cc[2] === c2);
      if (j < 0) throw new CubeError('Có viên góc mang tổ hợp màu không tồn tại.');
      cp[i] = j;
      co[i] = ori;
    }
    for (let i = 0; i < 12; i++) {
      const [a, b] = EDGE_FACELET[i];
      const j = EDGE_COLOR.findIndex((ec) => ec[0] === f[a] && ec[1] === f[b]);
      if (j >= 0) { ep[i] = j; eo[i] = 0; continue; }
      const k = EDGE_COLOR.findIndex((ec) => ec[1] === f[a] && ec[0] === f[b]);
      if (k < 0) throw new CubeError('Có viên cạnh mang tổ hợp màu không tồn tại.');
      ep[i] = k;
      eo[i] = 1;
    }
    return { cp, co, ep, eo };
  }

  function verifyCubie(c) {
    if (new Set(c.cp).size !== 8) throw new CubeError('Có viên góc bị lặp (thiếu một viên góc khác).');
    if (new Set(c.ep).size !== 12) throw new CubeError('Có viên cạnh bị lặp (thiếu một viên cạnh khác).');
    if (c.co.reduce((a, b) => a + b, 0) % 3 !== 0) {
      throw new CubeError('Một viên góc bị vặn sai hướng (khối đã bị tháo/lắp lại hoặc nhập nhầm màu).');
    }
    if (c.eo.reduce((a, b) => a + b, 0) % 2 !== 0) {
      throw new CubeError('Một viên cạnh bị lật ngược (khối đã bị tháo/lắp lại hoặc nhập nhầm màu).');
    }
    if (permParity(c.cp) !== permParity(c.ep)) {
      throw new CubeError('Hai viên bị đổi chỗ cho nhau – trạng thái này không thể giải (kiểm tra lại màu).');
    }
  }

  /*
   * Kiểm tra mảng 54 mã màu (bất kỳ giá trị nào, ví dụ 0..5).
   * Trả về { ok: true, facelets } hoặc { ok: false, error }.
   */
  function validateColors(colors) {
    if (!colors || colors.length !== 54) return { ok: false, error: 'Cần đủ 54 ô màu.' };
    if (colors.some((c) => c === null || c === undefined)) {
      return { ok: false, error: 'Còn ô chưa có màu.' };
    }
    const counts = new Map();
    colors.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
    const centers = FACES.map((_, i) => colors[i * 9 + 4]);
    if (new Set(centers).size !== 6) {
      return { ok: false, error: 'Sáu ô tâm phải có sáu màu khác nhau.' };
    }
    for (const [c, n] of counts) {
      if (!centers.includes(c)) return { ok: false, error: 'Có màu không trùng với ô tâm nào.' };
      if (n !== 9) {
        return { ok: false, error: `Mỗi màu phải xuất hiện đúng 9 lần (một màu đang có ${n} ô).`, color: c };
      }
    }
    const facelets = colors.map((c) => FACES[centers.indexOf(c)]).join('');
    try {
      verifyCubie(toCubie(facelets));
    } catch (e) {
      if (e instanceof CubeError) return { ok: false, error: e.message };
      throw e;
    }
    return { ok: true, facelets };
  }

  // ---------- Tự sắp xếp / xoay các mặt chụp nhầm ----------
  const OPPOSITE_POS = [3, 4, 5, 0, 1, 2]; // U-D, R-L, F-B
  const posOfFacelet = (i) => Math.floor(i / 9);
  const VALID_CORNER_POS = new Set();
  CORNER_COLOR.forEach((s) => {
    const p = Array.from(s).map((f) => FACES.indexOf(f));
    for (let k = 0; k < 3; k++) VALID_CORNER_POS.add([p[k], p[(k + 1) % 3], p[(k + 2) % 3]].join(','));
  });

  // Xoay 9 ô của một mặt 90° theo chiều kim đồng hồ, `times` lần.
  function rotateFaceArray(face9, times) {
    let cur = face9.slice();
    for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
      const old = cur;
      cur = new Array(9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cur[r * 3 + c] = old[(2 - c) * 3 + r];
    }
    return cur;
  }

  /*
   * Áp dụng cách sắp xếp lên mảng 54 phần tử bất kỳ (màu, RGB...).
   * arrangement[p] = { src, rot }: vị trí p (U R F D L B) lấy ảnh đã chụp ở vị trí src, xoay rot lần 90°.
   */
  function applyArrangement(arr, arrangement) {
    const out = new Array(54);
    arrangement.forEach(({ src, rot }, p) => {
      rotateFaceArray(arr.slice(src * 9, src * 9 + 9), rot).forEach((v, k) => { out[p * 9 + k] = v; });
    });
    return out;
  }

  // Chi phí đặt ảnh đã chụp ở vị trí src vào vị trí p với rot lần xoay 90°.
  function arrangeCost(p, src, rot) {
    const moved = src !== p ? (p === 0 || p === 2 ? 3 : 1) : 0; // U = 0, F = 2
    return moved + (rot !== 0 ? 1 : 0);
  }

  /*
   * Tìm cách gán 6 ảnh đã chụp vào 6 vị trí và xoay từng ảnh sao cho khối hợp lệ,
   * ưu tiên ít thay đổi nhất so với lúc chụp (xem arrangeCost). Đổi ảnh ở mặt TRÊN/TRƯỚC bị phạt
   * nặng hơn để giữ nguyên cách cầm khối của người dùng (nếu không sẽ hay chọn "nhìn từ phía sau").
   * Trả về:
   *   { ok: true, cost, arrangement, colors, facelets }  nếu tìm được (cost = 0: đã đúng sẵn)
   *   { ok: false, reason: 'incomplete' | 'duplicate-center' | 'not-found', ... }
   */
  function autoArrange(colors, { maxNodes = 3e6 } = {}) {
    if (!colors || colors.length !== 54 || colors.some((c) => c === null || c === undefined)) {
      return { ok: false, reason: 'incomplete' };
    }
    const centers = FACES.map((_, k) => colors[k * 9 + 4]);
    const dupColor = centers.find((c, i) => centers.indexOf(c) !== i);
    if (dupColor !== undefined) {
      return { ok: false, reason: 'duplicate-center', color: dupColor,
        faces: centers.map((c, i) => (c === dupColor ? i : -1)).filter((i) => i >= 0) };
    }

    const rotated = FACES.map((_, k) => [0, 1, 2, 3].map((r) => rotateFaceArray(colors.slice(k * 9, k * 9 + 9), r)));
    const cur = new Array(54).fill(undefined);
    const placed = new Array(6).fill(false);
    const used = new Array(6).fill(false);
    const posOfColor = new Map();
    const assign = new Array(6);
    let best = null;
    let bestCost = Infinity;
    let nodes = 0;

    function consistent() {
      for (const [a, b] of EDGE_FACELET) {
        if (!placed[posOfFacelet(a)] || !placed[posOfFacelet(b)]) continue;
        const ca = cur[a], cb = cur[b];
        if (ca === cb) return false;
        const pa = posOfColor.get(ca), pb = posOfColor.get(cb);
        if (pa !== undefined && pb !== undefined && OPPOSITE_POS[pa] === pb) return false;
      }
      for (const fl of CORNER_FACELET) {
        if (!fl.every((i) => placed[posOfFacelet(i)])) continue;
        const cs = fl.map((i) => cur[i]);
        if (cs[0] === cs[1] || cs[1] === cs[2] || cs[0] === cs[2]) return false;
        const ps = cs.map((c) => posOfColor.get(c));
        if (ps.every((p) => p !== undefined) && !VALID_CORNER_POS.has(ps.join(','))) return false;
      }
      return true;
    }

    function search(p, cost) {
      if (cost >= bestCost || ++nodes > maxNodes) return;
      if (p === 6) {
        const v = validateColors(cur);
        if (v.ok) {
          bestCost = cost;
          best = { arrangement: assign.map((a) => ({ ...a })), colors: cur.slice(), facelets: v.facelets };
        }
        return;
      }
      // Thử trước các lựa chọn ít thay đổi: giữ đúng chỗ, không xoay.
      const options = [];
      for (let k = 0; k < 6; k++) {
        if (used[k]) continue;
        for (let r = 0; r < 4; r++) options.push({ k, r, c: arrangeCost(p, k, r) });
      }
      options.sort((x, y) => x.c - y.c);
      for (const { k, r, c } of options) {
        if (cost + c >= bestCost) continue;
        used[k] = true;
        placed[p] = true;
        posOfColor.set(centers[k], p);
        rotated[k][r].forEach((v, i) => { cur[p * 9 + i] = v; });
        assign[p] = { src: k, rot: r };
        if (consistent()) search(p + 1, cost + c);
        used[k] = false;
        placed[p] = false;
        posOfColor.delete(centers[k]);
        for (let i = 0; i < 9; i++) cur[p * 9 + i] = undefined;
        if (bestCost === 0) return;
      }
    }

    search(0, 0);
    if (!best) return { ok: false, reason: 'not-found', exhausted: nodes <= maxNodes };
    return { ok: true, cost: bestCost, ...best };
  }

  /*
   * Khi đủ 9 ô mỗi màu mà khối vẫn sai, thường là 2 ô bị nhận nhầm màu cho nhau (đỏ↔cam,
   * trắng↔vàng...). Thử đổi màu từng cặp ô nghi ngờ (suspects từ vision.suspectCells, ô mơ hồ nhất
   * trước) rồi chạy autoArrange. Trả về { a, b, colorA, colorB, result } hoặc null.
   */
  function findSwapFix(colors, suspects, { top = 12, maxTries = 30 } = {}) {
    const cand = suspects.slice(0, top);
    const pairs = [];
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i], b = cand[j];
        if (colors[a.index] === colors[b.index]) continue;
        // Ưu tiên cặp mà màu đang gán của ô này là màu "gần thứ hai" của ô kia.
        const cross = (a.alt === colors[b.index] ? 1 : 0) + (b.alt === colors[a.index] ? 1 : 0);
        if (cross === 0) continue;
        pairs.push({ a: a.index, b: b.index, score: cross * 10 + a.ratio + b.ratio });
      }
    }
    pairs.sort((x, y) => y.score - x.score);
    for (const { a, b } of pairs.slice(0, maxTries)) {
      const trial = Array.from(colors);
      [trial[a], trial[b]] = [trial[b], trial[a]];
      const result = autoArrange(trial, { maxNodes: 4e5 });
      if (result.ok) return { a, b, colorA: trial[a], colorB: trial[b], result };
    }
    return null;
  }

  function randomScramble(length = 25, rng = Math.random) {
    const moves = [];
    let last = -1;
    let lastAxis = -1;
    let sameAxisCount = 0;
    while (moves.length < length) {
      const fi = Math.floor(rng() * 6);
      if (fi === last) continue;
      const axis = fi % 3;
      if (axis === lastAxis && sameAxisCount >= 1) continue;
      sameAxisCount = axis === lastAxis ? sameAxisCount + 1 : 0;
      last = fi;
      lastAxis = axis;
      moves.push({ face: FACES[fi], power: 1 + Math.floor(rng() * 3) });
    }
    return moves;
  }

  root.Rubik = root.Rubik || {};
  root.Rubik.cube = {
    FACES, NORMALS, FACELETS, MOVE_PERM, SOLVED,
    CORNER_FACELET, CORNER_COLOR, EDGE_FACELET, EDGE_COLOR,
    CubeError,
    parseMove, parseMoves, moveToString, inverseMove,
    applyMove, applyMoves, toCubie, verifyCubie, validateColors,
    randomScramble, permParity, rotateFaceArray, applyArrangement, autoArrange, arrangeCost,
    rotateWholeCube, applyCubeRotations, findOrientation, findSwapFix,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
