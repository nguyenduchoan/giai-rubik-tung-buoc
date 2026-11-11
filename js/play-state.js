/* Khối tự chơi và hai ngăn lịch sử; không dùng dữ liệu camera/bộ giải. */
(function (root) {
  'use strict';
  const C = root.Rubik.cube;
  const LIMIT = 200;

  class PlayState {
    constructor(saved) {
      this.reset();
      if (!saved || typeof saved !== 'object') return;
      try {
        if (!Array.isArray(saved.colors) || !C.validateColors(saved.colors).ok ||
            !C.FACES.every((face, index) => saved.colors[index * 9 + 4] === face)) return;
        const history = (items) => {
          if (!Array.isArray(items) || items.length > LIMIT || items.some((item) => typeof item !== 'string')) throw new Error('Lịch sử không hợp lệ');
          return items.map((item) => C.moveToString(C.parseMove(item)));
        };
        const past = history(saved.past), future = history(saved.future);
        if (past.length + future.length > LIMIT) return;
        this.colors = saved.colors.slice();
        this.past = past;
        this.future = future;
      } catch (error) { /* Dữ liệu lưu hỏng: giữ khối ban đầu. */ }
    }

    reset() {
      this.colors = Array.from(C.SOLVED);
      this.past = [];
      this.future = [];
    }

    move(token) {
      const move = C.parseMove(token);
      this.colors = C.applyMove(this.colors, move);
      this.past.push(C.moveToString(move));
      if (this.past.length > LIMIT) this.past.shift();
      this.future = [];
    }

    undo() {
      if (!this.past.length) return;
      const token = this.past.pop();
      this.colors = C.applyMove(this.colors, C.inverseMove(C.parseMove(token)));
      this.future.push(token);
    }

    redo() {
      if (!this.future.length) return;
      const token = this.future.pop();
      this.colors = C.applyMove(this.colors, token);
      this.past.push(token);
    }

    get solved() { return this.colors.every((color, index) => color === C.SOLVED[index]); }
    snapshot() { return { colors: this.colors.slice(), past: this.past.slice(), future: this.future.slice() }; }
  }

  root.Rubik.PlayState = PlayState;
})(typeof globalThis !== 'undefined' ? globalThis : this);
