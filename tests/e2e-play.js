// Điều khiển Rubik ảo bằng nút, bàn phím, chuột và chạm thật qua giao thức của Chrome.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { launchChrome, sleep } = require('./lib/chrome.js');
require('../js/cube.js');
const C = globalThis.Rubik.cube;
const out = path.resolve(process.argv[2] || '.e2e-out/play');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-play-'));

(async () => {
  const server = await start(0, '127.0.0.1');
  let page;
  try {
    fs.mkdirSync(out, { recursive: true });
    page = await launchChrome({ userDataDir: profile, args: ['--deny-permission-prompts'] });
    const errors = [];
    page.onEvent((event) => { if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text); });
    const send = async (method, params) => {
      const result = await page.send(method, params);
      assert(!result.error, JSON.stringify(result.error));
      return result;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const evaluate = page.evaluate;
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
    const waitFor = async (expression) => {
      for (let i = 0; i < 120; i++) {
        if (await evaluate(expression)) return;
        await sleep(80);
      }
      throw new Error(`Hết thời gian chờ: ${expression}; lỗi JS: ${errors.join('; ')}`);
    };
    const ready = () => waitFor('!document.querySelector("#play-clockwise").disabled');
    const snapshot = () => evaluate('JSON.parse(localStorage.getItem("rubik-play-v1"))');
    const checkColors = async (expected, label) => {
      assert.deepEqual((await snapshot()).colors, Array.from(expected), label);
      assert(await evaluate(`(() => {
        const palette = { U: 1, R: 3, F: 5, D: 0, L: 2, B: 4 };
        const expected = ${JSON.stringify(Array.from(expected))};
        const cell = document.createElement('i');
        return Array.from(document.querySelectorAll('#play-cube [data-facelet]')).every(sticker => {
          cell.style.background = Rubik.vision.PALETTE[palette[expected[Number(sticker.dataset.facelet)]]].hex;
          return sticker.style.background === cell.style.background;
        });
      })()`), `${label}: hình 3D phải khớp trạng thái`);
      console.log(`✓ ${label}`);
    };
    const open = async () => {
      await send('Page.navigate', { url });
      await waitFor('!!window.Rubik?.play');
      await click('#nav-play');
    };
    const reset = async () => { await ready(); await click('#play-reset'); };
    const rect = (selector) => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const mouseDrag = async (point, dx, dy) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 4; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx * i / 4, y: point.y + dy * i / 4, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button: 'left', buttons: 0, clickCount: 1 });
    };
    const key = async (key, code, modifiers = 0) => {
      await evaluate('document.activeElement.blur()');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
      await ready();
    };
    const screenshot = async (name) => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, name), Buffer.from(result.result.data, 'base64'));
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await open();
    await reset();
    assert(await evaluate('document.querySelector("#nav-play").getAttribute("aria-selected") === "true" && document.querySelectorAll(".panel.active").length === 1'));
    await click('[data-play-face="R"]');
    await click('#play-clockwise'); await ready();
    await checkColors(C.applyMove(C.SOLVED, 'R'), 'Nút xoay phải 90°');
    await click('#play-counterclockwise'); await ready();
    await checkColors(C.SOLVED, 'Xoay ngược trả khối về ban đầu');
    await click('#play-half'); await ready();
    const half = (await snapshot()).colors;
    await click('#play-undo'); await ready();
    await checkColors(C.SOLVED, 'Hoàn tác khôi phục đúng khối');
    await click('#play-redo'); await ready();
    await checkColors(half, 'Làm lại khôi phục nước vừa hoàn tác');

    await reset();
    await mouseDrag(await rect('#play-cube [data-facelet="19"]'), -55, 0);
    await ready();
    await checkColors(C.applyMove(C.SOLVED, 'U'), 'Kéo thật hàng trên mặt trước xoay đúng lớp U');
    await mouseDrag(await rect('#play-cube [data-facelet="23"]'), 0, -55);
    await ready();
    await checkColors(C.applyMoves(C.SOLVED, 'U R'), 'Kéo thật cột phải mặt trước xoay đúng lớp R');
    const beforeOrbit = await snapshot();
    const angle = await evaluate('document.querySelector("#play-cube .cube3d").style.transform');
    await mouseDrag(await rect('#play-cube [data-facelet="22"]'), 30, 10);
    assert.notEqual(await evaluate('document.querySelector("#play-cube .cube3d").style.transform'), angle);
    assert.deepEqual(await snapshot(), beforeOrbit);
    console.log('✓ Kéo ô tâm chỉ đổi góc nhìn');
    await click('#play-view');
    await click('#play-turn-mode');
    await mouseDrag(await rect('#play-cube [data-facelet="19"]'), 30, 10);
    assert.deepEqual(await snapshot(), beforeOrbit);
    console.log('✓ Tắt xoay lớp thì kéo trên ô màu chỉ đổi góc nhìn');
    await click('#play-turn-mode'); await click('#play-view');

    await reset();
    await key('r', 'KeyR');
    await checkColors(C.applyMove(C.SOLVED, 'R'), 'Phím R xoay mặt phải');
    await key('R', 'KeyR', 8);
    await checkColors(C.SOLVED, 'Shift + R xoay ngược');
    await key('2', 'Digit2');
    await checkColors(C.applyMove(C.SOLVED, 'R2'), 'Phím 2 xoay nửa vòng mặt đã chọn');
    await key('z', 'KeyZ', 2);
    await checkColors(C.SOLVED, 'Ctrl + Z hoàn tác');
    await key('y', 'KeyY', 2);
    await checkColors(C.applyMove(C.SOLVED, 'R2'), 'Ctrl + Y làm lại');
    await reset();
    await evaluate('document.querySelector("#play-sequence").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR' });
    assert.deepEqual((await snapshot()).past, []);
    console.log('✓ Gõ trong ô công thức không xoay khối bằng phím tắt');
    await evaluate('document.querySelector("#play-sequence").value = "R X U"');
    await click('#play-run');
    assert((await text('#play-error')).length > 0);
    await checkColors(C.SOLVED, 'Công thức sai bị từ chối toàn bộ');
    await evaluate('document.querySelector("#play-sequence").value = "R U R’ U’"');
    await click('#play-run');
    await waitFor('document.querySelector("#play-stop").disabled && !document.querySelector("#play-run").disabled');
    await checkColors(C.applyMoves(C.SOLVED, "R U R' U'"), 'Chạy công thức có dấu phẩy tiếng Việt đúng thứ tự');
    await evaluate('document.querySelector("#play-sequence").value = "R U R U R U R U R U"');
    await click('#play-run'); await sleep(50); await click('#play-stop'); await ready();
    const stopped = await snapshot(); await sleep(600);
    assert.deepEqual(await snapshot(), stopped);
    console.log('✓ Dừng công thức không còn nước chạy ngầm');
    await click('#play-run'); await sleep(50); await click('#nav-learn'); await sleep(600);
    const leftTab = await snapshot(); await sleep(600);
    assert.deepEqual(await snapshot(), leftTab);
    await click('#nav-play');
    assert(await evaluate('document.querySelector("#play-stop").disabled'));
    console.log('✓ Đổi tab dừng công thức và không tự chạy lại khi quay về');

    await reset(); await click('#play-scramble');
    const shuffled = await snapshot();
    assert.equal(shuffled.past.length, 20);
    assert(C.validateColors(shuffled.colors).ok);
    assert.notEqual(shuffled.colors.join(''), C.SOLVED);
    await open();
    assert.deepEqual(await snapshot(), shuffled);
    await checkColors(shuffled.colors, 'Tráo tạo khối hợp lệ và tải lại giữ đủ khối/lịch sử');

    // Bản học chỉ cho đổi góc nhìn; hình và bước của bài học giữ nguyên.
    await click('#nav-learn');
    await click('[data-level="start"]'); await click('[data-lesson="triggers"]');
    const learning = await evaluate('Array.from(document.querySelectorAll("#learn-cube .sticker"), e => e.style.background)');
    await mouseDrag(await rect('#learn-cube .sticker'), 20, 10);
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#learn-cube .sticker"), e => e.style.background)'), learning);
    assert((await text('#learn-counter')).includes('0/4'));
    assert.deepEqual(await snapshot(), shuffled);
    console.log('✓ Tương tác trong bài học không đổi màu mẫu hoặc khối tự chơi');
    await click('#nav-edit'); await click('#btn-reset-solved'); await click('#btn-solve');
    await waitFor('document.querySelector(".tab.active").dataset.tab === "solve" && document.querySelector("#step-move").textContent === "🎉"');
    await click('#nav-play'); await click('#play-clockwise'); await ready(); await click('#nav-solve');
    assert.equal(await text('#step-move'), '🎉');
    console.log('✓ Tự xoay không sửa lời giải của khối đã nhập');

    await click('#nav-play'); await reset(); await click('#play-view');
    await evaluate('window.scrollTo(0, 0)'); await screenshot('desktop.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const touchStart = await rect('#play-cube [data-facelet="19"]');
    const touch = (x, y) => ({ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 });
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(touchStart.x, touchStart.y)] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(touchStart.x - 45, touchStart.y)] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ready();
    await checkColors(C.applyMove(C.SOLVED, 'U'), 'Vuốt cảm ứng thật xoay đúng lớp trên');
    const beforeCancel = await snapshot();
    const cancelPoint = await rect('#play-cube [data-facelet="23"]');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(cancelPoint.x, cancelPoint.y)] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(cancelPoint.x, cancelPoint.y - 40)] });
    await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await sleep(300);
    assert.deepEqual(await snapshot(), beforeCancel);
    console.log('✓ Hủy cử chỉ không tạo nước xoay');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(cancelPoint.x, cancelPoint.y)] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(cancelPoint.x, cancelPoint.y - 40)] });
    await click('#nav-learn');
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert.deepEqual(await snapshot(), beforeCancel);
    await click('#nav-play');
    const nextPoint = await rect('#play-cube [data-facelet="23"]');
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(nextPoint.x, nextPoint.y)] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(nextPoint.x, nextPoint.y - 40)] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ready();
    await checkColors(C.applyMoves(C.SOLVED, 'U R'), 'Rời tab hủy cử chỉ; quay lại vẫn vuốt được');
    for (const width of [375, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
      assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `Tràn ngang ${width}px`);
    }
    console.log('✓ Không tràn ngang trên điện thoại 320–375px');
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: true });
    await evaluate('document.querySelector("#play-cube").scrollIntoView({ block: "center", behavior: "instant" })');
    await screenshot('mobile.png');

    await evaluate('localStorage.setItem("rubik-play-v1", "{broken")');
    await open();
    assert((await text('#play-status')).includes('Khối đã giải hoàn chỉnh'));
    await reset();
    await checkColors(C.SOLVED, 'Dữ liệu lưu hỏng không chặn mở khối mới');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Storage.prototype.getItem = () => { throw new Error('blocked'); };
      Storage.prototype.setItem = () => { throw new Error('blocked'); };
    ` });
    await open();
    const original = await evaluate('Array.from(document.querySelectorAll("#play-cube .sticker"), e => e.style.background)');
    await click('#play-clockwise'); await ready();
    assert.notDeepEqual(await evaluate('Array.from(document.querySelectorAll("#play-cube .sticker"), e => e.style.background)'), original);
    assert((await text('#play-storage-note')).includes('không cho lưu'));
    assert.deepEqual(errors, []);
    console.log('✓ Bị chặn lưu trữ vẫn xoay được; không có lỗi JavaScript');
    console.log('Tất cả kiểm thử Rubik tự chơi ĐẠT');
  } finally {
    if (page) page.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
