#!/usr/bin/env node
/*
 * Chạy kiểm thử trình duyệt, tự bật máy chủ tĩnh:
 *   - tests/e2e-camera.js: luồng camera giả cho các kịch bản chụp MISTAKES=0,1,2,3
 *   - tests/e2e-state.js: các ca trạng thái (chụp trùng, hoạt ảnh cũ, sửa tay, tự cập nhật)
 *   npm run test:e2e                 # tất cả
 *   MISTAKES=2 npm run test:e2e      # chỉ một (hoặc vài: MISTAKES=1,3) kịch bản camera, bỏ qua e2e-state
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

function run(label, args, env = {}) {
  return new Promise((resolve) => {
    console.log(`\n=== ${label} ===`);
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code === 0));
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
  }
  console.log(failed.length ? `\nKHÔNG ĐẠT: ${failed.join('; ')}` : '\nĐẠT tất cả kiểm thử trình duyệt');
  process.exitCode = failed.length ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
