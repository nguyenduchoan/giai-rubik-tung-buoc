/*
 * Giữ sẵn vài bộ tráo random-state do luồng phụ sinh, để lệnh Bắt đầu không phải chờ bộ giải (vài trăm ms–vài giây)
 * và không chặn vòng xử lý đang đo giờ của các phòng khác. Hết hàng thì dùng tạm 25 nước ngẫu nhiên.
 */
'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomMoveScramble } = require('./engine.js');

class Scrambler {
  constructor({ size = 3, worker = true, log = () => {} } = {}) {
    this.size = size;
    this.queue = [];
    this.log = log;
    this.busy = false;
    this.closed = false;
    this.worker = null;
    if (worker) this.spawn();
  }

  spawn() {
    if (this.closed) return;
    const w = new Worker(path.join(__dirname, 'scramble-worker.js'));
    this.worker = w;
    w.unref();
    w.on('message', (msg) => {
      if (msg.ready) { this.busy = false; this.fill(); return; }
      this.busy = false;
      if (msg.result) this.queue.push(msg.result);
      else this.log('scrambler_error', { message: msg.error });
      this.fill();
    });
    w.on('error', (error) => { this.log('scrambler_crash', { message: error.message }); });
    w.on('exit', () => {
      if (this.worker === w) this.worker = null;
      this.busy = false;
      if (!this.closed) setTimeout(() => this.spawn(), 5000).unref();
    });
    this.busy = true;
    w.postMessage('init');
  }

  fill() {
    if (this.closed || this.busy || !this.worker || this.queue.length >= this.size) return;
    this.busy = true;
    this.worker.postMessage('next');
  }

  // Trả ngay một bộ tráo; avoid: trạng thái của ván trước để không lặp đề.
  take(avoid) {
    let item = null;
    while (this.queue.length) {
      const next = this.queue.shift();
      if (next.state !== avoid) { item = next; break; }
    }
    this.fill();
    return item || randomMoveScramble();
  }

  get ready() { return this.queue.length; }

  close() {
    this.closed = true;
    const w = this.worker;
    this.worker = null;
    return w ? w.terminate().catch(() => {}) : Promise.resolve();
  }
}

module.exports = { Scrambler };
