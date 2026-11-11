/* Điều khiển Rubik tự chơi; mỗi nước được chốt sau khi hoạt ảnh kết thúc. */
(function () {
  'use strict';
  const { cube: C, Cube3D, PlayState, vision: V } = window.Rubik;
  const $ = (selector) => document.querySelector(selector);
  const KEY = 'rubik-play-v1';
  const palette = { U: 1, R: 3, F: 5, D: 0, L: 2, B: 4 };
  const names = { U: 'Trên', R: 'Phải', F: 'Trước', D: 'Dưới', L: 'Trái', B: 'Sau' };
  const hex = (face) => V.PALETTE[palette[face]].hex;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (error) { /* Không đọc được dữ liệu cũ. */ }
  const model = new PlayState(saved);
  let active = false, running = false, run = 0;
  let selected = 'F';
  let notice = '';
  const view = new Cube3D($('#play-cube'), {
    size: 48,
    turnMode: () => $('#play-turn-mode').checked,
    canTurn: () => active && !view.animating && !running,
    onSelect: (face) => { selected = face; render(); },
    onTurn: (move) => { void manual(C.moveToString(move)); },
    onHint: (hint) => { notice = hint; render(); },
  });
  const busy = () => view.animating || running;
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(model.snapshot())); }
    catch (error) { $('#play-storage-note').textContent = 'Trình duyệt không cho lưu; khối đang chơi chỉ giữ trong lần mở này.'; }
  };

  for (const face of ['U', 'D', 'F', 'B', 'R', 'L']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.playFace = face;
    const chip = document.createElement('span');
    chip.className = 'color-chip';
    chip.style.background = hex(face);
    button.append(chip, `${face} · ${names[face]}`);
    button.addEventListener('click', () => { selected = face; notice = ''; render(); });
    $('#play-faces').appendChild(button);
  }

  function render() {
    if (!view.animating) view.setColors(model.colors.map(hex));
    view.setHighlight(view.animating ? null : selected);
    $('#play-faces').querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.playFace === selected));
    });
    $('#play-face-name').textContent = `Mặt ${names[selected].toLowerCase()} (${selected}) · tâm ${V.PALETTE[palette[selected]].name.toLowerCase()}`;
    $('#play-status').textContent = running ? 'Đang chạy công thức…' : notice || (model.solved
      ? '✓ Khối đã giải hoàn chỉnh. Tráo khối để bắt đầu thử sức!'
      : `Nước vừa đi: ${model.past.at(-1) || '—'} · Tiếp tục xoay để đưa sáu mặt về cùng màu.`);
    for (const id of ['clockwise', 'counterclockwise', 'half', 'scramble', 'reset', 'run']) $('#play-' + id).disabled = busy();
    $('#play-undo').disabled = busy() || !model.past.length;
    $('#play-redo').disabled = busy() || !model.future.length;
    $('#play-stop').disabled = !running;
    $('#play-sequence').disabled = busy();
    const history = $('#play-history');
    history.replaceChildren();
    if (!model.past.length) {
      const empty = document.createElement('li');
      empty.className = 'muted small';
      empty.textContent = 'Chưa có nước xoay.';
      history.appendChild(empty);
    }
    model.past.slice(-30).forEach((token, index, items) => {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = token;
      if (index === items.length - 1) item.className = 'current';
      item.appendChild(code);
      history.appendChild(item);
    });
  }

  async function perform(action, token) {
    if (!active || view.animating) return;
    if (action === 'undo') token = model.past.at(-1);
    if (action === 'redo') token = model.future.at(-1);
    if (!token) return;
    const move = action === 'undo' ? C.inverseMove(C.parseMove(token)) : C.parseMove(token);
    selected = move.face;
    notice = '';
    $('#play-error').textContent = '';
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 240;
    const pending = view.animateMove(move, duration, () => {
      if (action === 'move') model.move(token);
      else model[action]();
      save();
      view.setColors(model.colors.map(hex));
    });
    render();
    await pending;
    render();
  }

  async function manual(token, action = 'move') {
    if (busy()) return;
    await perform(action, token);
  }

  function stop() {
    running = false;
    run++;
    render();
  }

  $('#play-clockwise').addEventListener('click', () => { void manual(selected); });
  $('#play-counterclockwise').addEventListener('click', () => { void manual(selected + "'"); });
  $('#play-half').addEventListener('click', () => { void manual(selected + '2'); });
  $('#play-undo').addEventListener('click', () => { void manual(null, 'undo'); });
  $('#play-redo').addEventListener('click', () => { void manual(null, 'redo'); });
  $('#play-view').addEventListener('click', () => view.resetView());
  $('#play-stop').addEventListener('click', stop);
  $('#play-scramble').addEventListener('click', () => {
    if (busy()) return;
    const moves = C.randomScramble(20);
    moves.forEach((move) => model.move(C.moveToString(move)));
    notice = 'Đã tráo 20 nước. Hãy thử tự giải hoặc chuyển sang Học chơi để ôn lại cách làm.';
    $('#play-error').textContent = '';
    save();
    render();
  });
  $('#play-reset').addEventListener('click', () => {
    if (busy()) return;
    model.reset();
    notice = '';
    $('#play-error').textContent = '';
    save();
    render();
  });
  $('#play-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy() || !active) return;
    let moves;
    try {
      moves = C.parseMoves($('#play-sequence').value.replace(/[’′]/g, "'"));
      if (!moves.length || moves.length > 100) throw new Error('Độ dài không hợp lệ');
    } catch (error) {
      $('#play-error').textContent = 'Nhập 1–100 nước, ngăn bằng dấu cách. Chỉ dùng R, L, U, D, F, B với dấu phẩy hoặc số 2, ví dụ R U R’ U’.';
      return;
    }
    running = true;
    const token = ++run;
    render();
    for (const move of moves) {
      if (!active || !running || token !== run) break;
      await perform('move', C.moveToString(move));
      if (active && running && token === run) await new Promise((resolve) => setTimeout(resolve, 70));
    }
    if (token !== run) return;
    running = false;
    render();
  });
  document.addEventListener('keydown', (event) => {
    if (!active || event.defaultPrevented || event.repeat ||
        event.target.closest('input, textarea, select, .tabs, [contenteditable]')) return;
    const key = event.key.toUpperCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'Z' || key === 'Y') {
        event.preventDefault();
        void manual(null, key === 'Y' || event.shiftKey ? 'redo' : 'undo');
      }
      return;
    }
    if (event.altKey) return;
    if (C.FACES.includes(key)) {
      event.preventDefault();
      void manual(key + (event.shiftKey ? "'" : ''));
    } else if (key === '2') {
      event.preventDefault();
      void manual(selected + '2');
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.Rubik.play = { setActive(value) { active = value; if (!value) stop(); else render(); } };
  render();
})();
