// E2E: Chrome headless giả lập điện thoại + camera giả (video y4m quay 6 mặt khối Rubik).
// Kiểm tra: tự xin quyền camera, tự chụp khi giữ yên, nhận đúng màu, giải, Tiếp/Tự chạy tới cuối,
// lời giải bị huỷ khi đầu vào thay đổi. Mỗi điều kiện không đạt => thoát với mã 1.
// Chạy: node tests/e2e-camera.js http://127.0.0.1:8000/ .e2e-out   (cần google-chrome)
// hoặc `npm run test:e2e` (tự bật máy chủ, chạy cả 4 kịch bản). Biến môi trường:
//   CHROME_BIN   đường dẫn Chrome/Chromium (mặc định: google-chrome)
//   CHROME_FLAGS cờ thêm, cách nhau bằng dấu cách (ví dụ --no-sandbox trên CI)
const fs = require('fs');
const path = require('path');
const { launchChrome } = require('./lib/chrome.js');
require('../js/cube.js');
const C = globalThis.Rubik.cube;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = process.argv[2];
const outDir = path.resolve(process.argv[3]);
fs.mkdirSync(outDir, { recursive: true });

// ---------- Tạo video ----------
const W = 320, H = 240, FPS = 10;
const ST = { U: 0, R: 2, F: 5, D: 1, L: 3, B: 4 };
const CAM = { 0: [215, 212, 195], 1: [210, 200, 45], 2: [175, 30, 40], 3: [235, 105, 35], 4: [30, 75, 165], 5: [35, 155, 85] };
const solved = C.FACES.flatMap((f) => new Array(9).fill(ST[f]));
const truth = C.applyMoves(solved, "R U2 F' L D B2 R' U F2 D' L2 B U' R2");
const OFF = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

let seed = 3;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// MISTAKES=1: mô phỏng người dùng chụp nhầm (đổi chỗ Phải/Trái, mặt Trên ngược 180°, mặt Dưới lệch 90°).
// MISTAKES=2: thứ tự và chiều hoàn toàn tuỳ ý.
const SEQUENCES = {
  0: [['F', 0], ['R', 0], ['B', 0], ['L', 0], ['U', 0], ['D', 0]],
  1: [['F', 0], ['L', 0], ['B', 0], ['R', 0], ['U', 2], ['D', 1]],
  2: [['D', 1], ['B', 3], ['U', 2], ['R', 0], ['F', 1], ['L', 2]],
  3: [['D', 1], ['B', 3], ['U', 2], ['R', 0], ['F', 1], ['L', 2]],
};
const MODE = Number(process.env.MISTAKES || 0);
const SEQUENCE = SEQUENCES[MODE];

// Màu hiển thị của từng ô. MISTAKES=3: một ô đỏ trông hơi cam và một ô cam trông hơi đỏ
// (ánh sáng xấu) để app nhận nhầm cho nhau.
const paint = truth.map((c) => CAM[c]);
const AMBIG = MODE === 3
  ? [truth.findIndex((c, i) => c === 2 && i % 9 !== 4), truth.findIndex((c, i) => c === 3 && i % 9 !== 4)]
  : [];
if (MODE === 3) {
  paint[AMBIG[0]] = [222, 82, 36];
  paint[AMBIG[1]] = [205, 55, 38];
}

function faceFrame(face, rot) {
  const face9 = C.rotateFaceArray(paint.slice(OFF[face], OFF[face] + 9), rot);
  const img = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = 90; img[i * 3 + 1] = 74; img[i * 3 + 2] = 58; }
  const size = 144, x0 = (W - size) / 2, y0 = (H - size) / 2, cell = size / 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = Math.floor(x / cell), r = Math.floor(y / cell);
      const lx = x - c * cell, ly = y - r * cell;
      const inSticker = lx > 3 && lx < cell - 3 && ly > 3 && ly < cell - 3;
      const col = inSticker ? face9[r * 3 + c] : [15, 15, 15];
      const p = ((y0 + y) * W + x0 + x) * 3;
      img[p] = col[0]; img[p + 1] = col[1]; img[p + 2] = col[2];
    }
  }
  return img;
}
function noiseFrame() {
  const img = new Uint8Array(W * H * 3);
  for (let by = 0; by < H; by += 16) for (let bx = 0; bx < W; bx += 16) {
    const col = [rnd() * 255, rnd() * 255, rnd() * 255];
    for (let y = by; y < by + 16; y++) for (let x = bx; x < bx + 16; x++) {
      const p = (y * W + x) * 3; img[p] = col[0]; img[p + 1] = col[1]; img[p + 2] = col[2];
    }
  }
  return img;
}
function toYuv(img, jitter) {
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 3, r = img[p], g = img[p + 1], b = img[p + 2];
    Y[y * W + x] = cl(0.299 * r + 0.587 * g + 0.114 * b + (rnd() - 0.5) * jitter);
    if (y % 2 === 0 && x % 2 === 0) {
      const q = (y / 2) * (W / 2) + x / 2;
      U[q] = cl(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      V[q] = cl(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
    }
  }
  return Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
}
const y4m = path.join(outDir, 'cube.y4m');
const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
for (const [face, rot] of SEQUENCE) {
  const f = faceFrame(face, rot);
  for (let i = 0; i < FPS * 3; i++) parts.push(toYuv(f, 6));
  for (let i = 0; i < FPS; i++) parts.push(toYuv(noiseFrame(), 0));
}
fs.writeFileSync(y4m, Buffer.concat(parts));

// ---------- Điều kiện bắt buộc ----------
const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
  if (!ok) failures.push(name);
}

// ---------- Chạy Chrome ----------
(async () => {
  let browser = null;
  try {
    browser = await launchChrome({
      userDataDir: path.join(outDir, 'profile'),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m],
    });
    const { send, evaluate } = browser;
    const errors = [];
    browser.onEvent((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
    });
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
    };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.navigate', { url });
    await sleep(1500);
    const text = (sel) => evaluate(`document.querySelector('${sel}').textContent`);
    const activeTab = () => evaluate(`document.querySelector('.tab.active').dataset.tab`);
    check('màn hình cảm ứng (pointer: coarse)', await evaluate(`matchMedia('(pointer: coarse)').matches`));
    check('tự bật camera khi mở trang', /Tắt camera/.test(await text('#btn-camera')), await text('#camera-note'));
    check('mặc định tắt tự chụp để người dùng chủ động xác nhận màu',
      await evaluate(`!document.querySelector('#auto-capture').checked`));
    await shot('c1-start');
    let testedPreview = false;
    let shotMid = false;
    for (let i = 0; i < 160; i++) {
      await sleep(250);
      const tab = await evaluate(`document.querySelector('.tab.active').dataset.tab`);
      if (tab === 'edit') break;
      const hud = await text('#camera-hud');
      if (/Đã nhận diện màu/.test(hud)) {
        if (!testedPreview) {
          testedPreview = true;
          await evaluate(`document.querySelector('#btn-capture').click()`);
          await sleep(150);
          check('bấm Chụp mặt này => hiện preview xác nhận màu (chưa tự sang mặt kế)',
            await evaluate(`document.querySelector('#face-preview-box').classList.contains('is-preview') && !document.querySelector('#btn-retake-face').hidden`) &&
            /0\/6/.test(await text('#auto-status')), await text('#auto-status'));
          await evaluate(`document.querySelector('#btn-retake-face').click()`);
          await sleep(150);
          check('bấm Chụp lại => quay về camera trực tiếp',
            await evaluate(`!document.querySelector('#face-preview-box').classList.contains('is-preview') && document.querySelector('#btn-retake-face').hidden`));
          // Bấm xác nhận 3 lần trên cùng một tâm không được đếm thành 3 mặt:
          // sau lần đầu chuyển sang mặt kế tiếp và chờ xoay khối, không giữ mặt vừa lưu để xác nhận lại.
          for (let j = 0; j < 20 && !/Đã nhận diện màu/.test(await text('#camera-hud')); j++) await sleep(150);
          await evaluate(`document.querySelector('#btn-confirm-face').click()`);
          await sleep(200);
          await evaluate(`document.querySelector('#btn-confirm-face').click()`);
          await sleep(200);
          await evaluate(`document.querySelector('#btn-confirm-face').click()`);
          await sleep(150);
          check('bấm xác nhận 3 lần trên cùng 1 tâm => vẫn chỉ 1/6 mặt, đang chờ mặt tiếp theo',
            /1\/6/.test(await text('#auto-status')) &&
            await evaluate(`document.querySelectorAll('#face-list li.done').length === 1`),
            await text('#auto-status'));
          continue;
        }
        await evaluate(`document.querySelector('#btn-capture').click()`);
        await sleep(100);
        const st = await text('#auto-status');
        if (!shotMid && /2\/6/.test(st)) { await shot('c2-mid'); shotMid = true; }
        await evaluate(`document.querySelector('#btn-confirm-face').click()`);
      }
    }
    check('chụp và xác nhận đủ 6 mặt thì sang bước 2', await activeTab() === 'edit');
    const truthJson = JSON.stringify(truth);
    const colorsMatch = () => evaluate(`(() => {
      const truth = ${truthJson};
      const hex = Rubik.vision.PALETTE.map((p) => p.hex);
      const off = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };
      const order = ['U', 'R', 'F', 'D', 'L', 'B'];
      const toHex = (c) => '#' + c.match(/\\d+/g).map((n) => (+n).toString(16).padStart(2, '0')).join('');
      return [...document.querySelectorAll('#net .grid')].every((grid, gi) => [...grid.children].every((b, k) =>
        toHex(b.style.background) === hex[truth[off[order[gi]] + k]]));
    })()`);
    const solvedNet = () => evaluate(`[...document.querySelectorAll('#net-small .grid')].every(x => new Set([...x.children].map(c => c.style.background)).size === 1)`);
    const note = await evaluate(`(() => { const n = document.querySelector('#arrange-note'); return n.hidden ? '' : n.textContent; })()`);
    console.log('arrange note:', note || '(không)');
    if (MODE === 3) {
      console.log('suspect/suggest cells:', await evaluate(`document.querySelectorAll('#net .suspect').length + ' ? / ' + document.querySelectorAll('#net .suggest').length + ' !'`));
      await shot('c3a-suggest');
      const hasSuggest = await evaluate(`!!document.querySelector('[data-apply-suggestion]')`);
      check('có nút "Áp dụng gợi ý" cho 2 ô nhận nhầm', hasSuggest);
      if (hasSuggest) {
        await evaluate(`document.querySelector('[data-apply-suggestion]').click()`);
        await sleep(300);
      }
    }
    check('màu hợp lệ sau khi chụp' + (MODE === 3 ? ' + áp dụng gợi ý' : ''), /Màu hợp lệ/.test(await text('#validation')), await text('#validation'));
    check('lưới màu trùng khối thật (đã ghép/xoay đúng)', await colorsMatch());
    // Chạm vào 1 ô -> bảng chọn màu -> chọn màu khác -> số đếm đổi; chọn lại màu cũ -> hợp lệ lại.
    const cellSel = `document.querySelectorAll('#net .grid')[0].children[0]`;
    const orig = await evaluate(`${cellSel}.style.background`);
    await evaluate(`(() => { const r = ${cellSel}.getBoundingClientRect(); ${cellSel}.click(); })()`);
    await sleep(200);
    check('chạm ô thì mở bảng chọn màu', await evaluate(`!document.querySelector('#color-picker').hidden`));
    await shot('c3b-picker');
    await evaluate(`(() => { const b = [...document.querySelectorAll('#color-picker [data-color]')].find((x) => !x.classList.contains('current')); b.click(); })()`);
    await sleep(200);
    check('chọn màu khác => đóng bảng và báo thừa/thiếu màu',
      await evaluate(`document.querySelector('#color-picker').hidden`) && /đúng 9 lần/.test(await text('#validation')), await text('#validation'));
    await evaluate(`${cellSel}.click()`);
    await sleep(150);
    await evaluate(`(() => { const hex = (c) => '#' + c.match(/\\d+/g).map((n) => (+n).toString(16).padStart(2, '0')).join(''); const want = hex('${orig}'); const id = Rubik.vision.PALETTE.findIndex((p) => p.hex === want); document.querySelector('#color-picker [data-color="' + id + '"]').click(); })()`);
    await sleep(300);
    check('chọn lại màu cũ => hợp lệ lại, trùng khối thật',
      /Màu hợp lệ/.test(await text('#validation')) && await colorsMatch(), await text('#validation'));
    // Bấm ⟳ xoay tay một mặt: không được báo "nhận sai màu", và "Giải ngay" phải tự xoay lại.
    await evaluate(`document.querySelector('#net .net-face .label button').click()`);
    await sleep(300);
    check('xoay tay ⟳ => báo lệch hướng, không báo sai màu', /lệch hướng/.test(await text('#validation')), await text('#validation'));
    check('camera tắt khi sang bước 2', /Bật camera/.test(await text('#btn-camera')));
    await shot('c3-edit');

    await evaluate(`document.querySelector('#btn-solve').click()`);
    for (let i = 0; i < 40; i++) { await sleep(250); if (await activeTab() === 'solve') break; }
    const solLen = Number((/(\d+)/.exec(await text('#solution-length')) || [])[1]);
    check('Giải ngay => có lời giải', await activeTab() === 'solve' && solLen > 2, await text('#solution-length'));
    await evaluate(`document.querySelector('#btn-next').click()`); await sleep(900);
    await evaluate(`document.querySelector('#btn-next').click()`); await sleep(900);
    check('bấm Tiếp 2 lần => Bước 3', /^Bước 3 \//.test(await text('#step-counter')), await text('#step-counter'));
    await shot('c4-solve');
    await evaluate(`(() => { document.querySelector('#speed').value = 150; document.querySelector('#btn-play').click(); })()`);
    await sleep(1200);
    check('Tự chạy => nút Dừng, Tiếp bị khoá',
      /Dừng/.test(await text('#btn-play')) && await evaluate(`document.querySelector('#btn-next').disabled`));
    await shot('c5-playing');
    for (let i = 0; i < 120; i++) { await sleep(250); if (/Đã xong/.test(await text('#step-counter'))) break; }
    await sleep(300);
    check('chạy tới cuối => Đã xong + Xem lại',
      /Đã xong/.test(await text('#step-counter')) && /Xem lại/.test(await text('#btn-play')), await text('#step-counter'));
    check('khối cuối cùng đã giải (mỗi mặt một màu)', await solvedNet());

    // Đầu vào đổi (Xoá hết) => bước 3 không được giữ lời giải cũ.
    await evaluate(`document.querySelector('.tab[data-tab="edit"]').click()`);
    await evaluate(`document.querySelector('#btn-clear').click()`);
    await evaluate(`document.querySelector('.tab[data-tab="solve"]').click()`);
    await sleep(300);
    check('Xoá hết => bước 3 bỏ lời giải cũ',
      await text('#solution-length') === '' && await text('#step-move') === '–', `${await text('#solution-length')} ${await text('#step-move')}`);

    // Đổi dữ liệu trong lúc đang tính (Giải ngay -> Khối đã giải) => bỏ kết quả, không áp lên khối mới.
    await evaluate(`document.querySelector('.tab[data-tab="edit"]').click()`);
    await evaluate(`document.querySelector('#btn-scramble').click()`);
    await evaluate(`(() => { document.querySelector('#btn-solve').click(); document.querySelector('#btn-reset-solved').click(); })()`);
    for (let i = 0; i < 24 && /Đang tính/.test(await text('#btn-solve')); i++) await sleep(250);
    await sleep(300);
    check('đổi màu lúc đang tính => bỏ kết quả, ở lại bước 2',
      await activeTab() === 'edit' && /thay đổi/.test(await text('#toast')), await text('#toast'));
    await evaluate(`document.querySelector('.tab[data-tab="solve"]').click()`);
    await sleep(300);
    check('...và bước 3 không có lời giải nào', await text('#solution-length') === '', await text('#solution-length'));

    // Camera đang bật thì chọn ảnh có sẵn: sang bước khác rồi quay lại, camera không được tự bật đè lên ảnh.
    await evaluate(`document.querySelector('.tab[data-tab="scan"]').click()`);
    await evaluate(`document.querySelector('#btn-camera').textContent === '📷 Bật camera' && document.querySelector('#btn-camera').click()`);
    for (let i = 0; i < 20 && !/Tắt camera/.test(await text('#btn-camera')); i++) await sleep(250);
    check('bật lại camera ở bước 1', /Tắt camera/.test(await text('#btn-camera')), await text('#btn-camera'));
    await send('DOM.enable');
    const { root } = (await send('DOM.getDocument')).result;
    const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' })).result;
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(__dirname, '..', 'test-images', '1-tam-do.png')] });
    await sleep(800);
    check('chọn ảnh => tắt camera, hiện ảnh', /Bật camera/.test(await text('#btn-camera')) &&
      !await evaluate(`document.querySelector('#btn-capture').disabled`), await text('#btn-camera'));
    await evaluate(`document.querySelector('.tab[data-tab="edit"]').click()`);
    await sleep(200);
    await evaluate(`document.querySelector('.tab[data-tab="scan"]').click()`);
    await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(2000);
    check('quay lại bước 1 => vẫn là ảnh, camera không tự bật đè', /Bật camera/.test(await text('#btn-camera')), await text('#btn-camera'));

    // Ảnh hỏng: báo lỗi, giữ nguyên camera đang chạy.
    const camOn = async () => {
      for (let i = 0; i < 24 && !/Tắt camera/.test(await text('#btn-camera')); i++) await sleep(250);
      return /Tắt camera/.test(await text('#btn-camera'));
    };
    await evaluate(`document.querySelector('#btn-camera').click()`);
    check('bật camera lại', await camOn(), await text('#btn-camera'));
    const broken = path.join(outDir, 'hong.png');
    fs.writeFileSync(broken, 'day khong phai anh');
    await send('DOM.setFileInputFiles', { nodeId, files: [broken] });
    await sleep(1000);
    check('chọn ảnh hỏng => báo lỗi, camera vẫn chạy', /Tắt camera/.test(await text('#btn-camera')) &&
      /Không đọc được ảnh/.test(await text('#toast')), `${await text('#btn-camera')} | ${await text('#toast')}`);

    // Quyền camera trả về chậm (điện thoại hay gặp): lượt bật bị huỷ do đổi bước thì quay lại phải tự bật tiếp.
    await evaluate(`(() => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => new Promise((r) => setTimeout(r, 1500)).then(() => orig(c));
      document.querySelector('#btn-camera').click(); // tắt
    })()`);
    await sleep(300);
    await evaluate(`(() => {
      document.querySelector('#btn-camera').click(); // bật (đang chờ quyền)
      document.querySelector('.tab[data-tab="edit"]').click();
      document.querySelector('.tab[data-tab="scan"]').click();
    })()`);
    check('lượt bật bị huỷ do đổi bước => quay lại vẫn tự bật camera', await camOn(), await text('#btn-camera'));

    // Đang chờ quyền thì chọn ảnh: dùng ảnh, không bật camera đè, không kẹt ghi chú "đang xin quyền".
    await evaluate(`document.querySelector('#btn-camera').click()`); // tắt
    await sleep(300);
    await evaluate(`document.querySelector('#btn-camera').click()`); // bật (đang chờ quyền)
    await sleep(200);
    await send('DOM.setFileInputFiles', { nodeId, files: [path.join(__dirname, '..', 'test-images', '1-tam-do.png')] });
    await sleep(2500);
    check('chọn ảnh khi đang chờ quyền => dùng ảnh, không kẹt ghi chú',
      /Bật camera/.test(await text('#btn-camera')) && !await evaluate(`document.querySelector('#btn-capture').disabled`) &&
      !/Đang xin quyền/.test(await text('#camera-note')), `${await text('#btn-camera')} | ${await text('#camera-note')}`);

    check('không có lỗi JS trong trình duyệt', errors.length === 0, JSON.stringify(errors));
  } catch (err) {
    check('không có ngoại lệ khi chạy test', false, err && err.stack);
  } finally {
    if (browser) browser.close();
  }
  console.log(failures.length ? `\nKHÔNG ĐẠT ${failures.length} điều kiện: ${failures.join('; ')}` : '\nTất cả điều kiện ĐẠT');
  process.exitCode = failures.length ? 1 : 0;
})();
