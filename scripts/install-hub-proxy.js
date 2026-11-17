// Gắn tuyến Rubik vào API Hub; không đổi cấu hình nginx hoặc phần xác thực hiện có.
//  - src/app.js: middleware HTTP /api/rubik/ (đặt trước bộ đọc JSON).
//  - server.js: chuyển yêu cầu nâng cấp WebSocket /api/rubik/online/ws, các đường khác vẫn đi Web CLI.
// Lưu bản gốc trước khi sửa lần đầu (data/rubik-room-service/*.before-rubik.js); chạy lại nhiều lần an toàn.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '/var/www/html');
const backupDir = path.join(root, 'data/rubik-room-service');

function patch(relative, backupName, anchor, addition, marker) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(addition)) return false;
  if (source.split(anchor).length !== 2 || source.includes(marker)) {
    throw new Error(`Cấu trúc ${relative} khác dự kiến; giữ nguyên để kiểm tra.`);
  }
  const backup = path.join(backupDir, backupName);
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, source, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(file + '.rubik-next', source.replace(anchor, addition), { mode: fs.statSync(file).mode & 0o777 });
  fs.renameSync(file + '.rubik-next', file);
  return true;
}

const appAnchor = '  app.use(webCliProxy.handle);';
const appChanged = patch('api-server/src/app.js', 'hub-app.before-rubik.js', appAnchor,
  appAnchor + "\n  // Rubik: API phòng giao hữu, tách tiến trình và dữ liệu khỏi Hub.\n  app.use(require('../../data/rubik-room-service/hub-proxy.js').createRubikProxy());",
  'rubik-room-service/hub-proxy');

const serverAnchor = '  server.on(\'upgrade\', app.locals.webCliProxy.upgrade);';
const serverChanged = patch('api-server/server.js', 'hub-server.before-rubik.js', serverAnchor, [
  '  // Rubik: WebSocket Thi trực tiếp /api/rubik/online/ws; đường khác giữ nguyên cho Web CLI.',
  "  const rubikUpgrade = require('../data/rubik-room-service/hub-proxy.js').createRubikUpgrade();",
  "  server.on('upgrade', (request, socket, head) => {",
  '    if (rubikUpgrade(request, socket, head)) return;',
  '    app.locals.webCliProxy.upgrade(request, socket, head);',
  '  });',
].join('\n'), 'rubik-room-service/hub-proxy');

console.log(appChanged || serverChanged ? 'Đã cài tuyến /api/rubik/ (HTTP và WebSocket) vào API Hub.' : 'Tuyến API Rubik đã được cài.');
