// Chạy: node tests/serve.test.js
// Máy chủ chạy thử phải trả đúng file, từ chối đường dẫn xấu bằng 4xx và không bao giờ bị dừng.
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { start } = require('../scripts/serve.js');

// Gửi đường dẫn nguyên văn (fetch sẽ tự chuẩn hoá /../ và %2e%2e).
function request(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // Thư mục gốc tạm, có file ẩn và symlink trỏ ra ngoài.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rubik-serve-'));
  const root = path.join(base, 'site');
  fs.mkdirSync(path.join(root, 'js'), { recursive: true });
  fs.mkdirSync(path.join(root, '.local'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>ok');
  fs.writeFileSync(path.join(root, 'js', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, '.local', 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(base, 'outside.txt'), 'outside');
  let symlink = true;
  try {
    fs.symlinkSync(path.join(base, 'outside.txt'), path.join(root, 'link.txt'));
    fs.symlinkSync(path.join(root, '.local', 'secret.txt'), path.join(root, 'public.txt')); // trỏ vào file ẩn bên trong
  } catch (e) { symlink = false; }

  const server = await start(0, '127.0.0.1', root);
  const { port } = server.address();
  try {
    const ok = [
      ['/', 200, 'text/html'],
      ['/index.html', 200, 'text/html'],
      ['/js/app.js', 200, 'text/javascript'],
      ['/js/app.js?v=123', 200, 'text/javascript'],
    ];
    for (const [p, status, type] of ok) {
      const r = await request(port, p);
      assert.strictEqual(r.status, status, p);
      assert.ok(r.type.startsWith(type), `${p}: ${r.type}`);
    }
    const bad = [
      ['/%00', 400], ['/index.html%00.js', 400], ['/%E0%A4%A', 400], ['/js%5c..%5c..%5coutside.txt', 400],
      ['/.local/secret.txt', 404], ['/%2elocal/secret.txt', 404], ['/../outside.txt', 404],
      ['/%2e%2e/outside.txt', 404], ['/js/../../outside.txt', 404], ['/nope.js', 404], ['/js', 404],
      ['/index.html/', 404],
    ];
    if (symlink) bad.push(['/link.txt', 404], ['/public.txt', 404]);
    for (const [p, status] of bad) {
      const r = await request(port, p);
      assert.strictEqual(r.status, status, `${p}: ${r.status}`);
      assert.ok(!/secret|outside/.test(r.body), `${p} lộ nội dung`);
    }
    assert.strictEqual((await request(port, '/', 'POST')).status, 405);
    assert.strictEqual((await request(port, '/', 'HEAD')).status, 200);
    // Sau mọi yêu cầu xấu, máy chủ vẫn sống.
    assert.strictEqual((await request(port, '/')).status, 200);
    console.log(`Máy chủ chạy thử: ${ok.length} yêu cầu hợp lệ, ${bad.length + 1} yêu cầu xấu bị từ chối, vẫn chạy bình thường`);
    console.log('Tất cả test PASS');
  } finally {
    server.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
