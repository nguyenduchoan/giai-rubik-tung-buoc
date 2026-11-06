// E2E: các ca trạng thái dễ sai, chạy trên Chrome headless, nhập ảnh qua nút "Chọn ảnh có sẵn".
//   1. Phát hiện chụp trùng (kể cả khi ảnh trùng bị nhận thành màu còn thiếu) thì phải chặn giải
//      cho tới khi chụp lại, hoặc người dùng xác nhận hai ảnh là hai mặt khác nhau.
//   2. Hoạt ảnh của lời giải cũ kết thúc sau khi đã có lời giải mới thì không được làm nhảy bước.
//   3. Quay lại bước chụp rồi sang lại bước 2 (không chụp thêm) thì không được ghi đè màu đã sửa tay.
//   4. Máy chủ có bản mới: không tự tải lại khi người dùng đã tô màu thủ công.
//   5. Giải xong rồi chụp lại thành ảnh trùng (màu không đổi) thì lời giải cũ phải bị huỷ.
//   6. Chụp lại một mặt không làm mất các ô đã sửa tay ở mặt khác.
//   7. Lời giải xong khi người dùng đã sang bước 1 thì không kéo họ sang bước 3; đang ở bước 3 thì hiện ngay.
//   8. Chụp 5 mặt + tô tay mặt thứ 6 (app tự xoay cả khối), rồi chụp nốt mặt 6: không lỗi, không mất ảnh.
//   9. Khoá giữ màn hình ở bước 3: bật/tắt đúng khi đổi bước nhanh, xin lại khi trang hiện lại.
// Chạy: node tests/e2e-state.js [thư mục kết quả]   (hoặc npm run test:e2e)
// Biến môi trường: CHROME_BIN, CHROME_FLAGS (như tests/e2e-camera.js), E2E_STATE_PORT (mặc định 8766).
// Mỗi điều kiện không đạt => thoát với mã 1.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { start } = require('../scripts/serve.js');
const { launchChrome } = require('./lib/chrome.js');
require('../js/cube.js');

const C = globalThis.Rubik.cube;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join('.e2e-out', 'state'));
const PORT = Number(process.env.E2E_STATE_PORT || 8766);

// ---------- Ảnh mặt Rubik dạng PNG (không cần thư viện) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const p = y * (w * 3 + 1) + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
// Mặt 3x3 chiếm đúng 60% giữa ảnh (khớp khung lưới mặc định của app), có khe tối giữa các ô.
function faceImage(color) {
  const N = 300, x0 = 60, size = 180, cell = 60;
  return png(N, N, (x, y) => {
    const fx = x - x0, fy = y - x0;
    if (fx < 0 || fy < 0 || fx >= size || fy >= size) return [90, 74, 58];
    const lx = fx % cell, ly = fy % cell;
    return lx < 4 || ly < 4 || lx >= cell - 4 || ly >= cell - 4 ? [15, 15, 15] : color;
  });
}

const RGB = {
  W: [215, 212, 195], Y: [210, 200, 45], R: [175, 30, 40], O: [235, 105, 35], B: [30, 75, 165], G: [35, 155, 85],
  // Chụp lại mặt đỏ dưới ánh sáng hơi vàng: vẫn rất gần màu đỏ ở trên (bị coi là chụp trùng)
  // nhưng nhận màu từng ô lại ra CAM, đúng màu của mặt còn thiếu.
  R2: [180, 70, 48],
};

// ---------- Điều kiện bắt buộc ----------
const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
  if (!ok) failures.push(name);
}

(async () => {
  fs.rmSync(outDir, { recursive: true, force: true });
  const imgDir = path.join(outDir, 'img');
  fs.mkdirSync(imgDir, { recursive: true });
  for (const [name, color] of Object.entries(RGB)) fs.writeFileSync(path.join(imgDir, `${name}.png`), faceImage(color));
  const solvedImg = (faces) => faces.map((f) => path.join(imgDir, `${f}.png`));
  // Thứ tự ô chụp của app: Trước, Phải, Sau, Trái, Trên, Dưới.
  const DUP_SET = solvedImg(['G', 'R', 'B', 'R2', 'W', 'Y']); // thiếu mặt cam, ảnh 4 chụp lại mặt đỏ
  const SOLVED_SET = solvedImg(['G', 'R', 'B', 'O', 'W', 'Y']); // khối đã giải, đúng cách cầm chuẩn
  // Khối đã giải cầm nghêng (lật quanh trục Phải): app sẽ phải xoay cả khối về cách cầm chuẩn.
  const LETTER = ['W', 'Y', 'R', 'O', 'B', 'G'];
  const ST = { U: 0, R: 2, F: 5, D: 1, L: 3, B: 4 };
  const tilted = C.rotateWholeCube(C.FACES.flatMap((f) => new Array(9).fill(ST[f])), 'R');
  const TILT = ['F', 'R', 'B', 'L', 'U', 'D'].map((f) => LETTER[tilted[C.FACES.indexOf(f) * 9 + 4]]);
  const REAL_CUBE = fs.readdirSync(path.join(ROOT, 'test-images')).filter((f) => f.endsWith('.png')).sort()
    .map((f) => path.join(ROOT, 'test-images', f)); // khối thật, lời giải 8 bước

  // Bản sao tạm của trang để giả lập "máy chủ có bản mới" mà không đụng vào mã nguồn.
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-e2e-state-'));
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(site, 'index.html'));
  fs.cpSync(path.join(ROOT, 'css'), path.join(site, 'css'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'js'), path.join(site, 'js'), { recursive: true });
  const server = await start(PORT, '127.0.0.1', site);
  const url = `http://127.0.0.1:${PORT}/`;

  let browser = null;
  try {
    browser = await launchChrome({ userDataDir: path.join(outDir, 'profile'), args: ['--deny-permission-prompts'] });
    const { send, evaluate } = browser;
    const errors = [];
    browser.onEvent((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    });
    const text = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.trim() : null; })()`);
    const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const activeTab = () => evaluate(`document.querySelector('.tab.active').dataset.tab`);
    const tab = async (name) => { await click(`.tab[data-tab="${name}"]`); await sleep(200); };
    const toastText = () => evaluate(`(() => { const t = document.querySelector('#toast'); return t.hidden ? '' : t.textContent; })()`);
    const cell = (face, k) => `document.querySelectorAll('#net .grid')[${face}].children[${k}]`;
    const cellColor = (face, k) => evaluate(`${cell(face, k)}.style.background`);
    const pick = async (face, k, colorId) => {
      await evaluate(`${cell(face, k)}.click()`);
      await sleep(150);
      await click(`#color-picker [data-color="${colorId}"]`);
      await sleep(300);
    };
    const open = async () => {
      await send('Page.navigate', { url });
      await sleep(2000);
    };
    const upload = async (files) => {
      const { root } = (await send('DOM.getDocument')).result;
      const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' })).result;
      for (const f of files) {
        await send('DOM.setFileInputFiles', { nodeId, files: [f] });
        await sleep(500);
        await click('#btn-capture');
        await sleep(400);
      }
      await sleep(800);
    };
    const waitSolve = async () => {
      for (let i = 0; i < 40 && await activeTab() !== 'solve'; i++) await sleep(150);
    };
    // Bấm vào ảnh thứ i (1..6) trong danh sách ở bước 1 để chụp lại ảnh đó.
    const chooseShot = async (i) => {
      await tab('scan');
      await evaluate(`document.querySelectorAll('#face-list li')[${i - 1}].click()`);
      await sleep(200);
    };

    await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
    // Giả lập Wake Lock API (request/release bất đồng bộ như thật) để đếm số khoá đang giữ.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const locks = new Set();
      const drop = (l) => { if (!l.released) { l.released = true; locks.delete(l); l.dispatchEvent(new Event('release')); } };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
        request: async () => {
          await new Promise((r) => setTimeout(r, 60));
          const l = new EventTarget();
          l.released = false;
          l.release = async () => { await new Promise((r) => setTimeout(r, 60)); drop(l); };
          locks.add(l);
          return l;
        },
      } });
      window.__wakeLocks = () => locks.size;
      window.__browserReleaseLocks = () => [...locks].forEach(drop);
    })();` });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 1, mobile: true });

    // ----- 4. Có bản mới trên máy chủ nhưng người dùng đã tô màu thủ công -----
    console.log('\n[4] Tự cập nhật khi đã tô màu thủ công');
    await open();
    await evaluate('window.__samePage = true');
    await tab('edit');
    await pick(0, 0, 2);
    const painted = await cellColor(0, 0);
    const indexPath = path.join(site, 'index.html');
    fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8').replace(/\?v=[0-9A-Za-z]+/g, '?v=e2enew'));
    await sleep(31000); // app chỉ kiểm tra bản mới tối đa 30 giây/lần
    await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(2000);
    check('không tự tải lại trang', await evaluate('window.__samePage === true'));
    check('hiện nút "Tải lại" để người dùng tự chọn', await evaluate(`!document.querySelector('#update-banner').hidden`));
    check('ô vừa tô vẫn giữ màu', await evaluate(`!!document.querySelector('#net')`) && await cellColor(0, 0) === painted);

    // ----- 3. Quay lại bước chụp không được ghi đè màu đã sửa tay -----
    console.log('\n[3] Quay lại bước chụp rồi sang lại bước 2');
    await open();
    await upload(REAL_CUBE);
    check('chụp đủ 6 ảnh khối thật => hợp lệ', /Màu hợp lệ/.test(await text('#validation')), await text('#validation'));
    const before = await cellColor(0, 0);
    const otherColor = await evaluate(`(() => { ${cell(0, 0)}.click(); const b = [...document.querySelectorAll('#color-picker [data-color]')].find((x) => !x.classList.contains('current')); const id = b.dataset.color; document.querySelector('#color-picker [data-cancel]').click(); return id; })()`);
    await pick(0, 0, otherColor);
    const edited = await cellColor(0, 0);
    check('sửa tay 1 ô => báo thừa/thiếu màu', edited !== before && /đúng 9 lần/.test(await text('#validation')), await text('#validation'));
    await tab('scan');
    await click('#btn-to-edit');
    await sleep(400);
    check('sang lại bước 2 => vẫn giữ màu đã sửa', await cellColor(0, 0) === edited && /đúng 9 lần/.test(await text('#validation')),
      `${await cellColor(0, 0)} | ${await text('#validation')}`);
    await pick(0, 0, await evaluate(`Rubik.vision.PALETTE.findIndex((p) => p.hex === '#' + ${JSON.stringify(before)}.match(/\\d+/g).map((n) => (+n).toString(16).padStart(2, '0')).join(''))`));
    check('chọn lại màu cũ => hợp lệ lại', /Màu hợp lệ/.test(await text('#validation')), await text('#validation'));

    // ----- 2. Hoạt ảnh cũ không được làm nhảy bước của lời giải mới -----
    console.log('\n[2] Giải lại trong lúc hình 3D đang xoay');
    await click('#btn-solve');
    await waitSolve();
    check('giải khối thật => Bước 1 / 8', /^Bước 1 \/ 8/.test(await text('#step-counter')), await text('#step-counter'));
    await evaluate(`document.querySelector('#speed').value = 1200`);
    await evaluate(`(() => {
      document.querySelector('#btn-next').click();          // bắt đầu xoay bước 1 (~1,2 giây)
      document.querySelector('.tab[data-tab="edit"]').click();
      document.querySelector('#btn-solve').click();         // giải lại ngay khi hình còn đang xoay
    })()`);
    await sleep(2500);
    check('lời giải mới vẫn ở Bước 1 sau khi hoạt ảnh cũ kết thúc',
      await activeTab() === 'solve' && /^Bước 1 \/ 8/.test(await text('#step-counter')), await text('#step-counter'));
    await click('#btn-next');
    await sleep(1800);
    check('bấm Tiếp => Bước 2 / 8 bình thường', /^Bước 2 \/ 8/.test(await text('#step-counter')), await text('#step-counter'));

    // ----- 1. Phát hiện chụp trùng thì chặn giải -----
    console.log('\n[1] Ảnh chụp trùng bị nhận thành màu còn thiếu');
    await open();
    await upload(DUP_SET);
    const note = await text('#arrange-note');
    check('báo chụp trùng ảnh 2 và 4, thiếu mặt cam', /chụp trùng/.test(note) && /Cam/.test(note), note);
    check('không báo "Màu hợp lệ"', !/Màu hợp lệ/.test(await text('#validation')), await text('#validation'));
    await click('#btn-solve');
    await sleep(1500);
    check('bấm Giải ngay => không giải, ở lại bước 2', await activeTab() === 'edit' && /chụp trùng/.test(await toastText()),
      `${await activeTab()} | ${await toastText()}`);
    await tab('solve');
    check('bước 3 không có lời giải', await text('#solution-length') === '', await text('#solution-length'));
    await tab('edit');
    await pick(0, 0, 3);
    await pick(0, 0, 0); // trả về đúng màu trắng (ô sửa tay được giữ qua lần chụp lại bên dưới)
    check('sửa tay vẫn giữ cảnh báo chụp trùng', /chụp trùng/.test(await text('#arrange-note')) && !/Màu hợp lệ/.test(await text('#validation')),
      `${await text('#arrange-note')} | ${await text('#validation')}`);
    await evaluate(`[...document.querySelectorAll('[data-rescan]')].find((b) => /ảnh 4/.test(b.textContent)).click()`);
    await sleep(400);
    check('bấm chụp lại ảnh 4 => về bước 1', await activeTab() === 'scan' && /ảnh 4/.test(await text('#auto-status')), await text('#auto-status'));
    await upload(solvedImg(['O']));
    check('chụp lại đúng mặt cam => hợp lệ, hết cảnh báo',
      /Màu hợp lệ/.test(await text('#validation')) && !/chụp trùng/.test(await text('#arrange-note') || ''), await text('#validation'));
    await click('#btn-solve');
    await waitSolve();
    check('giải được (khối đã giải: 0 bước)', await activeTab() === 'solve' && /\(0 bước\)/.test(await text('#solution-length')), await text('#solution-length'));

    console.log('\n[1b] Cảnh báo chụp trùng sai (hai mặt khác nhau trông giống nhau)');
    await open();
    await upload(DUP_SET);
    check('có nút xác nhận hai ảnh khác nhau', await evaluate(`!!document.querySelector('[data-ignore-duplicate]')`));
    await click('[data-ignore-duplicate]');
    await sleep(500);
    check('xác nhận => bỏ cảnh báo, phân loại lại và cho giải',
      !/chụp trùng/.test(await text('#arrange-note') || '') && /Màu hợp lệ/.test(await text('#validation')), await text('#validation'));

    // ----- 5. Giải xong rồi chụp lại thành ảnh trùng, màu không đổi -----
    console.log('\n[5] Chụp lại thành ảnh trùng sau khi đã giải');
    await open();
    await upload(SOLVED_SET);
    await click('#btn-solve');
    await waitSolve();
    check('giải khối đã giải => 0 bước', /\(0 bước\)/.test(await text('#solution-length')), await text('#solution-length'));
    const colorsBefore = await evaluate(`[...document.querySelectorAll('#net-small .grid span')].map((s) => s.style.background).join()`);
    await chooseShot(4); // mặt cam
    await upload(solvedImg(['R2'])); // chụp nhầm lại mặt đỏ, bị nhận thành cam => màu y hệt cũ
    check('bước 2 báo chụp trùng', /chụp trùng/.test(await text('#arrange-note')), await text('#arrange-note'));
    check('màu các ô không đổi (đúng ca khó)', await evaluate(`[...document.querySelectorAll('#net .grid button')].map((s) => s.style.background).join()`) === colorsBefore);
    await tab('solve');
    check('bước 3 không còn lời giải cũ', await text('#solution-length') === '' && /Chưa có lời giải/.test(await text('#hold-hint')),
      `${await text('#solution-length')} | ${await text('#step-desc')}`);

    // ----- 6. Chụp lại một mặt giữ các ô đã sửa tay ở mặt khác -----
    console.log('\n[6] Chụp lại một mặt khi đã sửa tay mặt khác');
    await open();
    await upload(SOLVED_SET);
    await tab('edit');
    await pick(0, 0, 3); // mặt TRÊN (trắng), ô đầu => cam
    const editedCell = await cellColor(0, 0);
    await chooseShot(1); // chụp lại mặt TRƯỚC (xanh lá)
    await upload(solvedImg(['G']));
    check('ô đã sửa ở mặt khác vẫn giữ màu', await activeTab() === 'edit' && await cellColor(0, 0) === editedCell &&
      /đúng 9 lần/.test(await text('#validation')), `${await cellColor(0, 0)} | ${await text('#validation')}`);
    await chooseShot(5); // chụp lại chính mặt TRÊN => ảnh mới thay cho ô đã sửa
    await upload(solvedImg(['W']));
    check('chụp lại chính mặt đó => ảnh mới thay ô sửa tay', /Màu hợp lệ/.test(await text('#validation')), await text('#validation'));

    // ----- 7. Giải xong khi người dùng đã sang bước khác -----
    console.log('\n[7] Bấm Giải ngay rồi sang bước chụp');
    await evaluate(`(() => { document.querySelector('#btn-solve').click(); document.querySelector('.tab[data-tab="scan"]').click(); })()`);
    await sleep(2500);
    check('vẫn ở bước 1, có thông báo đã có lời giải', await activeTab() === 'scan' && /Đã có lời giải/.test(await toastText()),
      `${await activeTab()} | ${await toastText()}`);
    await tab('solve');
    check('mở bước 3 => thấy lời giải', /\(0 bước\)/.test(await text('#solution-length')), await text('#solution-length'));

    console.log('\n[7b] Bấm Giải ngay rồi mở ngay bước 3 (bộ giải còn đang dựng bảng tra)');
    await open();
    await tab('edit');
    await click('#btn-scramble');
    await evaluate(`(() => { document.querySelector('#btn-solve').click(); document.querySelector('.tab[data-tab="solve"]').click(); })()`);
    for (let i = 0; i < 30 && /Đang tính/.test(await text('#btn-solve')); i++) await sleep(200);
    await sleep(300);
    check('lời giải hiện ngay ở bước 3, không phải bấm lại tab',
      await activeTab() === 'solve' && /^Bước 1 \//.test(await text('#step-counter')) && !/mở "3\./.test(await toastText()),
      `${await text('#step-counter')} | ${await toastText()}`);

    // ----- 8. Chụp 5 mặt, tô tay mặt 6 (app xoay cả khối), rồi chụp nốt mặt 6 -----
    console.log('\n[8] Chụp 5 mặt + tô tay mặt thứ 6 trên khối cầm nghêng, rồi chụp nốt mặt 6');
    await open();
    await upload(solvedImg(TILT.slice(0, 5)));
    await tab('edit');
    const sixth = LETTER.indexOf(TILT[5]);
    for (let k = 0; k < 9; k++) await pick(3, k, sixth); // mặt DƯỚI trong lưới = ảnh 6
    check('tô đủ => ghép thành khối hợp lệ (đã xoay cả khối)', /Màu hợp lệ/.test(await text('#validation')), await text('#validation'));
    await tab('scan');
    const shots = await evaluate(`[...document.querySelectorAll('#face-list li')].map((li) => li.classList.contains('done'))`);
    const statusText = await text('#auto-status');
    const current = Number((/ảnh (\d)/.exec(statusText) || [])[1]);
    check('bước 1 vẫn còn đúng 1 ảnh chưa chụp và đang chờ đúng ảnh đó',
      shots.filter((d) => !d).length === 1 && shots[current - 1] === false, `${JSON.stringify(shots)} | ${statusText}`);
    await upload(solvedImg([TILT[5]]));
    check('chụp nốt mặt 6 => sang bước 2, hợp lệ', await activeTab() === 'edit' && /Màu hợp lệ/.test(await text('#validation')),
      `${await activeTab()} | ${await text('#validation')}`);

    // ----- 9. Khoá giữ màn hình ở bước 3 -----
    console.log('\n[9] Khoá giữ màn hình');
    await tab('solve');
    await sleep(400);
    check('ở bước 3 => giữ 1 khoá', await evaluate('__wakeLocks()') === 1, await evaluate('__wakeLocks()'));
    await tab('edit');
    await sleep(400);
    check('rời bước 3 => nhả khoá', await evaluate('__wakeLocks()') === 0, await evaluate('__wakeLocks()'));
    await evaluate(`(() => { for (const t of ['solve', 'edit', 'solve', 'scan', 'solve']) document.querySelector('.tab[data-tab="' + t + '"]').click(); })()`);
    await sleep(800);
    check('đổi bước liên tục rồi dừng ở bước 3 => đúng 1 khoá', await evaluate('__wakeLocks()') === 1, await evaluate('__wakeLocks()'));
    await evaluate('__browserReleaseLocks()'); // trình duyệt tự nhả khi trang bị ẩn
    await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(400);
    check('trang hiện lại ở bước 3 => xin lại khoá', await evaluate('__wakeLocks()') === 1, await evaluate('__wakeLocks()'));

    check('không có lỗi JS trong trình duyệt', errors.length === 0, JSON.stringify(errors));
  } catch (err) {
    check('không có ngoại lệ khi chạy test', false, err && err.stack);
  } finally {
    if (browser) browser.close();
    server.close();
    fs.rmSync(site, { recursive: true, force: true });
  }
  console.log(failures.length ? `\nKHÔNG ĐẠT ${failures.length} điều kiện: ${failures.join('; ')}` : '\nTất cả điều kiện ĐẠT');
  process.exitCode = failures.length ? 1 : 0;
})();
