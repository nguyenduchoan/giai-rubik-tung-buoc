/*
 * Hiển thị khối Rubik 3D bằng CSS 3D transform, có animation cho từng bước xoay.
 * Kéo chuột / vuốt để xoay góc nhìn.
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
      this.animating = false;
      this.build();
      if (options.onTurn) this.enableLayerDrag();
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
        const cubie = this.cubies.get(f.pos.join(','));
        const st = document.createElement('div');
        st.className = 'sticker';
        if (this.options.onTurn) st.dataset.facelet = String(index);
        cubie.faces[NORMAL_TO_FACE[f.normal.join(',')]].appendChild(st);
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

    setHighlight(face) {
      this.cubies.forEach((c) => {
        const on = face && C.NORMALS[face].reduce((a, v, i) => a + v * c.pos[i], 0) === 1;
        c.el.classList.toggle('active-layer', !!on);
      });
    }

    applyView() {
      this.root.style.transform = `rotateX(${this.view.rx}deg) rotateY(${this.view.ry}deg)`;
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
      const px = (x * Math.cos(ry) + z * Math.sin(ry)) * this.size;
      const pz = (-x * Math.sin(ry) + z * Math.cos(ry)) * this.size;
      const py = -y * this.size;
      const screenY = py * Math.cos(rx) - pz * Math.sin(rx);
      const depth = py * Math.sin(rx) + pz * Math.cos(rx);
      const perspective = 1100 / (1100 - depth);
      return [px * perspective, screenY * perspective];
    }

    moveForDrag(index, dx, dy) {
      const facelet = C.FACELETS[index];
      if (!facelet || Math.hypot(dx, dy) < 18) return null;
      const point = facelet.pos.map((value, axis) => value + 0.5 * facelet.normal[axis]);
      const from = this.projectPoint(point);
      let best = null, alignment = 0.65;
      for (const face of C.FACES) {
        if (face === facelet.face) continue;
        const normal = C.NORMALS[face];
        const dot = normal.reduce((sum, value, axis) => sum + value * facelet.pos[axis], 0);
        if (dot !== 1) continue;
        const cross = [normal[1] * point[2] - normal[2] * point[1],
          normal[2] * point[0] - normal[0] * point[2], normal[0] * point[1] - normal[1] * point[0]];
        const angle = 0.02;
        const along = normal.reduce((sum, value, axis) => sum + value * point[axis], 0);
        const rotated = point.map((value, axis) => value * Math.cos(angle) - cross[axis] * Math.sin(angle) +
          normal[axis] * along * (1 - Math.cos(angle)));
        const to = this.projectPoint(rotated);
        const tx = to[0] - from[0], ty = to[1] - from[1];
        const similarity = (dx * tx + dy * ty) / (Math.hypot(dx, dy) * Math.hypot(tx, ty));
        if (Math.abs(similarity) > alignment) {
          alignment = Math.abs(similarity);
          best = { face, power: similarity > 0 ? 1 : 3 };
        }
      }
      return best;
    }

    enableLayerDrag() {
      const el = this.container;
      let gesture = null;
      el.addEventListener('pointerdown', (event) => {
        if (event.isPrimary === false || event.button !== 0 || gesture) return;
        const sticker = event.target.closest('[data-facelet]');
        const index = sticker ? Number(sticker.dataset.facelet) : null;
        const center = index !== null && index % 9 === 4;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
          rx: this.view.rx, ry: this.view.ry, index,
          turn: index !== null && !center && this.options.turnMode() && this.options.canTurn() };
        el.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      el.addEventListener('pointermove', (event) => {
        if (!gesture || gesture.id !== event.pointerId || gesture.turn) return;
        this.view.ry = gesture.ry + (event.clientX - gesture.x) * 0.5;
        this.view.rx = Math.max(-89, Math.min(89, gesture.rx - (event.clientY - gesture.y) * 0.5));
        this.applyView();
      });
      el.addEventListener('pointerup', (event) => {
        if (!gesture || gesture.id !== event.pointerId) return;
        const current = gesture;
        gesture = null;
        const dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (Math.hypot(dx, dy) < 8 && current.index !== null) {
          this.options.onSelect(C.FACELETS[current.index].face);
        } else if (current.turn && this.options.canTurn()) {
          const move = this.moveForDrag(current.index, dx, dy);
          if (move) this.options.onTurn(move);
          else this.options.onHint('Vuốt dọc hàng hoặc cột ngoài để xoay lớp. Bạn cũng có thể chọn mặt rồi dùng các nút xoay.');
        }
      });
      const cancel = (event) => { if (gesture && gesture.id === event.pointerId) gesture = null; };
      el.addEventListener('pointercancel', cancel);
      el.addEventListener('lostpointercapture', cancel);
    }

    /*
     * Animation một bước xoay. Sau khi xong, gọi onDone để cập nhật màu mới
     * (cùng một khung hình để tránh nhấp nháy).
     */
    animateMove(move, duration, onDone) {
      if (typeof move === 'string') move = C.parseMove(move);
      const n = C.NORMALS[move.face];
      const finalAngle = move.power === 3 ? -90 : 90 * move.power;
      const layer = [];
      this.cubies.forEach((c) => {
        if (n[0] * c.pos[0] + n[1] * c.pos[1] + n[2] * c.pos[2] === 1) layer.push(c);
      });
      const axis = `${n[0]}, ${-n[1]}, ${n[2]}`;
      this.animating = true;
      return new Promise((resolve) => {
        const t0 = performance.now();
        const total = duration * (move.power === 2 ? 1.5 : 1);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / total);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          if (t < 1) {
            layer.forEach((c) => {
              c.el.style.transform = `rotate3d(${axis}, ${finalAngle * e}deg) ${this.translate(c.pos)}`;
            });
            requestAnimationFrame(step);
            return;
          }
          layer.forEach((c) => { c.el.style.transform = this.translate(c.pos); });
          if (onDone) onDone();
          this.animating = false;
          resolve();
        };
        requestAnimationFrame(step);
      });
    }
  }

  root.Rubik = root.Rubik || {};
  root.Rubik.Cube3D = Cube3D;
})(typeof globalThis !== 'undefined' ? globalThis : this);
