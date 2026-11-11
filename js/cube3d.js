/*
 * Hiển thị khối Rubik 3D bằng CSS 3D transform, có animation cho từng bước xoay.
 * Kéo chuột / vuốt để xoay góc nhìn. Khi có options.onTurn (Chơi tự do), dùng Rubik.PlayGesture để nhận 1/2/3 ngón.
 * Lớp được mô tả chung bằng { axis, layers }: axis 0 = x (R), 1 = y (U), 2 = z (F); layers là toạ độ -1/0/1.
 * Mỗi ô màu (.sticker) chính là mặt ngoài của viên, không lồng phần tử con. Trên iPhone, sau hoạt ảnh có lúc vài ô hiện
 * nền tối của mặt viên (ô bị đen) cho tới khi đổi góc nhìn; bớt một tầng phần tử và refresh() nhằm tránh lỗi vẽ đó.
 */
(function (root) {
  'use strict';

  const C = root.Rubik.cube;

  const FACE_CLASS = { U: 'up', D: 'down', F: 'front', B: 'back', R: 'right', L: 'left' };
  const NORMAL_TO_FACE = {};
  Object.entries(C.NORMALS).forEach(([f, n]) => { NORMAL_TO_FACE[n.join(',')] = f; });

  const DEFAULT_VIEW = { rx: -26, ry: -36 };

  class Cube3D {
    constructor(container, options = {}) {
      this.container = container;
      this.options = options;
      this.size = options.size || 56;
      this.view = { ...DEFAULT_VIEW };
      this.scale = 1;
      this.animating = false;
      this.build();
      if (options.onTurn) this.enableGestures();
      else this.enableDrag();
    }

    build() {
      const S = this.size;
      this.container.innerHTML = '';
      this.container.classList.add('cube3d-scene');
      this.root = document.createElement('div');
      this.root.className = 'cube3d';
      this.container.appendChild(this.root);

      this.cubies = new Map();
      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            const el = document.createElement('div');
            el.className = 'cubie';
            el.style.width = el.style.height = S + 'px';
            el.style.left = el.style.top = -S / 2 + 'px';
            const faces = {};
            Object.entries(FACE_CLASS).forEach(([f, cls]) => {
              const fe = document.createElement('div');
              fe.className = 'cubie-face ' + cls;
              fe.style.transform = this.faceTransform(cls);
              el.appendChild(fe);
              faces[f] = fe;
            });
            const pos = [x, y, z];
            el.style.transform = this.translate(pos);
            this.root.appendChild(el);
            this.cubies.set(pos.join(','), { el, pos, faces });
          }
        }
      }

      this.stickers = C.FACELETS.map((f, index) => {
        const st = this.cubies.get(f.pos.join(',')).faces[NORMAL_TO_FACE[f.normal.join(',')]];
        st.classList.add('sticker');
        if (this.options.onTurn) st.dataset.facelet = String(index);
        return st;
      });
      this.applyView();
    }

    faceTransform(cls) {
      const h = this.size / 2;
      switch (cls) {
        case 'front': return `translateZ(${h}px)`;
        case 'back': return `rotateY(180deg) translateZ(${h}px)`;
        case 'right': return `rotateY(90deg) translateZ(${h}px)`;
        case 'left': return `rotateY(-90deg) translateZ(${h}px)`;
        case 'up': return `rotateX(90deg) translateZ(${h}px)`;
        case 'down': return `rotateX(-90deg) translateZ(${h}px)`;
        default: return '';
      }
    }

    // Toạ độ toán học (y hướng lên) -> CSS (y hướng xuống).
    translate([x, y, z]) {
      const S = this.size;
      return `translate3d(${x * S}px, ${-y * S}px, ${z * S}px)`;
    }

    // colors: mảng 54 mã màu CSS.
    setColors(colors) {
      colors.forEach((c, i) => { this.stickers[i].style.background = c; });
    }

    // Mặt 'U'...'B' (cách gọi cũ) hoặc mô tả { axis, layers } -> mô tả chung; null nếu không có.
    static layerSpec(target) {
      if (!target) return null;
      if (typeof target === 'string') {
        const n = C.NORMALS[target];
        if (!n) return null;
        const axis = n.findIndex((v) => v !== 0);
        return { axis, layers: [n[axis]] };
      }
      return target;
    }

    // target: mặt, một mô tả { axis, layers } hoặc mảng mô tả (hai lớp của cử chỉ hai ngón); null để bỏ tô.
    markLayers(className, target) {
      const specs = (Array.isArray(target) ? target : [target]).map(Cube3D.layerSpec).filter(Boolean);
      this.cubies.forEach((c) => {
        c.el.classList.toggle(className, specs.some((spec) => spec.layers.includes(c.pos[spec.axis])));
      });
      return specs.length > 0;
    }

    setHighlight(target) { this.markLayers('active-layer', target); }

    // Tô sáng lớp đang được kéo; ẩn tô sáng lớp đang chọn để không nhầm lớp.
    setPreview(target) {
      this.previewing = this.markLayers('preview-layer', target);
      this.syncGesturing();
    }

    // Tô sáng các viên đang có ngón đặt lên nhưng chưa rõ kéo hàng hay cột (facelets: mảng số ô).
    setTouched(facelets) {
      const keys = new Set((facelets || []).map((index) => C.FACELETS[index] && C.FACELETS[index].pos.join(',')));
      this.cubies.forEach((c, key) => c.el.classList.toggle('touch-cubie', keys.has(key)));
      this.touching = keys.size > 0;
      this.syncGesturing();
    }

    syncGesturing() { this.container.classList.toggle('gesturing', !!(this.previewing || this.touching)); }

    applyView(nudge = 0) {
      this.root.style.transform = `scale3d(${this.scale}, ${this.scale}, ${this.scale}) rotateX(${this.view.rx + nudge}deg) rotateY(${this.view.ry}deg)`;
    }

    /*
     * Buộc trình duyệt dựng lại toàn khối sau một lượt xoay: lệch góc nhìn một lượng không thấy được trong một khung
     * hình rồi trả về. Trên iPhone, vài ô có thể bị vẽ đen sau hoạt ảnh cho tới khi đổi góc nhìn; bước này làm thay
     * thao tác đó. Vô hại với trình duyệt khác nên áp dụng chung.
     */
    refresh() {
      if (typeof requestAnimationFrame !== 'function') return;
      requestAnimationFrame(() => {
        this.applyView(0.01);
        requestAnimationFrame(() => this.applyView());
      });
    }

    // Co giãn khối theo vùng chứa (sân chơi toàn màn hình), chừa khoảng trống quanh khối để đặt thêm ngón.
    // reserveY: phần chiều cao dành cho chữ hiển thị chồng lên vùng chứa.
    fit(fraction = 0.56, reserveY = 0) {
      const rect = this.container.getBoundingClientRect();
      const room = Math.min(rect.width, rect.height - reserveY);
      if (!room) return;
      const scale = Math.max(0.7, Math.min(2.2, (room * fraction) / (this.size * 4.3)));
      if (Math.abs(scale - this.scale) < 0.005) return;
      this.scale = scale;
      this.applyView();
    }

    resetView() {
      this.view = { ...DEFAULT_VIEW };
      this.applyView();
    }

    enableDrag() {
      let start = null;
      const el = this.container;
      el.addEventListener('pointerdown', (e) => {
        start = { x: e.clientX, y: e.clientY, rx: this.view.rx, ry: this.view.ry };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!start) return;
        this.view.ry = start.ry + (e.clientX - start.x) * 0.5;
        this.view.rx = Math.max(-89, Math.min(89, start.rx - (e.clientY - start.y) * 0.5));
        this.applyView();
      });
      const end = () => { start = null; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }

    // Chiếu điểm của mô hình sang hướng màn hình, cùng thứ tự rotateX * rotateY của CSS.
    projectPoint([x, y, z]) {
      const rx = this.view.rx * Math.PI / 180, ry = this.view.ry * Math.PI / 180;
      const size = this.size * (this.scale || 1);
      const px = (x * Math.cos(ry) + z * Math.sin(ry)) * size;
      const pz = (-x * Math.sin(ry) + z * Math.cos(ry)) * size;
      const py = -y * size;
      const screenY = py * Math.cos(rx) - pz * Math.sin(rx);
      const depth = py * Math.sin(rx) + pz * Math.cos(rx);
      const perspective = 1100 / (1100 - depth);
      return [px * perspective, screenY * perspective];
    }

    /*
     * Chọn lớp theo ô bắt đầu và hướng kéo trên màn hình. Lớp chứa ô đó và vuông góc với mặt của ô; layers = 2 lấy
     * thêm lớp giữa kề lớp ngoài. Trả về { axis, layer, tx, ty, tokens: [chiều dương, chiều âm], spec },
     * { error } khi xoay hai lớp từ hàng/cột giữa, hoặc null khi hướng chưa rõ. (tx, ty) là hướng màn hình của chiều dương.
     */
    pickLayer(index, dx, dy, layers = 1) {
      const facelet = C.FACELETS[index];
      const length = Math.hypot(dx, dy);
      const M = root.Rubik.playMoves;
      if (!facelet || !length || !M) return null;
      const point = facelet.pos.map((value, axis) => value + 0.5 * facelet.normal[axis]);
      const from = this.projectPoint(point);
      const own = facelet.normal.findIndex((value) => value !== 0);
      let best = null, alignment = 0, runnerUp = 0;
      const n = facelet.normal;
      for (let axis = 0; axis < 3; axis++) {
        if (axis === own) continue;
        // Hướng ô di chuyển trên mặt của nó khi lớp xoay theo chiều kim đồng hồ nhìn từ mặt R/U/F của trục: -(trục × pháp tuyến).
        // Chỉ lấy phần nằm trong mặt (bỏ phần nhô ra khỏi mặt ở ô sát mép), đúng với cách người dùng vuốt dọc mặt khối.
        const a = [0, 0, 0];
        a[axis] = 1;
        const along = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
        const to = this.projectPoint(point.map((value, i) => value - 0.05 * along[i]));
        const tx = to[0] - from[0], ty = to[1] - from[1], tl = Math.hypot(tx, ty);
        if (!tl) continue;
        const similarity = Math.abs((dx * tx + dy * ty) / (length * tl));
        if (similarity > alignment) {
          runnerUp = alignment;
          alignment = similarity;
          best = { axis, tx: tx / tl, ty: ty / tl };
        } else {
          runnerUp = Math.max(runnerUp, similarity);
        }
      }
      // Cần khớp rõ với một trục; hướng chéo gần đều hai trục là mơ hồ: chưa chọn, chờ kéo rõ hơn.
      if (!best || alignment <= 0.65 || alignment - runnerUp < 0.1) return null;
      const layer = facelet.pos[best.axis];
      const wide = layers === 2;
      if (wide && layer === 0) {
        return { error: 'Ngón mốc đang ở hàng/cột giữa. Đặt ngón mốc lên hàng hoặc cột ngoài để xoay hai lớp.' };
      }
      return { ...best, layer,
        tokens: [M.fromLayer(best.axis, layer, 1, wide), M.fromLayer(best.axis, layer, -1, wide)],
        spec: { axis: best.axis, layers: wide ? [layer, 0] : [layer] } };
    }

    // Ký hiệu nước xoay cho một lần kéo (dùng trong kiểm thử); null khi quá ngắn/hướng chưa rõ.
    moveForDrag(index, dx, dy, layers = 1) {
      if (Math.hypot(dx, dy) < 14) return null;
      const pick = this.pickLayer(index, dx, dy, layers);
      if (!pick || pick.error) return pick;
      return pick.tokens[dx * pick.tx + dy * pick.ty > 0 ? 0 : 1];
    }

    orbitTo(from, dx, dy) {
      this.view.ry = from.ry + dx * 0.5;
      this.view.rx = Math.max(-89, Math.min(89, from.rx - dy * 0.5));
      this.applyView();
    }

    enableGestures() {
      const o = this.options;
      const el = this.container;
      let orbitFrom = null;
      this.gesture = new root.Rubik.PlayGesture({
        canTurn: () => o.canTurn(),
        pick: (index, dx, dy, layers) => this.pickLayer(index, dx, dy, layers),
        preview: (spec) => this.setPreview(spec),
        orbitStart: () => { orbitFrom = { ...this.view }; },
        orbit: (dx, dy) => { if (orbitFrom) this.orbitTo(orbitFrom, dx, dy); },
        orbitCancel: () => {
          if (orbitFrom) { this.view = { ...orbitFrom }; this.applyView(); }
          orbitFrom = null;
        },
        orbitEnd: () => { orbitFrom = null; },
        touch: (facelets) => this.setTouched(facelets),
        commit: (tokens) => o.onTurn(tokens),
        tap: (index) => o.onSelect(C.FACELETS[index].face),
        hint: (text) => o.onHint(text),
        status: (info) => { if (o.onGesture) o.onGesture(info); },
      }, o.gesture || {});
      const point = (event) => ({ id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp,
        kind: event.pointerType === 'touch' ? 'touch' : 'mouse', primary: event.isPrimary });
      el.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch' && event.button !== 0) return;
        const sticker = event.target.closest('[data-facelet]');
        const accepted = this.gesture.down({ ...point(event), facelet: sticker ? Number(sticker.dataset.facelet) : null,
          mode: o.dragMode ? o.dragMode() : null });
        if (accepted) {
          // Giữ quyền nhận sự kiện của từng ngón khi ngón trượt ra ngoài khối.
          try { el.setPointerCapture(event.pointerId); } catch (error) { /* con trỏ đã nhấc */ }
        }
        event.preventDefault();
      });
      el.addEventListener('pointermove', (event) => this.gesture.move(point(event)));
      el.addEventListener('pointerup', (event) => this.gesture.up(point(event)));
      el.addEventListener('pointercancel', (event) => this.gesture.cancel(event.pointerId));
      el.addEventListener('lostpointercapture', (event) => this.gesture.cancel(event.pointerId));
    }

    cancelGesture(note) { if (this.gesture) this.gesture.abort(note); }

    // Mô tả chung { axis, layers, dir, power } của một nước: chuỗi 'R2', { face, power } hoặc mô tả sẵn.
    static turnSpec(move) {
      if (typeof move === 'string') move = C.parseMove(move);
      if (move.axis !== undefined) return move;
      const n = C.NORMALS[move.face];
      const axis = n.findIndex((v) => v !== 0);
      return { axis, layers: [n[axis]], dir: n[axis], power: move.power };
    }

    /*
     * Animation một bước xoay. Sau khi xong, gọi onDone để cập nhật màu mới
     * (cùng một khung hình để tránh nhấp nháy).
     * move: { face, power } (Học chơi/Hướng dẫn giải), { axis, layers, dir, power } (Chơi tự do, Rubik.playMoves.describe)
     * hoặc mảng các mô tả đó: các lớp không chung viên, chuyển động cùng lúc, mỗi lớp theo trục và chiều của nó.
     */
    animateMove(move, duration, onDone) {
      const specs = (Array.isArray(move) ? move : [move]).map(Cube3D.turnSpec);
      const used = new Set();
      const groups = specs.map((spec) => {
        const n = [0, 0, 0];
        n[spec.axis] = spec.dir;
        const cubies = [];
        this.cubies.forEach((c) => {
          if (!spec.layers.includes(c.pos[spec.axis])) return;
          if (used.has(c)) throw new Error('Các lớp chuyển động cùng lúc không được chung viên');
          used.add(c);
          cubies.push(c);
        });
        return { cubies, axis: `${n[0]}, ${-n[1]}, ${n[2]}`, angle: spec.power === 3 ? -90 : 90 * spec.power };
      });
      this.animating = true;
      return new Promise((resolve) => {
        const t0 = performance.now();
        const total = duration * (specs.some((spec) => spec.power === 2) ? 1.5 : 1);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / total);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          if (t < 1) {
            groups.forEach((g) => g.cubies.forEach((c) => {
              c.el.style.transform = `rotate3d(${g.axis}, ${g.angle * e}deg) ${this.translate(c.pos)}`;
            }));
            requestAnimationFrame(step);
            return;
          }
          groups.forEach((g) => g.cubies.forEach((c) => { c.el.style.transform = this.translate(c.pos); }));
          if (onDone) onDone();
          this.animating = false;
          this.refresh();
          resolve();
        };
        requestAnimationFrame(step);
      });
    }
  }

  root.Rubik = root.Rubik || {};
  root.Rubik.Cube3D = Cube3D;
})(typeof globalThis !== 'undefined' ? globalThis : this);
