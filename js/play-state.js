/* Khối tự chơi và hai ngăn lịch sử; không dùng dữ liệu camera/bộ giải. */
(function (root) {
  'use strict';
  const C = root.Rubik.cube;
  const P = root.Rubik.playMoves;
  const LIMIT = 200;
  const VERSION = 2;

  /*
   * Khối hợp lệ: 54 ô mang sáu màu U R F D L B, mỗi màu 9 ô, các viên ghép được (kiểm tra theo màu tâm) và sáu tâm
   * nằm ở một trong 24 hướng cầm của khối chuẩn. Xoay lớp giữa/hai lớp làm tâm đổi chỗ nên không buộc tâm cố định.
   */
  function validColors(colors) {
    return Array.isArray(colors) && colors.length === 54 && colors.every((c) => C.FACES.includes(c)) &&
      C.validateColors(colors).ok && P.centersValid(colors);
  }

  class PlayState {
    // saved: bản lưu phiên bản 2 hoặc bản cũ (chỉ có colors/past/future). restored cho biết đã nhận bản lưu.
    constructor(saved) {
      this.reset();
      this.restored = false;
      if (!saved || typeof saved !== 'object') return;
      try {
        if ((saved.version !== undefined && saved.version !== VERSION) || !validColors(saved.colors)) return;
        const history = (items) => {
          if (!Array.isArray(items) || items.length > LIMIT || items.some((item) => typeof item !== 'string')) throw new Error('Lịch sử không hợp lệ');
          return items.map(P.normalize);
        };
        const past = history(saved.past), future = history(saved.future);
        if (past.length + future.length > LIMIT) return;
        this.colors = saved.colors.slice();
        this.past = past;
        this.future = future;
        this.restored = true;
      } catch (error) { /* Dữ liệu lưu hỏng: giữ khối ban đầu. */ }
    }

    reset() {
      this.colors = Array.from(C.SOLVED);
      this.past = [];
      this.future = [];
    }

    move(token) {
      const move = P.parse(token);
      this.colors = P.apply(this.colors, move);
      this.past.push(P.toString(move));
      if (this.past.length > LIMIT) this.past.shift();
      this.future = [];
    }

    undo() {
      if (!this.past.length) return;
      const token = this.past.pop();
      this.colors = P.apply(this.colors, P.inverse(token));
      this.future.push(token);
    }

    redo() {
      if (!this.future.length) return;
      const token = this.future.pop();
      this.colors = P.apply(this.colors, token);
      this.past.push(token);
    }

    // Đã giải khi mỗi mặt cùng màu với tâm của nó, ở bất kỳ hướng cầm nào.
    get solved() { return P.isSolved(this.colors); }
    snapshot() { return { version: VERSION, colors: this.colors.slice(), past: this.past.slice(), future: this.future.slice() }; }
  }

  PlayState.LIMIT = LIMIT;
  PlayState.validColors = validColors;
  root.Rubik.PlayState = PlayState;
})(typeof globalThis !== 'undefined' ? globalThis : this);
