/*
 * Bộ giải Rubik theo thuật toán hai pha của Herbert Kociemba.
 *
 * Pha 1: đưa khối về nhóm G1 = <U, D, R2, L2, F2, B2>
 *        (mọi góc/cạnh đúng hướng, 4 cạnh tầng giữa nằm ở tầng giữa).
 * Pha 2: giải hoàn toàn bằng các bước xoay trong G1.
 *
 * Thường cho lời giải khoảng 18–22 bước trong vòng chưa tới 1–2 giây.
 * Phụ thuộc: js/cube.js (Rubik.cube).
 */
(function (root) {
  'use strict';

  const C = root.Rubik.cube;
  const N_MOVES = 18; // mặt (U R F D L B) * 3 + (lần xoay - 1)
  const P2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16]; // U U2 U' R2 F2 D D2 D' L2 B2
  const N_TWIST = 2187;
  const N_FLIP = 2048;
  const N_SLICE = 495;
  const N_SLICE_SORTED = 11880;
  const N_PERM8 = 40320;
  const N_SLICE_PERM = 24;

  // ---------- Cubie ----------
  const SOLVED_CUBIE = {
    cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };

  // a * b: thực hiện a rồi tới b.
  function multiply(a, b) {
    const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
    for (let i = 0; i < 8; i++) {
      cp[i] = a.cp[b.cp[i]];
      co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
    }
    for (let i = 0; i < 12; i++) {
      ep[i] = a.ep[b.ep[i]];
      eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2;
    }
    return { cp, co, ep, eo };
  }

  // Các bước xoay cơ bản suy ra trực tiếp từ mô hình hình học trong cube.js.
  const MOVE_CUBE = [];
  C.FACES.forEach((face) => {
    for (let p = 1; p <= 3; p++) {
      MOVE_CUBE.push(C.toCubie(C.applyMove(C.SOLVED, { face, power: p }).join('')));
    }
  });

  // ---------- Toạ độ ----------
  function binom(n, k) {
    if (k < 0 || n < k) return 0;
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return Math.round(r);
  }

  function twistCoord(c) {
    let t = 0;
    for (let i = 0; i < 7; i++) t = t * 3 + c.co[i];
    return t;
  }

  function flipCoord(c) {
    let f = 0;
    for (let i = 0; i < 11; i++) f = f * 2 + c.eo[i];
    return f;
  }

  function rotateLeft(arr, l, r) {
    const t = arr[l];
    for (let i = l; i < r; i++) arr[i] = arr[i + 1];
    arr[r] = t;
  }

  // Vị trí + hoán vị của 4 cạnh tầng giữa (FR, FL, BL, BR). 0..11879; /24 cho pha 1, %24 cho pha 2.
  function sliceSortedCoord(c) {
    let a = 0, x = 0;
    const edge4 = [0, 0, 0, 0];
    for (let j = 11; j >= 0; j--) {
      if (c.ep[j] >= 8) {
        a += binom(11 - j, x + 1);
        edge4[3 - x] = c.ep[j];
        x++;
      }
    }
    let b = 0;
    for (let j = 3; j > 0; j--) {
      let k = 0;
      while (edge4[j] !== j + 8) {
        rotateLeft(edge4, 0, j);
        k++;
      }
      b = (j + 1) * b + k;
    }
    return 24 * a + b;
  }

  function lehmer(p) {
    let idx = 0;
    for (let i = 0; i < p.length; i++) {
      let cnt = 0;
      for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) cnt++;
      idx = idx * (p.length - i) + cnt;
    }
    return idx;
  }

  const cornerPermCoord = (c) => lehmer(c.cp);
  const edge8Coord = (c) => lehmer(c.ep.slice(0, 8));

  // ---------- Bảng xoay & bảng cắt tỉa ----------
  // Dựng bảng xoay bằng BFS: mỗi giá trị toạ độ giữ một khối đại diện.
  function buildMoveTable(size, coordFn, moves) {
    const M = moves.length;
    const table = new Int32Array(size * M).fill(-1);
    const reps = new Array(size);
    const start = coordFn(SOLVED_CUBIE);
    reps[start] = SOLVED_CUBIE;
    const queue = new Int32Array(size);
    let head = 0, tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++];
      const cube = reps[c];
      for (let m = 0; m < M; m++) {
        const nc = multiply(cube, moves[m]);
        const n = coordFn(nc);
        table[c * M + m] = n;
        if (reps[n] === undefined) {
          reps[n] = nc;
          queue[tail++] = n;
        }
      }
    }
    if (tail !== size) throw new Error(`Bảng xoay không đầy đủ (${tail}/${size}).`);
    return table;
  }

  function buildPruneTable(n1, n2, mt1, mt2, M) {
    const total = n1 * n2;
    const table = new Int8Array(total).fill(-1);
    table[0] = 0;
    let done = 1, depth = 0;
    while (done < total) {
      for (let i = 0; i < total; i++) {
        if (table[i] !== depth) continue;
        const c1 = (i / n2) | 0;
        const c2 = i - c1 * n2;
        for (let m = 0; m < M; m++) {
          const j = mt1[c1 * M + m] * n2 + mt2[c2 * M + m];
          if (table[j] === -1) {
            table[j] = depth + 1;
            done++;
          }
        }
      }
      depth++;
      if (depth > 30) throw new Error('Bảng cắt tỉa không hội tụ.');
    }
    return table;
  }

  let T = null;

  function init() {
    if (T) return T;
    const P2_CUBES = P2_MOVES.map((m) => MOVE_CUBE[m]);

    const twistMove = buildMoveTable(N_TWIST, twistCoord, MOVE_CUBE);
    const flipMove = buildMoveTable(N_FLIP, flipCoord, MOVE_CUBE);
    const sliceSortedMove = buildMoveTable(N_SLICE_SORTED, sliceSortedCoord, MOVE_CUBE);

    const sliceMove = new Int32Array(N_SLICE * N_MOVES);
    for (let s = 0; s < N_SLICE; s++) {
      for (let m = 0; m < N_MOVES; m++) {
        sliceMove[s * N_MOVES + m] = (sliceSortedMove[s * 24 * N_MOVES + m] / 24) | 0;
      }
    }
    const P2 = P2_MOVES.length;
    const slicePermMove = new Int32Array(N_SLICE_PERM * P2);
    for (let s = 0; s < N_SLICE_PERM; s++) {
      for (let i = 0; i < P2; i++) {
        slicePermMove[s * P2 + i] = sliceSortedMove[s * N_MOVES + P2_MOVES[i]];
      }
    }
    const cornerMove = buildMoveTable(N_PERM8, cornerPermCoord, P2_CUBES);
    const edge8Move = buildMoveTable(N_PERM8, edge8Coord, P2_CUBES);

    T = {
      twistMove, flipMove, sliceMove, sliceSortedMove, cornerMove, edge8Move, slicePermMove,
      pruneTwistSlice: buildPruneTable(N_TWIST, N_SLICE, twistMove, sliceMove, N_MOVES),
      pruneFlipSlice: buildPruneTable(N_FLIP, N_SLICE, flipMove, sliceMove, N_MOVES),
      pruneCornerSlice: buildPruneTable(N_PERM8, N_SLICE_PERM, cornerMove, slicePermMove, P2),
      pruneEdgeSlice: buildPruneTable(N_PERM8, N_SLICE_PERM, edge8Move, slicePermMove, P2),
    };
    return T;
  }

  const IS_P2_MOVE = new Array(N_MOVES).fill(false);
  P2_MOVES.forEach((m) => { IS_P2_MOVE[m] = true; });

  // Hai mặt đối diện (cùng trục) chỉ được đi theo một thứ tự để tránh trùng lặp.
  function skipFace(face, lastFace) {
    if (lastFace < 0) return false;
    if (face === lastFace) return true;
    return face % 3 === lastFace % 3 && face < lastFace;
  }

  /*
   * Giải khối từ chuỗi 54 ký tự URFDLB.
   * opts.targetLength: dừng ngay khi tìm được lời giải <= số bước này (mặc định 20).
   * opts.timeLimit: thời gian (ms) tối đa để tiếp tục rút ngắn lời giải (mặc định 1500).
   * Trả về mảng {face, power}.
   */
  function solve(facelets, opts = {}) {
    const t = init();
    const target = opts.targetLength ?? 20;
    const deadline = Date.now() + (opts.timeLimit ?? 1500);

    const cube = C.toCubie(facelets);
    C.verifyCubie(cube);

    const moves1 = new Array(32);
    const moves2 = new Array(32);
    let best = null;
    let limit = opts.maxLength ?? 30; // giới hạn trên (bao gồm) của tổng số bước
    let nodes = 0;
    let stop = false;

    function phase2(cp, ep, sp, depth, togo, lastFace) {
      if (togo === 0) return cp === 0 && ep === 0 && sp === 0;
      for (let i = 0; i < P2_MOVES.length; i++) {
        const m = P2_MOVES[i];
        const face = (m / 3) | 0;
        if (skipFace(face, lastFace)) continue;
        const cp2 = t.cornerMove[cp * 10 + i];
        const ep2 = t.edge8Move[ep * 10 + i];
        const sp2 = t.slicePermMove[sp * 10 + i];
        const h = Math.max(t.pruneCornerSlice[cp2 * 24 + sp2], t.pruneEdgeSlice[ep2 * 24 + sp2]);
        if (h >= togo) continue;
        moves2[depth] = m;
        if (phase2(cp2, ep2, sp2, depth + 1, togo - 1, face)) return true;
      }
      return false;
    }

    function startPhase2(depth1) {
      let c = cube;
      for (let i = 0; i < depth1; i++) c = multiply(c, MOVE_CUBE[moves1[i]]);
      const cp = cornerPermCoord(c);
      const ep = edge8Coord(c);
      const sp = sliceSortedCoord(c);
      const lastFace = depth1 > 0 ? (moves1[depth1 - 1] / 3) | 0 : -1;
      const maxD2 = Math.min(limit - depth1, 18);
      const h = Math.max(t.pruneCornerSlice[cp * 24 + sp], t.pruneEdgeSlice[ep * 24 + sp]);
      for (let d2 = h; d2 <= maxD2; d2++) {
        if (phase2(cp, ep, sp, 0, d2, lastFace)) {
          best = moves1.slice(0, depth1).concat(moves2.slice(0, d2));
          limit = best.length - 1;
          if (best.length <= target) stop = true;
          return;
        }
      }
    }

    function phase1(tw, fl, sl, depth, togo, lastFace) {
      if (togo === 0) {
        if (tw === 0 && fl === 0 && sl === 0) {
          // Nếu bước cuối thuộc G1 thì lời giải pha 1 ngắn hơn đã được thử rồi.
          if (depth === 0 || !IS_P2_MOVE[moves1[depth - 1]]) startPhase2(depth);
        }
        return;
      }
      if ((++nodes & 0x3fff) === 0 && best && Date.now() > deadline) stop = true;
      for (let face = 0; face < 6 && !stop; face++) {
        if (skipFace(face, lastFace)) continue;
        for (let p = 0; p < 3 && !stop; p++) {
          const m = face * 3 + p;
          const tw2 = t.twistMove[tw * N_MOVES + m];
          const fl2 = t.flipMove[fl * N_MOVES + m];
          const sl2 = t.sliceMove[sl * N_MOVES + m];
          const h = Math.max(t.pruneTwistSlice[tw2 * N_SLICE + sl2], t.pruneFlipSlice[fl2 * N_SLICE + sl2]);
          if (h >= togo) continue;
          moves1[depth] = m;
          phase1(tw2, fl2, sl2, depth + 1, togo - 1, face);
        }
      }
    }

    const tw0 = twistCoord(cube);
    const fl0 = flipCoord(cube);
    const sl0 = (sliceSortedCoord(cube) / 24) | 0;
    for (let d1 = 0; d1 <= limit && !stop; d1++) {
      phase1(tw0, fl0, sl0, 0, d1, -1);
      if (best && Date.now() > deadline) break;
    }
    if (!best) throw new C.CubeError('Không tìm được lời giải.');
    return best.map((m) => ({ face: C.FACES[(m / 3) | 0], power: (m % 3) + 1 }));
  }

  root.Rubik.solver = {
    init,
    solve,
    isReady: () => T !== null,
    _internal: { multiply, MOVE_CUBE, SOLVED_CUBIE, twistCoord, flipCoord, sliceSortedCoord },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
