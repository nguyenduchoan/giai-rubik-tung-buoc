// Hai trình duyệt độc lập, giao diện dưới /rubik/ và API đi qua tuyến Hub thực tế.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { createRubikProxy } = require('../scripts/hub-proxy.js');
const { launchChrome, sleep } = require('./lib/chrome.js');
require('../js/cube.js');
const C = globalThis.Rubik.cube;
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || '.e2e-out/rooms');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-rooms-browser-'));
  const pages = [], errors = [];
  const backend = await start(0, '127.0.0.1', root, { dataDir: path.join(temp, 'data') });
  const port = backend.address().port;
  const proxy = createRubikProxy({ port });
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('<head>', '<head><meta name="rubik-api-base" content="/api/rubik/">');
  const front = http.createServer((req, res) => proxy(req, res, () => {
    if (req.url === '/rubik/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
    if (!req.url.startsWith('/rubik/')) { res.writeHead(404); res.end(); return; }
    const upstream = http.request({ host: '127.0.0.1', port, path: req.url.slice('/rubik'.length), method: req.method }, (incoming) => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  }));
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  const url = process.env.RUBIK_ROOM_URL || `http://127.0.0.1:${front.address().port}/rubik/`;
  const origin = new URL(url).origin;
  const wait = async (page, expression) => {
    for (let i = 0; i < 140; i++) { if (await page.evaluate(expression)) return; await sleep(60); }
    throw new Error(`Hết thời gian chờ ${expression}; lỗi: ${errors.join('; ')}`);
  };
  const click = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const realClick = async (page, selector) => {
    const point = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  };
  const checkArena = async (page) => {
    assert(await page.evaluate(`(() => {
      const game = document.querySelector('#room-game'), r = game.getBoundingClientRect();
      const cube = document.querySelector('#room-cube').getBoundingClientRect();
      return document.documentElement.classList.contains('room-open') &&
        getComputedStyle(document.documentElement).overflowY === 'hidden' &&
        getComputedStyle(document.body).overflowY === 'hidden' && document.querySelector('.app-header').inert &&
        Math.abs(r.top) <= 1 && Math.abs(r.left) <= 1 && Math.abs(r.width - innerWidth) <= 1 && Math.abs(r.height - innerHeight) <= 1 &&
        game.scrollHeight <= game.clientHeight + 1 && cube.height >= 100 &&
        ['#room-back', '#room-fullscreen', '#room-layer', '#room-mode', '#room-half'].every(selector => {
          const button = document.querySelector(selector), rect = button.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
        });
    })()`), 'Sân phủ kín màn hình, khóa cuộn nền, khối và các nút không bị cắt');
    const before = await page.evaluate('scrollY');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 30, y: 180, deltaX: 0, deltaY: 400 });
    await sleep(120);
    assert.equal(await page.evaluate('scrollY'), before, 'Lăn chuột không kéo cả trang');
    if (await page.evaluate('navigator.maxTouchPoints > 0')) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 20, y: 60, id: 1 }] });
      for (const y of [100, 160, 220]) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 20, y, id: 1 }] });
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(120);
      assert.equal(await page.evaluate('scrollY'), before, 'Vuốt cảm ứng không kéo cả trang');
    }
  };
  const input = (page, selector, value) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`);
  const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
  const open = async (page) => {
    await page.send('Page.navigate', { url }); await wait(page, '!!window.Rubik?.rooms'); await click(page, '#nav-rooms');
  };
  const screenshot = async (page, name) => {
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(out, name), Buffer.from(shot.result.data, 'base64'));
  };
  try {
    fs.mkdirSync(out, { recursive: true });
    for (let i = 0; i < 2; i++) {
      const page = await launchChrome({ userDataDir: path.join(temp, 'profile-' + i), args: ['--deny-permission-prompts'] });
      pages.push(page);
      page.onEvent((e) => { if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text); });
      await page.send('Runtime.enable'); await page.send('Page.enable');
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page.send('Emulation.setDeviceMetricsOverride', { width: i ? 390 : 1280, height: i ? 844 : 1000, deviceScaleFactor: 1, mobile: !!i });
      await open(page);
    }
    const [a, b] = pages;
    await input(a, '#room-nickname', 'An'); await click(a, '#room-create');
    await wait(a, '!document.querySelector("#room-content").hidden');
    const code = await text(a, '#room-code');
    assert.match(code, /^[A-Z0-9]{6}$/);
    await input(b, '#room-nickname', 'Bình'); await input(b, '#room-code-input', code.toLowerCase()); await click(b, '#room-join');
    await wait(b, '!document.querySelector("#room-content").hidden');
    await click(a, '#room-refresh'); await wait(a, 'document.querySelectorAll("#room-results tr").length === 2');
    const publicRoom = (await (await fetch(origin + '/api/rubik/rooms/' + code)).json()).room;
    const stickers = (page) => page.evaluate('[...document.querySelectorAll("#room-cube [data-facelet]")].map(s=>s.style.background)');
    assert.deepEqual(await stickers(a), await stickers(b));
    assert.equal(await text(a, '#room-moves'), '0'); assert.equal(await text(a, '#room-time'), '0:00.00');
    await screenshot(a, 'desktop-room.png'); await screenshot(b, 'mobile-room.png');
    console.log('✓ Hai trình duyệt tạo/vào bằng mã thường, cùng khối tráo, bảng chung dưới /rubik/');

    // Lưu khối tự chơi trước khi thi; việc chơi phòng phải không ghi đè bản này.
    await click(a, '#nav-play'); await click(a, '#play-scramble');
    const freePlay = await a.evaluate('localStorage.getItem("rubik-play-v2")');
    await click(a, '#play-back');
    await realClick(a, '#room-start');
    await wait(a, 'document.fullscreenElement === document.querySelector("#room-game")');
    await checkArena(a);
    assert.equal(await text(a, '#room-time'), '0:00.00', 'Mở toàn màn hình chưa chạy đồng hồ');
    await screenshot(a, 'desktop-playing.png');
    await realClick(a, '#room-fullscreen');
    await wait(a, '!document.fullscreenElement');
    await checkArena(a);
    await realClick(a, '#room-fullscreen');
    await wait(a, '!!document.fullscreenElement');
    await a.evaluate('document.exitFullscreen()');
    await wait(a, '!document.fullscreenElement');
    await checkArena(a);
    await realClick(a, '#room-back');
    assert(await a.evaluate(`!document.documentElement.classList.contains('room-open') &&
      !document.querySelector('.app-header').inert && Rubik.rooms.inProgress`));
    await realClick(a, '#room-fullscreen');
    await wait(a, '!!document.fullscreenElement');
    assert.equal(await text(a, '#room-moves'), '0');
    await click(a, '#room-view'); assert.equal(await text(a, '#room-moves'), '0');
    // Khi rời tab phòng mà lượt còn dở, bản cập nhật chỉ hiện banner, không tải lại trang.
    await click(a, '#nav-scan');
    await wait(a, '!document.fullscreenElement && !document.documentElement.classList.contains("room-open")');
    await a.evaluate(`(() => {
      window.roomUpdateGuard = true;
      const fetchBefore = window.fetch, nowBefore = performance.now.bind(performance);
      window.fetch = (route, options) => route === location.pathname
        ? Promise.resolve(new Response('<script src="js/app.js?v=roomguardnew"></script>')) : fetchBefore(route, options);
      performance.now = () => nowBefore() + 60000;
      document.dispatchEvent(new Event('visibilitychange'));
      performance.now = nowBefore; window.fetch = fetchBefore;
    })()`);
    await wait(a, '!document.querySelector("#update-banner").hidden');
    assert(await a.evaluate('window.roomUpdateGuard && Rubik.rooms.inProgress'));
    await click(a, '#nav-rooms');
    const solution = C.parseMoves(publicRoom.scramble).reverse().map(C.inverseMove).map(C.moveToString);
    async function solve(page, offlineAtEnd = false) {
      let count = 0;
      for (let i = 0; i < solution.length; i++) {
        if (offlineAtEnd && i === solution.length - 1) {
          await page.send('Network.enable');
          await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        }
        const move = C.parseMove(solution[i]);
        await input(page, '#room-layer', move.face);
        await click(page, move.power === 2 ? '#room-half' : move.power === 3 ? '#room-counterclockwise' : '#room-clockwise');
        count++;
        await wait(page, `document.querySelector('#room-moves').textContent === '${count}'`);
      }
      return count;
    }
    await solve(a, true);
    await wait(a, '!document.querySelector("#room-retry").hidden');
    assert(!(await (await fetch(origin + '/api/rubik/rooms/' + code)).json()).room.players[0].result);
    await a.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await click(a, '#room-retry'); await wait(a, 'document.querySelector("#room-status").textContent.includes("Đã lưu")');
    await b.evaluate(`document.querySelector('#room-game').requestFullscreen = () => Promise.reject(new Error('Bị từ chối'))`);
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 });
    await click(b, '#room-start');
    await checkArena(b);
    assert(await b.evaluate('!document.fullscreenElement'));
    await screenshot(b, 'mobile-playing.png');
    for (const [width, height] of [[320, 568], [844, 390], [568, 320], [390, 844]]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await sleep(120);
      await checkArena(b);
    }
    await solve(b);
    await wait(b, 'document.querySelector("#room-status").textContent.includes("Đã lưu")');
    assert(await b.evaluate(`!document.documentElement.classList.contains('room-open') && !document.querySelector('.app-header').inert`),
      'Giải xong trở lại phòng và mở cuộn nền');
    await click(a, '#room-refresh');
    await wait(a, '[...document.querySelectorAll("#room-results tr")].every(tr => !tr.textContent.includes("Chưa có kết quả"))');
    const saved = (await (await fetch(origin + '/api/rubik/rooms/' + code)).json()).room;
    fs.writeFileSync(path.join(out, 'verified-room.json'), JSON.stringify(saved, null, 2));
    assert(saved.players.every((p) => p.result.moveCount === solution.length && p.result.durationMs > 0));
    const ordered = [...saved.players].sort((x, y) => x.result.durationMs - y.result.durationMs);
    assert((await text(a, '#room-results tr:first-child')).startsWith(ordered[0].nickname));
    assert.equal(await a.evaluate('localStorage.getItem("rubik-play-v2")'), freePlay);
    console.log('✓ Giải thật, tính giờ/bước, gửi lại khi mất mạng, bảo toàn khối tự chơi và không tự tải lại giữa lượt');

    await open(a); await click(a, '#room-resume'); await wait(a, 'document.querySelector("#room-status").textContent.includes("Đã lưu")');
    assert.equal(await text(a, '#room-moves'), String(solution.length));
    await screenshot(a, 'desktop-results.png');
    for (const width of [320, 390]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await sleep(120);
      assert(await b.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `Không tràn ngang ${width}px`);
    }
    await screenshot(b, 'mobile-results.png');
    await click(b, '#room-leave');
    await b.evaluate(`Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })`);
    await click(b, '#room-create'); await wait(b, '!document.querySelector("#room-content").hidden');
    await click(b, '#room-start');
    await checkArena(b);
    assert(await b.evaluate('!document.fullscreenElement'));
    await realClick(b, '#room-back');
    assert(await b.evaluate(`Rubik.rooms.inProgress && !document.documentElement.classList.contains('room-open')`));
    await realClick(b, '#room-fullscreen');
    await checkArena(b);
    await click(b, '#nav-play');
    assert(await b.evaluate(`Rubik.play.active && document.querySelector('.app-header').inert &&
      !document.documentElement.classList.contains('room-open')`), 'Chuyển sang Chơi tự do giữ khóa nền của sân chơi đó');
    await click(b, '#play-back');
    await click(b, '#room-leave');
    assert(await b.evaluate(`!Rubik.rooms.inProgress && !document.documentElement.classList.contains('room-open') && !document.querySelector('.app-header').inert`));
    assert.deepEqual(errors, []);
    console.log('✓ Bắt đầu tự mở toàn màn hình, không cuộn trang khi bị từ chối/không hỗ trợ, quay về phòng và kết thúc khôi phục bố cục');
    console.log('✓ Mở lại nhận diện/kết quả, bố cục 320–390 px, không có lỗi JavaScript');
  } finally {
    pages.forEach((p) => p.close());
    await new Promise((r) => front.close(r)); await new Promise((r) => backend.close(r));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
