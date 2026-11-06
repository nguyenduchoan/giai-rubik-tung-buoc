/* Chạy bộ giải trong Web Worker để giao diện không bị đứng khi dựng bảng tra. */
/* global importScripts */
// Dùng cùng tham số phiên bản (?v=...) với URL của worker để không nạp bản cũ trong cache.
importScripts('cube.js' + self.location.search, 'solver.js' + self.location.search);

self.onmessage = (e) => {
  const { id, type, facelets, options } = e.data;
  try {
    if (type === 'init') {
      self.Rubik.solver.init();
      self.postMessage({ id, ok: true });
    } else if (type === 'solve') {
      const moves = self.Rubik.solver.solve(facelets, options);
      self.postMessage({ id, ok: true, moves });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
