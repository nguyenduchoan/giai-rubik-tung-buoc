// Sân chơi Rubik tự chơi: toàn màn hình, chuột, chạm 1/2/3/4 ngón thật qua giao thức của Chrome, nút, bàn phím, lưu khối.
// Hai ngón: mỗi ngón kéo một hàng/cột song song theo chiều riêng; chỉ 3 ngón đổi góc nhìn; tô sáng viên đang chạm.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../scripts/serve.js');
const { launchChrome, sleep } = require('./lib/chrome.js');
require('../js/cube.js');
require('../js/play-moves.js');
const { cube: C, playMoves: P } = globalThis.Rubik;
const SOLVED = Array.from(C.SOLVED);
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
    const waitFor = async (expression, label = expression) => {
      for (let i = 0; i < 120; i++) {
        if (await evaluate(expression)) return;
        await sleep(80);
      }
      throw new Error(`Hết thời gian chờ: ${label}; lỗi JS: ${errors.join('; ')}`);
    };
    const ready = () => waitFor('!document.querySelector("#play-scramble").disabled', 'khối hết bận');
    const snapshot = () => evaluate('JSON.parse(localStorage.getItem("rubik-play-v2"))');
    const transform = () => evaluate('document.querySelector("#play-cube .cube3d").style.transform');
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
      await waitFor('Rubik.play.active');
    };
    const reset = async () => { await ready(); await click('#play-reset'); await ready(); };
    const rect = (selector) => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    const sticker = (index) => rect(`#play-cube [data-facelet="${index}"]`);
    // Điểm trên vùng nền của sân chơi, không trúng ô nào của khối.
    const background = (side = 'left') => evaluate(`(() => {
      const r = document.querySelector('#play-cube').getBoundingClientRect();
      for (let k = 0; k < 40; k++) {
        const x = ${side === 'left' ? 'r.left + 20 + k * 4' : 'r.right - 20 - k * 4'}, y = r.top + r.height * 0.55;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest('#play-cube') && !hit.closest('[data-facelet]')) return { x, y };
      }
      return null;
    })()`);
    const realClick = async (selector) => {
      const point = await rect(selector);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
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
    // Chạm nhiều ngón: đặt lần lượt từng ngón, giữ, kéo cùng lúc, rồi nhấc riêng từng ngón (touchEnd với điểm cần nhấc).
    const finger = (id, p) => ({ x: p.x, y: p.y, id, radiusX: 2, radiusY: 2, force: 1 });
    const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const multiDrag = async (starts, moves, { hold = 220, steps = 4, onPlaced, onMoved } = {}) => {
      const vectors = Array.isArray(moves[0]) ? moves : starts.map(() => moves);
      for (let i = 0; i < starts.length; i++) await touch('touchStart', starts.slice(0, i + 1).map((p, j) => finger(j + 1, p)));
      if (hold) await sleep(hold);
      if (onPlaced) await onPlaced();
      const at = (j, s) => ({ x: starts[j].x + vectors[j][0] * s / steps, y: starts[j].y + vectors[j][1] * s / steps });
      for (let s = 1; s <= steps; s++) await touch('touchMove', starts.map((_, j) => finger(j + 1, at(j, s))));
      if (onMoved) await onMoved();
      for (let j = 0; j < starts.length; j++) await touch('touchEnd', [finger(j + 1, at(j, steps))]);
    };

    const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    // Sau khi xoay: tâm mọi ô đang nhìn thấy trong ảnh chụp phải là màu ô, không phải nền tối #111 của mặt viên.
    const noDarkCells = async (label) => {
      await sleep(150); // chờ hết hoạt ảnh và khung hình dựng lại
      const shot = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
      const result = await evaluate(`(async () => {
        const img = new Image();
        img.src = 'data:image/png;base64,${shot}';
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const scale = img.width / innerWidth;
        const centre = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
        const visible = [...document.querySelectorAll('#play-cube [data-facelet]')].filter((el) => document.elementFromPoint(...centre(el)) === el);
        const dark = visible.filter((el) => {
          const [x, y] = centre(el);
          const pixel = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
          return Math.max(pixel[0], pixel[1], pixel[2]) < 48;
        }).map((el) => el.dataset.facelet);
        return { visible: visible.length, dark };
      })()`);
      assert(result.visible >= 20, `${label}: nhìn thấy quá ít ô (${result.visible})`);
      assert.deepEqual(result.dark, [], `${label}: có ô bị tối`);
      console.log(`✓ ${label}: ${result.visible} ô nhìn thấy, không ô nào bị tối`);
    };

    // ---------- Toàn màn hình, máy tính ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await waitFor('!!window.Rubik?.play');
    await click('#nav-learn');
    await realClick('#nav-play');
    await waitFor('document.fullscreenElement === document.querySelector("#play-arena") && document.querySelector("#play-fullscreen").getAttribute("aria-pressed") === "true"', 'mở toàn màn hình');
    assert(await evaluate(`document.documentElement.classList.contains('play-open') && document.querySelector('.app-header').inert &&
      document.querySelector('#play-arena').contains(document.activeElement)`), 'Khóa cuộn nền, đầu trang inert, tiêu điểm trong sân chơi');
    assert.equal(await text('#play-screen-note'), '');
    console.log('✓ Bấm thật vào tab Chơi tự do tự mở toàn màn hình');
    await realClick('#play-fullscreen');
    await waitFor('!document.fullscreenElement && /Đã thoát/.test(document.querySelector("#play-screen-note").textContent)', 'thoát bằng nút');
    await sleep(400);
    assert(await evaluate('!document.fullscreenElement && Rubik.play.active'), 'Thoát toàn màn hình không đóng sân chơi, không tự mở lại');
    assert.match(await text('#play-screen-note'), /Đã thoát toàn màn hình/);
    await realClick('#play-fullscreen');
    await waitFor('!!document.fullscreenElement', 'mở lại bằng nút');
    await evaluate('document.exitFullscreen()'); // trình duyệt tự thoát (Esc, cử chỉ hệ thống)
    await waitFor('!document.fullscreenElement && document.querySelector("#play-fullscreen").getAttribute("aria-pressed") === "false"');
    await sleep(400);
    assert(await evaluate('!document.fullscreenElement && Rubik.play.active && document.querySelector("#play-fullscreen").getAttribute("aria-pressed") === "false"'));
    console.log('✓ Thoát bằng nút hoặc trình duyệt: giữ sân chơi phủ trang, không tự mở lại');
    await realClick('#play-fullscreen');
    await waitFor('!!document.fullscreenElement');
    await realClick('#play-back');
    await waitFor(`!Rubik.play.active && !document.fullscreenElement && document.querySelector('.tab.active').dataset.tab === 'learn' &&
      document.activeElement.id === 'nav-learn' && !document.documentElement.classList.contains('play-open') &&
      !document.querySelector('.app-header').inert`, 'Quay lại về tab trước, khôi phục cuộn và tiêu điểm');
    console.log('✓ Quay lại thoát toàn màn hình, về tab trước đó, khôi phục cuộn nền và tiêu điểm');
    await open(); // bấm bằng script (không phải thao tác người dùng): trình duyệt từ chối toàn màn hình
    await waitFor('/chưa cho mở toàn màn hình/.test(document.querySelector("#play-screen-note").textContent)', 'báo bị từ chối');
    assert(await evaluate(`(() => {
      const r = document.querySelector('#play-arena').getBoundingClientRect();
      return !document.fullscreenElement && r.width === innerWidth && r.height === innerHeight && !document.querySelector('#play-fullscreen').hidden;
    })()`), 'Bị từ chối vẫn phủ kín trang và có nút thử lại');
    console.log('✓ Toàn màn hình bị từ chối: sân chơi vẫn phủ vùng hiển thị, có nút thử lại');

    // ---------- Nút, chuột ----------
    await reset();
    await click('[data-play-face="R"]');
    await click('#play-clockwise'); await ready();
    await checkColors(C.applyMove(SOLVED, 'R'), 'Nút xoay phải 90°');
    await click('#play-counterclockwise'); await ready();
    await checkColors(SOLVED, 'Xoay ngược trả khối về ban đầu');
    await click('#play-half'); await ready();
    const half = (await snapshot()).colors;
    await click('#play-undo'); await ready();
    await checkColors(SOLVED, 'Hoàn tác khôi phục đúng khối');
    await click('#play-redo'); await ready();
    await checkColors(half, 'Làm lại khôi phục nước vừa hoàn tác');
    await reset();
    await click('[data-play-face="M"]'); await click('#play-clockwise'); await ready();
    await checkColors(P.apply(SOLVED, 'M'), 'Nút xoay lớp giữa M');
    assert(await evaluate(`getComputedStyle(document.querySelector('[data-play-face="U"] .color-chip')).backgroundColor !==
      getComputedStyle(document.querySelector('[data-play-face="D"] .color-chip')).backgroundColor`));
    await click('input[name="play-mode"][value="layer2"]');
    await click('[data-play-face="R"]');
    assert.equal(await text('#play-clockwise'), '↻ Rw');
    await click('#play-clockwise'); await ready();
    await checkColors(P.applyAll(SOLVED, 'M Rw'), 'Chế độ 2 lớp: nút xoay Rw');
    await click('[data-play-face="E"]');
    assert(await evaluate('document.querySelector("#play-clockwise").disabled'), 'Lớp giữa không có kiểu hai lớp');
    await click('input[name="play-mode"][value="layer1"]');

    await reset();
    await mouseDrag(await sticker(19), -55, 0); await ready();
    await checkColors(P.apply(SOLVED, 'U'), 'Kéo chuột hàng trên mặt trước: U');
    await mouseDrag(await sticker(23), 0, -55); await ready();
    await checkColors(P.applyAll(SOLVED, 'U R'), 'Kéo chuột cột phải: R');
    await mouseDrag(await sticker(22), 55, 0); await ready();
    await checkColors(P.applyAll(SOLVED, 'U R E'), 'Kéo chuột qua ô tâm chọn lớp giữa: E');
    await mouseDrag(await sticker(19), -160, 0); await ready();
    await checkColors(P.applyAll(SOLVED, 'U R E U'), 'Kéo chuột ra ngoài khối vẫn được theo dõi');
    await click('input[name="play-mode"][value="layer2"]');
    await mouseDrag(await sticker(21), 0, 60); await ready();
    await checkColors(P.applyAll(SOLVED, 'U R E U Lw'), 'Chế độ 2 lớp: kéo chuột cột trái xuống là Lw');
    await click('input[name="play-mode"][value="view"]');
    const beforeOrbit = await snapshot();
    let angle = await transform();
    await mouseDrag(await sticker(19), 40, 15);
    assert.notEqual(await transform(), angle);
    assert.deepEqual(await snapshot(), beforeOrbit);
    await click('input[name="play-mode"][value="layer1"]');
    angle = await transform();
    await mouseDrag(await background(), 40, 15);
    assert.notEqual(await transform(), angle);
    assert.deepEqual(await snapshot(), beforeOrbit);
    console.log('✓ Chế độ Góc nhìn và kéo vùng nền chỉ đổi góc nhìn');
    await click('#play-view');

    // ---------- Bàn phím, công thức ----------
    await reset();
    await key('r', 'KeyR');
    await checkColors(P.apply(SOLVED, 'R'), 'Phím R xoay mặt phải');
    await key('R', 'KeyR', 8);
    await checkColors(SOLVED, 'Shift + R xoay ngược');
    await key('2', 'Digit2');
    await checkColors(P.apply(SOLVED, 'R2'), 'Phím 2 xoay nửa vòng lớp đã chọn');
    await key('m', 'KeyM');
    await checkColors(P.applyAll(SOLVED, 'R2 M'), 'Phím M xoay lớp giữa');
    await key('z', 'KeyZ', 2);
    await checkColors(P.apply(SOLVED, 'R2'), 'Ctrl + Z hoàn tác');
    await key('y', 'KeyY', 2);
    await checkColors(P.applyAll(SOLVED, 'R2 M'), 'Ctrl + Y làm lại');
    await reset();
    await evaluate('document.querySelector("#play-sequence").focus()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR' });
    assert.deepEqual((await snapshot()).past, []);
    console.log('✓ Gõ trong ô công thức không xoay khối bằng phím tắt');
    await evaluate('document.querySelector("#play-sequence").value = "R X U"');
    await click('#play-run');
    assert((await text('#play-error')).length > 0);
    await checkColors(SOLVED, 'Công thức sai bị từ chối toàn bộ');
    const mixed = "R U R’ U’ M2 r U2 Rw'";
    await evaluate(`document.querySelector("#play-sequence").value = ${JSON.stringify(mixed)}`);
    await click('#play-run');
    await waitFor('document.querySelector("#play-stop").disabled && !document.querySelector("#play-run").disabled');
    await checkColors(P.applyAll(SOLVED, mixed), 'Công thức hỗn hợp M2, r, Rw chạy đúng thứ tự');
    assert.deepEqual((await snapshot()).past, ['R', 'U', "R'", "U'", 'M2', 'Rw', 'U2', "Rw'"], 'Lịch sử chuẩn hoá r thành Rw');
    await evaluate('document.querySelector("#play-sequence").value = "R U R U R U R U R U"');
    await click('#play-run'); await sleep(50); await click('#play-stop'); await ready();
    const stopped = await snapshot(); await sleep(600);
    assert.deepEqual(await snapshot(), stopped);
    console.log('✓ Dừng công thức không còn nước chạy ngầm');
    await click('#play-run'); await sleep(50); await click('#play-back'); await sleep(600);
    const leftTab = await snapshot(); await sleep(600);
    assert.deepEqual(await snapshot(), leftTab);
    await click('#nav-play');
    assert(await evaluate('document.querySelector("#play-stop").disabled'));
    console.log('✓ Quay lại dừng công thức và không tự chạy lại khi vào lại');

    // ---------- Lưu khối ----------
    await reset(); await click('#play-scramble');
    await click('[data-play-face="S"]'); await click('#play-clockwise'); await ready();
    const shuffled = await snapshot();
    assert.equal(shuffled.past.length, 21);
    assert(C.validateColors(shuffled.colors).ok);
    await open();
    assert.deepEqual(await snapshot(), shuffled);
    await checkColors(shuffled.colors, 'Tải lại sau tráo và lớp giữa S giữ đủ khối/lịch sử');
    const legacy = { colors: C.applyMoves(SOLVED, "R U R' U'"), past: ['R', 'U', "R'", "U'"], future: ['F'] };
    await evaluate(`localStorage.removeItem('rubik-play-v2'); localStorage.setItem('rubik-play-v1', ${JSON.stringify(JSON.stringify(legacy))})`);
    await open();
    assert.deepEqual(await snapshot(), { version: 3, ...legacy }, 'Chuyển bản lưu cũ sang bản mới');
    assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("rubik-play-v1"))'), legacy, 'Giữ bản cũ làm bản phục hồi');
    await checkColors(legacy.colors, 'Bản lưu cũ hiển thị đúng sau khi chuyển');
    await evaluate('localStorage.setItem("rubik-play-v2", "{broken"); localStorage.removeItem("rubik-play-v1")');
    await open();
    assert((await text('#play-status')).includes('Khối đã giải hoàn chỉnh'));
    await reset();
    await checkColors(SOLVED, 'Dữ liệu lưu hỏng không chặn mở khối mới');

    // Bản học chỉ cho đổi góc nhìn; hình và bước của bài học giữ nguyên.
    await click('#play-scramble');
    const played = await snapshot();
    await click('#play-back');
    await click('#nav-learn');
    await click('[data-level="start"]'); await click('[data-lesson="triggers"]');
    const learning = await evaluate('Array.from(document.querySelectorAll("#learn-cube .sticker"), e => e.style.background)');
    await mouseDrag(await rect('#learn-cube .sticker'), 20, 10);
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("#learn-cube .sticker"), e => e.style.background)'), learning);
    assert((await text('#learn-counter')).includes('0/4'));
    assert.deepEqual(await snapshot(), played);
    console.log('✓ Tương tác trong bài học không đổi màu mẫu hoặc khối tự chơi');
    await click('#nav-edit'); await click('#btn-reset-solved'); await click('#btn-solve');
    await waitFor('document.querySelector(".tab.active").dataset.tab === "solve" && document.querySelector("#step-move").textContent === "🎉"');
    await click('#nav-play'); await click('#play-clockwise'); await ready(); await click('#play-back');
    assert.equal(await evaluate('document.querySelector(".tab.active").dataset.tab'), 'solve');
    assert.equal(await text('#step-move'), '🎉');
    console.log('✓ Tự xoay không sửa lời giải của khối đã nhập');
    await click('#nav-play'); await reset(); await click('#play-view');
    await screenshot('desktop.png');

    // ---------- Chạm nhiều ngón trên điện thoại ----------
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await open(); // mở lại ở màn hình hẹp: bảng điều khiển đóng sẵn
    assert(await evaluate('document.querySelector("#play-panel").hidden'), 'Màn hình hẹp: bảng điều khiển đóng sẵn');
    assert.match(await text('.play-gesture-hint'), /1 ngón: một hàng\/cột · 2 ngón: hai hàng\/cột, mỗi ngón một chiều · 3 ngón: nhìn quanh/);
    await reset();
    let expected = SOLVED;
    const turned = async (entry, label) => {
      await ready();
      expected = P.applyAll(expected, entry);
      await checkColors(expected, label);
      assert.equal((await snapshot()).past.at(-1), entry, `${label}: lịch sử ghi một lượt`);
    };
    const restingView = await transform();
    await multiDrag([await sticker(19)], [-60, 0], {
      onPlaced: async () => {
        assert.equal(await count('#play-cube .cubie.touch-cubie'), 1, 'Đặt một ngón tô sáng viên đang chạm');
        assert.equal(await count('#play-cube .cubie.preview-layer'), 0);
      },
      onMoved: async () => {
        assert.equal(await count('#play-cube .cubie.preview-layer'), 9, 'Rõ hướng: tô sáng cả hàng');
        assert.equal(await count('#play-cube .cubie.touch-cubie'), 0, 'Rõ hướng: bỏ tô viên');
      },
    });
    await turned('U', 'Một ngón vuốt hàng trên: U');
    assert.equal(await count('#play-cube .cubie.touch-cubie, #play-cube .cubie.preview-layer'), 0, 'Nhấc tay bỏ tô sáng');
    await noDarkCells('Sau nước một ngón');
    assert.equal(await transform(), restingView, 'Dựng lại khối sau nước xoay trả góc nhìn về đúng chỗ');
    await multiDrag([await sticker(23)], [0, -50], { hold: 0, steps: 2 });
    await turned('R', 'Một ngón vuốt nhanh cột phải: R');
    await multiDrag([await sticker(19)], [0, 60]);
    await turned('M', 'Một ngón vuốt cột giữa xuống: M');
    await multiDrag([await sticker(22)], [60, 0]);
    await turned('E', 'Một ngón vuốt qua ô tâm sang phải: E');
    await multiDrag([await sticker(21), await sticker(23)], [[0, 60], [0, -60]], {
      onPlaced: async () => {
        assert.equal(await count('#play-cube .cubie.touch-cubie'), 2, 'Đặt hai ngón tô sáng hai viên');
        await screenshot('touch-highlight.png');
      },
      onMoved: async () => {
        assert.equal(await count('#play-cube .cubie.preview-layer'), 18, 'Tô sáng đủ hai cột khi kéo');
        assert.equal(await count('#play-cube .cubie.touch-cubie'), 0);
        assert.match(await text('#play-gesture'), /2 ngón · L R$/);
        await screenshot('two-layers-opposite.png');
      },
    });
    assert.equal(await evaluate('Array.from(document.querySelectorAll("#play-cube .cubie"), (c) => c.style.transform).filter((t) => t.includes("rotate3d")).length'),
      18, 'Hai lớp chuyển động cùng lúc');
    await turned('L R', 'Hai ngón ngược chiều: cột trái xuống, cột phải lên là L R');
    await noDarkCells('Sau lượt hai ngón');
    await multiDrag([await sticker(19), await sticker(25)], [-60, 0]);
    await turned("U D'", "Hai ngón cùng chiều: hàng trên và hàng dưới sang trái là U D'");
    await multiDrag([await sticker(19), await sticker(22)], [[-60, 0], [60, 0]]);
    await turned('U E', 'Hai ngón ngược chiều trên hàng trên và hàng giữa: U E');
    const historyLength = (await snapshot()).past.length;
    await click('#play-undo'); await ready();
    expected = P.applyAll(expected, P.inverseEntry('U E'));
    await checkColors(expected, 'Hoàn tác lượt hai ngón bằng một lần bấm');
    assert.equal((await snapshot()).past.length, historyLength - 1);
    await click('#play-redo'); await ready();
    expected = P.applyAll(expected, 'U E');
    await checkColors(expected, 'Làm lại lượt hai ngón bằng một lần bấm');
    await click('#play-undo'); await ready();
    expected = P.applyAll(expected, P.inverseEntry('U E'));
    const beforeThree = await snapshot();
    assert.equal(beforeThree.future.length, 1);
    angle = await transform();
    await multiDrag([await background(), await sticker(19), await sticker(25)], [70, 35], {
      onMoved: async () => {
        assert.match(await text('#play-gesture'), /3 ngón · đổi góc nhìn/);
        await screenshot('three-fingers.png');
      },
    });
    await sleep(200);
    assert.notEqual(await transform(), angle, 'Ba ngón đổi góc nhìn');
    assert.deepEqual(await snapshot(), beforeThree, 'Ba ngón không đổi màu, lịch sử hay nhánh làm lại');
    console.log('✓ Ba ngón chỉ đổi góc nhìn; nhấc từng ngón không tạo thêm nước');
    await click('#play-view');

    const unchanged = async (label) => {
      await sleep(350);
      assert.deepEqual(await snapshot(), beforeThree, label);
      console.log(`✓ ${label}`);
    };
    // Thêm ngón sau khi đã khóa hướng: hủy lượt.
    const anchor = await sticker(19), extra = await background();
    await touch('touchStart', [finger(1, anchor)]);
    await sleep(220);
    await touch('touchMove', [finger(1, { x: anchor.x - 40, y: anchor.y })]);
    await touch('touchStart', [finger(1, { x: anchor.x - 40, y: anchor.y }), finger(2, extra)]);
    await touch('touchMove', [finger(1, { x: anchor.x - 80, y: anchor.y }), finger(2, { x: extra.x - 40, y: extra.y })]);
    await touch('touchEnd', [finger(1, { x: anchor.x - 80, y: anchor.y })]);
    await touch('touchEnd', [finger(2, { x: extra.x - 40, y: extra.y })]);
    await unchanged('Thêm ngón sau khi khóa hủy lượt an toàn');
    await multiDrag([await sticker(19), await sticker(21), await sticker(23), await background()], [50, 0]);
    await unchanged('Bốn ngón không tạo nước');
    await multiDrag([await sticker(23), await background()], [[0, -60], [0, 60]]);
    await unchanged('Hai ngón, một ngón ở vùng nền: không tạo nước');
    assert.match(await text('#play-status'), /cả hai ngón lên khối/);
    await multiDrag([await sticker(19), await sticker(22)], [0, 60]);
    await unchanged('Hai ngón trên cùng một cột: không tạo nước');
    assert.match(await text('#play-status'), /hai hàng hoặc hai cột khác nhau/);
    await multiDrag([await sticker(18), await sticker(26)], [[-60, 0], [0, -60]]);
    await unchanged('Một ngón kéo hàng, ngón kia kéo cột: không tạo nước');
    assert.match(await text('#play-status'), /song song/);
    await multiDrag([await sticker(21), await sticker(23)], [[0, 60], [0, -4]]);
    await unchanged('Hai ngón, một ngón không kéo: không tạo nước');
    assert.match(await text('#play-status'), /cả hai ngón đủ xa/);
    angle = await transform();
    await multiDrag([await background()], [70, 35]);
    await unchanged('Một ngón kéo vùng nền không xoay khối');
    assert.equal(await transform(), angle, 'Một ngón kéo vùng nền không đổi góc nhìn');
    assert.match(await text('#play-status'), /3 ngón để đổi góc nhìn/);
    await multiDrag([await sticker(19)], [6, 0]);
    await unchanged('Vuốt quá ngắn không tạo nước');
    const cancelPoint = await sticker(23);
    await touch('touchStart', [finger(1, cancelPoint)]);
    await sleep(220);
    await touch('touchMove', [finger(1, { x: cancelPoint.x, y: cancelPoint.y - 50 })]);
    await touch('touchCancel', []);
    await unchanged('Ngắt chạm (touchcancel) không tạo nước');
    const toolbar = await rect('#play-gesture');
    await multiDrag([toolbar], [-60, 0]);
    await unchanged('Kéo bắt đầu trên thanh công cụ không xoay khối');
    await touch('touchStart', [finger(1, cancelPoint)]);
    await sleep(220);
    await touch('touchMove', [finger(1, { x: cancelPoint.x, y: cancelPoint.y - 50 })]);
    await click('#play-back');
    await touch('touchEnd', [finger(1, { x: cancelPoint.x, y: cancelPoint.y - 50 })]);
    await unchanged('Rời sân chơi giữa cử chỉ không tạo nước');
    await click('#nav-play');
    await multiDrag([await sticker(23)], [0, -50]);
    await turned('R', 'Vào lại sân chơi vẫn vuốt được');
    const undoButton = await rect('#play-undo');
    await touch('touchStart', [finger(1, undoButton)]);
    await touch('touchEnd', [finger(1, undoButton)]);
    await ready();
    expected = P.apply(expected, "R'");
    await checkColors(expected, 'Chạm nút Hoàn tác chỉ chạy nút, không tính vào cử chỉ');
    await screenshot('mobile.png');

    // ---------- Bố cục ----------
    for (const [width, height] of [[320, 640], [375, 812], [390, 844], [844, 390], [1280, 800]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
      await sleep(250);
      const layout = await evaluate(`(() => {
        const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; };
        const cube = document.querySelector('#play-cube').getBoundingClientRect();
        const cubeArt = document.querySelector('#play-cube .cube3d').getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('#play-arena').scrollWidth > innerWidth,
          toolbar: [...document.querySelectorAll('.play-toolbar .btn')].filter((b) => !b.hidden).every(inside),
          stage: Math.round(Math.min(cube.width, cube.height)),
          centered: Math.abs(cubeArt.left - (cube.left + cube.width / 2)) < 2,
        };
      })()`);
      assert(!layout.overflow, `Tràn ngang ${width}×${height}`);
      assert(layout.toolbar, `Thanh công cụ nằm trong màn hình ${width}×${height}`);
      assert(layout.stage >= 150, `Vùng chơi đủ lớn ${width}×${height}: ${layout.stage}px`);
      assert(layout.centered, `Khối nằm giữa vùng chơi ${width}×${height}`);
      await click('#play-panel-toggle');
      await evaluate('document.querySelector("#play-sequence").focus({ preventScroll: true })');
      await sleep(400);
      const reachable = await evaluate(`(() => {
        const r = document.querySelector('#play-sequence').getBoundingClientRect();
        const close = document.querySelector('#play-panel-close').getBoundingClientRect();
        const ok = !document.querySelector('#play-panel').hidden && r.top >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1 &&
          close.top >= -1 && close.bottom <= innerHeight + 1 && !!document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2)?.closest('#play-panel-close');
        return { ok, input: [Math.round(r.top), Math.round(r.bottom)], close: [Math.round(close.top), Math.round(close.bottom)], height: innerHeight,
          focused: document.activeElement.id, scrollTop: Math.round(document.querySelector('#play-panel').scrollTop) };
      })()`);
      assert(reachable.ok, `Bảng điều khiển và ô công thức tiếp cận được ${width}×${height}: ${JSON.stringify(reachable)}`);
      if (width === 390) await screenshot('mobile-panel.png');
      if (width === 844) await screenshot('landscape.png');
      await click('#play-panel-close');
    }
    console.log('✓ Bố cục 320/375/390 px dọc, 844×390 ngang và máy tính: không tràn, thanh công cụ và bảng điều khiển tiếp cận được');

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
