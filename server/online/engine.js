/*
 * Mô hình Rubik phía máy chủ: nạp đúng các tệp trình duyệt dùng (cube.js, play-moves.js, online-protocol.js) để hai
 * bên áp dụng cùng phép xoay. Kèm bộ sinh trạng thái ngẫu nhiên hợp lệ cho bộ tráo random-state (BR-08).
 */
'use strict';
const { randomInt } = require('node:crypto');
require('../../js/cube.js');
require('../../js/play-moves.js');
require('../../js/online-protocol.js');

const C = globalThis.Rubik.cube;
const P = globalThis.Rubik.playMoves;
const protocol = globalThis.Rubik.onlineProtocol;

function randomPerm(n, rand) {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rand(i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

// Trạng thái ngẫu nhiên đều trên toàn bộ trạng thái giải được: hoán vị/định hướng ngẫu nhiên thỏa ràng buộc chẵn lẻ.
function randomCubie(rand = randomInt) {
  const cp = randomPerm(8, rand);
  const ep = randomPerm(12, rand);
  if (C.permParity(cp) !== C.permParity(ep)) [ep[0], ep[1]] = [ep[1], ep[0]];
  const co = Array.from({ length: 7 }, () => rand(3));
  co.push((3 - (co.reduce((a, b) => a + b, 0) % 3)) % 3);
  const eo = Array.from({ length: 11 }, () => rand(2));
  eo.push(eo.reduce((a, b) => a + b, 0) % 2);
  return { cp, co, ep, eo };
}

// Ngược với C.toCubie: dựng 54 ô URFDLB từ dạng viên.
function fromCubie({ cp, co, ep, eo }) {
  const f = Array.from(C.SOLVED);
  for (let i = 0; i < 8; i++) {
    for (let n = 0; n < 3; n++) f[C.CORNER_FACELET[i][(n + co[i]) % 3]] = C.CORNER_COLOR[cp[i]][n];
  }
  for (let i = 0; i < 12; i++) {
    for (let n = 0; n < 2; n++) f[C.EDGE_FACELET[i][(n + eo[i]) % 2]] = C.EDGE_COLOR[ep[i]][n];
  }
  return f.join('');
}

// Dự phòng khi bộ giải chưa sẵn sàng: 25 nước ngẫu nhiên (bộ tráo giao hữu, ghi rõ loại trong ván).
function randomMoveScramble(rand = randomInt) {
  const moves = C.randomScramble(25, () => rand(1 << 30) / (1 << 30)).map((m) => C.moveToString(m));
  const scramble = moves.join(' ');
  return { scramble, state: P.applyAll(Array.from(C.SOLVED), scramble).join(''), kind: 'random-moves' };
}

module.exports = { C, P, protocol, randomCubie, fromCubie, randomMoveScramble };
