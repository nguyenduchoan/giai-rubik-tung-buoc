(function () {
  'use strict';
  const { cube: C, playMoves: P, PlayState, RoomAttempt, Cube3D, vision: V } = window.Rubik;
  const $ = (selector) => document.querySelector(selector);
  const LAST = 'rubik-room-last', key = (code) => 'rubik-room-' + code;
  const apiBase = $('meta[name="rubik-api-base"]')?.content || 'api/';
  let active = false, room = null, player = null, attempt = null, view = null;
  let pending = null, saving = false, entering = false, refreshing = false, tick = null;
  let generation = 0, clockFrame = 0;
  const game = $('#room-game');
  let expanded = false;
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFullscreen = () => fullscreenElement() === game;
  const fullscreenSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
    !!(game.requestFullscreen || game.webkitRequestFullscreen);
  function exitFullscreen() {
    if (!isFullscreen()) return;
    try {
      const result = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
      if (result?.catch) result.catch(() => {});
    } catch (error) { /* Trình duyệt đã tự thoát. */ }
  }
  function enterFullscreen() {
    if (!fullscreenSupported() || isFullscreen()) return;
    try {
      const result = game.requestFullscreen ? game.requestFullscreen({ navigationUI: 'hide' }) : game.webkitRequestFullscreen();
      if (result?.then) result.then(() => { if (!expanded) exitFullscreen(); }, () => {});
    } catch (error) { /* Sân chơi vẫn phủ kín trang nếu trình duyệt từ chối. */ }
  }
  function updateFullscreenButton() {
    const button = $('#room-fullscreen');
    button.textContent = isFullscreen() ? '⛶ Thu nhỏ' : '⛶ Toàn màn hình';
    button.setAttribute('aria-pressed', String(isFullscreen()));
  }
  function openGame() {
    expanded = true;
    document.documentElement.classList.add('room-open');
    game.classList.add('room-expanded');
    $('#room-back').hidden = false;
    document.querySelectorAll('.app-header, #update-banner, .room-heading, .room-results').forEach((element) => element.inert = true);
    // Yêu cầu ngay trong thao tác bấm để trình duyệt cho phép mở toàn màn hình.
    enterFullscreen();
    fit();
    game.focus({ preventScroll: true });
  }
  function closeGame(focus = false) {
    if (!expanded) return;
    expanded = false;
    exitFullscreen();
    document.documentElement.classList.remove('room-open');
    game.classList.remove('room-expanded');
    $('#room-back').hidden = true;
    document.querySelectorAll('.app-header, #update-banner, .room-heading, .room-results').forEach((element) => {
      element.inert = !!window.Rubik.play?.active && element.matches('.app-header, #update-banner');
    });
    fit();
    if (focus) {
      const button = $('#room-fullscreen');
      button.focus({ preventScroll: true });
      // Phần còn lại của trang chỉ nhận tiêu điểm sau khi trình duyệt thoát toàn màn hình.
      if (isFullscreen()) game.addEventListener('fullscreenchange', () => button.focus({ preventScroll: true }), { once: true });
    }
  }
  const hex = (c) => V.PALETTE[PlayState.PALETTE[c]].hex;
  const formatTime = (ms) => {
    const cs = Math.floor(ms / 10);
    return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };
  const read = (name) => { try { return JSON.parse(localStorage.getItem(name)); } catch (error) { return null; } };
  function remember() {
    try {
      localStorage.setItem(key(room.code), JSON.stringify(player));
      localStorage.setItem(LAST, JSON.stringify(room.code));
    } catch (error) { $('#room-storage-note').textContent = 'Trình duyệt không cho lưu nhận diện. Giữ trang này mở để gửi kết quả.'; }
  }
  async function api(route, body) {
    let response;
    try {
      response = await fetch(new URL(apiBase + route, document.baseURI), {
        method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(12000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
    } catch (error) { throw new Error('Chưa kết nối được phòng. Kiểm tra mạng rồi thử lại.'); }
    let data;
    try { data = await response.json(); } catch (error) { throw new Error('Dịch vụ phòng chưa sẵn sàng. Vui lòng thử lại sau.'); }
    if (!response.ok) throw new Error(data.error || 'Không thực hiện được. Vui lòng thử lại.');
    return data;
  }
  const ownResult = () => room?.players.find((p) => p.playerId === player?.playerId)?.result;
  function receiveRoom(next) {
    if (next.code === room?.code) {
      for (const entry of next.players) entry.result ||= room.players.find((p) => p.playerId === entry.playerId)?.result || null;
    }
    room = next;
  }
  const canTurn = () => active && attempt && !attempt.result && !view.animating;
  const base = () => $('#room-layer').value + ($('#room-mode').value === 'layer2' && C.FACES.includes($('#room-layer').value) ? 'w' : '');
  const turnsAllowed = () => canTurn() && !($('#room-mode').value === 'layer2' && P.SLICES.includes($('#room-layer').value));

  for (const layer of ['U', 'D', 'F', 'B', 'R', 'L', 'M', 'E', 'S']) {
    const option = document.createElement('option');
    option.value = layer; option.textContent = layer + ' · ' + P.NAMES[layer];
    $('#room-layer').appendChild(option);
  }
  $('#room-layer').value = 'F';

  function paintStats() {
    const result = ownResult() || pending;
    $('#room-time').textContent = formatTime(result?.durationMs || attempt?.elapsed || 0);
    $('#room-moves').textContent = String(result?.moveCount || attempt?.moveCount || 0);
  }
  function clock() {
    cancelAnimationFrame(clockFrame);
    if (!active || !attempt || attempt.result || document.hidden) return;
    paintStats();
    clockFrame = requestAnimationFrame(clock);
  }
  function render() {
    paintStats();
    const saved = ownResult();
    $('#room-start').hidden = !!attempt || !!saved || !!pending;
    $('#room-retry').hidden = !pending || !!saved || saving;
    $('#room-status').textContent = saved ? '✓ Đã lưu kết quả của bạn.' : pending ?
      (saving ? 'Đã giải xong! Đang lưu kết quả…' : 'Đã giải xong. Kết quả chưa lưu, bấm Gửi lại.') :
      attempt ? (attempt.startedAt === null ? 'Xoay nước đầu tiên để bắt đầu tính giờ.' : 'Đang giải — tiếp tục xoay để đưa sáu mặt về cùng màu.') :
      'Bấm Bắt đầu. Đồng hồ chạy từ nước xoay đầu tiên.';
    for (const id of ['clockwise', 'counterclockwise', 'half']) $('#room-' + id).disabled = !turnsAllowed();
    if (view && !view.animating) view.setHighlight(attempt && !attempt.result ? P.describe(base()) : null);
    const tbody = $('#room-results');
    tbody.replaceChildren();
    const players = [...(room?.players || [])].sort((a, b) => (a.result?.durationMs ?? Infinity) - (b.result?.durationMs ?? Infinity));
    for (const entry of players) {
      const tr = document.createElement('tr');
      if (entry.playerId === player?.playerId) tr.className = 'room-own-result';
      for (const value of [entry.nickname + (entry.playerId === player?.playerId ? ' (bạn)' : ''),
        entry.result ? formatTime(entry.result.durationMs) : 'Chưa có kết quả', entry.result?.moveCount ?? '—']) {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  function fit() { if (active && view && room) view.fit(0.57, 0); }
  function ensureView() {
    if (view) return;
    view = new Cube3D($('#room-cube'), {
      size: 44, dragMode: () => $('#room-mode').value, canTurn,
      onSelect: (face) => { $('#room-layer').value = face; render(); },
      onTurn: (entry) => { void turn(entry); },
      onHint: (text) => { $('#room-status').textContent = text; },
    });
    if (window.ResizeObserver) new ResizeObserver(() => { view.cancelGesture(); fit(); }).observe($('#room-cube'));
    else window.addEventListener('resize', fit);
  }
  function resumeButton() {
    const code = read(LAST);
    $('#room-resume').hidden = !code || !read(key(code));
    $('#room-resume').textContent = 'Mở lại phòng ' + (code || '');
  }
  async function enter(code = null) {
    if (entering || view?.animating) return;
    entering = true;
    $('#room-error').textContent = '';
    $('#room-create').disabled = $('#room-join').disabled = $('#room-resume').disabled = true;
    try {
      const identity = code && read(key(code));
      const data = identity ? await api('rooms/' + code) : await api(code ? 'rooms/' + code + '/join' : 'rooms', { nickname: $('#room-nickname').value });
      if (identity && !data.room.players.some((p) => p.playerId === identity.playerId)) throw new Error('Nhận diện cũ không còn trong phòng. Hãy dùng biệt danh khác để vào lại.');
      generation++;
      room = data.room; player = identity || data.player; attempt = null;
      pending = player.pending || null;
      remember();
      $('#room-entry').hidden = true; $('#room-content').hidden = false;
      $('#room-code').textContent = room.code; $('#room-me').textContent = player.nickname;
      $('#room-refresh-note').textContent = 'Bảng kết quả tự cập nhật khi bạn đang mở phòng.';
      ensureView();
      view.setColors(P.applyAll(Array.from(C.SOLVED), room.scramble).map(hex));
      render(); fit(); scheduleRefresh();
      if (pending && !ownResult()) void saveResult();
    } catch (error) { $('#room-error').textContent = error.message; }
    finally {
      entering = false;
      $('#room-create').disabled = $('#room-join').disabled = $('#room-resume').disabled = false;
    }
  }
  async function refresh() {
    if (!room || !active || document.hidden || refreshing) return;
    const version = generation, code = room.code;
    refreshing = true;
    try {
      const data = await api('rooms/' + code);
      if (generation !== version) return;
      receiveRoom(data.room);
      $('#room-refresh-note').textContent = 'Đã cập nhật kết quả.';
      render();
    } catch (error) { if (generation === version) $('#room-refresh-note').textContent = error.message; }
    finally { refreshing = false; }
  }
  function scheduleRefresh() {
    clearInterval(tick);
    if (active && room && !document.hidden) tick = setInterval(() => { void refresh(); }, 2000);
  }
  async function saveResult() {
    if (!pending || saving || !room) return;
    const version = generation;
    saving = true; render();
    try {
      const data = await api('rooms/' + room.code + '/result', {
        playerId: player.playerId, playerToken: player.playerToken, ...pending,
      });
      if (version !== generation) return;
      receiveRoom(data.room); pending = null; delete player.pending; remember();
      $('#room-error').textContent = '';
    } catch (error) { if (version === generation) $('#room-error').textContent = error.message; }
    finally { saving = false; if (version === generation) render(); }
  }
  async function turn(entry) {
    if (!canTurn()) return;
    const current = attempt;
    const moves = current.begin(entry);
    if (!moves) return;
    $('#room-error').textContent = '';
    clock();
    const pendingMove = view.animateMove(moves.map(P.describe), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 240, () => {
      current.commit(moves);
      view.setColors(current.model.colors.map(hex));
    });
    render();
    await pendingMove;
    if (attempt !== current) return;
    if (current.result) {
      pending = { ...current.result }; player.pending = pending; remember();
      closeGame(true);
      void saveResult();
    }
    render();
  }

  $('#room-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const join = event.submitter?.value === 'join';
    const code = $('#room-code-input').value.trim().toUpperCase();
    if (join && !/^[A-Z0-9]{6}$/.test(code)) { $('#room-error').textContent = 'Nhập mã mời gồm 6 ký tự chữ hoặc số.'; return; }
    void enter(join ? code : null);
  });
  $('#room-resume').addEventListener('click', () => { void enter(read(LAST)); });
  $('#room-start').addEventListener('click', () => {
    if (!active || !room || ownResult() || attempt || pending) return;
    attempt = new RoomAttempt(room.scramble);
    view.setColors(attempt.model.colors.map(hex));
    openGame();
    render(); fit();
  });
  $('#room-leave').addEventListener('click', () => {
    if (view?.animating) return;
    closeGame();
    generation++; clearInterval(tick); cancelAnimationFrame(clockFrame); view?.cancelGesture();
    room = player = attempt = pending = null;
    $('#room-content').hidden = true; $('#room-entry').hidden = false; $('#room-error').textContent = '';
    resumeButton();
  });
  $('#room-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(room.code); $('#room-copy').textContent = '✓ Đã sao chép'; }
    catch (error) { $('#room-error').textContent = 'Mã mời của bạn: ' + room.code; }
    setTimeout(() => { $('#room-copy').textContent = 'Sao chép mã'; }, 2000);
  });
  $('#room-retry').addEventListener('click', () => { void saveResult(); });
  $('#room-refresh').addEventListener('click', () => { void refresh(); });
  for (const [id, suffix] of [['clockwise', ''], ['counterclockwise', "'"], ['half', '2']]) {
    $('#room-' + id).addEventListener('click', () => { if (turnsAllowed()) void turn(base() + suffix); });
  }
  for (const id of ['layer', 'mode']) $('#room-' + id).addEventListener('change', render);
  $('#room-view').addEventListener('click', () => view?.resetView());
  $('#room-back').addEventListener('click', () => { view?.cancelGesture(); closeGame(true); });
  $('#room-fullscreen').addEventListener('click', () => {
    if (isFullscreen()) exitFullscreen();
    else openGame();
  });
  function onFullscreenChange() {
    if (isFullscreen() && !expanded) exitFullscreen();
    updateFullscreenButton(); fit();
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', (event) => {
    if (!canTurn() || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, select, textarea, .tabs, [contenteditable]')) return;
    const layer = event.key.toUpperCase();
    if (Object.hasOwn(P.BASES, layer) && !layer.endsWith('w')) {
      event.preventDefault(); $('#room-layer').value = layer; void turn(layer + (event.shiftKey ? "'" : ''));
    } else if (layer === '2' && turnsAllowed()) { event.preventDefault(); void turn(base() + '2'); }
  });
  document.addEventListener('visibilitychange', () => {
    view?.cancelGesture(); scheduleRefresh(); clock();
    if (!document.hidden) { paintStats(); void refresh(); }
  });
  window.Rubik.rooms = {
    setActive(value) {
      active = value;
      if (!value) {
        view?.cancelGesture();
        closeGame();
      } else { resumeButton(); fit(); render(); void refresh(); }
      scheduleRefresh(); clock();
    },
    get inProgress() { return !!attempt && !ownResult(); },
  };
  resumeButton();
})();
