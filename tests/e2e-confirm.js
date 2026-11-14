// Kiểm tra xác nhận màu bằng thao tác chạm thật ngay khi camera vừa chuyển mặt.
// Chạy: node tests/e2e-confirm.js [thư mục kết quả] (cần Google Chrome).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { launchChrome, sleep } = require('./lib/chrome.js');

const outDir = path.resolve(process.argv[2] || '.e2e-out/confirm');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await start(0, '127.0.0.1');
  let browser;
  try {
    browser = await launchChrome({ userDataDir: path.join(outDir, 'profile') });
    const { send, evaluate } = browser;
    const errors = [];
    browser.onEvent((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    // Canvas phát video camera thật để ứng dụng vẫn lấy mẫu/phân loại màu và nhận pointerdown như bình thường.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      const rgb = ['#d7d4c3', '#d2c82d', '#af1e28', '#eb6923', '#1e4ba5', '#239b55'];
      window.__setCameraFace = (colors) => {
        ctx.fillStyle = '#5a4a3a'; ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#0f0f0f'; ctx.fillRect(88, 48, 144, 144);
        colors.forEach((color, k) => {
          ctx.fillStyle = rgb[color];
          ctx.fillRect(92 + k % 3 * 48, 52 + Math.floor(k / 3) * 48, 40, 40);
        });
      };
      window.__setCameraFace([0, 1, 2, 3, 5, 5, 0, 1, 2]);
      navigator.mediaDevices.getUserMedia = async () => {
        const stream = canvas.captureStream(30);
        // Tạo khung hình đều đặn ngay cả khi người dùng giữ nguyên mặt Rubik.
        setInterval(() => ctx.fillRect(0, 0, 1, 1), 30);
        return stream;
      };
    })();` });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });

    const waitFor = async (description, expression) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await sleep(5);
      }
      throw new Error('Quá thời gian chờ: ' + description);
    };
    const displayedColors = `(() => {
      const palette = Rubik.vision.PALETTE.map(p => 'rgb(' + p.hex.slice(1).match(/../g).map(c => parseInt(c, 16)).join(', ') + ')');
      return [...document.querySelector('#capture-preview-grid').children].map(b => palette.indexOf(b.style.background));
    })()`;
    const showFace = async (colors) => {
      await evaluate(`window.__setCameraFace(${JSON.stringify(colors)})`);
      await waitFor('màu mới hiện đủ 9 ô', `JSON.stringify(${displayedColors}) === '${JSON.stringify(colors)}'`);
    };
    const tap = async (selector, { whilePressed = null, holdMs = 0, cancel = false } = {}) => {
      const target = await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        button.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = button.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return { x, y, enabled: !button.disabled, reachable: button.contains(document.elementFromPoint(x, y)) };
      })()`);
      assert.ok(target.enabled && target.reachable, selector + ' phải đang bấm được');
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y, id: 1 }] });
      if (whilePressed) await evaluate(whilePressed);
      if (holdMs) await sleep(holdMs);
      await send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    };
    const progress = () => evaluate(`document.querySelector('#auto-status').textContent`);
    const savedCount = () => evaluate(`document.querySelectorAll('#face-list li.done').length`);
    const nextFace = () => evaluate(`document.querySelector('#face-list li.current').children[1].textContent`);
    const face = (center) => [0, 1, 2, 3, center, 5, 0, 1, 2];

    await waitFor('camera nhận diện mặt đầu', `document.querySelector('#preview-title').textContent.includes('Xanh lá')`);
    await evaluate(`document.querySelector('#btn-confirm-face').scrollIntoView({ block: 'center' })`);
    await sleep(500); // có mẫu ổn định trước lần xác nhận đầu tiên
    await tap('#btn-confirm-face');
    assert.equal(await savedCount(), 1);
    assert.equal(await nextFace(), 'Ảnh 2');
    assert.match(await progress(), /1\/6/);
    assert.equal(await evaluate(`document.querySelector('#scan-title').textContent`), 'Ảnh 2/6 · Mặt tiếp theo');
    assert.equal(await evaluate(`document.activeElement.id`), 'scan-title');
    assert.ok(await evaluate(`(() => { const r = document.querySelector('#scan-title').getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight; })()`));
    console.log('✓ Xác nhận màu mặt đầu => mở ngay màn Ảnh 2, không kiểm tra chiều cầm');

    await sleep(350); // mặt cũ lại có mẫu ổn định trước khi xoay sang mặt mới
    assert.ok(await evaluate(`document.querySelector('#btn-confirm-face').disabled`));
    assert.deepEqual(await evaluate(displayedColors), Array(9).fill(-1), 'Màn mới không hiển thị lại màu mặt vừa lưu');
    const nextShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'next-face.png'), Buffer.from(nextShot.result.data, 'base64'));
    await tap('#btn-capture', { cancel: true });
    assert.equal(await savedCount(), 1, 'Hủy thao tác chạm không được xác nhận thêm mặt');
    await showFace(face(2));
    await tap('#btn-confirm-face', {
      whilePressed: `window.__setCameraFace(${JSON.stringify(face(5))})`,
      holdMs: 400,
    });
    assert.equal(await savedCount(), 2, 'Đang thấy mặt đỏ thì phải lưu mặt đỏ, không cập nhật lại mặt xanh lá');
    assert.equal(await nextFace(), 'Ảnh 3');
    assert.match(await progress(), /2\/6/);
    assert.match(await evaluate(`document.querySelectorAll('#face-list li.done')[1].textContent`), /Đỏ/);
    console.log('✓ Vừa thấy tâm đỏ, camera đổi lại trong lúc giữ nút => vẫn nhận lần bấm, lưu mặt đỏ, chọn Ảnh 3');

    await sleep(350);
    const changed = face(2);
    changed[0] = 4;
    await tap('#face-list li:nth-child(2)'); // sửa/chụp lại là thao tác riêng, không giữ màn mặt vừa xác nhận
    await showFace(changed);
    await tap('#btn-confirm-face');
    assert.equal(await savedCount(), 2, 'Cùng tâm chỉ cập nhật mặt đã lưu');
    assert.equal(await nextFace(), 'Ảnh 3');
    const firstCell = await evaluate(`document.querySelectorAll('#face-list li.done')[1].querySelector('.mini-face').children[0].style.background`);
    assert.equal(firstCell, 'rgb(0, 80, 200)', 'Ô vừa đổi phải được lưu, kể cả khi tâm vẫn giữ nguyên');
    console.log('✓ Cùng tâm, một ô vừa đổi màu => cập nhật đúng màu đang hiển thị');

    await sleep(350);
    await showFace(face(4));
    await evaluate(`document.querySelector('#btn-capture').scrollIntoView({ block: 'center' })`);
    await tap('#btn-capture');
    assert.ok(await evaluate(`document.querySelector('#face-preview-box').classList.contains('is-preview')`));
    assert.deepEqual(await evaluate(displayedColors), face(4), 'Chụp để xem trước cũng phải dùng đúng mặt mới');
    await tap('#capture-preview-grid button[data-preview-cell="0"]');
    assert.equal(await evaluate(`document.querySelector('#color-picker').hidden`), false);
    await tap('#color-picker [data-color="3"]');
    const manualColors = face(4).map((color, k) => k === 0 ? 3 : color);
    assert.deepEqual(await evaluate(displayedColors), manualColors);
    await evaluate(`window.__setCameraFace(${JSON.stringify(face(5))})`);
    await sleep(200);
    assert.deepEqual(await evaluate(displayedColors), manualColors, 'Ảnh camera thay đổi không được ghi đè màu sửa tay');
    await tap('#btn-confirm-face');
    assert.equal(await savedCount(), 3);
    assert.equal(await nextFace(), 'Ảnh 4');
    assert.equal(await evaluate(`document.querySelectorAll('#face-list li.done')[2].querySelector('.mini-face').children[0].style.background`), 'rgb(255, 109, 0)');
    console.log('✓ Chụp mặt mới, sửa tay rồi xác nhận => lưu 3/6 mặt, giữ màu đã sửa');

    for (const center of [3, 0, 1]) {
      await sleep(350);
      await showFace(face(center));
      await evaluate(`document.querySelector('#btn-confirm-face').scrollIntoView({ block: 'center' })`);
      await tap('#btn-confirm-face');
    }
    assert.equal(await evaluate(`document.querySelector('.tab.active').dataset.tab`), 'edit');
    assert.equal(await evaluate(`document.querySelectorAll('#net .grid')[5].children[0].style.background`), 'rgb(255, 109, 0)', 'Phân loại đủ 6 mặt phải giữ màu người dùng đã sửa tay');
    assert.deepEqual(errors, []);
    console.log('✓ Xác nhận đủ 6 tâm khác nhau => tự chuyển sang màn kiểm tra màu, không lỗi JavaScript');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'confirmed-six.png'), Buffer.from(shot.result.data, 'base64'));
    await evaluate(`document.querySelector('#nav-scan').click()`);
    assert.equal(await savedCount(), 6);
  } finally {
    if (browser) browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
