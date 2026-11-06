/*
 * Điều khiển Chrome headless qua DevTools Protocol cho kiểm thử trình duyệt (không cần thư viện).
 *   const page = await launchChrome({ userDataDir, args: ['--use-fake-ui-for-media-stream'] });
 *   await page.send('Page.navigate', { url });
 *   const title = await page.evaluate('document.title');
 *   page.close();
 * - Dùng cổng điều khiển ngẫu nhiên (--remote-debugging-port=0, đọc từ DevToolsActivePort) nên không bao giờ
 *   nối nhầm vào một Chrome cũ còn sót lại từ lần chạy trước.
 * - Chrome đóng/crash: mọi yêu cầu đang chờ và yêu cầu mới đều trả về ngay, evaluate() ném lỗi thay vì treo.
 * Biến môi trường: CHROME_BIN (mặc định google-chrome), CHROME_FLAGS (cờ thêm, ví dụ --no-sandbox trên CI).
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome({ userDataDir, args = [] }) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });
  const extra = (process.env.CHROME_FLAGS || '').split(/\s+/).filter(Boolean);
  const proc = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, ...args, ...extra, 'about:blank',
  ], { stdio: 'ignore' });
  let exited = null;
  proc.on('error', (err) => { exited = `không chạy được Chrome (${err.message}); đặt CHROME_BIN nếu cần`; });
  proc.on('exit', (code, signal) => { exited = exited || `Chrome đã thoát (${signal || code})`; });
  const kill = () => { if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL'); };

  try {
    let port = 0;
    for (let i = 0; i < 150 && !port; i++) {
      if (exited) throw new Error(exited);
      try { port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || 0; } catch (e) { /* chưa có */ }
      if (!port) await sleep(100);
    }
    if (!port) throw new Error('Chrome không mở cổng điều khiển sau 15 giây');
    let targets = null;
    for (let i = 0; i < 50 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { await sleep(100); }
    }
    const page = targets && targets.find((t) => t.type === 'page');
    if (!page) throw new Error('Không tìm thấy tab của Chrome');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Không kết nối được DevTools')), { once: true });
    });
    let id = 0;
    const waiting = new Map();
    const listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    });
    ws.addEventListener('close', () => { waiting.forEach((r) => r({})); waiting.clear(); });

    const send = (method, params = {}) => {
      if (ws.readyState !== WebSocket.OPEN) return Promise.resolve({});
      return new Promise((resolve) => {
        const i = ++id;
        waiting.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    };
    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (!res.result) throw new Error(`Mất kết nối với Chrome${exited ? ` (${exited})` : ''}`);
      return res.result.result?.value;
    };
    return {
      send,
      evaluate,
      onEvent: (fn) => listeners.push(fn),
      close: () => { try { ws.close(); } catch (e) { /* đã đóng */ } kill(); },
    };
  } catch (err) {
    kill();
    throw err;
  }
}

module.exports = { launchChrome, sleep };
