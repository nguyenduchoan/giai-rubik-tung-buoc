#!/usr/bin/env node
/*
 * Chạy kiểm thử trình duyệt, tự bật máy chủ tĩnh:
 *   - tests/e2e-camera.js: luồng camera giả cho các kịch bản chụp MISTAKES=0,1,2,3
 *   - tests/e2e-state.js: các ca trạng thái (chụp trùng, hoạt ảnh cũ, sửa tay, tự cập nhật)
 *   - tests/e2e-learn.js: lộ trình học, mô phỏng công thức và lưu tiến độ
 *   - tests/e2e-play.js: Rubik tự chơi, chuột/cảm ứng, hoàn tác và lưu khối
 *   npm run test:e2e                 # tất cả
 *   MISTAKES=2 npm run test:e2e      # chỉ một (hoặc vài: MISTAKES=1,3) kịch bản camera
 * Cần Google Chrome/Chromium; đặt CHROME_BIN nếu lệnh `google-chrome` không có trên PATH.
 * Ảnh chụp màn hình từng kịch bản lưu ở .e2e-out/ (đổi bằng E2E_OUT).
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { start } = require('./serve.js');

const PORT = Number(process.env.E2E_PORT || 8765);
const OUT = path.resolve(process.env.E2E_OUT || '.e2e-out');
const MODES = (process.env.MISTAKES || '0,1,2,3').split(',').map((s) => s.trim()).filter(Boolean);
const TESTS = path.join(__dirname, '..', 'tests');

/*
 * Mỗi bộ kiểm thử thường chạy dưới 2 phút; quá giới hạn thì dừng hẳn và tính là không đạt (tránh treo CI).
 * Bộ kiểm thử chạy trong nhóm tiến trình riêng để khi dừng thì dừng cả Chrome nó đã mở (không để sót Chrome).
 */
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 4 * 60 * 1000);
const GROUP_KILL = process.platform !== 'win32';
let running = null;

function killTree(child) {
  try {
    if (GROUP_KILL) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch (e) { /* đã thoát */ }
}

function run(label, args, env = {}) {
  return new Promise((resolve) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(process.execPath, args, {
      stdio: 'inherit', env: { ...process.env, ...env }, detached: GROUP_KILL,
    });
    running = child;
    const timer = setTimeout(() => {
      console.error(`✗ ${label}: quá ${Math.round(TIMEOUT_MS / 1000)} giây, dừng kiểm thử`);
      killTree(child);
    }, TIMEOUT_MS);
    child.on('error', (err) => { console.error(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      running = null;
      killTree(child); // dọn tiến trình con còn sót trong nhóm (nếu có)
      resolve(code === 0);
    });
  });
}

// Ctrl+C / CI huỷ job: nhóm tiến trình riêng không nhận tín hiệu từ terminal nên phải tự dừng.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (running) killTree(running);
    process.exit(130);
  });
}

(async () => {
  const server = await start(PORT, '127.0.0.1');
  const failed = [];
  try {
    for (const mode of MODES) {
      const label = `Camera MISTAKES=${mode}`;
      const args = [path.join(TESTS, 'e2e-camera.js'), `http://127.0.0.1:${PORT}/`, path.join(OUT, `mistakes-${mode}`)];
      if (!(await run(label, args, { MISTAKES: mode }))) failed.push(label);
    }
  } finally {
    server.close();
  }
  if (!process.env.MISTAKES) {
    const label = 'Ca trạng thái (e2e-state)';
    if (!(await run(label, [path.join(TESTS, 'e2e-state.js'), path.join(OUT, 'state')]))) failed.push(label);
    const learnLabel = 'Tab học chơi (e2e-learn)';
    if (!(await run(learnLabel, [path.join(TESTS, 'e2e-learn.js'), path.join(OUT, 'learn')]))) failed.push(learnLabel);
    const playLabel = 'Rubik tự chơi (e2e-play)';
    if (!(await run(playLabel, [path.join(TESTS, 'e2e-play.js'), path.join(OUT, 'play')]))) failed.push(playLabel);
  }
  console.log(failed.length ? `\nKHÔNG ĐẠT: ${failed.join('; ')}` : '\nĐẠT tất cả kiểm thử trình duyệt');
  process.exitCode = failed.length ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
