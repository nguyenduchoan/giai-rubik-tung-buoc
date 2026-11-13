// Lượt giải trong phòng: tách khối, bộ đếm và đồng hồ khỏi lịch sử Chơi tự do.
(function (root) {
  'use strict';
  const { cube: C, playMoves: P, PlayState } = root.Rubik;
  class RoomAttempt {
    constructor(scramble, now = () => performance.now()) {
      this.model = new PlayState();
      this.model.colors = P.applyAll(Array.from(C.SOLVED), scramble);
      this.now = now;
      this.startedAt = null;
      this.moveCount = 0;
      this.result = null;
    }
    begin(entry) {
      if (this.result) return null;
      const moves = P.parseEntry(entry);
      if (this.startedAt === null) this.startedAt = this.now();
      return moves;
    }
    commit(moves) {
      if (this.result || this.startedAt === null) return;
      this.model.move(moves);
      this.moveCount += P.parseEntry(moves).length;
      if (this.model.solved) this.result = { moveCount: this.moveCount, durationMs: Math.max(1, Math.round(this.elapsed)) };
    }
    get elapsed() { return this.result ? this.result.durationMs : this.startedAt === null ? 0 : this.now() - this.startedAt; }
  }
  root.Rubik.RoomAttempt = RoomAttempt;
})(typeof globalThis !== 'undefined' ? globalThis : this);
