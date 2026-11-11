// Kiểm thử trình duyệt: tab học riêng, mô phỏng độc lập, đổi bài và lưu tiến độ.
// Chạy: node tests/e2e-learn.js [thư mục kết quả]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { launchChrome, sleep } = require('./lib/chrome.js');

const outDir = path.resolve(process.argv[2] || '.e2e-out/learn');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-learn-'));
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures.push(label);
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await start(0, '127.0.0.1');
  let browser;
  try {
    browser = await launchChrome({ userDataDir: profile, args: ['--deny-permission-prompts'] });
    const { send, evaluate } = browser;
    const errors = [];
    browser.onEvent((event) => {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    });
    await send('Runtime.enable');
    await send('Page.enable');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
    const waitFor = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(expression)) return;
        await sleep(100);
      }
      throw new Error(`Hết thời gian chờ: ${expression}; lỗi JS: ${errors.join('; ')}`);
    };
    const open = async () => {
      await send('Page.navigate', { url });
      await waitFor('!!window.Rubik?.learn && !!document.querySelector("#learn-title").textContent');
    };
    const tab = (name) => click(`.tab[data-tab="${name}"]`);
    const lesson = async (level, id) => {
      await click(`[data-level="${level}"]`);
      await click(`[data-lesson="${id}"]`);
    };
    const stickerColors = () => evaluate('Array.from(document.querySelectorAll("#learn-cube .sticker"), e => e.style.background)');
    const screenshot = async (name) => {
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(outDir, name), Buffer.from(result.result.data, 'base64'));
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await open();
    await tab('learn');
    check('Tab Học chơi riêng, truy cập ngay không cần ảnh hoặc lời giải',
      await evaluate('document.querySelector(".tab.active").dataset.tab === "learn" && document.querySelectorAll(".panel.active").length === 1 && document.querySelector("#nav-learn").getAttribute("aria-selected") === "true"'));
    check('Bài đầu có nội dung và không hiện mô phỏng khi không có công thức',
      (await text('#learn-title')) === 'Hiểu khối trước khi xoay' && await evaluate('document.querySelector("#learn-practice").hidden'));
    await click('#learn-complete');
    check('Tự đánh dấu bài cập nhật tiến độ', (await text('#learn-progress-text')).startsWith('1/15'));
    await screenshot('desktop.png');

    await lesson('start', 'notation');
    const initial = await stickerColors();
    await click('#learn-next');
    await waitFor('document.querySelector("#learn-counter").textContent.includes("1/1") && !document.querySelector("#learn-prev").disabled');
    check('Tiến một nước thay đổi khối 3D', JSON.stringify(await stickerColors()) !== JSON.stringify(initial));
    await click('#learn-prev');
    await waitFor('document.querySelector("#learn-counter").textContent.includes("0/1") && !document.querySelector("#learn-next").disabled');
    assert.deepEqual(await stickerColors(), initial, 'Lùi phải phục hồi đúng trạng thái trước');
    check('Lùi phục hồi đúng 54 ô màu', true);

    await lesson('start', 'triggers');
    await evaluate('document.querySelector("#learn-speed").value = "250"');
    await click('#learn-play');
    await waitFor('document.querySelector("#learn-counter").textContent.includes("4/4") && document.querySelector("#learn-play").getAttribute("aria-pressed") === "false"');
    check('Tự chạy hết công thức giải xong khối mẫu', await evaluate(`
      ['up', 'right', 'front', 'down', 'left', 'back'].every(face => {
        const stickers = Array.from(document.querySelectorAll('#learn-cube .cubie-face.sticker.' + face));
        return stickers.length === 9 && new Set(stickers.map(e => e.style.background)).size === 1;
      })
    `));
    await click('#learn-play');
    await sleep(80);
    await click('#learn-play');
    await waitFor('!document.querySelector("#learn-play").disabled');
    const paused = await text('#learn-counter');
    await sleep(600);
    check('Dừng tự chạy không tự tiến thêm nước', (await text('#learn-counter')) === paused);

    await click('[data-formula="right"]');
    await click('#learn-next');
    await click('[data-formula="left"]');
    await waitFor('!document.querySelector("#learn-next").disabled');
    check('Đổi công thức khi đang xoay không nhận kết quả của công thức cũ',
      (await text('#learn-formula-title')) === 'Chuỗi tay trái' && (await text('#learn-counter')).includes('0/4'));
    const leftStart = await stickerColors();
    await click('#learn-next');
    await lesson('beginner', 'middle-layer');
    await waitFor('!document.querySelector("#learn-next").disabled');
    check('Đổi bài giữa hoạt ảnh về đúng khối mẫu mới',
      (await text('#learn-formula-title')) === 'Chèn cạnh sang phải' && (await text('#learn-counter')).includes('0/8') && JSON.stringify(await stickerColors()) !== JSON.stringify(leftStart));
    await click('#learn-play');
    await tab('edit');
    await sleep(600);
    const away = await text('#learn-counter');
    await sleep(600);
    await tab('learn');
    check('Rời tab dừng tự chạy và quay lại không tự chạy tiếp',
      (await text('#learn-counter')) === away && await evaluate('document.querySelector("#learn-play").getAttribute("aria-pressed") === "false"'));

    // Chuẩn bị lời giải thật rồi học một bài; tab học không được sửa khối/lời giải.
    await tab('edit');
    await click('#btn-scramble');
    await click('#btn-solve');
    await waitFor('document.querySelector(".tab.active").dataset.tab === "solve" && document.querySelectorAll("#move-list button").length > 0');
    await click('#btn-next');
    await waitFor('document.querySelector("#step-counter").textContent.includes("Bước 2")');
    const solutionCounter = await text('#step-counter');
    const solutionColors = await evaluate('Array.from(document.querySelectorAll("#net-small .grid span"), e => e.style.background)');
    await tab('learn');
    await lesson('advanced', 'pll');
    await click('#learn-moves button:nth-child(4)');
    await tab('solve');
    check('Học công thức giữ nguyên bước và khối của lời giải thật',
      (await text('#step-counter')) === solutionCounter && JSON.stringify(await evaluate('Array.from(document.querySelectorAll("#net-small .grid span"), e => e.style.background)')) === JSON.stringify(solutionColors));

    // Đổi tab bằng bàn phím không được làm tiến một nước của lời giải.
    await evaluate('document.querySelector("#nav-edit").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    await sleep(700);
    check('Phím mũi tên đổi tab không làm chạy lời giải', (await text('#step-counter')) === solutionCounter);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
    await sleep(700);
    check('Phím cách trên nút tab không bật tự chạy lời giải',
      (await text('#step-counter')) === solutionCounter && !(await text('#btn-play')).includes('Dừng'));

    await tab('learn');
    await lesson('beginner', 'orient-corners');
    await click('#learn-complete');
    await open();
    await tab('learn');
    check('Tải lại giữ bài đang học và các bài đã đánh dấu',
      (await text('#learn-title')).includes('Xoay góc vàng') && await evaluate('document.querySelector("#learn-complete").checked') && (await text('#learn-progress-text')).startsWith('2/15'));

    // Kiểm tra mọi bài có thể đi tới, qua cả ranh giới giữa các mức.
    await lesson('start', 'pieces');
    for (let i = 0; i < 14; i++) await click('#learn-next-lesson');
    check('Đi tuần tự đủ 15 bài và khóa nút ở cuối lộ trình',
      (await text('#learn-position')).includes('15 / 15') && await evaluate('document.querySelector("#learn-next-lesson").disabled'));
    for (let i = 0; i < 14; i++) await click('#learn-previous-lesson');
    check('Đi ngược về đầu lộ trình', await evaluate('document.querySelector("#learn-previous-lesson").disabled'));

    await lesson('beginner', 'orient-corners');
    for (const width of [375, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
      await evaluate('window.scrollTo(0, 0)');
      check(`Không tràn ngang trên điện thoại ${width}px`, await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 1000, deviceScaleFactor: 1, mobile: true });
    await evaluate('document.querySelector("#learn-practice").scrollIntoView()');
    await screenshot('mobile-formula.png');
    await evaluate('document.querySelector("#learn-cube").scrollIntoView({block:"center"})');
    await screenshot('mobile-player.png');

    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
      Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
    ` });
    await open();
    await tab('learn');
    await click('#learn-complete');
    await click('#learn-next-lesson');
    check('Bị chặn lưu trữ vẫn đọc bài, đổi bài và đánh dấu được',
      (await text('#learn-title')).includes('Đọc ký hiệu') && (await text('#learn-progress-text')).startsWith('1/15') && await evaluate('!document.querySelector("#learn-storage-note").hidden'));
    check('Không có lỗi JavaScript trong trình duyệt', errors.length === 0);
    if (errors.length) console.error(errors.join('\n'));
    if (failures.length) throw new Error(failures.join('; '));
    console.log('Tất cả kiểm thử tab học ĐẠT');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
