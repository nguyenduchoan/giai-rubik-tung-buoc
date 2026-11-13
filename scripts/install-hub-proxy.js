// Thêm đúng một tuyến vào API Hub; không đổi cấu hình nginx hoặc phần xác thực hiện có.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '/var/www/html');
const file = path.join(root, 'api-server/src/app.js');
const source = fs.readFileSync(file, 'utf8');
const anchor = '  app.use(webCliProxy.handle);';
const addition = "\n  // Rubik: API phòng giao hữu, tách tiến trình và dữ liệu khỏi Hub.\n  app.use(require('../../data/rubik-room-service/hub-proxy.js').createRubikProxy());";
if (source.includes(addition)) { console.log('Tuyến API Rubik đã được cài.'); process.exit(0); }
if (source.split(anchor).length !== 2 || source.includes('rubik-room-service/hub-proxy')) {
  throw new Error('Cấu trúc API Hub khác dự kiến; giữ nguyên để kiểm tra.');
}
const backup = path.join(root, 'data/rubik-room-service/hub-app.before-rubik.js');
if (!fs.existsSync(backup)) fs.writeFileSync(backup, source, { mode: 0o600, flag: 'wx' });
fs.writeFileSync(file + '.rubik-next', source.replace(anchor, anchor + addition), { mode: fs.statSync(file).mode & 0o777 });
fs.renameSync(file + '.rubik-next', file);
console.log('Đã cài tuyến /api/rubik/ vào API Hub.');
