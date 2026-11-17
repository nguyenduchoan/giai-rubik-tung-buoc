// Thi trực tiếp trên hai Chrome độc lập (cookie riêng), giao diện dưới /rubik/, API + WebSocket qua lớp chuyển tiếp Hub.
//   node tests/e2e-online.js [thư-mục-ảnh]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { createRubikProxy, createRubikUpgrade } = require('../scripts/hub-proxy.js');
const { launchChrome, sleep } = require('./lib/chrome.js');
require('../js/cube.js');
require('../js/play-moves.js');
const C = globalThis.Rubik.cube;
const P = globalThis.Rubik.playMoves;
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || '.e2e-out/online');
const CONFIG = { inspectionMs: 4000, countdownMs: 3000, prepareTimeoutMs: 8000, inspectionAckMs: 3000 };

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-online-browser-'));
  const pages = [];
  const errors = [];
  const backend = await start(0, '127.0.0.1', root, { dataDir: path.join(temp, 'data'), online: { config: CONFIG, log: () => {} } });
  const port = backend.address().port;
  const proxy = createRubikProxy({ port });
  const upgrade = createRubikUpgrade({ port });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('<head>', '<head><meta name="rubik-api-base" content="/api/rubik/">');
  const front = http.createServer((req, res) => proxy(req, res, () => {
    if (req.url === '/rubik/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (!req.url.startsWith('/rubik/')) { res.writeHead(404); res.end(); return; }
    const up = http.request({ host: '127.0.0.1', port, path: req.url.slice('/rubik'.length), method: req.method }, (incoming) => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  }));
  front.on('upgrade', (req, socket, head) => { if (!upgrade(req, socket, head)) socket.destroy(); });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${front.address().port}/rubik/`;

  const wait = async (page, expression, ms = 10000) => {
    for (let waited = 0; waited < ms; waited += 60) { if (await page.evaluate(expression)) return; await sleep(60); }
    throw new Error(`Hết thời gian chờ ${expression}; lỗi: ${errors.join('; ')}`);
  };
  const click = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (page, selector, value) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`);
  const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const stickers = (page) => page.evaluate('[...document.querySelectorAll("#online-cube [data-facelet]")].map(s => s.style.background).join("|")');
  const screenshot = async (page, name) => {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, name), Buffer.from(shot.result.data, 'base64'));
  };
  const key = async (page, letter, shift) => {
    const base = { key: shift ? letter : letter.toLowerCase(), code: 'Key' + letter, windowsVirtualKeyCode: letter.charCodeAt(0), modifiers: shift ? 8 : 0 };
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', text: base.key, ...base });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const moveCount = (page) => page.evaluate('Number(document.querySelector("#online-moves").textContent)');
  // Giải bằng bàn phím theo từng nước một; nước 180° là hai lần 90° (tính hai nước như người chơi thật).
  async function play(page, moves) {
    for (const token of moves) {
      const m = P.parse(token);
      const presses = m.power === 2 ? [false, false] : [m.power === 3];
      for (const shift of presses) {
        const before = await moveCount(page);
        await key(page, m.base, shift);
        // Nước cuối của người cuối cùng chốt ván: phòng sang kết quả và sân thi đóng lại.
        await wait(page, `(Number(document.querySelector("#online-moves").textContent) === ${before + 1} && !Rubik.online.debug().race?.pending.length && !Rubik.online.debug().animating) || Rubik.online.debug().snap.room.status === "RESULTS"`);
      }
    }
  }

  try {
    fs.mkdirSync(out, { recursive: true });
    for (let i = 0; i < 2; i++) {
      const page = await launchChrome({ userDataDir: path.join(temp, 'profile-' + i), args: ['--deny-permission-prompts'] });
      pages.push(page);
      page.onEvent((e) => {
        if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
        if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errors.push(e.params.args.map((a) => a.value ?? a.description).join(' '));
      });
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page.send('Emulation.setDeviceMetricsOverride', { width: i ? 390 : 1280, height: i ? 844 : 900, deviceScaleFactor: 1, mobile: !!i });
    }
    const [a, b] = pages;
    await a.evaluate(`localStorage.setItem('rubik-play-v2', 'giu-nguyen')`).catch(() => {});

    // ---- An tạo phòng ----
    await a.send('Page.navigate', { url });
    await wait(a, '!!window.Rubik?.online');
    await a.evaluate(`localStorage.setItem('rubik-play-v2', '{"marker":"giu-nguyen"}')`);
    await click(a, '#nav-rooms');
    assert.equal(await a.evaluate('document.querySelector("#rooms-live").hidden'), false, 'mặc định là Thi trực tiếp');
    await wait(a, '!document.querySelector("#online-form").hidden');
    await input(a, '#online-nickname', 'A');
    await click(a, '#online-create');
    assert.match(await text(a, '#online-error'), /2–20/);
    await input(a, '#online-nickname', 'An');
    await click(a, '#online-create');
    await wait(a, '!document.querySelector("#online-room").hidden && /^[2-9A-Z]{8}$/.test(document.querySelector("#online-room-code").textContent)');
    const code = await text(a, '#online-room-code');
    await wait(a, 'document.querySelector("#online-net").dataset.state === "online"');
    assert.equal(await a.evaluate('document.querySelector("#online-start").disabled'), true, 'một người chưa bắt đầu được');
    assert.match(await text(a, '#online-blockers'), /ít nhất 2/);

    // ---- Bình vào bằng liên kết mời trên điện thoại ----
    await b.send('Page.navigate', { url: `${url}#room=${code}` });
    await wait(b, '!!window.Rubik?.online && document.querySelector("#nav-rooms").classList.contains("active")');
    await wait(b, `document.querySelector("#online-code").value === ${JSON.stringify(code)}`);
    await input(b, '#online-nickname', 'an');
    await click(b, '#online-join');
    await wait(b, 'document.querySelector("#online-error").textContent.includes("Tên này")');
    await input(b, '#online-nickname', 'Bình');
    await click(b, '#online-join');
    await wait(b, '!document.querySelector("#online-room").hidden && document.querySelector("#online-net").dataset.state === "online"');
    await wait(a, 'document.querySelector("#online-members").textContent.includes("Bình")');
    await wait(a, 'document.querySelector("#online-blockers").textContent.includes("Bình chưa sẵn sàng")');
    await screenshot(b, 'mobile-lobby.png');
    await click(b, '#online-ready');
    await wait(a, '!document.querySelector("#online-start").disabled');
    await screenshot(a, 'desktop-lobby.png');
    console.log('✓ Tạo phòng, mời bằng liên kết #room=, tên trùng, sẵn sàng và lý do chưa bắt đầu');

    // ---- Bắt đầu: chuẩn bị → quan sát (cùng khối, chưa xoay được) → thi ----
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 });
    await click(a, '#online-start');
    for (const page of pages) await wait(page, 'Rubik.online.debug().arena && Rubik.online.debug().snap.round?.status === "INSPECTION"');
    assert.equal(await stickers(a), await stickers(b), 'hai người nhận cùng một khối');
    assert(await b.evaluate(`(() => {
      const game = document.querySelector('#online-game'), r = game.getBoundingClientRect();
      return document.documentElement.classList.contains('room-open') && document.querySelector('.app-header').inert &&
        Math.abs(r.width - innerWidth) <= 1 && Math.abs(r.height - innerHeight) <= 1 && game.scrollHeight <= game.clientHeight + 1 &&
        ['#online-back', '#online-fullscreen', '#online-layer', '#online-half', '#online-clock'].every((s) => {
          const x = document.querySelector(s).getBoundingClientRect();
          return x.top >= 0 && x.bottom <= innerHeight && x.left >= 0 && x.right <= innerWidth;
        });
    })()`), 'sân thi phủ màn hình điện thoại, không cắt nút');
    assert.match(await text(a, '#online-countdown'), /Quan sát|^\d$/);
    await key(a, 'R', false);
    await sleep(150);
    assert.equal(await moveCount(a), 0, 'không xoay được lớp khi đang quan sát');
    await screenshot(b, 'mobile-inspection.png');
    await wait(a, 'document.querySelector("#online-countdown").textContent === "3"', 6000);
    await screenshot(a, 'desktop-countdown.png');
    for (const page of pages) await wait(page, 'Rubik.online.debug().snap.round?.status === "RUNNING"', 6000);
    const scramble = await a.evaluate('Rubik.online.debug().snap.round.scramble');
    const solution = P.parseSequence(scramble).reverse().map((m) => P.toString(P.inverse(m)));
    console.log('✓ Chuẩn bị, quan sát cùng khối, đếm ngược và khóa xoay trước giờ bắt đầu');

    // ---- Thi: An giải xong; Bình tải lại trang giữa chừng rồi giải tiếp ----
    await play(a, solution);
    await wait(a, 'Rubik.online.debug().race.ended && /Xong!/.test(document.querySelector("#online-status").textContent)');
    const officialA = await text(a, '#online-clock');
    assert.match(officialA, /^\d:\d\d\.\d\d$/);
    await wait(b, 'document.querySelector("#online-opponents").textContent.includes("An: ✔")');
    await screenshot(b, 'mobile-racing.png');
    const half = solution.slice(0, 2);
    await play(b, half);
    const countBefore = await moveCount(b);
    await b.send('Page.reload');
    await wait(b, '!!window.Rubik?.online && Rubik.online.debug().snap?.round?.status === "RUNNING" && Rubik.online.debug().arena');
    assert.equal(await moveCount(b), countBefore, 'tải lại trang nhận đúng số nước đã được máy chủ xác nhận');
    await wait(b, '/^0:0[1-9]|^0:[1-5]\\d/.test(document.querySelector("#online-clock").textContent)');
    await play(b, solution.slice(2));
    for (const page of pages) await wait(page, 'Rubik.online.debug().snap.room.status === "RESULTS" && !Rubik.online.debug().arena');
    const rows = await a.evaluate('[...document.querySelectorAll("#online-result-rows tr")].map(tr => [...tr.cells].map(td => td.textContent))');
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0], '1');
    assert.equal(rows[0][1], 'An (bạn)');
    assert.equal(rows[0][2], officialA, 'bảng kết quả dùng đúng thời gian máy chủ đã báo');
    assert(!(await a.evaluate('document.documentElement.classList.contains("room-open")')), 'có kết quả thì mở lại cuộn trang');
    await screenshot(a, 'desktop-results.png');
    await screenshot(b, 'mobile-results.png');
    assert.equal(await a.evaluate(`localStorage.getItem('rubik-play-v2')`), '{"marker":"giu-nguyen"}', 'không đụng khối Chơi tự do');
    console.log('✓ Giải bằng bàn phím, máy chủ xác nhận, tải lại trang giữa ván giữ trạng thái, bảng kết quả chính thức');

    // ---- Thi lại, tab thứ hai lấy quyền, lịch sử, chế độ cũ vẫn dùng được ----
    await click(a, '#online-next');
    await wait(b, 'Rubik.online.debug().snap.room.status === "LOBBY" && !document.querySelector("#online-ready").hidden && document.querySelector("#online-ready").textContent.includes("Sẵn sàng")');
    await click(a, '#online-history summary');
    await wait(a, 'document.querySelectorAll("#online-history-list button").length === 1');
    await click(a, '#online-history-list button');
    await wait(a, 'document.querySelectorAll("#online-history-detail tr").length === 3');
    await click(b, '#rooms-mode-async');
    await wait(b, '!document.querySelector("#room-entry").hidden && document.querySelector("#rooms-live").hidden');
    await click(b, '#rooms-mode-live');
    await wait(b, '!document.querySelector("#online-room").hidden');
    for (const [width, height] of [[320, 568], [844, 390]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await sleep(150);
      assert(await b.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `không cuộn ngang ở ${width}x${height}`);
    }
    await screenshot(b, 'mobile-320-lobby.png');
    await b.evaluate('window.confirm = () => true');
    await click(b, '#online-leave');
    await wait(b, '!document.querySelector("#online-entry").hidden && document.querySelector("#online-room").hidden');
    await wait(a, '!document.querySelector("#online-members").textContent.includes("Bình")');
    console.log('✓ Thi lại về phòng chờ, lịch sử ván, chuyển qua lại Thi tự do giờ, bố cục 320/844 px');
    assert.deepEqual(errors, [], 'không có lỗi JavaScript');
    console.log('Thi trực tiếp: kiểm thử trình duyệt PASS');
  } finally {
    for (const page of pages) page.close();
    backend.close();
    backend.closeAllConnections?.();
    front.close();
    front.closeAllConnections?.();
    await sleep(300);
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode || 0), 200));
