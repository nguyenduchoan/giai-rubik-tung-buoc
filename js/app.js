/* Điều khiển giao diện: chụp màu -> kiểm tra -> hướng dẫn giải từng bước. */
(function () {
  'use strict';

  const { cube: C, solver: S, vision: V, Cube3D } = window.Rubik;
  const PAL = V.PALETTE;
  const $ = (sel) => document.querySelector(sel);

  const FACE_NAMES = { U: 'TRÊN', R: 'PHẢI', F: 'TRƯỚC', D: 'DƯỚI', L: 'TRÁI', B: 'SAU' };
  const FACE_OFFSET = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };
  const SCAN_ORDER = ['F', 'R', 'B', 'L', 'U', 'D'];

  // Bảng màu chuẩn: trắng trên, xanh lá trước, đỏ phải, cam trái, xanh dương sau, vàng dưới.
  const STANDARD = { U: 0, R: 2, F: 5, D: 1, L: 3, B: 4 };
  const SOLVED_COLORS = C.FACES.flatMap((f) => new Array(9).fill(STANDARD[f]));
  const EMPTY_COLOR = '#3a4258';
  const IS_TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // Ngưỡng tự chụp
  const AUTO = {
    sampleMs: 150, // chu kỳ lấy mẫu
    holdMs: 1000, // giữ yên bao lâu thì chụp
    maxSpread: 45, // độ phân tán màu tối đa trong 1 ô (ô sticker phải khá đồng đều)
    maxMotion: 14, // chênh lệch màu tối đa giữa 2 lần lấy mẫu để coi là "đứng yên"
    minCenterDiff: 18, // tâm phải khác tâm các mặt đã chụp (tránh chụp trùng mặt)
    maxLineRatio: 0.6, // khe giữa các sticker phải tối hơn sticker (nếu mặt chỉ có 1 màu)
    cooldownMs: 1500,
  };

  const state = {
    colors: C.FACES.flatMap((f) => [null, null, null, null, STANDARD[f], null, null, null, null]),
    rgb: new Array(54).fill(null),
    scanned: {},
    scanIndex: 0,
    solution: null,
    startColors: null,
    solutionKey: null, // màu đầu vào đã dùng để giải; đầu vào đổi thì lời giải hết hiệu lực
    step: 0,
    playing: false,
    busy: false,
    fixedFaces: new Set(), // các mặt vừa được tự đổi chỗ/xoay
    suggestion: null, // { a, b, colorA, colorB }: gợi ý sửa 2 ô bị nhận nhầm màu
    arrangeNote: null, // { kind: 'ok' | 'warn', html }
    duplicate: null, // { faces: [p1, p2], color }: 2 ảnh chụp trùng một mặt – chặn giải tới khi xử lý xong
    needsClassify: false, // có ảnh mới chưa được phân loại lại (tránh ghi đè màu đã sửa tay)
  };
  const INITIAL_COLORS = state.colors.slice();

  // ---------- Tiện ích ----------
  let toastTimer = null;
  function toast(msg, ms = 3500) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  const hex = (id) => (id === null || id === undefined ? EMPTY_COLOR : PAL[id].hex);
  const chip = (id) => `<span class="color-chip" style="background:${hex(id)}"></span>`;
  const colorName = (id) => (id === null || id === undefined ? '?' : PAL[id].name);
  const centerOf = (face, colors = state.colors) => colors[FACE_OFFSET[face] + 4];
  const activeTab = () => document.querySelector('.tab.active').dataset.tab;

  // Giữ màn hình điện thoại không tắt khi đang quay/giải.
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (e) { /* không hỗ trợ hoặc bị từ chối: bỏ qua */ }
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name !== 'scan') stopCamera();
    closePicker();
    if (name !== 'solve') state.playing = false;
    if (name === 'edit') renderEditor();
    if (name === 'scan') {
      renderScanGuide();
      if (cam.wanted) startCamera();
    }
    if (name === 'solve') renderSolve();
    keepAwake(name === 'solve');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // ================== 1. CHỤP / QUAY ==================
  const canvas = $('#camera-canvas');
  const ctx = canvas.getContext('2d');
  const frame = document.createElement('canvas');
  const frameCtx = frame.getContext('2d', { willReadFrequently: true });
  const cam = {
    mode: null, // null | 'camera' | 'image'
    video: null,
    stream: null,
    facing: 'environment',
    wanted: false, // người dùng đã bật camera (để tự bật lại khi quay về tab)
    starting: false,
    cx: 0.5, cy: 0.5, size: 0.6,
    live: null,
    lastSample: 0,
    prevRgb: null,
    stableSince: 0,
    cooldownUntil: 0,
    hint: '',
    progress: 0,
  };

  function gridRect() {
    const s = cam.size * Math.min(frame.width, frame.height);
    let x = cam.cx * frame.width - s / 2;
    let y = cam.cy * frame.height - s / 2;
    x = Math.max(0, Math.min(frame.width - s, x));
    y = Math.max(0, Math.min(frame.height - s, y));
    return { x, y, s };
  }

  function drawOverlay() {
    const { x, y, s } = gridRect();
    const lw = Math.max(2, s / 120);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(x, y, s, s);
    ctx.fill('evenodd');
    ctx.strokeStyle = cam.progress > 0 ? '#2fbf71' : '#ffffff';
    ctx.lineWidth = lw * (cam.progress > 0 ? 1.6 : 1);
    ctx.strokeRect(x, y, s, s);
    ctx.lineWidth = lw / 2;
    ctx.strokeStyle = '#ffffff';
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (s * i) / 3, y); ctx.lineTo(x + (s * i) / 3, y + s);
      ctx.moveTo(x, y + (s * i) / 3); ctx.lineTo(x + s, y + (s * i) / 3);
      ctx.stroke();
    }
    if (cam.progress > 0) {
      // Thanh tiến trình "giữ yên" dọc cạnh trên khung.
      ctx.fillStyle = '#2fbf71';
      ctx.fillRect(x, y - lw * 4, s * cam.progress, lw * 3);
    }
    if (cam.live) {
      const r = s / 18;
      cam.live.forEach((id, k) => {
        const cxp = x + ((k % 3) + 0.5) * (s / 3);
        const cyp = y + (Math.floor(k / 3) + 0.5) * (s / 3);
        ctx.beginPath();
        ctx.arc(cxp, cyp, r, 0, Math.PI * 2);
        ctx.fillStyle = PAL[id].hex;
        ctx.fill();
        ctx.lineWidth = lw / 2;
        ctx.strokeStyle = '#000';
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  function setHud(text) {
    if (cam.hint === text) return;
    cam.hint = text;
    const hud = $('#camera-hud');
    hud.hidden = !text;
    hud.textContent = text;
  }

  const currentFace = () => SCAN_ORDER[state.scanIndex];

  // Mặt đang ngắm có trùng với một mặt đã chụp khác không (so màu ô tâm)?
  function duplicateFace(rgb) {
    return SCAN_ORDER.find((f) => f !== currentFace() && state.scanned[f] && state.rgb[FACE_OFFSET[f] + 4] &&
      V.colorDistance(rgb[4], state.rgb[FACE_OFFSET[f] + 4]) < AUTO.minCenterDiff);
  }

  function autoCaptureTick(now, detail) {
    const auto = $('#auto-capture').checked && cam.mode === 'camera';
    if (!auto) { cam.progress = 0; setHud(''); return; }
    if (state.scanned[currentFace()] && SCAN_ORDER.every((f) => state.scanned[f])) { cam.progress = 0; return; }
    if (now < cam.cooldownUntil) { cam.progress = 0; return; }

    const uniform = detail.spread.every((sp) => sp <= AUTO.maxSpread);
    const motion = cam.prevRgb
      ? Math.max(...detail.rgb.map((c, k) => V.colorDistance(c, cam.prevRgb[k])))
      : Infinity;
    cam.prevRgb = detail.rgb;

    if (!uniform) {
      cam.stableSince = 0; cam.progress = 0;
      setHud('Đưa một mặt chưa chụp vào vừa khít khung 3×3');
      return;
    }
    // Mặt chỉ một màu dễ nhầm với tường/bàn: chỉ tự chụp khi thấy rõ khe tối giữa các ô.
    const distinct = new Set(detail.rgb.map(V.classifyHeuristic)).size;
    if (distinct < 2 && detail.lineRatio > AUTO.maxLineRatio) {
      cam.stableSince = 0; cam.progress = 0;
      setHud('Chưa thấy khối Rubik. Nếu mặt này chỉ có 1 màu, bấm “Chụp mặt này”.');
      return;
    }
    const dup = duplicateFace(detail.rgb);
    if (dup) {
      cam.stableSince = 0; cam.progress = 0;
      setHud(`Mặt tâm ${colorName(centerOf(dup))} đã chụp rồi – hãy xoay sang mặt khác`);
      return;
    }
    if (motion > AUTO.maxMotion) {
      cam.stableSince = 0; cam.progress = 0;
      setHud('Giữ yên khối Rubik…');
      return;
    }
    if (!cam.stableSince) cam.stableSince = now;
    cam.progress = Math.min(1, (now - cam.stableSince) / AUTO.holdMs);
    setHud('Giữ yên… sắp chụp');
    if (cam.progress >= 1) {
      cam.stableSince = 0;
      cam.progress = 0;
      captureFace(detail.rgb);
    }
  }

  function renderLoop(now) {
    if (cam.mode === 'camera' && cam.video && cam.video.readyState >= 2) {
      const w = cam.video.videoWidth, h = cam.video.videoHeight;
      if (frame.width !== w || frame.height !== h) {
        frame.width = w;
        frame.height = h;
        fitCameraBox();
      }
      frameCtx.drawImage(cam.video, 0, 0, w, h);
    }
    if (cam.mode && frame.width > 0) {
      if (canvas.width !== frame.width || canvas.height !== frame.height) {
        canvas.width = frame.width;
        canvas.height = frame.height;
      }
      ctx.drawImage(frame, 0, 0);
      if (now - cam.lastSample > AUTO.sampleMs) {
        cam.lastSample = now;
        const { x, y, s } = gridRect();
        const detail = V.sampleGridDetailed(frameCtx, x, y, s);
        cam.live = detail.rgb.map(V.classifyHeuristic);
        if (!state.scanned[currentFace()]) renderMiniFace($('#current-preview'), cam.live);
        autoCaptureTick(now, detail);
      }
      drawOverlay();
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // Khung hiển thị theo đúng tỉ lệ ảnh (điện thoại dọc thường cho video 3:4).
  function fitCameraBox() {
    const wrap = $('#camera-wrap');
    if (frame.width && frame.height) wrap.style.aspectRatio = `${frame.width} / ${frame.height}`;
  }

  function setMode(mode) {
    cam.mode = mode;
    $('#camera-placeholder').hidden = !!mode;
    $('#btn-capture').disabled = !mode;
    $('#btn-camera').textContent = mode === 'camera' ? '⏹ Tắt camera' : '📷 Bật camera';
    $('#btn-flip').hidden = mode !== 'camera';
    if (mode !== 'camera') { setHud(''); cam.progress = 0; }
    keepAwake(mode === 'camera');
  }

  const cameraSupported = () => !!(window.isSecureContext && navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia);

  function showCameraNote(html) {
    $('#camera-note').innerHTML = html;
  }

  async function startCamera() {
    if (cam.starting || cam.mode === 'camera') return;
    if (!cameraSupported()) {
      showCameraNote('Trình duyệt chỉ cho dùng camera trực tiếp khi trang mở bằng <b>https://</b>. ' +
        'Hãy dùng nút <b>📸 Chụp bằng app camera</b> bên dưới.');
      toast('Không mở được camera trực tiếp (cần HTTPS). Dùng "Chụp bằng app camera".', 6000);
      return;
    }
    cam.starting = true;
    showCameraNote('Đang xin quyền camera… Hãy bấm <b>Cho phép</b> trên hộp thoại của trình duyệt.');
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: cam.facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.playsInline = true;
      video.muted = true;
      video.srcObject = cam.stream;
      await video.play();
      cam.video = video;
      cam.wanted = true;
      cam.prevRgb = null;
      if (activeTab() !== 'scan') { stopCamera(); return; }
      setMode('camera');
      showCameraNote('');
    } catch (err) {
      if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
      cam.stream = null;
      cam.wanted = false;
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        showCameraNote('Quyền camera đang bị chặn. Bấm biểu tượng 🔒 cạnh địa chỉ trang → <b>Camera: Cho phép</b>, ' +
          'rồi bấm lại nút bên trên. Hoặc dùng <b>📸 Chụp bằng app camera</b>.');
      } else {
        showCameraNote('Không mở được camera: ' + (err && err.message ? err.message : err) +
          '. Bạn vẫn có thể dùng <b>📸 Chụp bằng app camera</b>.');
      }
    } finally {
      cam.starting = false;
    }
  }

  function stopCamera() {
    if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
    cam.stream = null;
    cam.video = null;
    if (cam.mode === 'camera') setMode(null);
  }

  // Mở trang trên điện thoại: hỏi quyền camera ngay. Máy tính: chỉ tự bật khi đã được cấp quyền trước đó.
  async function initCamera() {
    if (!cameraSupported()) {
      showCameraNote('Trang đang mở qua <b>http</b> nên trình duyệt không cho dùng camera trực tiếp. ' +
        'Dùng nút <b>📸 Chụp bằng app camera</b> bên dưới để chụp từng mặt.');
      $('#btn-camera-big').hidden = true;
      $('#btn-camera').hidden = true;
      $('#auto-capture').closest('label').hidden = true;
      return;
    }
    let permission = 'prompt';
    try {
      permission = (await navigator.permissions.query({ name: 'camera' })).state;
    } catch (e) { /* Safari cũ không hỗ trợ query camera */ }
    if (permission === 'denied') {
      showCameraNote('Quyền camera đang bị chặn. Bấm biểu tượng 🔒 cạnh địa chỉ trang để cho phép, ' +
        'hoặc dùng <b>📸 Chụp bằng app camera</b>.');
      return;
    }
    if (permission === 'granted' || IS_TOUCH) startCamera();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      const wanted = cam.wanted;
      stopCamera();
      cam.wanted = wanted;
    } else if (cam.wanted && activeTab() === 'scan') {
      startCamera();
    }
  });

  $('#btn-camera').addEventListener('click', () => {
    if (cam.mode === 'camera') { stopCamera(); cam.wanted = false; } else startCamera();
  });
  $('#btn-camera-big').addEventListener('click', () => startCamera());
  $('#btn-flip').addEventListener('click', () => {
    cam.facing = cam.facing === 'environment' ? 'user' : 'environment';
    stopCamera();
    startCamera();
  });

  // Ảnh từ app camera hoặc thư viện. Dùng data: URL để hợp với CSP của server.
  function loadImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        stopCamera();
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        frame.width = Math.round(img.width * scale);
        frame.height = Math.round(img.height * scale);
        frameCtx.drawImage(img, 0, 0, frame.width, frame.height);
        fitCameraBox();
        setMode('image');
        toast('Kéo khung lưới cho khớp với mặt Rubik rồi bấm "Chụp mặt này".');
      };
      img.onerror = () => toast('Không đọc được ảnh.');
      img.src = reader.result;
    };
    reader.onerror = () => toast('Không đọc được ảnh.');
    reader.readAsDataURL(file);
  }
  ['#file-input', '#file-camera'].forEach((sel) => {
    $(sel).addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      loadImageFile(file);
    });
  });

  $('#grid-size').addEventListener('input', (e) => { cam.size = e.target.value / 100; });

  // Kéo khung lưới.
  (function enableGridDrag() {
    let drag = null;
    const toFrame = (e) => {
      const r = canvas.getBoundingClientRect();
      const scale = Math.min(r.width / canvas.width, r.height / canvas.height);
      const ox = (r.width - canvas.width * scale) / 2;
      const oy = (r.height - canvas.height * scale) / 2;
      return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!cam.mode) return;
      drag = { p: toFrame(e), cx: cam.cx, cy: cam.cy };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = toFrame(e);
      cam.cx = Math.max(0, Math.min(1, drag.cx + (p.x - drag.p.x) / frame.width));
      cam.cy = Math.max(0, Math.min(1, drag.cy + (p.y - drag.p.y) / frame.height));
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  })();

  function flashFeedback() {
    const f = $('#flash');
    f.classList.remove('on');
    void f.offsetWidth; // khởi động lại animation
    f.classList.add('on');
    const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (navigator.vibrate && activated) navigator.vibrate(60);
  }

  function captureFace(rgbs) {
    const face = currentFace();
    if (!rgbs) {
      const { x, y, s } = gridRect();
      rgbs = V.sampleGrid(frameCtx, x, y, s);
    }
    const off = FACE_OFFSET[face];
    rgbs.forEach((rgb, k) => {
      state.rgb[off + k] = rgb;
      state.colors[off + k] = V.classifyHeuristic(rgb);
    });
    state.scanned[face] = true;
    state.needsClassify = true;
    cam.cooldownUntil = performance.now() + AUTO.cooldownMs;
    cam.prevRgb = null;
    flashFeedback();
    if (cam.mode === 'image') {
      setMode(null);
      cam.live = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (SCAN_ORDER.every((f) => state.scanned[f])) {
      const fix = classifyScanned();
      toast(fix.valid
        ? 'Đã chụp đủ 6 mặt và ghép thành khối hợp lệ! Kiểm tra lại rồi bấm "Giải ngay".'
        : fix.duplicate ? '⚠ Có 2 ảnh chụp trùng một mặt – xem hướng dẫn chụp lại ở bước 2.'
          : 'Đã chụp đủ 6 mặt. Hãy kiểm tra và sửa các ô bị nhận sai màu.', 5000);
      switchTab('edit');
      return;
    }
    // Chụp tay có thể trùng mặt đã chụp (tự chụp thì đã chặn từ trước).
    const dup = duplicateFace(rgbs);
    const next = SCAN_ORDER.findIndex((f, i) => i > state.scanIndex && !state.scanned[f]);
    state.scanIndex = next >= 0 ? next : SCAN_ORDER.findIndex((f) => !state.scanned[f]);
    const count = SCAN_ORDER.filter((f) => state.scanned[f]).length;
    if (dup) {
      toast(`⚠ Mặt vừa chụp có tâm ${colorName(centerOf(face))} giống một mặt đã chụp – có thể bạn chụp trùng. ` +
        'Bấm vào ảnh trong danh sách để chụp lại.', 6000);
    } else {
      toast(`Đã chụp ${count}/6 mặt. Xoay sang một mặt chưa chụp.`, 2000);
    }
    renderScanGuide();
  }

  $('#btn-capture').addEventListener('click', () => { if (cam.mode) captureFace(null); });

  // Chỉ cần đủ 6 mặt: thứ tự và chiều cầm tuỳ ý, app tự ghép/xoay lại (C.autoArrange).
  function scanInstruction() {
    const done = SCAN_ORDER.filter((f) => state.scanned[f]);
    const have = done.length
      ? `<br>Đã có tâm: ${done.map((f) => chip(centerOf(f))).join('')} – còn ${6 - done.length} mặt.`
      : '';
    return 'Chụp đủ <b>6 mặt</b>, mỗi mặt một lần. <b>Thứ tự và chiều cầm tuỳ ý</b> – app tự ghép ' +
      'và xoay các ảnh cho khớp nhau.' + have +
      '<br><span class="muted small">Mẹo: xoay cả khối sang ngang 4 lần để chụp 4 mặt xung quanh, ' +
      'rồi lật lên/xuống để chụp 2 mặt còn lại.</span>';
  }

  function renderMiniFace(el, ids, tiny = false) {
    el.className = 'mini-face' + (tiny ? ' tiny' : '');
    el.innerHTML = '';
    for (let k = 0; k < 9; k++) {
      const s = document.createElement('span');
      s.style.background = ids ? hex(ids[k]) : EMPTY_COLOR;
      el.appendChild(s);
    }
  }

  const faceColors = (face) => state.colors.slice(FACE_OFFSET[face], FACE_OFFSET[face] + 9);

  function renderScanGuide() {
    const face = currentFace();
    const count = SCAN_ORDER.filter((f) => state.scanned[f]).length;
    $('#scan-title').textContent = `Ảnh ${state.scanIndex + 1}/6`;
    $('#edge-top').hidden = true;
    $('#edge-bottom').hidden = true;
    $('#scan-instruction').innerHTML = scanInstruction();
    $('#scan-instruction-inline').innerHTML = scanInstruction();
    $('#auto-status').innerHTML = `Đang chụp: <b>ảnh ${state.scanIndex + 1}</b> · đã có ${count}/6 mặt`;
    renderMiniFace($('#current-preview'), state.scanned[face] ? faceColors(face) : cam.live);

    const list = $('#face-list');
    list.innerHTML = '';
    SCAN_ORDER.forEach((f, i) => {
      const li = document.createElement('li');
      li.className = (i === state.scanIndex ? 'current ' : '') + (state.scanned[f] ? 'done' : '');
      const mini = document.createElement('div');
      renderMiniFace(mini, state.scanned[f] ? faceColors(f) : null, true);
      li.appendChild(mini);
      const name = document.createElement('span');
      name.innerHTML = state.scanned[f] ? `Ảnh ${i + 1}: tâm ${chip(centerOf(f))}${colorName(centerOf(f))}` : `Ảnh ${i + 1}`;
      li.appendChild(name);
      const st = document.createElement('span');
      st.className = 'status';
      st.textContent = state.scanned[f] ? 'Đã chụp ✓ (chụp lại)' : 'Chưa chụp';
      li.appendChild(st);
      li.addEventListener('click', () => {
        state.scanIndex = i;
        cam.cooldownUntil = performance.now() + AUTO.cooldownMs;
        renderScanGuide();
      });
      list.appendChild(li);
    });
  }

  // Chỉ phân loại lại khi có ảnh mới; nếu không sẽ ghi đè các ô người dùng vừa sửa tay ở bước 2.
  $('#btn-to-edit').addEventListener('click', () => {
    if (state.needsClassify && SCAN_ORDER.every((f) => state.scanned[f])) classifyScanned();
    switchTab('edit');
  });

  /*
   * Đủ 6 ảnh: kiểm tra chụp trùng mặt trên MÀU ẢNH GỐC trước, vì classifyAll luôn ép 6 tâm thành 6 màu
   * khác nhau (mặt trùng sẽ thành "màu còn thiếu" và có thể ra khối hợp lệ giả). Rồi mới phân loại + ghép.
   * Khi trùng: giữ state.duplicate để chặn giải tới khi chụp lại, hoặc người dùng xác nhận hai ảnh là
   * hai mặt khác nhau (ignoreDuplicate) – ví dụ mặt đỏ và mặt cam đều một màu, trông giống nhau dưới đèn.
   */
  function classifyScanned({ ignoreDuplicate = false } = {}) {
    state.needsClassify = false;
    const dup = ignoreDuplicate ? null : V.duplicateCenters(state.rgb, { centerMax: AUTO.minCenterDiff });
    if (dup) {
      state.colors = state.rgb.map(V.classifyHeuristic);
      state.suggestion = null;
      state.fixedFaces = new Set();
      state.duplicate = { faces: dup, color: state.colors[dup[0] * 9 + 4] };
      state.arrangeNote = duplicateNote();
      return { valid: false, changed: 0, duplicate: true };
    }
    state.duplicate = null;
    state.colors = V.classifyAll(state.rgb);
    return autoFix();
  }

  // Các thao tác bị chặn khi còn 2 ảnh chụp trùng chưa xử lý.
  function blockedByDuplicate() {
    if (!state.duplicate) return false;
    toast('⚠ Có 2 ảnh chụp trùng một mặt – hãy chụp lại (xem hướng dẫn ở bước 2) trước khi giải.', 5000);
    renderEditor();
    return true;
  }

  function duplicateNote() {
    const { faces, color } = state.duplicate;
    return duplicateHtml(faces.map((p) => C.FACES[p]), color, true);
  }

  // faces: tên vị trí (U R F D L B) của 2 ảnh trùng; ảnh thứ hai tính là cùng màu tâm với ảnh đầu.
  function duplicateHtml(faces, color, ignorable) {
    const centers = C.FACES.map((f) => (f === faces[1] ? color : centerOf(f)));
    const missing = PAL.filter((p) => !centers.includes(p.id));
    return {
      kind: 'warn',
      html: `⚠ Các ảnh ${faces.map((f) => `<b>${SCAN_ORDER.indexOf(f) + 1}</b>`).join(' và ')} cùng có tâm ` +
        `${chip(color)}${colorName(color)} – có thể đã chụp trùng một mặt` +
        (missing.length ? ` và thiếu mặt tâm ${missing.map((p) => chip(p.id) + p.name).join(', ')}` : '') +
        '. Chụp lại: ' + faces.map((f) => `<button type="button" class="btn small" data-rescan="${f}">` +
        `📷 ảnh ${SCAN_ORDER.indexOf(f) + 1}</button>`).join(' ') +
        (ignorable ? '<br><button type="button" class="btn small" data-ignore-duplicate>' +
          'Không trùng – đây là 2 mặt khác nhau</button>' : ''),
    };
  }

  // ---------- Ghép 6 ảnh (thứ tự/chiều tuỳ ý) thành khối hợp lệ ----------
  // Cách cầm chuẩn khi giải: ưu tiên trắng trên + xanh lá trước (bảng màu phổ biến).
  const GRIP_PREFS = [
    (c) => c[0] === STANDARD.U && c[2] === STANDARD.F,
    (c) => c[0] === STANDARD.U,
    (c) => c[2] === STANDARD.F,
  ];

  function canonicalRotations(colors) {
    for (const pref of GRIP_PREFS) {
      const rots = C.findOrientation(colors, pref);
      if (rots) return rots;
    }
    return [];
  }

  /*
   * Ghép/xoay 6 ảnh cho khớp thành khối hợp lệ, rồi đưa về cách cầm chuẩn.
   * Trả về { valid, changed } và cập nhật ghi chú hiển thị ở bước 2.
   */
  function autoFix() {
    if (state.colors.some((c) => c === null)) return { valid: false, changed: 0 };
    let rotatedImages = 0;
    if (!C.validateColors(state.colors).ok) {
      const res = C.autoArrange(state.colors);
      if (!res.ok && res.reason === 'not-found') arrangeMemo = { key: state.colors.join(','), ok: false };
      if (res.ok) {
        state.colors = res.colors;
        state.rgb = C.applyArrangement(state.rgb, res.arrangement);
        rotatedImages = res.arrangement.filter((a) => a.rot).length;
      } else {
        return arrangeFailed(res);
      }
    }
    state.suggestion = null;
    const rots = canonicalRotations(state.colors);
    state.colors = C.applyCubeRotations(state.colors, rots);
    state.rgb = C.applyCubeRotations(state.rgb, rots);
    state.fixedFaces = new Set();
    const u = centerOf('U'), f = centerOf('F');
    state.arrangeNote = {
      kind: 'ok',
      html: `🪄 Đã ghép 6 ảnh thành khối hợp lệ${rotatedImages ? ` (tự xoay lại ${rotatedImages} ảnh chụp lệch chiều)` : ''}. ` +
        `Lưới bên dưới hiển thị theo cách cầm khi giải: tâm ${chip(u)}<b>${colorName(u)}</b> ở TRÊN, ` +
        `tâm ${chip(f)}<b>${colorName(f)}</b> hướng về bạn.`,
    };
    return { valid: true, changed: rotatedImages + (rots.length ? 1 : 0) };
  }

  function arrangeFailed(res) {
    if (res.reason === 'duplicate-center') {
      state.arrangeNote = duplicateHtml(res.faces.map((p) => C.FACES[p]), res.color, false);
    } else if (res.reason === 'not-found') {
      // Thường là 2 ô bị nhận nhầm màu cho nhau: thử tìm cặp ô đó để gợi ý.
      const fix = C.findSwapFix(state.colors, currentSuspects());
      state.suggestion = fix ? { a: fix.a, b: fix.b, colorA: fix.colorA, colorB: fix.colorB } : null;
      state.arrangeNote = {
        kind: 'warn',
        html: fix
          ? '⚠ Có 2 ô có vẻ bị nhận nhầm màu cho nhau (đánh dấu <span class="legend-suggest">!</span>):<ul>' +
            `<li>${cellName(fix.a)}: nên là ${chip(fix.colorA)}<b>${colorName(fix.colorA)}</b></li>` +
            `<li>${cellName(fix.b)}: nên là ${chip(fix.colorB)}<b>${colorName(fix.colorB)}</b></li></ul>` +
            '<button type="button" class="btn small primary" data-apply-suggestion>✔ Áp dụng gợi ý</button> ' +
            '<span class="small">hoặc chạm vào ô sai để tự chọn màu.</span>'
          : '⚠ Đã thử ghép và xoay các mặt nhưng vẫn không hợp lệ – có ô bị nhận sai màu. ' +
            '<b>Chạm vào ô sai</b> (ưu tiên ô có dấu <span class="legend-suspect">?</span>) để chọn lại màu; ' +
            'khi đủ 9 ô mỗi màu, app tự ghép lại.',
      };
    }
    return { valid: false, changed: 0 };
  }

  function cellName(i) {
    const k = i % 9;
    return `Mặt ${FACE_NAMES[C.FACES[Math.floor(i / 9)]]}, hàng ${Math.floor(k / 3) + 1} cột ${(k % 3) + 1}`;
  }

  // Ô có màu chụp được mơ hồ (chỉ khi có dữ liệu ảnh).
  function currentSuspects() {
    if (!state.rgb.some(Boolean)) return [];
    return V.suspectCells(state.rgb, state.colors);
  }

  // Sau khi sửa tay: nếu đủ 9 ô mỗi màu thì tự ghép/xoay lại.
  function afterManualEdit() {
    state.suggestion = null;
    state.arrangeNote = null;
    const counts = new Map();
    state.colors.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
    const complete = !counts.has(null) && counts.size === 6 && [...counts.values()].every((n) => n === 9);
    if (complete && !state.duplicate) {
      const fix = autoFix();
      if (fix.valid) toast('✓ Đã sửa – khối hợp lệ, sẵn sàng giải.');
    }
    renderEditor();
  }

  function setCellColor(idx, color) {
    if (state.colors[idx] === color) return;
    state.colors[idx] = color;
    afterManualEdit();
  }

  // ---------- Bảng chọn màu khi chạm vào một ô ----------
  const picker = $('#color-picker');
  let pickerIdx = null;

  function openPicker(idx, anchor) {
    pickerIdx = idx;
    const sug = state.suggestion;
    const hint = sug && (sug.a === idx || sug.b === idx) ? (sug.a === idx ? sug.colorA : sug.colorB) : null;
    picker.innerHTML =
      `<div class="picker-title">${cellName(idx)}<br><span class="muted small">Chọn màu đúng của ô này</span></div>` +
      '<div class="picker-grid">' + PAL.map((p) =>
        `<button type="button" data-color="${p.id}" class="${state.colors[idx] === p.id ? 'current' : ''}` +
        `${hint === p.id ? ' hint' : ''}"><i style="background:${p.hex}"></i>${p.name}` +
        `${state.colors[idx] === p.id ? ' ✓' : ''}${hint === p.id ? ' (gợi ý)' : ''}</button>`).join('') +
      '</div><button type="button" class="btn small picker-cancel" data-cancel>Huỷ</button>';
    picker.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = picker.offsetWidth, ph = picker.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(8, top)}px`;
    document.querySelectorAll('#net .grid button.picking').forEach((b) => b.classList.remove('picking'));
    anchor.classList.add('picking');
  }

  function closePicker() {
    const el = document.getElementById('color-picker');
    if (el) el.hidden = true;
    pickerIdx = null;
    document.querySelectorAll('#net .grid button.picking').forEach((b) => b.classList.remove('picking'));
  }

  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (btn && pickerIdx !== null) {
      const idx = pickerIdx;
      closePicker();
      setCellColor(idx, Number(btn.dataset.color));
      return;
    }
    if (e.target.closest('[data-cancel]')) closePicker();
  });
  document.addEventListener('pointerdown', (e) => {
    if (picker.hidden) return;
    if (e.target.closest('#color-picker') || e.target.closest('#net .grid button')) return;
    closePicker();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
  window.addEventListener('resize', closePicker);

  function clearArrangeNote() {
    state.arrangeNote = null;
    state.suggestion = null;
    state.fixedFaces = new Set();
  }

  $('#arrange-note').addEventListener('click', (e) => {
    if (e.target.closest('[data-ignore-duplicate]') && state.duplicate) {
      if (state.rgb.some((c) => !c)) state.duplicate = null;
      else if (classifyScanned({ ignoreDuplicate: true }).valid) toast('Đã bỏ cảnh báo và ghép thành khối hợp lệ.');
      renderEditor();
      return;
    }
    if (e.target.closest('[data-apply-suggestion]') && state.suggestion) {
      const { a, b, colorA, colorB } = state.suggestion;
      state.colors[a] = colorA;
      state.colors[b] = colorB;
      afterManualEdit();
      return;
    }
    const btn = e.target.closest('[data-rescan]');
    if (!btn) return;
    const face = btn.dataset.rescan;
    state.scanned[face] = false;
    state.scanIndex = SCAN_ORDER.indexOf(face);
    clearArrangeNote();
    switchTab('scan');
  });

  $('#btn-auto-arrange').addEventListener('click', () => {
    if (blockedByDuplicate()) return;
    if (C.validateColors(state.colors).ok) {
      toast('Các mặt đã hợp lệ, không cần sắp xếp lại.');
      return;
    }
    if (state.colors.some((c) => c === null)) {
      toast('Còn ô chưa có màu – hãy chụp/tô đủ 6 mặt trước.');
      return;
    }
    const fix = autoFix();
    renderEditor();
    if (fix.valid) toast('Đã ghép lại thành khối hợp lệ.');
  });

  // ================== 2. KIỂM TRA MÀU ==================
  const NET_POS = { U: [1, 2], L: [2, 1], F: [2, 2], R: [2, 3], B: [2, 4], D: [3, 2] };

  function renderNet(container, colors, { editable = false, badColors = null, suspects = null } = {}) {
    container.innerHTML = '';
    C.FACES.forEach((face) => {
      const wrap = document.createElement('div');
      wrap.className = 'net-face' + (editable && state.fixedFaces.has(C.FACES.indexOf(face)) ? ' fixed' : '');
      wrap.style.gridRow = NET_POS[face][0];
      wrap.style.gridColumn = NET_POS[face][1];
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (let k = 0; k < 9; k++) {
        const idx = FACE_OFFSET[face] + k;
        const el = document.createElement(editable ? 'button' : 'span');
        el.style.background = hex(colors[idx]);
        if (editable) {
          el.type = 'button';
          el.title = `${face}${k + 1}: ${colorName(colors[idx])}`;
          if (k === 4) el.classList.add('center');
          if (badColors && badColors.has(colors[idx])) el.classList.add('bad');
          const sug = state.suggestion;
          if (sug && (sug.a === idx || sug.b === idx)) el.classList.add('suggest');
          else if (suspects && suspects.has(idx)) el.classList.add('suspect');
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pickerIdx === idx) closePicker();
            else openPicker(idx, el);
          });
        }
        grid.appendChild(el);
      }
      wrap.appendChild(grid);
      if (editable) {
        const label = document.createElement('div');
        label.className = 'label';
        const fixedMark = state.fixedFaces.has(C.FACES.indexOf(face)) ? ' 🪄' : '';
        label.innerHTML = `<span>${face} · ${FACE_NAMES[face]}${fixedMark}</span>`;
        const rot = document.createElement('button');
        rot.type = 'button';
        rot.textContent = '⟳';
        rot.title = 'Xoay mặt này 90° theo chiều kim đồng hồ';
        rot.addEventListener('click', () => {
          rotateFace(face);
          state.suggestion = null;
          state.arrangeNote = null;
          renderEditor();
        });
        label.appendChild(rot);
        wrap.appendChild(label);
      }
      container.appendChild(wrap);
    });
  }

  function rotateFace(face) {
    const off = FACE_OFFSET[face];
    const rot = (arr) => {
      const old = arr.slice(off, off + 9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) arr[off + r * 3 + c] = old[(2 - c) * 3 + r];
    };
    rot(state.colors);
    rot(state.rgb);
  }

  function renderPalette(counts) {
    const el = $('#palette');
    el.innerHTML = '';
    PAL.forEach((p) => {
      const b = document.createElement('span');
      b.className = 'swatch';
      const n = counts[p.id] || 0;
      b.innerHTML = `<i style="background:${p.hex}"></i>${p.name} <span class="count ${n === 9 ? '' : 'bad'}">${n}/9</span>`;
      el.appendChild(b);
    });
  }

  // Khối chưa hợp lệ nhưng màu vẫn đúng, chỉ do các mặt lệch hướng/đổi chỗ (ví dụ vừa bấm ⟳)?
  let arrangeMemo = { key: null, ok: false };
  function arrangeable(colors) {
    const key = colors.join(',');
    if (arrangeMemo.key !== key) arrangeMemo = { key, ok: C.autoArrange(colors, { maxNodes: 4e5 }).ok };
    return arrangeMemo.ok;
  }

  function renderEditor() {
    const counts = {};
    state.colors.forEach((c) => { if (c !== null) counts[c] = (counts[c] || 0) + 1; });
    renderPalette(counts);
    if (state.duplicate) state.arrangeNote = duplicateNote();
    const v = state.duplicate
      ? { ok: false, error: 'Có 2 ảnh chụp trùng một mặt.' }
      : C.validateColors(state.colors);
    const allNine = PAL.every((p) => counts[p.id] === 9);
    const fixable = !v.ok && !state.duplicate && allNine && arrangeable(state.colors);
    const badColors = new Set(Object.keys(counts).filter((c) => counts[c] > 9).map(Number));
    const suspects = v.ok || fixable ? null : new Set(currentSuspects()
      .filter((s) => s.ratio > 0.75).slice(0, 6).map((s) => s.index));
    closePicker();
    renderNet($('#net'), state.colors, { editable: true, badColors, suspects });
    const note = $('#arrange-note');
    note.hidden = !state.arrangeNote;
    if (state.arrangeNote) {
      note.className = 'arrange-note' + (state.arrangeNote.kind === 'warn' ? ' warn' : '');
      note.innerHTML = state.arrangeNote.html;
    }
    const val = $('#validation');
    val.className = 'validation ' + (v.ok ? 'ok' : fixable ? '' : 'err');
    val.textContent = v.ok ? '✓ Màu hợp lệ – sẵn sàng giải.'
      : state.duplicate ? '⚠ Có 2 ảnh chụp trùng một mặt – chụp lại ảnh bị trùng trước khi giải.'
      : fixable ? '↻ Các mặt đang lệch hướng so với nhau (màu vẫn đúng) – bấm 🧠 Giải ngay, app tự xoay lại cho khớp.'
      : allNine ? '⚠ Khối chưa khớp – có ô bị nhận sai màu. Chạm vào ô sai để chọn lại màu.'
        : '⚠ ' + v.error;
    val.title = v.ok ? '' : v.error;
  }

  $('#btn-scramble').addEventListener('click', () => {
    const moves = C.randomScramble(22);
    state.colors = C.applyMoves(SOLVED_COLORS, moves);
    state.rgb = new Array(54).fill(null);
    state.scanned = {};
    state.duplicate = null;
    state.needsClassify = false;
    clearArrangeNote();
    state.suggestion = null;
    renderEditor();
    toast('Đã tráo: ' + moves.map(C.moveToString).join(' '), 6000);
  });
  $('#btn-reset-solved').addEventListener('click', () => {
    state.colors = SOLVED_COLORS.slice();
    state.duplicate = null;
    clearArrangeNote();
    renderEditor();
  });
  $('#btn-clear').addEventListener('click', () => {
    state.colors = state.colors.map((c, i) => (i % 9 === 4 ? c : null));
    state.rgb = new Array(54).fill(null);
    state.scanned = {};
    state.scanIndex = 0;
    state.duplicate = null;
    state.needsClassify = false;
    clearArrangeNote();
    renderEditor();
  });

  // ---------- Bộ giải (Web Worker nếu có, ngược lại chạy trên luồng chính) ----------
  const SOLVE_OPTS = { targetLength: 20, timeLimit: 1500 };
  const solverWorker = { worker: null, seq: 0, pending: new Map() };

  function failWorker(reason) {
    solverWorker.worker = null;
    solverWorker.pending.forEach(({ reject }) => reject({ fallback: true, reason }));
    solverWorker.pending.clear();
  }

  try {
    const w = new Worker('js/solver-worker.js?v=20261106');
    w.onmessage = (e) => {
      const p = solverWorker.pending.get(e.data.id);
      if (!p) return;
      solverWorker.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.moves);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => { e.preventDefault(); failWorker(e.message); };
    solverWorker.worker = w;
    w.postMessage({ id: ++solverWorker.seq, type: 'init' });
  } catch (err) {
    solverWorker.worker = null; // ví dụ mở trực tiếp file:// trên Chrome
  }

  function solveOnMainThread(facelets) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try { resolve(S.solve(facelets, SOLVE_OPTS)); } catch (e) { reject(e); }
      }, 50);
    });
  }

  function solveAsync(facelets) {
    const w = solverWorker.worker;
    if (!w) return solveOnMainThread(facelets);
    return new Promise((resolve, reject) => {
      const id = ++solverWorker.seq;
      solverWorker.pending.set(id, { resolve, reject });
      w.postMessage({ id, type: 'solve', facelets, options: SOLVE_OPTS });
    }).catch((err) => {
      if (err && err.fallback) return solveOnMainThread(facelets);
      throw err;
    });
  }

  $('#btn-solve').addEventListener('click', async () => {
    if (state.busy || blockedByDuplicate()) return;
    let v = C.validateColors(state.colors);
    if (!v.ok && !state.colors.some((c) => c === null)) {
      const fix = autoFix();
      v = C.validateColors(state.colors);
      if (fix.valid) toast('🪄 Đã tự ghép/xoay các mặt cho khớp rồi giải.', 4000);
      else renderEditor();
    }
    if (!v.ok) {
      toast('Chưa thể giải: ' + v.error, 5000);
      return;
    }
    state.busy = true;
    const btn = $('#btn-solve');
    btn.disabled = true;
    btn.textContent = '⏳ Đang tính lời giải…';
    // Chốt đầu vào trước khi chờ bộ giải: người dùng vẫn sửa/tráo/xoá được trong lúc đó.
    const input = state.colors.slice();
    const key = input.join(',');
    try {
      const moves = await solveAsync(v.facelets);
      if (state.colors.join(',') !== key) {
        toast('Màu đã thay đổi trong lúc tính nên bỏ lời giải cũ – bấm "Giải ngay" lại để giải khối mới.', 5000);
        return;
      }
      state.solution = moves;
      state.startColors = input;
      state.solutionKey = key;
      state.step = 0;
      state.playing = false;
      switchTab('solve');
    } catch (err) {
      toast('Lỗi khi giải: ' + (err.message || err), 6000);
    } finally {
      state.busy = false;
      btn.disabled = false;
      btn.textContent = '🧠 Giải ngay';
    }
  });

  // ================== 3. HƯỚNG DẪN GIẢI ==================
  const view3d = new Cube3D($('#cube3d'), { size: IS_TOUCH && window.innerWidth < 500 ? 46 : 58 });
  view3d.setColors(state.colors.map(hex));

  const MOVE_TEXT = {
    U: { name: 'mặt TRÊN', cw: 'hàng trên cùng xoay sang TRÁI', ccw: 'hàng trên cùng xoay sang PHẢI' },
    D: { name: 'mặt DƯỚI', cw: 'hàng dưới cùng xoay sang PHẢI', ccw: 'hàng dưới cùng xoay sang TRÁI' },
    R: { name: 'mặt PHẢI', cw: 'cột bên phải đẩy LÊN trên', ccw: 'cột bên phải kéo XUỐNG dưới' },
    L: { name: 'mặt TRÁI', cw: 'cột bên trái kéo XUỐNG dưới', ccw: 'cột bên trái đẩy LÊN trên' },
    F: {
      name: 'mặt TRƯỚC',
      cw: 'mặt hướng về bạn quay theo chiều kim đồng hồ',
      ccw: 'mặt hướng về bạn quay ngược chiều kim đồng hồ',
    },
    B: {
      name: 'mặt SAU',
      cw: 'nhìn từ phía trước: lớp sau cùng quay ngược chiều kim đồng hồ (phần trên đi sang TRÁI)',
      ccw: 'nhìn từ phía trước: lớp sau cùng quay theo chiều kim đồng hồ (phần trên đi sang PHẢI)',
    },
  };
  const HIDDEN_FACES = { L: true, D: true, B: true };

  function describeMove(m) {
    const t = MOVE_TEXT[m.face];
    const c = centerOf(m.face, state.startColors);
    const name = `${t.name} (tâm ${chip(c)}<b>${colorName(c)}</b>)`;
    let text;
    if (m.power === 2) text = `Xoay ${name} <b>180°</b> (hai lần 90°, chiều nào cũng được).`;
    else if (m.power === 1) text = `Xoay ${name} 90° <b>theo chiều kim đồng hồ</b> – ${t.cw}.`;
    else text = `Xoay ${name} 90° <b>ngược chiều kim đồng hồ</b> – ${t.ccw}.`;
    if (HIDDEN_FACES[m.face]) {
      text += '<span class="hidden-face">Mặt này bị khuất ở góc nhìn mặc định – kéo hình 3D để quan sát.</span>';
    }
    return text;
  }

  function colorsAtStep(step) {
    return C.applyMoves(state.startColors, state.solution.slice(0, step));
  }

  // Đầu vào đã đổi kể từ lúc giải (sửa màu, xoay mặt, tráo, xoá, chụp lại…) thì bỏ lời giải cũ.
  function dropStaleSolution() {
    if (!state.solution || state.solutionKey === state.colors.join(',')) return;
    state.solution = null;
    state.startColors = null;
    state.solutionKey = null;
    state.step = 0;
    state.playing = false;
  }

  function renderSolve() {
    dropStaleSolution();
    if (!state.solution) {
      if (!view3d.animating) view3d.setColors(state.colors.map(hex));
      $('#hold-hint').innerHTML = 'Chưa có lời giải. Hãy chụp/nhập màu rồi bấm <b>Giải ngay</b> ở bước 2.';
      $('#step-counter').textContent = '';
      $('#step-move').textContent = '–';
      $('#step-desc').textContent = '';
      $('#move-list').innerHTML = '';
      $('#solution-length').textContent = '';
      $('#progress-bar').style.width = '0%';
      ['#btn-first', '#btn-prev', '#btn-next', '#btn-play'].forEach((s) => { $(s).disabled = true; });
      renderNet($('#net-small'), state.colors);
      return;
    }
    const sol = state.solution;
    const cc = (f) => centerOf(f, state.startColors);
    const tag = (f) => `${chip(cc(f))}<b>${colorName(cc(f))}</b>`;
    $('#hold-hint').innerHTML =
      `<b>Cách cầm trước khi giải:</b> tâm ${tag('U')} ở <b>TRÊN</b>, tâm ${tag('F')} hướng <b>về phía bạn</b>. ` +
      `Khi đó bên PHẢI là ${tag('R')}, bên TRÁI là ${tag('L')}, phía SAU là ${tag('B')}, dưới ĐÁY là ${tag('D')}. ` +
      'Giữ nguyên cách cầm này đến hết, chỉ xoay từng lớp theo hướng dẫn.';
    $('#solution-length').textContent = `(${sol.length} bước)`;
    $('#progress-bar').style.width = sol.length ? `${(100 * state.step) / sol.length}%` : '100%';

    const colors = colorsAtStep(state.step);
    if (!view3d.animating) view3d.setColors(colors.map(hex));
    renderNet($('#net-small'), colors);

    const done = state.step >= sol.length;
    if (sol.length === 0) {
      $('#step-counter').textContent = '';
      $('#step-move').textContent = '🎉';
      $('#step-desc').innerHTML = 'Khối Rubik đã ở trạng thái giải xong!';
    } else if (done) {
      $('#step-counter').textContent = `Đã xong ${sol.length}/${sol.length} bước`;
      $('#step-move').textContent = '🎉';
      $('#step-desc').innerHTML = 'Hoàn thành! Khối Rubik của bạn đã được giải.';
    } else {
      const m = sol[state.step];
      $('#step-counter').textContent = `Bước ${state.step + 1} / ${sol.length}`;
      $('#step-move').textContent = C.moveToString(m);
      $('#step-desc').innerHTML = describeMove(m) + (state.playing ? '' :
        '<br><span class="muted small">Làm xong trên khối thật thì bấm “Tiếp”, hoặc “Tự chạy” để xem hết một lượt.</span>');
    }
    view3d.setHighlight(done || view3d.animating ? null : sol[state.step] && sol[state.step].face);

    $('#btn-first').disabled = state.step === 0 || state.playing;
    $('#btn-prev').disabled = state.step === 0 || state.playing;
    $('#btn-next').disabled = done || state.playing;
    $('#btn-play').disabled = sol.length === 0;
    $('#btn-play').textContent = state.playing ? '⏸ Dừng' : done ? '↻ Xem lại' : '⏩ Tự chạy';
    $('#btn-play').classList.toggle('primary', state.playing);

    const list = $('#move-list');
    list.innerHTML = '';
    sol.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = C.moveToString(m);
      b.title = `Bước ${i + 1}`;
      if (i < state.step) b.classList.add('done');
      if (i === state.step) b.classList.add('current');
      b.addEventListener('click', () => {
        if (view3d.animating) return;
        state.playing = false;
        state.step = i;
        renderSolve();
      });
      list.appendChild(b);
    });
  }

  const speed = () => Number($('#speed').value);

  /*
   * Trong lúc hình 3D đang xoay, người dùng có thể sang bước 2 và giải khối khác. Khi hoạt ảnh cũ xong,
   * chỉ cập nhật bước nếu vẫn là lời giải đó; nếu không thì vẽ lại theo lời giải mới (hoạt ảnh cũ đã tô màu cũ).
   */
  async function animateStep(delta) {
    const sol = state.solution;
    const from = state.step;
    const to = from + delta;
    if (!sol || view3d.animating || to < 0 || to > sol.length) return;
    const m = delta > 0 ? sol[from] : C.inverseMove(sol[to]);
    view3d.setHighlight(null);
    const target = colorsAtStep(to);
    await view3d.animateMove(m, speed(), () => view3d.setColors(target.map(hex)));
    if (state.solution === sol && state.step === from) state.step = to;
    renderSolve();
  }
  const stepForward = () => animateStep(1);
  const stepBack = () => animateStep(-1);

  // Tự chạy liên tục hết toàn bộ lời giải trong một lượt (bấm lại để dừng).
  async function play() {
    if (state.playing || !state.solution) return;
    if (state.step >= state.solution.length) state.step = 0;
    state.playing = true;
    renderSolve();
    while (state.playing && state.step < state.solution.length) {
      await stepForward();
      if (state.playing && state.step < state.solution.length) {
        await new Promise((r) => setTimeout(r, speed() * 0.6));
      }
    }
    state.playing = false;
    renderSolve();
  }

  function togglePlay() {
    if (state.playing) {
      state.playing = false;
      renderSolve();
    } else {
      play();
    }
  }

  $('#btn-next').addEventListener('click', () => { state.playing = false; stepForward(); });
  $('#btn-prev').addEventListener('click', () => { state.playing = false; stepBack(); });
  $('#btn-first').addEventListener('click', () => {
    if (view3d.animating) return;
    state.playing = false;
    state.step = 0;
    renderSolve();
  });
  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-reset-view').addEventListener('click', () => view3d.resetView());

  document.addEventListener('keydown', (e) => {
    if (activeTab() !== 'solve' || !state.solution) return;
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); state.playing = false; stepForward(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); state.playing = false; stepBack(); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  });

  // ---------- Tự cập nhật khi server có bản mới ----------
  // Điện thoại giữ tab rất lâu: tab mở từ trước khi triển khai vẫn chạy mã cũ (và các lỗi cũ) cho tới khi tải lại.
  const scriptVersion = (html) => (/js\/app\.js[?]v=([0-9A-Za-z]+)/.exec(html) || [])[1];
  const APP_VERSION = scriptVersion(($('script[src*="app.js"]') || {}).outerHTML || '');
  let lastUpdateCheck = -Infinity;

  async function checkForUpdate() {
    if (!APP_VERSION || location.protocol === 'file:' || performance.now() - lastUpdateCheck < 30000) return;
    lastUpdateCheck = performance.now();
    let latest;
    try {
      latest = scriptVersion(await (await fetch(location.pathname, { cache: 'no-store' })).text());
    } catch (e) { return; }
    if (!latest || latest === APP_VERSION) return;
    // Chỉ tự tải lại khi trang còn nguyên như lúc mở: chưa chụp, chưa tô/sửa màu, chưa giải.
    const pristine = !state.solution && !SCAN_ORDER.some((f) => state.scanned[f]) &&
      state.colors.every((c, i) => c === INITIAL_COLORS[i]);
    if (pristine) { location.reload(); return; }
    $('#update-banner').hidden = false;
  }
  $('#btn-reload').addEventListener('click', () => location.reload());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) checkForUpdate(); });
  checkForUpdate();

  renderScanGuide();
  renderSolve();
  initCamera();
})();
