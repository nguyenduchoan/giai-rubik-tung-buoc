/*
 * Máy chủ WebSocket tối giản theo RFC 6455, không phụ thuộc thư viện (repo không có node_modules).
 * Chỉ nhận khung văn bản UTF-8 có mặt nạ từ trình duyệt, có ghép khung phân mảnh, ping/pong và đóng kết nối.
 * Giới hạn kích thước bản tin (mặc định 4 KiB) và bộ đệm gửi để một máy khách chậm không giữ bộ nhớ vô hạn.
 */
'use strict';
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFERED = 1 << 20;
const decoder = new TextDecoder('utf-8', { fatal: true });

const acceptKey = (key) => crypto.createHash('sha1').update(key + GUID).digest('base64');

function rejectUpgrade(socket, status, text) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

class WsConnection extends EventEmitter {
  constructor(socket, { maxPayload = 4096 } = {}) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.fragmentSize = 0;
    this.closed = false;
    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('error', () => this.terminate());
    socket.on('close', () => this.finish());
    socket.on('end', () => this.terminate());
  }

  receive(chunk) {
    if (this.closed) return;
    this.emit('activity');
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (!this.closed) {
      const frame = this.parse();
      if (!frame) break;
      this.handle(frame);
    }
  }

  parse() {
    const b = this.buffer;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    let len = b[1] & 0x7f;
    let offset = 2;
    if (b[0] & 0x70) return this.fail(1002);
    if (!(b[1] & 0x80)) return this.fail(1002); // máy khách bắt buộc dùng mặt nạ
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      if (b.readUInt32BE(2) !== 0) return this.fail(1009);
      len = b.readUInt32BE(6); offset = 10;
    }
    if (opcode >= 0x8 && (len > 125 || !fin)) return this.fail(1002);
    if (len > this.maxPayload) return this.fail(1009);
    if (b.length < offset + 4 + len) return null;
    const mask = b.subarray(offset, offset + 4);
    const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + len));
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    this.buffer = b.subarray(offset + 4 + len);
    return { fin, opcode, payload };
  }

  handle({ fin, opcode, payload }) {
    switch (opcode) {
      case 0x0:
        if (!this.fragments) { this.fail(1002); return; }
        this.fragmentSize += payload.length;
        if (this.fragmentSize > this.maxPayload) { this.fail(1009); return; }
        this.fragments.push(payload);
        if (fin) {
          const all = Buffer.concat(this.fragments);
          this.fragments = null; this.fragmentSize = 0;
          this.deliver(all);
        }
        return;
      case 0x1:
        if (this.fragments) { this.fail(1002); return; }
        if (fin) this.deliver(payload);
        else { this.fragments = [payload]; this.fragmentSize = payload.length; }
        return;
      case 0x2:
        this.fail(1003); // chỉ nhận văn bản
        return;
      case 0x8: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        this.close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000);
        return;
      }
      case 0x9:
        this.write(0xa, payload);
        return;
      case 0xa:
        this.emit('pong');
        return;
      default:
        this.fail(1002);
    }
  }

  deliver(buffer) {
    let text;
    try { text = decoder.decode(buffer); } catch (e) { this.fail(1007); return; }
    this.emit('message', text);
  }

  write(opcode, payload) {
    if (this.closed || this.socket.destroyed) return false;
    if (this.socket.writableLength > MAX_BUFFERED) { this.terminate(); return false; }
    this.socket.write(encodeFrame(opcode, payload));
    return true;
  }

  send(text) { return this.write(0x1, Buffer.from(text, 'utf8')); }
  ping() { return this.write(0x9, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.write(0x8, body.subarray(0, 125));
    this.finish();
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), 2000);
    timer.unref?.();
  }

  fail(code) { this.close(code); return null; }

  terminate() {
    this.socket.destroy();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.emit('close');
  }
}

// Bắt tay nâng cấp; trả về WsConnection hoặc null nếu yêu cầu không phải WebSocket hợp lệ (đã trả lời lỗi).
function acceptUpgrade(req, socket, head, options = {}) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (req.method !== 'GET' || upgrade !== 'websocket' || typeof key !== 'string' ||
      !/^[A-Za-z0-9+/]{22}==$/.test(key) || req.headers['sec-websocket-version'] !== '13') {
    rejectUpgrade(socket, 400, 'Bad Request');
    return null;
  }
  socket.write([
    'HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', '',
  ].join('\r\n'));
  const conn = new WsConnection(socket, options);
  if (head && head.length) conn.receive(head);
  return conn;
}

module.exports = { acceptUpgrade, rejectUpgrade, WsConnection, encodeFrame, acceptKey };
