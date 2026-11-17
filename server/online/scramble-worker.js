// Luồng phụ sinh bộ tráo random-state: trạng thái ngẫu nhiên → giải hai pha → đảo chuỗi giải thành chuỗi tráo.
'use strict';
const { parentPort } = require('node:worker_threads');
const { C, P, randomCubie, fromCubie } = require('./engine.js');
require('../../js/solver.js');
const S = globalThis.Rubik.solver;

function generate() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = fromCubie(randomCubie());
    if (state === C.SOLVED) continue;
    const solution = S.solve(state, { targetLength: 21, timeLimit: 400 });
    if (solution.length < 10) continue; // quá dễ cho một ván thi
    const scramble = solution.slice().reverse().map((m) => C.moveToString(C.inverseMove(m))).join(' ');
    if (P.applyAll(Array.from(C.SOLVED), scramble).join('') !== state) throw new Error('Chuỗi tráo không khớp trạng thái');
    return { scramble, state, kind: 'random-state' };
  }
  throw new Error('Không sinh được trạng thái phù hợp');
}

parentPort.on('message', (msg) => {
  try {
    if (msg === 'init') { S.init(); parentPort.postMessage({ ready: true }); return; }
    parentPort.postMessage({ result: generate() });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
