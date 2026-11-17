/*
 * Giao diện Thi trực tiếp: vào phòng, phòng chờ, chuẩn bị, quan sát, thi, kết quả và thi lại.
 * Máy chủ quyết định mọi mốc giờ và kết quả; trình duyệt chỉ hiển thị dự đoán (khối đã xác nhận + các nước đang chờ)
 * để thao tác mượt, bị từ chối thì dựng lại đúng khối của máy chủ. Khối thi tách hẳn khối Chơi tự do và bộ giải.
 * Cũng quản lý nút chọn giữa "Thi trực tiếp" và "Thi tự do giờ" (js/rooms.js).
 */
(function () {
  'use strict';
  const { cube: C, playMoves: P, PlayState, Cube3D, vision: V, onlineProtocol: Proto, OnlineClient } = window.Rubik;
  const $ = (selector) => document.querySelector(selector);
  const MODE_KEY = 'rubik-rooms-mode';
  const ROOM_KEY = 'rubik-online-room';
  const MAX_PENDING = 8;
  const STALL_MS = 2000;
  const apiBase = $('meta[name="rubik-api-base"]')?.content || 'api/';
  const hex = (c) => V.PALETTE[PlayState.PALETTE[c]].hex;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* không lưu được */ } },
  };

  let mode = store.get(MODE_KEY) === 'async' ? 'async' : 'live';
  let active = false;
  let booted = false;
  let busy = false;
  let roomId = null;
  let snap = null;
  let view = null;
  let race = null; // { roundId, confirmed, seq, pending[], official, ended }
  let arena = false;
  let dismissedRound = null;
  let frame = 0;
  let lastPhaseKey = '';
  const sent = { prepared: new Set(), acked: new Set() };
  let lastRejectAt = 0;
  let wasRunning = false;
  let needResend = false;

  const client = new OnlineClient({ apiBase, onMessage: (msg) => onMessage(msg), onState: () => renderNet() });

  // ---------- Chọn kiểu thi ----------
  function setMode(next) {
    mode = next;
    store.set(MODE_KEY, next);
    $('#rooms-live').hidden = next !== 'live';
    $('#rooms-async').hidden = next !== 'async';
    $('#rooms-mode-live').setAttribute('aria-pressed', String(next === 'live'));
    $('#rooms-mode-async').setAttribute('aria-pressed', String(next === 'async'));
    window.Rubik.rooms.setActive(active && next === 'async');
    if (next === 'live' && active) void boot();
    else closeArena();
  }
  $('#rooms-mode-live').addEventListener('click', () => setMode('live'));
  $('#rooms-mode-async').addEventListener('click', () => setMode('async'));

  // ---------- Vào phòng ----------
  const showError = (text) => { $('#online-error').textContent = text || ''; };

  let booting = null;
  function boot() {
    if (booted) return Promise.resolve();
    if (!booting) booting = startSession().finally(() => { booting = null; });
    return booting;
  }
  async function startSession() {
    try {
      const meta = await client.http('GET', 'meta');
      $('#online-service').textContent = meta.maintenance ? 'Dịch vụ đang bảo trì: chưa tạo phòng hoặc mở ván mới được.' :
        meta.engineVersion !== Proto.ENGINE_VERSION ? 'Ứng dụng của bạn khác phiên bản máy chủ. Tải lại trang để cập nhật.' : '';
      const session = await client.session();
      booted = true;
      const hash = /^#room=([0-9A-Za-z-]{8,10})$/.exec(location.hash);
      if (hash) $('#online-code').value = Proto.normalizeCode(hash[1]);
      showCurrent(session.activeRoom);
      if (session.activeRoom && (!hash || Proto.normalizeCode(hash[1]) === session.activeRoom.code)) enterRoom(session.activeRoom.roomId);
    } catch (error) {
      $('#online-service').textContent = error.code === 'network' || error.status >= 500
        ? 'Dịch vụ thi trực tiếp chưa sẵn sàng. Các phần khác vẫn dùng bình thường; thử lại sau.' : error.message;
    }
  }

  function showCurrent(current) {
    $('#online-current').hidden = !current;
    $('#online-form').hidden = !!current;
    if (current) {
      $('#online-current-code').textContent = `${current.code} (tên: ${current.nickname})`;
      $('#online-reopen').dataset.roomId = current.roomId;
    }
  }

  function enterRoom(id) {
    roomId = id;
    snap = null;
    race = null;
    store.set(ROOM_KEY, id);
    showError('');
    $('#online-entry').hidden = true;
    $('#online-room').hidden = false;
    $('#online-room-code').textContent = '…';
    client.connect(id);
    renderNet();
  }

  function leaveRoomView(message) {
    client.stop();
    closeArena();
    roomId = null;
    snap = null;
    race = null;
    store.set(ROOM_KEY, null);
    $('#online-room').hidden = true;
    $('#online-entry').hidden = false;
    $('#online-history').open = false;
    showCurrent(null);
    showError(message || '');
    if (location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search);
  }

  async function submitEntry(join) {
    if (busy) return;
    const nickname = $('#online-nickname').value;
    const code = Proto.normalizeCode($('#online-code').value);
    if (!Proto.normalizeNickname(nickname)) { showError(Proto.message('nickname_invalid')); $('#online-nickname').focus(); return; }
    if (join && !Proto.isCode(code)) { showError(Proto.message('code_invalid')); $('#online-code').focus(); return; }
    busy = true;
    $('#online-create').disabled = $('#online-join').disabled = true;
    showError('');
    try {
      await boot();
      if (roomId) return; // phiên đang có phòng: khởi tạo đã mở lại phòng đó
      if (!booted) { await client.session(); booted = true; }
      const result = join ? await client.call('POST', 'rooms/join', { code, nickname }) : await client.call('POST', 'rooms', { nickname });
      enterRoom(result.roomId);
    } catch (error) {
      if (error.code === 'session_in_other_room') showCurrent(error.data?.activeRoom);
      showError(error.message);
    } finally {
      busy = false;
      $('#online-create').disabled = $('#online-join').disabled = false;
    }
  }
  $('#online-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void submitEntry(event.submitter?.value === 'join');
  });
  $('#online-reopen').addEventListener('click', () => enterRoom($('#online-reopen').dataset.roomId));
  $('#online-leave-old').addEventListener('click', async () => {
    try {
      await client.call('POST', `rooms/${encodeURIComponent($('#online-reopen').dataset.roomId)}/leave`, {});
      showCurrent(null);
      showError('');
    } catch (error) { showError(error.message); }
  });

  // ---------- Bản tin từ máy chủ ----------
  function onMessage(msg) {
    switch (msg.type) {
      case 'welcome': needResend = true; break;
      case 'room.snapshot': onSnapshot(msg); break;
      case 'move.ack': onAck(msg); break;
      case 'move.rejected': onMoveRejected(msg); break;
      case 'control.revoked': closeArena(); render(); break;
      case 'room.removed': {
        const text = msg.code === 'left' ? '' : Proto.message(msg.code);
        leaveRoomView(text);
        break;
      }
      case 'service.restarting': $('#online-status').textContent = 'Máy chủ thi đấu đang khởi động lại…'; break;
      case 'command.rejected':
        if (!msg.commandId && msg.code) showError(Proto.message(msg.code));
        break;
      default: break;
    }
  }

  const me = () => snap?.me;
  const round = () => snap?.round;
  const mine = () => snap?.round?.mine;
  const isHost = () => !!snap?.me.isHost;
  const memberName = (id) => snap?.members.find((m) => m.memberId === id)?.nickname ||
    snap?.round?.attempts.find((a) => a.memberId === id)?.nickname || 'Một người';

  function onSnapshot(next) {
    snap = next;
    const r = next.round;
    const m = r?.mine;
    $('#online-room-code').textContent = next.room.code;
    // Chuẩn bị: báo máy đã sẵn sàng nhận khối, đúng phiên bản mô hình.
    if (r?.status === 'PREPARING' && m && !m.prepared && !sent.prepared.has(r.roundId) && client.controlling) {
      sent.prepared.add(r.roundId);
      client.raw({ type: 'round.prepared', roundId: r.roundId, engineVersion: Proto.ENGINE_VERSION });
    }
    // Quan sát: kiểm tra khối nhận được rồi xác nhận bằng mã trạng thái tự tính.
    if (r && r.startState && m) {
      if (!race || race.roundId !== r.roundId) {
        race = { roundId: r.roundId, confirmed: m.state || r.startState, seq: m.moveSeq, pending: [], official: m.elapsedMs, ended: false };
        paintCube();
      }
      if (r.status === 'INSPECTION' && !m.acked && !sent.acked.has(r.roundId) && client.controlling) {
        const valid = Proto.isState(r.startState) && P.applyAll(Array.from(C.SOLVED), r.scramble).join('') === r.startState;
        sent.acked.add(r.roundId);
        client.raw({ type: 'round.inspectionAck', roundId: r.roundId, stateHash: valid ? Proto.stateHash(r.startState) : 'invalid' });
      }
      reconcile(m, needResend);
    } else if (!r) {
      race = null;
    }
    needResend = false;
    if (r?.status === 'RUNNING' && !wasRunning) view?.cancelGesture('Bắt đầu! Đặt tay lại để xoay.');
    wasRunning = r?.status === 'RUNNING';
    autoArena();
    render();
  }

  // Đồng bộ lượt của mình với máy chủ. resend: vừa nối lại/lấy quyền nên gửi lại các nước máy chủ chưa nhận
  // (cùng mã lệnh, quyền mới; máy chủ trả lại kết quả cũ nếu thực ra đã nhận).
  function reconcile(m, resend) {
    if (!race) return;
    race.official = m.elapsedMs;
    race.ended = m.status === 'FINISHED' || m.status === 'DNF';
    const adopt = () => { race.confirmed = m.state; race.seq = m.moveSeq; race.pending = []; };
    if (race.ended) { adopt(); paintCube(); return; }
    if (m.moveSeq < race.seq) adopt();
    else if (m.moveSeq > race.seq) {
      const accepted = race.pending.filter((p) => p.seq <= m.moveSeq);
      const state = accepted.reduce((st, p) => Proto.applyMove(st, p.move), race.confirmed);
      if (race.seq + accepted.length !== m.moveSeq || Proto.stateHash(state) !== m.stateHash) adopt();
      else {
        race.confirmed = state;
        race.seq = m.moveSeq;
        race.pending = race.pending.filter((p) => p.seq > m.moveSeq);
      }
    } else if (Proto.stateHash(race.confirmed) !== m.stateHash) adopt();
    if (resend) for (const p of race.pending) { p.sentAt = performance.now(); sendMove(p); }
    paintCube();
  }

  function onAck(msg) {
    if (!race || msg.roundId !== race.roundId) return;
    const index = race.pending.findIndex((p) => p.commandId === msg.commandId);
    if (index < 0) return;
    for (const p of race.pending.slice(0, index + 1)) race.confirmed = Proto.applyMove(race.confirmed, p.move);
    race.pending.splice(0, index + 1);
    race.seq = msg.moveSeq;
    if (Proto.stateHash(race.confirmed) !== msg.stateHash) { client.raw({ type: 'room.sync' }); return; }
    if (msg.status === 'FINISHED') {
      race.official = msg.elapsedMs;
      race.ended = true;
      race.pending = [];
    }
    render();
  }

  function onMoveRejected(msg) {
    if (!race) return;
    race.pending = [];
    const now = performance.now();
    if (now - lastRejectAt > 1000 && msg.code !== 'round_not_running') $('#online-status').textContent = Proto.message(msg.code);
    lastRejectAt = now;
    client.raw({ type: 'room.sync' });
    paintCube();
    render();
  }

  // ---------- Thi ----------
  const displayState = () => race ? race.pending.reduce((s, p) => Proto.applyMove(s, p.move), race.confirmed) : null;
  function paintCube() {
    const state = displayState();
    if (view && state && !view.animating) view.setColors(Array.from(state).map(hex));
  }
  const stalled = () => !!race?.pending.length && performance.now() - race.pending[0].sentAt > STALL_MS;
  function racing() {
    const r = round();
    const m = mine();
    if (!r || !m || !race || race.ended || !client.controlling) return false;
    if (r.status !== 'RUNNING' && !(r.status === 'INSPECTION' && client.serverNow() >= r.t0)) return false;
    return m.status === 'RACING' || m.status === 'PENDING';
  }
  const canTurn = () => racing() && !view?.animating && race.pending.length < MAX_PENDING && !stalled();
  const layerBase = () => $('#online-layer').value + ($('#online-mode').value === 'layer2' && C.FACES.includes($('#online-layer').value) ? 'w' : '');
  const buttonsAllowed = () => canTurn() && !($('#online-mode').value === 'layer2' && P.SLICES.includes($('#online-layer').value));

  function sendMove(p) {
    client.raw({
      type: 'attempt.move', commandId: p.commandId, roundId: race.roundId, controlEpoch: client.epoch,
      moveSeq: p.seq, baseStateHash: p.base, move: p.move,
    });
  }

  function turn(entry) {
    if (!canTurn()) return;
    let moves;
    try { moves = P.parseEntry(entry).map(P.toString); } catch (e) { return; }
    if (race.pending.length + moves.length > MAX_PENDING) return;
    for (const move of moves) {
      const base = displayState();
      const p = { commandId: window.Rubik.onlineRandomId(), seq: race.seq + race.pending.length + 1, move, base: Proto.stateHash(base), sentAt: performance.now() };
      race.pending.push(p);
      sendMove(p);
    }
    const target = race;
    view.animateMove(moves.map(P.describe), reduceMotion() ? 1 : 200, () => {
      if (race === target) view.setColors(Array.from(displayState()).map(hex));
    }).then(() => { if (race === target) { paintCube(); render(); } });
    render();
  }

  function ensureView() {
    if (view) return;
    view = new Cube3D($('#online-cube'), {
      size: 44, dragMode: () => $('#online-mode').value, canTurn,
      onSelect: (face) => { $('#online-layer').value = face; render(); },
      onTurn: (entry) => turn(entry),
      onHint: (text) => {
        const r = round();
        if (r?.status === 'INSPECTION' && client.serverNow() < r.t0) text = 'Đang quan sát: chưa xoay được lớp. Ba ngón hoặc kéo nền để đổi góc nhìn.';
        else if (racing() && (race.pending.length >= MAX_PENDING || stalled())) text = Proto.message('too_many_pending');
        $('#online-status').textContent = text;
      },
    });
    if (window.ResizeObserver) new ResizeObserver(() => { view.cancelGesture(); fit(); }).observe($('#online-cube'));
    else window.addEventListener('resize', fit);
    for (const layer of ['U', 'D', 'F', 'B', 'R', 'L', 'M', 'E', 'S']) {
      const option = document.createElement('option');
      option.value = layer;
      option.textContent = layer + ' · ' + P.NAMES[layer];
      $('#online-layer').appendChild(option);
    }
    $('#online-layer').value = 'F';
  }
  function fit() { if (view && arena) view.fit(0.57, 0); }

  // ---------- Sân thi phủ màn hình ----------
  const game = $('#online-game');
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFullscreen = () => fullscreenElement() === game;
  function exitFullscreen() {
    if (!isFullscreen()) return;
    try { const r = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen(); r?.catch?.(() => {}); } catch (e) { /* đã thoát */ }
  }
  function requestFullscreen() {
    if (isFullscreen()) { exitFullscreen(); return; }
    try {
      const r = game.requestFullscreen ? game.requestFullscreen({ navigationUI: 'hide' }) : game.webkitRequestFullscreen?.();
      r?.catch?.(() => {});
    } catch (e) { /* trình duyệt từ chối: sân vẫn phủ kín trang */ }
  }
  function setInert(value) {
    document.querySelectorAll('.app-header, #update-banner, .room-modes, #online-room > :not(#online-game)').forEach((el) => {
      el.inert = value || (!!window.Rubik.play?.active && el.matches('.app-header, #update-banner'));
    });
  }
  function openArena() {
    if (arena || !active || mode !== 'live') return;
    ensureView();
    arena = true;
    game.hidden = false;
    game.classList.add('room-expanded');
    document.documentElement.classList.add('room-open');
    setInert(true);
    paintCube();
    fit();
    game.focus({ preventScroll: true });
  }
  function closeArena() {
    if (!arena) return;
    arena = false;
    view?.cancelGesture();
    exitFullscreen();
    game.classList.remove('room-expanded');
    game.hidden = true;
    document.documentElement.classList.remove('room-open');
    setInert(false);
  }
  // Mở sân khi ván tới giai đoạn quan sát (không tự xin toàn màn hình: không có thao tác người dùng), đóng khi có kết quả.
  function autoArena() {
    const r = round();
    const m = mine();
    const live = r && m && (r.status === 'INSPECTION' || r.status === 'RUNNING') && !race?.ended && client.controlling;
    if (live && dismissedRound !== r.roundId) openArena();
    else if (!live && arena && !(race?.ended && r?.status === 'RUNNING' && m?.status === 'FINISHED')) closeArena();
    if (!r && arena) closeArena();
  }
  $('#online-back').addEventListener('click', () => { dismissedRound = round()?.roundId ?? null; closeArena(); render(); $('#online-open-arena').focus(); });
  $('#online-open-arena').addEventListener('click', () => { dismissedRound = null; openArena(); render(); });
  $('#online-fullscreen').addEventListener('click', requestFullscreen);
  const onFullscreen = () => {
    $('#online-fullscreen').setAttribute('aria-pressed', String(isFullscreen()));
    if (fullscreenElement() === game && !arena) exitFullscreen();
    fit();
  };
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);

  // ---------- Hiển thị ----------
  function renderNet() {
    const state = client.state;
    const r = round();
    const m = r?.attempts?.find((a) => a.memberId === me()?.memberId);
    const label = state === 'online' ? `● Đã kết nối${client.rtt !== null ? ` · ${Math.round(client.rtt)} ms` : ''}` :
      state === 'connecting' ? '◌ Đang kết nối…' : state === 'offline'
        ? `○ Mất kết nối — đang nối lại${r?.status === 'RUNNING' && m?.status === 'RACING' ? '; đồng hồ vẫn chạy, tối đa 60 giây mất kết nối mỗi lượt' : ''}` : '';
    $('#online-net').textContent = label;
    $('#online-net').dataset.state = state;
    $('#online-net-small').dataset.state = state;
    $('#online-net-small').title = label;
  }

  const reasonText = (r) => Proto.ROUND_REASONS[r] || 'sự cố';
  function phaseInfo() {
    const room = snap.room;
    const r = round();
    const m = mine();
    const lr = snap.lastRound;
    if (room.status === 'LOBBY') {
      let note = isHost() ? 'Bấm Bắt đầu khi mọi người đã sẵn sàng.' : me().ready ? 'Bạn đã sẵn sàng. Chờ chủ phòng bắt đầu.' : 'Bấm Sẵn sàng khi bạn chuẩn bị xong.';
      if (!me().engineOk) note = Proto.message('version_mismatch');
      if (room.expired) note = Proto.message('room_expired');
      if (lr?.status === 'CANCELLED') note = `Ván #${lr.seq} đã hủy trước giờ bắt đầu vì ${reasonText(lr.reason)}${lr.affected?.length ? ` (${lr.affected.join(', ')})` : ''}. ` + note;
      return { key: 'lobby', title: 'Phòng chờ', note };
    }
    if (room.status === 'RESULTS') {
      const waiting = isHost() ? 'Bấm Thi lại để mở ván mới.' : 'Chờ chủ phòng mở ván tiếp theo.';
      if (lr?.status === 'VOID') return { key: 'void' + lr.roundId, title: `Ván #${lr.seq} bị hủy`, note: `Ván bị hủy vì ${reasonText(lr.reason)}; không có bảng xếp hạng. ${waiting}` };
      return { key: 'results' + lr?.roundId, title: `Kết quả ván #${lr?.seq ?? ''}`, note: waiting };
    }
    if (!m) return { key: 'watch' + r?.roundId, title: `Ván #${r?.seq} đang diễn ra`, note: 'Bạn sẽ thi từ ván sau. Theo dõi trạng thái mọi người bên dưới.' };
    if (r.status === 'PREPARING') return { key: 'prep' + r.roundId, title: `Chuẩn bị ván #${r.seq}`, note: 'Đang chờ mọi máy sẵn sàng nhận khối…' };
    if (r.status === 'INSPECTION') return { key: 'insp' + r.roundId, title: `Quan sát ván #${r.seq}`, note: 'Mọi người nhận cùng một khối. Chưa xoay được lớp cho tới khi đếm ngược xong.' };
    if (race?.ended || m.status === 'FINISHED' || m.status === 'DNF') {
      const own = m.status === 'FINISHED' ? `Bạn đã xong: ${Proto.formatTime(m.elapsedMs)} (chờ chốt ván).` : `Bạn không hoàn thành: ${Proto.END_REASONS[m.endReason] || 'DNF'}.`;
      return { key: 'done' + r.roundId + m.status, title: `Ván #${r.seq} đang diễn ra`, note: own + ' Đang chờ người khác.' };
    }
    return { key: 'run' + r.roundId, title: `Đang thi ván #${r.seq}`, note: arena ? 'Đồng hồ đang chạy.' : 'Đồng hồ vẫn chạy khi bạn ở ngoài sân thi.' };
  }

  function memberStatus(member) {
    const r = round();
    const a = r?.attempts.find((x) => x.memberId === member.memberId);
    if (a) {
      if (a.status === 'FINISHED') return `✔ ${Proto.formatTime(a.elapsedMs)}`;
      if (a.status === 'DNF') return `DNF · ${Proto.END_REASONS[a.endReason] || ''}`;
      if (a.disconnected) return `mất kết nối (còn ${Math.ceil((a.reconnectLeftMs ?? 0) / 1000)} giây)`;
      return r.status === 'RUNNING' ? 'đang giải' : r.status === 'INSPECTION' ? 'đang quan sát' : 'đang chuẩn bị';
    }
    if (member.standing === 'WAITING_NEXT') return 'chờ ván sau';
    if (!member.connected) return '○ mất kết nối';
    if (!member.engineOk) return 'bản ứng dụng cũ';
    if (snap.room.status === 'LOBBY') return member.isHost ? '● chủ phòng' : member.ready ? '✔ sẵn sàng' : '● chưa sẵn sàng';
    return '● đã kết nối';
  }

  function renderMembers() {
    const list = $('#online-members');
    list.replaceChildren();
    const canManage = isHost() && ['LOBBY', 'RESULTS'].includes(snap.room.status);
    for (const member of snap.members) {
      const li = document.createElement('li');
      if (member.memberId === me().memberId) li.className = 'online-self';
      const name = document.createElement('span');
      name.className = 'online-member-name';
      name.textContent = member.nickname + (member.memberId === me().memberId ? ' (bạn)' : '') + (member.isHost ? ' · chủ' : '');
      const status = document.createElement('span');
      status.className = 'online-member-status muted small';
      status.textContent = memberStatus(member);
      li.append(name, status);
      if (canManage && member.memberId !== me().memberId) {
        const actions = document.createElement('span');
        actions.className = 'online-member-actions';
        if (member.connected) {
          const host = document.createElement('button');
          host.type = 'button';
          host.className = 'btn small';
          host.textContent = 'Chuyển chủ';
          host.addEventListener('click', () => act('room.transferHost', { memberId: member.memberId }));
          actions.appendChild(host);
        }
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'btn small';
        kick.textContent = 'Mời ra';
        kick.addEventListener('click', () => {
          if (window.confirm(`Mời ${member.nickname} ra khỏi phòng? Người này sẽ không vào lại được phòng này.`)) act('room.kick', { memberId: member.memberId });
        });
        actions.appendChild(kick);
        li.appendChild(actions);
      }
      list.appendChild(li);
    }
  }

  function renderBlockers() {
    const list = $('#online-blockers');
    list.replaceChildren();
    const lobby = snap.room.status === 'LOBBY';
    const blockers = lobby ? snap.blockers : [];
    const text = {
      too_few_players: () => 'Cần ít nhất 2 người sẵn sàng.',
      member_unready: (b) => `${memberName(b.memberId)} chưa sẵn sàng.`,
      member_disconnected: (b) => `${memberName(b.memberId)} đang mất kết nối.`,
      engine_mismatch: (b) => `${memberName(b.memberId)} cần tải lại trang để cập nhật ứng dụng.`,
    };
    for (const b of blockers) {
      const li = document.createElement('li');
      li.textContent = (text[b.code] || (() => Proto.message(b.code)))(b);
      list.appendChild(li);
    }
    list.hidden = !blockers.length;
    const start = $('#online-start');
    const without = $('#online-start-without');
    start.hidden = !(lobby && isHost());
    start.disabled = !!blockers.length || snap.room.expired || snap.room.maintenance || !client.controlling;
    const skippable = blockers.filter((b) => b.memberId && b.excludable);
    const others = blockers.filter((b) => !(b.memberId && b.excludable));
    without.hidden = !(lobby && isHost() && skippable.length && !others.length);
    if (!without.hidden) {
      without.textContent = `▶ Bắt đầu, để ${skippable.map((b) => memberName(b.memberId)).join(', ')} thi ván sau`;
      without.dataset.exclude = JSON.stringify(skippable.map((b) => b.memberId));
    }
    const ready = $('#online-ready');
    ready.hidden = !(lobby && !isHost() && me().standing === 'ACTIVE');
    ready.textContent = me().ready ? '✋ Hủy sẵn sàng' : '✋ Sẵn sàng';
    ready.setAttribute('aria-pressed', String(!!me().ready));
    ready.disabled = !me().engineOk || !client.controlling;
  }

  function renderResults() {
    const lr = snap.lastRound;
    const show = snap.room.status === 'RESULTS' && lr?.status === 'FINALIZED';
    $('#online-result').hidden = !show;
    if (!show) return;
    $('#online-result-title').textContent = `Ván #${lr.seq}${lr.scrambleKind === 'random-moves' ? ' · bộ tráo giao hữu 25 nước' : ''}`;
    fillResultRows($('#online-result-rows'), lr.attempts);
  }
  function fillResultRows(tbody, attempts) {
    tbody.replaceChildren();
    for (const a of attempts) {
      const tr = document.createElement('tr');
      if (a.memberId === me()?.memberId) tr.className = 'room-own-result';
      const cells = [
        a.rank ?? '–',
        a.nickname + (a.memberId === me()?.memberId ? ' (bạn)' : ''),
        a.status === 'FINISHED' ? Proto.formatTime(a.elapsedMs) : `DNF · ${Proto.END_REASONS[a.endReason] || ''}`,
        a.moveCount,
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = String(value);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function render() {
    if (!snap || !roomId) return;
    const room = snap.room;
    const r = round();
    const m = mine();
    $('#online-rules').textContent = `${room.rules.minPlayers}–${room.rules.maxPlayers} người · quan sát ${room.rules.inspectionMs / 1000} giây · tối đa ${room.rules.solveLimitMs / 60000} phút · giao hữu`;
    $('#online-close').hidden = !(isHost() && ['LOBBY', 'RESULTS'].includes(room.status));
    $('#online-takeover').hidden = client.state !== 'online' || client.controlling;
    $('#online-rename').hidden = !['LOBBY', 'RESULTS'].includes(room.status);
    const phase = phaseInfo();
    $('#online-phase').textContent = phase.title;
    $('#online-phase-note').textContent = phase.note;
    $('#online-next').hidden = !(room.status === 'RESULTS' && isHost());
    $('#online-next').disabled = !client.controlling || room.expired;
    const inRace = r && m && ['INSPECTION', 'RUNNING'].includes(r.status) && !race?.ended;
    $('#online-open-arena').hidden = !(inRace && !arena && client.controlling);
    renderBlockers();
    renderMembers();
    renderResults();
    renderNet();
    // Sân thi
    $('#online-me').textContent = `${me().nickname}${r ? ` · ván #${r.seq}` : ''}`;
    $('#online-surrender').hidden = !(r?.status === 'RUNNING' && m?.status === 'RACING' && !race?.ended);
    for (const id of ['cw', 'ccw', 'half']) $('#online-' + id).disabled = !buttonsAllowed();
    if (view && !view.animating) view.setHighlight(racing() ? P.describe(layerBase()) : null);
    if (phase.key !== lastPhaseKey) {
      lastPhaseKey = phase.key;
      $('#online-status').textContent = arenaStatus();
    }
    tick();
  }

  function arenaStatus() {
    const r = round();
    const m = mine();
    if (!r || !m) return '';
    if (r.status === 'INSPECTION') return 'Quan sát khối: xoay góc nhìn bằng ba ngón hoặc kéo nền. Chưa xoay được lớp.';
    if (race?.ended) {
      return m.status === 'FINISHED' || race.official !== null
        ? `Xong! Thời gian chính thức ${Proto.formatTime(race.official ?? m.elapsedMs)} — chờ chốt ván.`
        : `Lượt của bạn đã kết thúc: ${Proto.END_REASONS[m.endReason] || 'DNF'}.`;
    }
    return 'Bắt đầu! Đồng hồ đang chạy.';
  }

  // Đồng hồ hiển thị theo giờ máy chủ ước lượng; chỉ cập nhật chữ, không phát thông báo đọc màn hình.
  function tick() {
    cancelAnimationFrame(frame);
    if (!snap || !roomId || document.hidden) return;
    const r = round();
    const m = mine();
    const now = client.serverNow();
    let clock = '0:00.00';
    const countdown = $('#online-countdown');
    let count = '';
    if (r && m) {
      if (race?.official !== null && race?.official !== undefined) clock = Proto.formatTime(race.official);
      else if (m.status === 'DNF' || (race?.ended && m.status !== 'FINISHED')) clock = 'DNF';
      else if (r.t0 !== null && now >= r.t0) clock = Proto.formatTime(Math.min(now, r.td) - r.t0);
      if (r.status === 'INSPECTION' && r.t0 !== null) {
        const left = r.t0 - now;
        if (left > r.rules.countdownMs) count = `Quan sát · ${Math.ceil(left / 1000)}`;
        else if (left > 0) count = String(Math.ceil(left / 1000));
        else count = 'Bắt đầu!';
      } else if (r.status === 'PREPARING') count = 'Chuẩn bị…';
      else if (r.status === 'RUNNING' && now - r.t0 < 700 && now >= r.t0) count = 'Bắt đầu!';
      if (r.status === 'INSPECTION' && now >= r.t0 && !wasRunning) {
        wasRunning = true;
        view?.cancelGesture('Bắt đầu! Đặt tay lại để xoay.');
      }
    }
    $('#online-clock').textContent = clock;
    $('#online-moves').textContent = String(race ? race.seq + race.pending.length : 0);
    countdown.textContent = count;
    countdown.hidden = !count;
    countdown.classList.toggle('online-countdown-big', /^\d$/.test(count) || count === 'Bắt đầu!');
    // Trạng thái đối thủ và hạn nối lại cộng dồn
    if (r) {
      $('#online-opponents').textContent = r.attempts.filter((a) => a.memberId !== me().memberId)
        .map((a) => `${a.nickname}: ${memberStatus({ memberId: a.memberId })}`).join(' · ');
    } else $('#online-opponents').textContent = '';
    if (stalled() && arena) $('#online-status').textContent = 'Đang chờ máy chủ xác nhận nước xoay…';
    else if (race && !race.ended && race.pending.length && Proto.isSolved(displayState())) $('#online-status').textContent = 'Đang xác nhận với máy chủ…';
    const animate = r && (r.status === 'INSPECTION' || r.status === 'RUNNING' || r.status === 'PREPARING');
    if (animate && (arena || active)) frame = requestAnimationFrame(tick);
  }

  // ---------- Lệnh phòng ----------
  async function act(type, payload = {}) {
    showError('');
    try { return await client.command(type, payload); } catch (error) {
      if (['wrong_room_state', 'wrong_round', 'command_conflict'].includes(error.code)) client.raw({ type: 'room.sync' });
      showError(error.message);
      return null;
    }
  }
  $('#online-ready').addEventListener('click', () => act('room.ready', { ready: !me()?.ready }));
  $('#online-start').addEventListener('click', () => act('room.start'));
  $('#online-start-without').addEventListener('click', (event) => act('room.start', { exclude: JSON.parse(event.currentTarget.dataset.exclude || '[]') }));
  $('#online-next').addEventListener('click', () => act('room.next'));
  $('#online-claim').addEventListener('click', () => { client.raw({ type: 'control.claim' }); });
  $('#online-surrender').addEventListener('click', async () => {
    const r = round();
    if (!r || !window.confirm('Bỏ cuộc lượt này? Kết quả của bạn sẽ là DNF.')) return;
    if (await act('attempt.surrender', { roundId: r.roundId })) closeArena();
  });
  $('#online-leave').addEventListener('click', async () => {
    const r = round();
    const racingNow = r?.status === 'RUNNING' && mine()?.status === 'RACING';
    const preparing = r && mine() && ['PREPARING', 'INSPECTION'].includes(r.status);
    const warning = racingNow ? 'Rời phòng khi đang thi được tính là bỏ cuộc (DNF). Rời phòng?'
      : preparing ? 'Rời phòng bây giờ sẽ hủy ván đang chuẩn bị cho cả phòng. Rời phòng?' : 'Rời phòng thi này?';
    if (!window.confirm(warning)) return;
    if (client.state !== 'online') {
      try { await client.call('POST', `rooms/${encodeURIComponent(roomId)}/leave`, {}); leaveRoomView(''); } catch (error) { showError(error.message); }
      return;
    }
    await act('room.leave');
  });
  $('#online-close').addEventListener('click', () => {
    if (window.confirm('Đóng phòng cho mọi người? Kết quả các ván đã thi vẫn xem được trong 7 ngày.')) void act('room.close');
  });
  $('#online-copy').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#room=${snap?.room.code || ''}`;
    try {
      await navigator.clipboard.writeText(link);
      $('#online-copy').textContent = '✓ Đã sao chép';
    } catch (error) { showError(`Liên kết mời: ${link}`); }
    setTimeout(() => { $('#online-copy').textContent = 'Sao chép liên kết mời'; }, 2000);
  });
  $('#online-rename').addEventListener('click', () => {
    const form = $('#online-rename-form');
    form.hidden = !form.hidden;
    if (!form.hidden) { $('#online-rename-input').value = me()?.nickname || ''; $('#online-rename-input').focus(); }
  });
  $('#online-rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await act('room.rename', { nickname: $('#online-rename-input').value })) $('#online-rename-form').hidden = true;
  });

  // Lịch sử ván trong hạn lưu (7 ngày)
  $('#online-history').addEventListener('toggle', async () => {
    if (!$('#online-history').open || !roomId) return;
    const list = $('#online-history-list');
    list.replaceChildren();
    $('#online-history-detail').replaceChildren();
    try {
      const { rounds } = await client.call('GET', `rooms/${encodeURIComponent(roomId)}/rounds`);
      if (!rounds.length) { list.innerHTML = '<li class="muted">Chưa có ván nào kết thúc.</li>'; return; }
      for (const r of rounds) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn small';
        const label = { FINALIZED: 'đã chốt', VOID: 'bị hủy sau giờ bắt đầu', CANCELLED: 'hủy trước giờ bắt đầu' }[r.status] || r.status;
        button.textContent = `Ván #${r.seq} · ${r.players} người · ${label}`;
        button.addEventListener('click', () => showRound(r.roundId));
        li.appendChild(button);
        list.appendChild(li);
      }
    } catch (error) { list.textContent = error.message; }
  });
  async function showRound(id) {
    const detail = $('#online-history-detail');
    try {
      const { round: r } = await client.call('GET', `rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(id)}`);
      detail.replaceChildren();
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = `Ván #${r.seq}: ${r.status === 'FINALIZED' ? 'đã chốt' : 'bị hủy vì ' + reasonText(r.reason)}. Chuỗi tráo: ${r.scramble}`;
      detail.appendChild(p);
      if (r.attempts.length) {
        const table = document.createElement('table');
        table.className = 'room-table';
        table.innerHTML = '<thead><tr><th scope="col">Hạng</th><th scope="col">Người chơi</th><th scope="col">Thời gian</th><th scope="col">Số nước</th></tr></thead>';
        const tbody = document.createElement('tbody');
        fillResultRows(tbody, r.attempts);
        table.appendChild(tbody);
        detail.appendChild(table);
      }
    } catch (error) { detail.textContent = error.message; }
  }

  // ---------- Điều khiển xoay ----------
  for (const [id, suffix] of [['cw', ''], ['ccw', "'"], ['half', '2']]) {
    $('#online-' + id).addEventListener('click', () => { if (buttonsAllowed()) turn(layerBase() + suffix); });
  }
  for (const id of ['layer', 'mode']) $('#online-' + id).addEventListener('change', render);
  $('#online-view').addEventListener('click', () => view?.resetView());
  document.addEventListener('keydown', (event) => {
    if (!arena || !canTurn() || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, select, textarea, .tabs, [contenteditable]')) return;
    const layer = event.key.toUpperCase();
    if (Object.hasOwn(P.BASES, layer) && !layer.endsWith('w')) {
      event.preventDefault();
      $('#online-layer').value = layer;
      turn(layer + (event.shiftKey ? "'" : ''));
    } else if (layer === '2' && buttonsAllowed()) {
      event.preventDefault();
      turn(layerBase() + '2');
    }
  });
  document.addEventListener('visibilitychange', () => {
    view?.cancelGesture();
    // Quay lại tab: đo lại độ lệch đồng hồ và lấy trạng thái mới (giờ thi không dừng khi ẩn trang).
    if (!document.hidden && roomId) { client.resync(); tick(); }
  });

  window.Rubik.online = {
    setActive(value) {
      active = value;
      window.Rubik.rooms.setActive(value && mode === 'async');
      if (!value) { view?.cancelGesture(); closeArena(); return; }
      if (mode === 'live') {
        void boot();
        autoArena();
        render();
      }
    },
    // Đang ở trong phòng thi trực tiếp: không tự tải lại trang khi có bản mới (sẽ cắt kết nối giữa ván).
    get inProgress() { return !!roomId; },
    // Liên kết mời #room=MÃ mở thẳng tab Phòng thi đấu, chế độ Thi trực tiếp.
    openFromHash() {
      if (!/^#room=/.test(location.hash)) return false;
      if (mode !== 'live') setMode('live');
      $('#nav-rooms').click();
      return true;
    },
    debug: () => ({ snap, race, arena, net: client.state, epoch: client.epoch, offset: client.offset, animating: !!view?.animating }),
  };
  $('#rooms-live').hidden = mode !== 'live';
  $('#rooms-async').hidden = mode !== 'async';
  $('#rooms-mode-live').setAttribute('aria-pressed', String(mode === 'live'));
  $('#rooms-mode-async').setAttribute('aria-pressed', String(mode === 'async'));
  window.addEventListener('hashchange', () => { if (window.Rubik.online.openFromHash()) { booted = false; void boot(); } });
})();
