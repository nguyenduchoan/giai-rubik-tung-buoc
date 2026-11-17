/*
 * Kết nối Thi trực tiếp phía trình duyệt: gọi API HTTP (cookie phiên HttpOnly do máy chủ cấp), giữ một WebSocket
 * tự nối lại, ước lượng đồng hồ máy chủ bằng ping/pong (lấy mẫu có độ trễ nhỏ nhất) và gửi lệnh có mã chống lặp.
 * Không quyết định kết quả: đồng hồ hiển thị và trạng thái khối luôn đồng bộ lại theo máy chủ.
 */
(function (root) {
  'use strict';
  const Proto = root.Rubik.onlineProtocol;

  const randomId = () => (root.crypto?.randomUUID ? root.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  // Mã riêng của tab (giữ qua tải lại trang): cùng tab nối lại thì tự lấy lại quyền điều khiển, tab khác phải bấm lấy quyền.
  function tabId() {
    try {
      let id = sessionStorage.getItem('rubik-online-tab');
      if (!id) { id = randomId(); sessionStorage.setItem('rubik-online-tab', id); }
      return id;
    } catch (e) { return randomId(); }
  }

  class OnlineClient {
    constructor({ apiBase, onMessage = () => {}, onState = () => {} }) {
      this.apiBase = apiBase;
      this.onMessage = onMessage;
      this.onState = onState;
      this.clientId = tabId();
      this.state = 'idle';
      this.ws = null;
      this.roomId = null;
      this.stopped = true;
      this.attempt = 0;
      this.samples = [];
      this.offset = null;
      this.rtt = null;
      this.epoch = 0;
      this.controlling = false;
      this.waiting = new Map();
      this.lastMessage = 0;
    }

    url(route) { return new URL(this.apiBase + 'online/' + route, document.baseURI); }

    async http(method, route, body) {
      let response;
      try {
        response = await fetch(this.url(route), {
          method, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000),
          headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw Object.assign(new Error('Không kết nối được máy chủ thi đấu. Kiểm tra mạng rồi thử lại.'), { code: 'network' });
      }
      let data = null;
      try { data = await response.json(); } catch (e) { /* không phải JSON */ }
      if (!response.ok) {
        const code = data?.code || 'service_unavailable';
        throw Object.assign(new Error(Proto.message(code)), { code, data, status: response.status });
      }
      return data;
    }

    session() { return this.http('POST', 'session', {}); }

    // Phiên hết hạn/bị xóa cookie: tạo phiên mới rồi thử lại một lần.
    async call(method, route, body) {
      try { return await this.http(method, route, body); } catch (error) {
        if (error.code !== 'session_invalid') throw error;
        await this.session();
        return this.http(method, route, body);
      }
    }

    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.onState(state);
    }

    connect(roomId) {
      this.stop();
      this.roomId = roomId;
      this.stopped = false;
      this.attempt = 0;
      this.open();
    }

    open() {
      if (this.stopped) return;
      const url = this.url('ws');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { this.reconnectLater(); return; }
      this.ws = ws;
      this.controlling = false;
      this.samples = [];
      this.setState('connecting');
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.lastMessage = performance.now();
        this.raw({ type: 'hello', protocolVersion: Proto.PROTOCOL_VERSION, engineVersion: Proto.ENGINE_VERSION, roomId: this.roomId, clientId: this.clientId });
        this.startPing();
      };
      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.lastMessage = performance.now();
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }
        this.handle(msg);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.controlling = false;
        this.stopPing();
        this.failWaiting('network');
        if (this.stopped) { this.setState('idle'); return; }
        this.setState('offline');
        this.reconnectLater();
      };
      ws.onerror = () => { /* onclose xử lý */ };
    }

    reconnectLater() {
      clearTimeout(this.timer);
      const delay = Math.min(5000, 400 * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
      this.attempt += 1;
      this.timer = setTimeout(() => this.open(), delay);
    }

    // Ping 5 giây/lần để đo độ lệch đồng hồ; im lặng quá 12 giây thì coi kết nối đã chết và nối lại.
    startPing() {
      this.stopPing();
      this.ping();
      this.burst = [300, 700, 1200].map((ms) => setTimeout(() => this.ping(), ms));
      this.pinger = setInterval(() => {
        if (performance.now() - this.lastMessage > 12000) { this.ws?.close(); return; }
        this.ping();
      }, 5000);
    }
    stopPing() {
      clearInterval(this.pinger);
      for (const t of this.burst || []) clearTimeout(t);
      this.burst = [];
    }
    ping() { this.raw({ type: 'time.ping', t: performance.now() }); }
    resync() { if (this.ws?.readyState === 1) { this.samples = []; this.startPing(); this.raw({ type: 'room.sync' }); } }

    handle(msg) {
      const now = performance.now();
      if (msg.type === 'time.pong' && typeof msg.t === 'number' && typeof msg.serverTime === 'number') {
        const rtt = now - msg.t;
        this.samples.push({ rtt, offset: msg.serverTime + rtt / 2 - now });
        if (this.samples.length > 10) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.offset;
        this.rtt = best.rtt;
        return;
      }
      if (this.offset === null && typeof msg.serverTime === 'number') this.offset = msg.serverTime - now;
      if (msg.type === 'welcome') {
        this.epoch = msg.epoch;
        this.controlling = msg.controlling;
        this.attempt = 0;
        this.setState('online');
      }
      if (msg.type === 'control.revoked') this.controlling = false;
      if (msg.type === 'room.snapshot' && msg.me) { this.controlling = msg.me.controlling; this.epoch = msg.me.epoch; }
      if ((msg.type === 'command.ok' || msg.type === 'command.rejected') && msg.commandId && this.waiting.has(msg.commandId)) {
        const w = this.waiting.get(msg.commandId);
        this.waiting.delete(msg.commandId);
        clearTimeout(w.timer);
        if (msg.type === 'command.ok') w.resolve(msg.result);
        else w.reject(Object.assign(new Error(Proto.message(msg.code)), { code: msg.code, data: msg }));
      }
      if (msg.type === 'room.removed') this.stop();
      this.onMessage(msg);
    }

    serverNow() { return performance.now() + (this.offset ?? 0); }

    raw(msg) {
      if (this.ws?.readyState !== 1) return false;
      this.ws.send(JSON.stringify(msg));
      return true;
    }

    command(type, payload = {}) {
      const commandId = randomId();
      return new Promise((resolve, reject) => {
        if (!this.raw({ type, commandId, ...payload })) {
          reject(Object.assign(new Error('Đang mất kết nối. Chờ nối lại rồi thử lại.'), { code: 'network' }));
          return;
        }
        const timer = setTimeout(() => {
          this.waiting.delete(commandId);
          reject(Object.assign(new Error('Máy chủ chưa phản hồi. Thử lại.'), { code: 'timeout' }));
        }, 8000);
        this.waiting.set(commandId, { resolve, reject, timer });
      });
    }

    failWaiting(code) {
      for (const [id, w] of this.waiting) {
        clearTimeout(w.timer);
        w.reject(Object.assign(new Error('Mất kết nối khi đang gửi. Thử lại.'), { code }));
        this.waiting.delete(id);
      }
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.timer);
      this.stopPing();
      this.failWaiting('network');
      const ws = this.ws;
      this.ws = null;
      this.controlling = false;
      if (ws) { try { ws.close(1000); } catch (e) { /* đã đóng */ } }
      this.setState('idle');
    }
  }

  root.Rubik = root.Rubik || {};
  root.Rubik.OnlineClient = OnlineClient;
  root.Rubik.onlineRandomId = randomId;
})(typeof globalThis !== 'undefined' ? globalThis : this);
