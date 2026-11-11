/*
 * Sân chơi Rubik tự chơi phủ màn hình: cử chỉ 1/2/3 ngón, nút, bàn phím và công thức; mỗi nước được chốt sau khi
 * hoạt ảnh kết thúc. Toàn màn hình chỉ được yêu cầu trong thao tác của người dùng; bị từ chối thì vẫn phủ kín trang.
 */
(function () {
  'use strict';
  const { cube: C, Cube3D, PlayState, playMoves: P, vision: V } = window.Rubik;
  const $ = (selector) => document.querySelector(selector);
  const KEY = 'rubik-play-v2';
  const LEGACY_KEY = 'rubik-play-v1';
  const palette = { U: 1, R: 3, F: 5, D: 0, L: 2, B: 4 };
  const hex = (color) => V.PALETTE[palette[color]].hex;
  const colorName = (color) => V.PALETTE[palette[color]].name.toLowerCase();
  const LAYERS = ['U', 'D', 'F', 'B', 'R', 'L', 'M', 'E', 'S'];
  const arena = $('#play-arena');
  const narrow = window.matchMedia('(max-width: 760px)');

  // Đọc bản lưu mới; chưa có hoặc hỏng thì đọc bản cũ (giữ nguyên bản cũ làm bản phục hồi) rồi chuyển sang bản mới.
  function load() {
    const read = (key) => {
      try { return JSON.parse(localStorage.getItem(key)); } catch (error) { return null; }
    };
    const current = new PlayState(read(KEY));
    if (current.restored) return { model: current, migrate: false };
    const legacy = new PlayState(read(LEGACY_KEY));
    return { model: legacy, migrate: legacy.restored };
  }
  const loaded = load();
  const model = loaded.model;

  let active = false, running = false, run = 0;
  let selected = 'F';
  let notice = '';
  let screenNote = '';
  let panelOpen = null; // null: chưa mở sân chơi lần nào, chọn theo chiều rộng màn hình
  let fullscreenBefore = false;
  let exitHandler = null;
  let pendingFocus = null; // phần tử nhận tiêu điểm sau khi thoát toàn màn hình (khi còn toàn màn hình, phần còn lại của trang bị khóa)

  const mode = () => (document.querySelector('input[name="play-mode"]:checked') || {}).value || 'layer1';
  const busy = () => view.animating || running;
  const view = new Cube3D($('#play-cube'), {
    size: 48,
    dragMode: mode,
    canTurn: () => active && !busy(),
    onSelect: (face) => { selected = face; notice = ''; render(); },
    onTurn: (token) => { void manual(token); },
    onHint: (hint) => { notice = hint; render(); },
    onGesture: (info) => {
      const chip = $('#play-gesture');
      if (chip.textContent !== info.text) chip.textContent = info.text;
    },
  });

  if (!navigator.maxTouchPoints) {
    $('.play-gesture-hint').textContent = 'Chuột: kéo theo chế độ 1 lớp / 2 lớp / Góc nhìn trong Điều khiển · kéo nền để nhìn quanh';
  }

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(model.snapshot())); }
    catch (error) { $('#play-storage-note').textContent = 'Trình duyệt không cho lưu; khối đang chơi chỉ giữ trong lần mở này.'; }
  };
  if (loaded.migrate) save();

  for (const layer of LAYERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.playFace = layer;
    const chip = document.createElement('span');
    chip.className = 'color-chip' + (P.SLICES.includes(layer) ? ' slice-chip' : '');
    const label = document.createElement('span');
    label.textContent = `${layer} · ${P.NAMES[layer]}`;
    button.append(chip, label);
    button.addEventListener('click', () => { selected = layer; notice = ''; render(); });
    $('#play-faces').appendChild(button);
  }

  // Nút xoay dùng chế độ 2 lớp cho mặt ngoài; lớp giữa không có kiểu hai lớp.
  const wide = () => mode() === 'layer2';
  const selectedBase = () => (wide() && C.FACES.includes(selected) ? selected + 'w' : selected);
  const buttonsCanTurn = () => !(wide() && P.SLICES.includes(selected));
  const centerOf = (face) => model.colors[C.FACES.indexOf(face) * 9 + 4];

  // ---------- Toàn màn hình ----------
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const fullscreenSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
    !!(arena.requestFullscreen || arena.webkitRequestFullscreen);
  const isFullscreen = () => fullscreenElement() === arena;

  function refused() {
    if (!active || isFullscreen()) return;
    screenNote = 'Trình duyệt chưa cho mở toàn màn hình; sân chơi đang phủ kín trang. Bấm ⛶ để thử lại.';
    render();
  }

  // Phải gọi trong chính sự kiện chạm/bấm của người dùng.
  function enterFullscreen() {
    if (!fullscreenSupported()) {
      screenNote = 'Trình duyệt này không hỗ trợ toàn màn hình cho trang web; sân chơi đang phủ kín trang.';
      render();
      return;
    }
    if (isFullscreen()) return;
    let result;
    try {
      result = arena.requestFullscreen ? arena.requestFullscreen({ navigationUI: 'hide' }) : arena.webkitRequestFullscreen();
    } catch (error) {
      refused();
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(() => { if (!active) exitFullscreen(); }, refused);
    }
  }

  function exitFullscreen() {
    if (!isFullscreen()) return;
    try {
      const result = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (error) { /* trình duyệt đã tự thoát */ }
  }

  function focusLater(element) {
    element.focus();
    if (!fullscreenElement()) return;
    pendingFocus = element;
    setTimeout(() => { if (pendingFocus === element && !fullscreenElement()) { pendingFocus = null; element.focus(); } }, 1000);
  }

  function onFullscreenChange() {
    const on = isFullscreen();
    if (!fullscreenElement() && pendingFocus) {
      const element = pendingFocus;
      pendingFocus = null;
      element.focus();
    }
    if (on && !active) { exitFullscreen(); return; }
    if (on) screenNote = '';
    else if (fullscreenBefore && active) screenNote = 'Đã thoát toàn màn hình; sân chơi vẫn phủ kín trang. Bấm ⛶ để mở lại.';
    fullscreenBefore = on;
    render();
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // Bàn phím ảo che phần dưới vùng hiển thị: chừa chỗ để cuộn ô nhập công thức lên trên.
  function syncViewport() {
    const vv = window.visualViewport;
    const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    arena.style.setProperty('--play-kb', Math.round(keyboard) + 'px');
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewport);

  // Đổi kích thước vùng chơi (xoay máy, mở bảng điều khiển, vào/thoát toàn màn hình): hủy cử chỉ dở và căn lại khối.
  let stageSize = '';
  const refit = () => {
    if (!active) return;
    const rect = $('#play-cube').getBoundingClientRect();
    const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (size === stageSize) return;
    if (stageSize) view.cancelGesture('Đã hủy vì kích thước màn hình thay đổi');
    stageSize = size;
    view.fit(0.56, 110);
  };
  if (window.ResizeObserver) new ResizeObserver(refit).observe($('#play-cube'));
  else window.addEventListener('resize', refit);

  function setInert(on) {
    document.querySelectorAll('.app-header, #update-banner').forEach((element) => element.toggleAttribute('inert', on));
  }

  function open(requestFullscreen) {
    document.documentElement.classList.add('play-open');
    setInert(true);
    if (panelOpen === null) panelOpen = !narrow.matches;
    screenNote = '';
    fullscreenBefore = isFullscreen();
    if (requestFullscreen) enterFullscreen();
    syncViewport();
    stageSize = '';
    refit();
    arena.focus({ preventScroll: true });
  }

  function close() {
    view.cancelGesture();
    exitFullscreen();
    document.documentElement.classList.remove('play-open');
    setInert(false);
    screenNote = '';
  }

  // ---------- Hiển thị ----------
  function render() {
    if (!view.animating) view.setColors(model.colors.map(hex));
    const base = selectedBase();
    view.setHighlight(view.animating ? null : P.describe(base));
    $('#play-faces').querySelectorAll('button').forEach((button) => {
      const layer = button.dataset.playFace;
      button.setAttribute('aria-pressed', String(layer === selected));
      if (C.FACES.includes(layer)) button.querySelector('.color-chip').style.background = hex(centerOf(layer));
    });
    const center = C.FACES.includes(selected) ? ` · tâm ${colorName(centerOf(selected))}` : '';
    $('#play-face-name').textContent = buttonsCanTurn()
      ? `Đang chọn ${base} · ${P.NAMES[base]}${center}`
      : 'Lớp giữa không có kiểu hai lớp. Chọn một mặt ngoài hoặc chế độ 1 lớp.';
    $('#play-clockwise').textContent = `↻ ${base}`;
    $('#play-counterclockwise').textContent = `↺ ${base}'`;
    $('#play-half').textContent = `${base}2`;
    $('#play-status').textContent = running ? 'Đang chạy công thức…' : notice || (model.solved
      ? '✓ Khối đã giải hoàn chỉnh. Tráo khối để bắt đầu thử sức!'
      : `Nước vừa đi: ${model.past.at(-1) || '—'} · Tiếp tục xoay để đưa sáu mặt về cùng màu.`);
    for (const id of ['clockwise', 'counterclockwise', 'half']) $('#play-' + id).disabled = busy() || !buttonsCanTurn();
    for (const id of ['scramble', 'reset', 'run']) $('#play-' + id).disabled = busy();
    $('#play-undo').disabled = busy() || !model.past.length;
    $('#play-redo').disabled = busy() || !model.future.length;
    $('#play-stop').disabled = !running;
    $('#play-sequence').disabled = busy();

    const full = isFullscreen();
    const fullscreenButton = $('#play-fullscreen');
    fullscreenButton.hidden = !fullscreenSupported();
    fullscreenButton.setAttribute('aria-pressed', String(full));
    fullscreenButton.setAttribute('aria-label', full ? 'Thoát toàn màn hình' : 'Toàn màn hình');
    fullscreenButton.querySelector('.play-label').textContent = full ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    $('#play-screen-note').textContent = screenNote;
    $('#play-panel').hidden = !panelOpen;
    $('#play-panel-toggle').setAttribute('aria-expanded', String(!!panelOpen));

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

  // ---------- Nước xoay ----------
  async function perform(action, token) {
    if (!active || view.animating) return;
    if (action === 'undo') token = model.past.at(-1);
    if (action === 'redo') token = model.future.at(-1);
    if (!token) return;
    const move = action === 'undo' ? P.inverse(token) : P.parse(token);
    selected = move.base.replace('w', '');
    notice = '';
    $('#play-error').textContent = '';
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 240;
    const pending = view.animateMove(P.describe(move), duration, () => {
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

  $('#play-clockwise').addEventListener('click', () => { void manual(selectedBase()); });
  $('#play-counterclockwise').addEventListener('click', () => { void manual(selectedBase() + "'"); });
  $('#play-half').addEventListener('click', () => { void manual(selectedBase() + '2'); });
  $('#play-undo').addEventListener('click', () => { void manual(null, 'undo'); });
  $('#play-redo').addEventListener('click', () => { void manual(null, 'redo'); });
  $('#play-view').addEventListener('click', () => view.resetView());
  $('#play-stop').addEventListener('click', stop);
  $('#play-back').addEventListener('click', () => {
    const target = exitHandler ? exitHandler() : (window.Rubik.play.setActive(false), null);
    if (target) focusLater(target);
  });
  $('#play-fullscreen').addEventListener('click', () => {
    if (isFullscreen()) exitFullscreen();
    else enterFullscreen();
  });
  const togglePanel = (open) => {
    panelOpen = open;
    render();
    if (open) $('#play-panel-close').focus({ preventScroll: true });
    else $('#play-panel-toggle').focus({ preventScroll: true });
  };
  $('#play-panel-toggle').addEventListener('click', () => togglePanel(!panelOpen));
  $('#play-panel-close').addEventListener('click', () => togglePanel(false));
  document.querySelectorAll('input[name="play-mode"]').forEach((input) => input.addEventListener('change', () => {
    notice = '';
    render();
  }));
  $('#play-sequence').addEventListener('focus', () => {
    setTimeout(() => {
      syncViewport();
      $('#play-sequence').scrollIntoView({ block: 'nearest' });
    }, 300);
  });

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
      moves = P.parseSequence($('#play-sequence').value);
      if (!moves.length || moves.length > 100) throw new Error('Độ dài không hợp lệ');
    } catch (error) {
      $('#play-error').textContent = 'Nhập 1–100 nước, ngăn bằng dấu cách. Dùng R, L, U, D, F, B; lớp giữa M, E, S; hai lớp Rw, Uw… hoặc r, u…; thêm dấu phẩy để xoay ngược hoặc số 2 để xoay nửa vòng, ví dụ R U R’ U’ M2.';
      return;
    }
    running = true;
    const token = ++run;
    render();
    for (const move of moves) {
      if (!active || !running || token !== run) break;
      await perform('move', P.toString(move));
      if (active && running && token === run) await new Promise((resolve) => setTimeout(resolve, 70));
    }
    if (token !== run) return;
    running = false;
    render();
  });
  document.addEventListener('keydown', (event) => {
    if (!active || event.defaultPrevented || event.repeat ||
        event.target.closest('input:not([type="radio"]):not([type="checkbox"]), textarea, select, .tabs, [contenteditable]')) return;
    const key = event.key.toUpperCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 'Z' || key === 'Y') {
        event.preventDefault();
        void manual(null, key === 'Y' || event.shiftKey ? 'redo' : 'undo');
      }
      return;
    }
    if (event.altKey) return;
    if (LAYERS.includes(key)) {
      event.preventDefault();
      void manual(key + (event.shiftKey ? "'" : ''));
    } else if (key === '2' && buttonsCanTurn()) {
      event.preventDefault();
      void manual(selectedBase() + '2');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    stop();
    view.cancelGesture('Đã hủy vì trang bị ẩn');
  });

  window.Rubik.play = {
    // requestFullscreen: chỉ truyền true khi được gọi trong thao tác chạm/bấm/phím của người dùng.
    setActive(value, { requestFullscreen = false } = {}) {
      if (value === active) return;
      active = value;
      if (value) {
        open(requestFullscreen);
        render();
      } else {
        stop();
        close();
      }
    },
    // Hàm chuyển về tab trước đó khi bấm Quay lại (app.js cung cấp); trả về phần tử cần nhận tiêu điểm.
    setExitHandler(handler) { exitHandler = handler; },
    get active() { return active; },
  };
  render();
})();
