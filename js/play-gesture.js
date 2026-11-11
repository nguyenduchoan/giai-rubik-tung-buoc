/*
 * Bộ nhận cử chỉ của Chơi tự do, không dùng DOM để kiểm thử được bằng Node.
 * Vòng đời: idle → collect (nhận các ngón) → locked (đã chốt chế độ) → wait (chờ nhấc hết tay) → idle.
 *   - Cảm ứng: 1 ngón kéo một hàng/cột; 2 ngón, mỗi ngón trên một hàng/cột của hai lớp song song khác nhau, mỗi ngón
 *     kéo theo chiều riêng (hai lớp có thể ngược chiều), chốt một lượt hai nước; chỉ 3 ngón mới đổi góc nhìn.
 *     Ngón đặt ở vùng nền không xoay lớp và không đổi góc nhìn.
 *   - Chuột/bút: theo chế độ đang chọn (event.mode = 'layer1' | 'layer2' | 'view'); kéo vùng nền đổi góc nhìn.
 * Sự kiện vào: { id, x, y, t, kind: 'touch' | 'mouse', primary, facelet (số ô hoặc null), mode }.
 * handler: canTurn(), pick(facelet, dx, dy, layers) → { axis, layer, tx, ty, tokens: [chiều dương, chiều âm], spec }
 *   | { error } | null, touch(facelets) (các ô đang chạm, chưa rõ hướng), preview(specs[] | null), orbitStart(),
 *   orbit(dx, dy), orbitCancel(), orbitEnd(), commit(tokens[]), tap(facelet), hint(text), status({ phase, text }).
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    groupMs: 150, // khoảng ghép các ngón đặt gần như cùng lúc
    lockPx: 14, // độ dịch chuyển tối thiểu để xác nhận hướng/chiều
    tapPx: 8, // dưới mức này là chạm để chọn mặt
    maxFingers: 3,
  };
  const has = (value) => value !== null && value !== undefined;
  const HINT = {
    oneOff: 'Đặt ngón lên khối để xoay một hàng hoặc một cột. Dùng 3 ngón để đổi góc nhìn.',
    twoOff: 'Đặt cả hai ngón lên khối, mỗi ngón trên một hàng hoặc một cột.',
    parallel: 'Hai ngón phải kéo hai hàng hoặc hai cột song song nhau.',
    sameLayer: 'Đặt hai ngón lên hai hàng hoặc hai cột khác nhau.',
    twoShort: 'Kéo cả hai ngón đủ xa, mỗi ngón dọc theo hàng hoặc cột của mình.',
    unclear: 'Hướng vuốt chưa rõ. Vuốt dọc theo một hàng hoặc một cột.',
  };

  class PlayGesture {
    constructor(handler, options = {}) {
      this.h = handler;
      this.o = { ...DEFAULTS, ...options };
      this.pointers = new Map();
      this.picks = new Map(); // id ngón → lớp đã chọn theo hướng kéo của chính ngón đó
      this.note = '';
      this.clear();
    }

    clear() {
      this.phase = 'idle';
      this.kind = null;
      this.mode = null;
      this.type = null;
      this.movers = []; // các ngón quyết định lớp, theo thứ tự đặt xuống
      this.picks.clear();
      this.count = 0;
      this.peak = 0;
      this.lastDown = 0;
      this.order = 0;
    }

    get active() { return this.phase !== 'idle'; }

    // Độ dịch chuyển trung bình của các ngón tính từ mốc đo (đổi góc nhìn ba ngón, chuột).
    displacement() {
      let dx = 0, dy = 0;
      for (const p of this.pointers.values()) { dx += p.x - p.sx; dy += p.y - p.sy; }
      const n = this.pointers.size || 1;
      dx /= n; dy /= n;
      return { dx, dy, d: Math.hypot(dx, dy) };
    }

    shift(p) {
      const dx = p.x - p.sx, dy = p.y - p.sy;
      return { dx, dy, d: Math.hypot(dx, dy) };
    }

    // Đủ xa để khóa: 1–2 ngón đo từng ngón (hai ngón kéo ngược nhau có trung bình gần 0); 3 ngón đo trung bình để
    // chụm/phóng tay không bị coi là đổi góc nhìn.
    moved() {
      if (this.kind === 'touch' && this.pointers.size < 3) {
        return Math.max(...[...this.pointers.values()].map((p) => this.shift(p).d)) >= this.o.lockPx;
      }
      return this.displacement().d >= this.o.lockPx;
    }

    fingers() { return [...this.pointers.values()].sort((a, b) => a.order - b.order); }

    // Tô sáng viên dưới các ngón đang đặt mà chưa chọn được lớp (chỉ khi số ngón còn có thể xoay lớp).
    touched() {
      const n = this.pointers.size;
      const turning = this.kind === 'touch' ? n <= 2 : this.mode !== 'view';
      if (!turning || this.phase === 'wait' || this.phase === 'idle' || (this.phase === 'locked' && this.type === 'view')) {
        this.h.touch([]);
        return;
      }
      const pool = this.phase === 'locked' ? this.movers : this.fingers();
      this.h.touch(pool.filter((p) => has(p.facelet) && !this.picks.has(p.id)).map((p) => p.facelet));
    }

    down(e) {
      // Ngón chính mới nghĩa là không còn ngón nào khác đang chạm: bỏ dữ liệu cũ nếu sự kiện nhấc tay bị mất.
      if (e.primary && this.phase !== 'idle') this.abort();
      if (this.phase === 'idle') {
        this.pointers.clear();
        this.kind = e.kind;
        this.mode = e.mode || null;
        this.phase = 'collect';
        this.note = '';
      } else if (e.kind !== this.kind) {
        return false;
      }
      this.pointers.set(e.id, { id: e.id, x: e.x, y: e.y, sx: e.x, sy: e.y, facelet: has(e.facelet) ? e.facelet : null, order: this.order++ });
      this.peak = Math.max(this.peak, this.pointers.size);
      if (this.phase === 'locked') {
        this.abortActive();
        this.phase = 'wait';
        this.note = 'Đã hủy lượt vì có thêm ngón khi đang kéo';
        this.h.hint('Đã hủy lượt vì có thêm ngón khi đang kéo. Nhấc hết tay rồi đặt lại.');
      } else if (this.phase === 'collect') {
        if (this.pointers.size > this.o.maxFingers) {
          this.phase = 'wait';
          this.note = 'Không dùng 4 ngón trở lên';
          this.h.hint('Chỉ dùng 1, 2 hoặc 3 ngón. Nhấc hết tay rồi thử lại.');
        } else {
          // Thêm ngón trước khi khóa: đo lại từ vị trí hiện tại để không phát sinh xoay sớm.
          for (const p of this.pointers.values()) { p.sx = p.x; p.sy = p.y; }
          this.lastDown = e.t;
        }
      }
      this.touched();
      this.status();
      return true;
    }

    move(e) {
      const p = this.pointers.get(e.id);
      if (!p) return;
      p.x = e.x; p.y = e.y;
      if (this.phase === 'collect') {
        const settled = this.kind !== 'touch' || e.t - this.lastDown >= this.o.groupMs;
        if (settled && this.moved()) this.lock();
      } else if (this.phase === 'locked') {
        this.track();
      }
    }

    up(e) {
      const p = this.pointers.get(e.id);
      if (!p) return;
      p.x = e.x; p.y = e.y;
      if (this.phase === 'collect') {
        if (this.peak === 1 && this.shift(p).d < this.o.tapPx) {
          if (has(p.facelet)) this.h.tap(p.facelet);
        } else if (this.moved()) {
          // Vuốt nhanh, nhấc tay trước khi hết khoảng ghép ngón: chốt theo số ngón đang đặt.
          this.lock();
          if (this.phase === 'locked') this.finish();
        } else if (this.peak > 1) {
          this.note = 'Chưa kéo đủ xa';
        }
      } else if (this.phase === 'locked') {
        this.finish();
      }
      this.release(e.id);
    }

    // pointercancel hoặc mất quyền nhận con trỏ của một ngón.
    cancel(id) {
      if (!this.pointers.has(id)) return;
      if (this.phase === 'collect' || this.phase === 'locked') {
        this.abortActive();
        this.phase = 'wait';
        this.note = 'Cử chỉ bị ngắt';
      }
      this.release(id);
    }

    // Hủy toàn bộ: đổi kích thước, ẩn trang, rời tab.
    abort(note = '') {
      const busy = this.phase === 'collect' || this.phase === 'locked';
      this.abortActive();
      this.pointers.clear();
      this.clear();
      if (busy && note) this.note = note;
      this.status();
    }

    release(id) {
      this.pointers.delete(id);
      if (!this.pointers.size) this.clear();
      else if (this.phase !== 'idle') this.phase = 'wait';
      this.h.touch([]);
      this.status();
    }

    lock() {
      const count = this.pointers.size;
      const touch = this.kind === 'touch';
      let type = touch ? ['', 'layer1', 'pair', 'view'][count] : this.mode || 'layer1';
      let movers = [];
      if (type !== 'view') {
        movers = touch ? this.fingers() : this.fingers().slice(0, 1);
        if (movers.some((p) => !has(p.facelet))) {
          if (!touch) type = 'view'; // chuột kéo vùng nền: đổi góc nhìn
          else if (count === 1) return this.reject(HINT.oneOff, 'Một ngón ở ngoài khối');
          else return this.reject(HINT.twoOff, 'Cần cả hai ngón trên khối');
        } else if (!this.h.canTurn()) {
          return this.reject('Chờ nước xoay hoặc công thức hiện tại chạy xong.', 'Đang bận');
        }
      }
      this.type = type;
      this.movers = type === 'view' ? [] : movers;
      this.count = count;
      this.phase = 'locked';
      if (type === 'view') {
        this.h.touch([]);
        this.h.orbitStart();
      }
      this.track();
    }

    reject(hint, note) {
      this.abortActive();
      this.phase = 'wait';
      this.note = note;
      this.h.hint(hint);
      this.status();
    }

    layers() { return this.type === 'layer2' ? 2 : 1; }

    // Chọn lớp cho ngón chưa có lớp. force: lúc nhấc tay, dùng toàn bộ quãng đã đi dù chưa tới ngưỡng.
    // Trả về false nếu đã từ chối lượt.
    pickMovers(force) {
      let changed = false;
      for (const p of this.movers) {
        if (this.picks.has(p.id)) continue;
        const { dx, dy, d } = this.shift(p);
        if (!d || (!force && d < this.o.lockPx)) continue;
        const result = this.h.pick(p.facelet, dx, dy, this.layers());
        if (result && result.error) {
          this.reject(result.error, 'Mốc ở lớp giữa');
          return false;
        }
        if (result) { this.picks.set(p.id, result); changed = true; }
      }
      if (this.picks.size === 2) {
        const [a, b] = this.movers.map((p) => this.picks.get(p.id));
        if (a.axis !== b.axis) { this.reject(HINT.parallel, 'Hai lớp không song song'); return false; }
        if (a.layer === b.layer) { this.reject(HINT.sameLayer, 'Hai ngón cùng một lớp'); return false; }
      }
      if (changed) {
        this.h.preview(this.movers.filter((p) => this.picks.has(p.id)).map((p) => this.picks.get(p.id).spec));
        this.touched();
      }
      return true;
    }

    track() {
      if (this.type === 'view') {
        const { dx, dy } = this.displacement();
        this.h.orbit(dx, dy);
      } else if (!this.pickMovers(false)) {
        return;
      }
      this.status();
    }

    // Chiều xoay của một ngón theo vị trí hiện tại so với điểm đầu: +1, -1 hoặc 0 khi chưa đủ xa.
    direction(p) {
      const pick = this.picks.get(p.id);
      if (!pick) return 0;
      const { dx, dy } = this.shift(p);
      const along = dx * pick.tx + dy * pick.ty;
      return Math.abs(along) < this.o.lockPx ? 0 : Math.sign(along);
    }

    finish() {
      if (this.type === 'view') {
        this.h.orbitEnd();
        this.note = '';
        return;
      }
      if (!this.pickMovers(true)) return;
      const pair = this.movers.length === 2;
      if (this.picks.size < this.movers.length) {
        this.reject(pair ? HINT.twoShort : HINT.unclear, 'Hướng chưa rõ');
        return;
      }
      const signs = this.movers.map((p) => this.direction(p));
      if (pair && signs.some((sign) => sign) && signs.some((sign) => !sign)) {
        this.reject(HINT.twoShort, 'Một ngón chưa kéo đủ xa');
        return;
      }
      const tokens = this.movers.map((p, i) => this.picks.get(p.id).tokens[signs[i] > 0 ? 0 : 1]);
      this.h.preview(null);
      this.h.touch([]);
      this.picks.clear();
      if (!signs[0]) {
        this.note = 'Đã bỏ lượt';
        return;
      }
      this.note = '';
      this.h.commit(tokens);
    }

    abortActive() {
      if (this.phase === 'locked' && this.type === 'view') this.h.orbitCancel();
      this.h.preview(null);
      this.h.touch([]);
      this.picks.clear();
      this.movers = [];
      this.type = null;
    }

    status() {
      const n = this.pointers.size;
      let text;
      if (this.phase === 'idle') {
        text = this.note || 'Sẵn sàng';
      } else if (this.phase === 'collect') {
        text = `${n} ngón…`;
      } else if (this.phase === 'locked') {
        const who = this.kind === 'touch' ? `${this.count} ngón` : this.type === 'layer2' ? '2 lớp' : this.type === 'view' ? 'Kéo' : '1 lớp';
        if (this.type === 'view') {
          text = `${who} · đổi góc nhìn`;
        } else if (!this.picks.size) {
          text = `${who} · chọn hướng…`;
        } else {
          const parts = this.movers.map((p) => {
            const sign = this.direction(p);
            return sign ? this.picks.get(p.id).tokens[sign > 0 ? 0 : 1] : '…';
          });
          text = parts.every((part) => part === '…') ? `${who} · kéo thêm để xoay` : `${who} · ${parts.join(' ')}`;
        }
      } else {
        text = this.note ? `${this.note} · nhấc hết tay` : 'Nhấc hết tay để thử lại';
      }
      this.h.status({ phase: this.phase, text });
    }
  }

  PlayGesture.DEFAULTS = DEFAULTS;
  root.Rubik = root.Rubik || {};
  root.Rubik.PlayGesture = PlayGesture;
})(typeof globalThis !== 'undefined' ? globalThis : this);
