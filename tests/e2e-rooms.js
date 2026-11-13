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
    await click(a, '#room-start');
    assert.equal(await text(a, '#room-moves'), '0');
    await click(a, '#room-view'); assert.equal(await text(a, '#room-moves'), '0');
    // Khi rời tab phòng mà lượt còn dở, bản cập nhật chỉ hiện banner, không tải lại trang.
    await click(a, '#nav-scan');
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
    await click(b, '#room-start'); await solve(b);
    await wait(b, 'document.querySelector("#room-status").textContent.includes("Đã lưu")');
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
    assert.deepEqual(errors, []);
    console.log('✓ Mở lại nhận diện/kết quả, bố cục 320–390 px, không có lỗi JavaScript');
  } finally {
    pages.forEach((p) => p.close());
    await new Promise((r) => front.close(r)); await new Promise((r) => backend.close(r));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
