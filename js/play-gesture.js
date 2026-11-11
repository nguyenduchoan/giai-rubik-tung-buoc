/*
 * Bộ nhận cử chỉ của Chơi tự do, không dùng DOM để kiểm thử được bằng Node.
 * Vòng đời: idle → collect (nhận các ngón) → locked (đã chốt chế độ) → wait (chờ nhấc hết tay) → idle.
 *   - Cảm ứng: 1 ngón xoay một lớp, 2 ngón xoay hai lớp, 3 ngón đổi góc nhìn. Một ngón bắt đầu ở vùng nền đổi góc nhìn.
 *   - Chuột/bút: theo chế độ đang chọn (event.mode = 'layer1' | 'layer2' | 'view').
 * Sự kiện vào: { id, x, y, t, kind: 'touch' | 'mouse', primary, facelet (số ô hoặc null), mode }.
 * handler: canTurn(), pick(facelet, dx, dy, layers) → { tx, ty, tokens: [chiều dương, chiều âm], spec } | { error } | null,
 *   preview(spec | null), orbitStart(), orbit(dx, dy), orbitCancel(), orbitEnd(), commit(token), tap(facelet),
 *   hint(text), status({ phase, text }).
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    groupMs: 150, // khoảng ghép các ngón đặt gần như cùng lúc
    lockPx: 14, // độ dịch chuyển tối thiểu để xác nhận hướng/chiều
    tapPx: 8, // dưới mức này là chạm để chọn mặt
    maxFingers: 3,
    sameDirection: 0.6, // cos góc tối thiểu giữa hai ngón khi xoay hai lớp
    minShare: 0.35, // ngón kéo ít nhất phải đi được tỉ lệ này so với ngón kia
  };
  const has = (value) => value !== null && value !== undefined;

  class PlayGesture {
    constructor(handler, options = {}) {
      this.h = handler;
      this.o = { ...DEFAULTS, ...options };
      this.pointers = new Map();
      this.note = '';
      this.clear();
    }

    clear() {
      this.phase = 'idle';
      this.kind = null;
      this.mode = null;
      this.type = null;
      this.anchor = null;
      this.sel = null;
      this.count = 0;
      this.peak = 0;
      this.lastDown = 0;
      this.order = 0;
    }

    get active() { return this.phase !== 'idle'; }

    // Độ dịch chuyển trung bình của các ngón tính từ mốc đo.
    displacement() {
      let dx = 0, dy = 0;
      for (const p of this.pointers.values()) { dx += p.x - p.sx; dy += p.y - p.sy; }
      const n = this.pointers.size || 1;
      dx /= n; dy /= n;
      return { dx, dy, d: Math.hypot(dx, dy) };
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
      this.status();
      return true;
    }

    move(e) {
      const p = this.pointers.get(e.id);
      if (!p) return;
      p.x = e.x; p.y = e.y;
      if (this.phase === 'collect') {
        const settled = this.kind !== 'touch' || e.t - this.lastDown >= this.o.groupMs;
        if (settled && this.displacement().d >= this.o.lockPx) this.lock();
      } else if (this.phase === 'locked') {
        this.track();
      }
    }

    up(e) {
      const p = this.pointers.get(e.id);
      if (!p) return;
      p.x = e.x; p.y = e.y;
      if (this.phase === 'collect') {
        if (this.peak === 1 && Math.hypot(p.x - p.sx, p.y - p.sy) < this.o.tapPx) {
          if (has(p.facelet)) this.h.tap(p.facelet);
        } else if (this.displacement().d >= this.o.lockPx) {
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
      this.status();
    }

    lock() {
      const count = this.pointers.size;
      let type = this.kind === 'touch' ? ['', 'layer1', 'layer2', 'view'][count] : this.mode || 'layer1';
      const anchor = [...this.pointers.values()].sort((a, b) => a.order - b.order).find((p) => has(p.facelet)) || null;
      if (type !== 'view') {
        if (!anchor) {
          if (count === 1) type = 'view';
          else return this.reject('Đặt ít nhất một ngón lên khối làm mốc để xoay hai lớp.', 'Cần một ngón trên khối');
        } else if (!this.h.canTurn()) {
          return this.reject('Chờ nước xoay hoặc công thức hiện tại chạy xong.', 'Đang bận');
        }
      }
      this.type = type;
      this.anchor = anchor;
      this.count = count;
      this.phase = 'locked';
      if (type === 'view') this.h.orbitStart();
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

    track() {
      const { dx, dy } = this.displacement();
      if (this.type === 'view') {
        this.h.orbit(dx, dy);
      } else if (!this.sel) {
        const result = this.h.pick(this.anchor.facelet, dx, dy, this.layers());
        if (result && result.error) return this.reject(result.error, 'Mốc ở lớp giữa');
        if (result) {
          this.sel = result;
          this.h.preview(result.spec);
        }
      }
      this.status();
    }

    // Chiều xoay theo vị trí hiện tại so với điểm đầu: +1, -1 hoặc 0 khi chưa đủ xa.
    direction(dx, dy) {
      if (!this.sel) return 0;
      const along = dx * this.sel.tx + dy * this.sel.ty;
      return Math.abs(along) < this.o.lockPx ? 0 : Math.sign(along);
    }

    finish() {
      const { dx, dy } = this.displacement();
      if (this.type === 'view') {
        this.h.orbitEnd();
        this.note = '';
        return;
      }
      if (!this.sel) {
        const result = this.h.pick(this.anchor.facelet, dx, dy, this.layers());
        if (!result || result.error) {
          this.reject(result ? result.error : 'Hướng vuốt chưa rõ. Vuốt dọc theo một hàng hoặc một cột.', 'Hướng chưa rõ');
          return;
        }
        this.sel = result;
      }
      if (this.kind === 'touch' && this.count === 2) {
        const [a, b] = [...this.pointers.values()].map((p) => [p.x - p.sx, p.y - p.sy]);
        const la = Math.hypot(...a), lb = Math.hypot(...b);
        const cos = la && lb ? (a[0] * b[0] + a[1] * b[1]) / (la * lb) : -1;
        if (Math.min(la, lb) < this.o.minShare * Math.max(la, lb) || cos < this.o.sameDirection) {
          this.reject('Kéo hai ngón cùng một hướng để xoay hai lớp.', 'Hai ngón lệch hướng');
          return;
        }
      }
      const sign = this.direction(dx, dy);
      const token = sign > 0 ? this.sel.tokens[0] : this.sel.tokens[1];
      this.h.preview(null);
      this.sel = null;
      if (!sign) {
        this.note = 'Đã bỏ lượt';
        return;
      }
      this.note = '';
      this.h.commit(token);
    }

    abortActive() {
      if (this.phase === 'locked' && this.type === 'view') this.h.orbitCancel();
      this.h.preview(null);
      this.sel = null;
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
        } else if (this.sel) {
          const { dx, dy } = this.displacement();
          const sign = this.direction(dx, dy);
          text = `${who} · ${sign ? this.sel.tokens[sign > 0 ? 0 : 1] : 'kéo thêm để xoay'}`;
        } else {
          text = `${who} · chọn hướng…`;
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
