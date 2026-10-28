// Gamer Tivi — server không phụ thuộc thư viện ngoài (chỉ dùng module có sẵn của Node.js)
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

// Đọc cấu hình từ file .env (nếu có): GMAIL_USER, GMAIL_APP_PASSWORD...
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- Lưu trữ người dùng (file JSON) ----------
let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { users = {}; }
let saveTimer = null;
function saveUsers() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(USERS_FILE + '.tmp', JSON.stringify(users, null, 2));
    fs.renameSync(USERS_FILE + '.tmp', USERS_FILE);
  }, 50);
}
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8'); } catch {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

const GAMES = new Set(['lol', 'valorant', 'freefire', 'pubg', 'lienquan', 'all']);
const isCountry = (c) => c === 'ALL' || /^[A-Z]{2}$/.test(c);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (e, key) => (e ? reject(e) : resolve({ salt, hash: key.toString('hex') })))
  );
}
async function verifyPassword(user, password) {
  const { hash } = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

// Token ký HMAC, hết hạn sau 30 ngày; đổi mật khẩu sẽ tăng `ver` để vô hiệu hoá token cũ
function makeToken(u) {
  const payload = Buffer.from(JSON.stringify({ u: u.username, v: u.ver, exp: Date.now() + 30 * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function readToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const u = users[p.u];
    if (!u || u.ver !== p.v || p.exp < Date.now()) return null;
    return u;
  } catch { return null; }
}
const publicUser = (u) => ({ username: u.username, name: u.name, country: u.country, email: u.email || '' });
const GMAIL_RE = /^[a-z0-9._%+-]{3,64}@(gmail|googlemail)\.com$/;
const findByEmail = (email) => Object.values(users).find((u) => u.email === email);

// ---------- Giới hạn tần suất đơn giản ----------
const hits = new Map();
function limited(ip, max = 20, windowMs = 60000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > max;
}
setInterval(() => { hits.clear(); for (const [k, v] of resetCodes) if (v.exp < Date.now()) resetCodes.delete(k); }, 10 * 60000).unref();

// ---------- Gửi email qua SMTP (Gmail: smtp.gmail.com:465 + Mật khẩu ứng dụng) ----------
function mailConfigured() { return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD); }
function sendMail(to, subject, text) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = +process.env.SMTP_PORT || 465;
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.GMAIL_USER, pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const b64 = (x) => Buffer.from(x).toString('base64');
  const body = b64(text).replace(/(.{76})/g, '$1\r\n');
  const msg = [`From: Gamer Tivi <${user}>`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', `Date: ${new Date().toUTCString()}`, '', body].join('\r\n');
  return new Promise((resolve, reject) => {
    const sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', waiter = null, done = false;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(); };
    const timer = setTimeout(() => finish(new Error('SMTP timeout')), 20000);
    sock.setEncoding('utf8');
    sock.on('error', finish);
    sock.on('close', () => finish(new Error('SMTP connection closed')));
    sock.on('data', (d) => {
      buf += d;
      const lines = buf.split('\r\n');
      buf = lines.pop();
      for (const l of lines) if (/^\d{3} /.test(l) && waiter) { const w = waiter; waiter = null; w(l); }
    });
    const reply = () => new Promise((r) => (waiter = r));
    const cmd = async (line, ok) => {
      if (line !== null) sock.write(line + '\r\n');
      const r = await reply();
      if (!r.startsWith(String(ok))) throw new Error('SMTP ' + r);
    };
    (async () => {
      await new Promise((r, j) => { waiter = (l) => (l.startsWith('220') ? r() : j(new Error('SMTP ' + l))); });
      await cmd('EHLO gamertivi.local', 250);
      await cmd('AUTH LOGIN', 334);
      await cmd(b64(user), 334);
      await cmd(b64(pass), 235);
      await cmd(`MAIL FROM:<${user}>`, 250);
      await cmd(`RCPT TO:<${to}>`, 250);
      await cmd('DATA', 354);
      await cmd(msg + '\r\n.', 250);
      sock.write('QUIT\r\n');
      finish();
    })().catch(finish);
  });
}

const resetCodes = new Map(); // email -> { hash, exp, tries, sentAt }
const codeHash = (email, code) => crypto.createHmac('sha256', SECRET).update(email + ':' + code).digest('hex');

// ---------- HTTP: API + file tĩnh ----------
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const routes = {}; // "METHOD /path" -> handler(req, res, body)
const route = (method, p, fn) => (routes[`${method} ${p}`] = fn);

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (d) => { data += d; if (data.length > 10240) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const ipOf = (req) => req.socket.remoteAddress;
const authUser = (req) => readToken((req.headers.authorization || '').replace('Bearer ', ''));
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 30);

route('POST', '/api/register', async (req, res, body) => {
  if (limited(ipOf(req), 10)) return json(res, 429, { error: 'Thử lại sau ít phút' });
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = cleanName(body.name) || username;
  const email = String(body.email || '').trim().toLowerCase();
  if (!GMAIL_RE.test(email)) return json(res, 400, { error: 'Hãy nhập địa chỉ Gmail hợp lệ (dạng ten@gmail.com)' });
  if (findByEmail(email)) return json(res, 409, { error: 'Gmail này đã được dùng cho tài khoản khác' });
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) return json(res, 400, { error: 'Tên đăng nhập 3-20 ký tự: chữ thường, số, _ hoặc .' });
  if (password.length < 6 || password.length > 100) return json(res, 400, { error: 'Mật khẩu phải từ 6 ký tự' });
  if (Object.prototype.hasOwnProperty.call(users, username)) return json(res, 409, { error: 'Tên đăng nhập đã tồn tại' });
  const { salt, hash } = await hashPassword(password);
  users[username] = { username, name, email, salt, hash, ver: 1, country: 'VN', createdAt: Date.now() };
  saveUsers();
  json(res, 200, { token: makeToken(users[username]), user: publicUser(users[username]) });
});

route('POST', '/api/login', async (req, res, body) => {
  if (limited(ipOf(req), 15)) return json(res, 429, { error: 'Thử quá nhiều lần, hãy đợi một lúc' });
  const key = String(body.username || '').trim().toLowerCase();
  const user = Object.prototype.hasOwnProperty.call(users, key) ? users[key] : null;
  if (!user || !(await verifyPassword(user, String(body.password || ''))))
    return json(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu' });
  json(res, 200, { token: makeToken(user), user: publicUser(user) });
});

route('GET', '/api/me', (req, res) => {
  const u = authUser(req);
  u ? json(res, 200, { user: publicUser(u) }) : json(res, 401, { error: 'Phiên đăng nhập hết hạn, hãy đăng nhập lại' });
});

route('PUT', '/api/profile', (req, res, body) => {
  const u = authUser(req);
  if (!u) return json(res, 401, { error: 'Phiên đăng nhập hết hạn, hãy đăng nhập lại' });
  const name = cleanName(body.name);
  const country = String(body.country || '');
  if (!name) return json(res, 400, { error: 'Tên hiển thị không được trống' });
  if (!isCountry(country)) return json(res, 400, { error: 'Quốc gia không hợp lệ' });
  const email = String(body.email || '').trim().toLowerCase();
  if (email && email !== u.email) {
    if (!GMAIL_RE.test(email)) return json(res, 400, { error: 'Hãy nhập địa chỉ Gmail hợp lệ (dạng ten@gmail.com)' });
    const other = findByEmail(email);
    if (other && other !== u) return json(res, 409, { error: 'Gmail này đã được dùng cho tài khoản khác' });
    u.email = email;
  }
  u.name = name;
  u.country = country;
  saveUsers();
  json(res, 200, { user: publicUser(u) });
});

route('PUT', '/api/password', async (req, res, body) => {
  const u = authUser(req);
  if (!u) return json(res, 401, { error: 'Phiên đăng nhập hết hạn, hãy đăng nhập lại' });
  if (limited(ipOf(req), 10)) return json(res, 429, { error: 'Thử lại sau ít phút' });
  if (!(await verifyPassword(u, String(body.oldPassword || '')))) return json(res, 400, { error: 'Mật khẩu hiện tại không đúng' });
  const np = String(body.newPassword || '');
  if (np.length < 6 || np.length > 100) return json(res, 400, { error: 'Mật khẩu mới phải từ 6 ký tự' });
  const { salt, hash } = await hashPassword(np);
  Object.assign(u, { salt, hash, ver: u.ver + 1 });
  saveUsers();
  kickUser(u.username); // ngắt các kết nối cũ
  json(res, 200, { token: makeToken(u) });
});

route('POST', '/api/forgot', async (req, res, body) => {
  if (limited(ipOf(req), 6)) return json(res, 429, { error: 'Thử quá nhiều lần, hãy đợi một lúc' });
  const email = String(body.email || '').trim().toLowerCase();
  if (!GMAIL_RE.test(email)) return json(res, 400, { error: 'Hãy nhập địa chỉ Gmail hợp lệ' });
  const reply = { ok: true, message: 'Nếu Gmail này đã đăng ký, mã xác nhận đã được gửi. Mã có hiệu lực 10 phút.' };
  const user = findByEmail(email);
  const prev = resetCodes.get(email);
  if (!user || (prev && Date.now() - prev.sentAt < 60000)) return json(res, 200, reply); // không tiết lộ email có tồn tại hay không
  const code = String(crypto.randomInt(100000, 1000000));
  resetCodes.set(email, { hash: codeHash(email, code), exp: Date.now() + 10 * 60000, tries: 0, sentAt: Date.now() });
  const text = `Xin chào ${user.name},\n\nMã khôi phục mật khẩu Gamer Tivi của bạn là: ${code}\nMã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.\n`;
  if (!mailConfigured()) {
    console.log(`[DEV] Chưa cấu hình Gmail. Mã khôi phục cho ${email}: ${code}`);
  } else {
    try { await sendMail(email, 'Mã khôi phục mật khẩu Gamer Tivi', text); }
    catch (e) { console.error('Gửi mail lỗi:', e.message); resetCodes.delete(email); return json(res, 500, { error: 'Không gửi được email, hãy thử lại sau' }); }
  }
  json(res, 200, reply);
});

route('POST', '/api/reset', async (req, res, body) => {
  if (limited(ipOf(req), 15)) return json(res, 429, { error: 'Thử quá nhiều lần, hãy đợi một lúc' });
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  const np = String(body.newPassword || '');
  if (np.length < 6 || np.length > 100) return json(res, 400, { error: 'Mật khẩu mới phải từ 6 ký tự' });
  const entry = resetCodes.get(email);
  const user = findByEmail(email);
  const bad = () => json(res, 400, { error: 'Mã không đúng hoặc đã hết hạn' });
  if (!entry || !user || entry.exp < Date.now()) return bad();
  if (++entry.tries > 5) { resetCodes.delete(email); return bad(); }
  const a = Buffer.from(codeHash(email, code), 'hex'), b = Buffer.from(entry.hash, 'hex');
  if (!crypto.timingSafeEqual(a, b)) return bad();
  resetCodes.delete(email);
  const { salt, hash } = await hashPassword(np);
  Object.assign(user, { salt, hash, ver: user.ver + 1 });
  saveUsers();
  kickUser(user.username);
  json(res, 200, { token: makeToken(user), user: publicUser(user) });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    try { await handler(req, res, req.method === 'GET' ? {} : await readBody(req)); }
    catch (e) { console.error(e); json(res, 500, { error: 'Lỗi máy chủ' }); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Không hỗ trợ' });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSocket tối giản (RFC 6455) ----------
class Socket {
  constructor(sock) {
    this.sock = sock; this.readyState = 1; this.buf = Buffer.alloc(0); this.frag = [];
    this.handlers = {};
    sock.on('data', (d) => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => sock.destroy());
  }
  on(ev, fn) { this.handlers[ev] = fn; }
  _emit(ev, ...a) { this.handlers[ev] && this.handlers[ev](...a); }
  _closed() { if (this.readyState !== 3) { this.readyState = 3; this._emit('close'); } }
  _frame(op, payload) {
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536
      ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
      : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
    return Buffer.concat([head, payload]);
  }
  send(text) { if (this.readyState === 1) this.sock.write(this._frame(1, Buffer.from(text))); }
  ping() { if (this.readyState === 1) this.sock.write(this._frame(9, Buffer.alloc(0))); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    this.sock.end(this._frame(8, Buffer.from([code >> 8, code & 255])));
  }
  terminate() { this.sock.destroy(); }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 15, masked = b[1] & 0x80;
      let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > 64 * 1024) return this.sock.destroy(); // client phải mask; giới hạn kích thước
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) { this.close(); return this.sock.end(); }
      if (op === 9) { this.sock.write(this._frame(10, payload)); continue; }
      if (op === 10) { this._emit('pong'); continue; }
      if (op === 1 || op === 2 || op === 0) {
        this.frag.push(payload);
        if (fin) { const msg = Buffer.concat(this.frag).toString(); this.frag = []; this._emit('message', msg); }
      }
    }
  }
}

// ---------- WebSocket: ghép cặp + signaling WebRTC ----------
const clients = new Set();
let waiting = []; // hàng đợi chờ ghép
let nextMatch = 1;

const send = (c, msg) => c.ws.send(JSON.stringify(msg));

function compatible(a, b) {
  if (a.username === b.username) return false;
  const gameOk = a.game === 'all' || b.game === 'all' || a.game === b.game;
  const countryOk = a.country === 'ALL' || b.country === 'ALL' || a.country === b.country;
  return gameOk && countryOk;
}
const brief = (c) => ({ name: c.name, country: c.country, game: c.game });

function unqueue(c) { waiting = waiting.filter((x) => x !== c); }

function leave(c, notify = true) {
  unqueue(c);
  const p = c.peer;
  if (p) {
    c.peer = p.peer = null;
    p.mid = c.mid = null;
    if (notify) send(p, { type: 'peer-left' });
  }
  c.state = 'idle';
  if (p) p.state = 'idle';
}

function find(c, game, country) {
  leave(c);
  c.game = game;
  c.country = country;
  const idx = waiting.findIndex((w) => compatible(c, w));
  if (idx === -1) {
    c.state = 'waiting';
    waiting.push(c);
    return send(c, { type: 'waiting' });
  }
  const [other] = waiting.splice(idx, 1);
  const mid = nextMatch++;
  c.peer = other; other.peer = c;
  c.mid = other.mid = mid;
  c.state = other.state = 'in-call';
  // Người vào sau là bên gọi (caller)
  send(c, { type: 'matched', mid, role: 'caller', peer: brief(other) });
  send(other, { type: 'matched', mid, role: 'callee', peer: brief(c) });
}

function kickUser(username) {
  for (const c of clients) if (c.username === username) { leave(c); c.ws.close(4001); }
}

const broadcastStats = () => {
  const msg = { type: 'stats', online: clients.size, waiting: waiting.length };
  for (const c of clients) send(c, msg);
};
setInterval(broadcastStats, 5000).unref();

server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new Socket(sock);
  const user = readToken(url.searchParams.get('token'));
  if (!user) return ws.close(4001);
  const c = { ws, username: user.username, name: user.name, country: user.country, game: 'all', state: 'idle', peer: null, mid: null, alive: true };
  clients.add(c);
  send(c, { type: 'hello' });
  broadcastStats();

  ws.on('pong', () => (c.alive = true));
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'find':
        if (!GAMES.has(m.game) || !isCountry(m.country)) return;
        c.name = (users[c.username] || {}).name || c.name;
        find(c, m.game, m.country);
        broadcastStats();
        break;
      case 'cancel':
        leave(c);
        broadcastStats();
        break;
      case 'signal':
        if (c.peer && m.mid === c.mid && m.data && typeof m.data === 'object')
          send(c.peer, { type: 'signal', mid: c.mid, data: m.data });
        break;
    }
  });
  ws.on('close', () => {
    leave(c);
    clients.delete(c);
    broadcastStats();
  });
});

// Dọn các kết nối chết
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    c.ws.ping();
  }
}, 25000).unref();

server.listen(PORT, () => console.log(`Gamer Tivi chạy tại http://localhost:${PORT}`));
