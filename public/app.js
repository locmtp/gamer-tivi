'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Dữ liệu cố định ----------
const GAMES = [
  { id: 'lol', name: 'Liên Minh Huyền Thoại', icon: '⚔️', color: '#c89b3c' },
  { id: 'valorant', name: 'Valorant', icon: '🎯', color: '#ff4655' },
  { id: 'freefire', name: 'Free Fire', icon: '🔥', color: '#ff8a00' },
  { id: 'pubg', name: 'PUBG Mobile', icon: '🪖', color: '#e0b43c' },
  { id: 'lienquan', name: 'Liên Quân Mobile', icon: '🛡️', color: '#3b82f6' },
  { id: 'all', name: 'Tất cả', icon: '🎲', color: '#a855f7' },
];
const gameName = (id) => (GAMES.find((g) => g.id === id) || {}).name || id;

const COUNTRIES = [['ALL', 'Tất cả quốc gia'], ['VN', 'Việt Nam'], ['US', 'Hoa Kỳ'], ['TH', 'Thái Lan'], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['MY', 'Malaysia'], ['SG', 'Singapore'], ['KH', 'Campuchia'], ['LA', 'Lào'], ['MM', 'Myanmar'], ['KR', 'Hàn Quốc'], ['JP', 'Nhật Bản'], ['CN', 'Trung Quốc'], ['TW', 'Đài Loan'], ['HK', 'Hồng Kông'], ['IN', 'Ấn Độ'], ['AU', 'Úc'], ['CA', 'Canada'], ['GB', 'Anh'], ['DE', 'Đức'], ['FR', 'Pháp'], ['ES', 'Tây Ban Nha'], ['IT', 'Ý'], ['RU', 'Nga'], ['TR', 'Thổ Nhĩ Kỳ'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['SA', 'Ả Rập Xê Út'], ['AE', 'UAE'], ['EG', 'Ai Cập'], ['NG', 'Nigeria'], ['ZA', 'Nam Phi']];
const flag = (c) => (c === 'ALL' ? '🌍' : String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0))));
const countryLabel = (c) => `${flag(c)} ${(COUNTRIES.find((x) => x[0] === c) || [, c])[1]}`;

const FILTERS = [
  { id: 'none', name: 'Gốc', css: 'none' },
  { id: 'bw', name: 'Đen trắng', css: 'grayscale(1) contrast(1.1)' },
  { id: 'sepia', name: 'Cổ điển', css: 'sepia(.9) contrast(1.05)' },
  { id: 'warm', name: 'Ấm', css: 'sepia(.3) saturate(1.4) hue-rotate(-12deg) brightness(1.05)' },
  { id: 'cool', name: 'Lạnh', css: 'saturate(1.2) hue-rotate(25deg) brightness(1.02)' },
  { id: 'vivid', name: 'Rực rỡ', css: 'saturate(2) contrast(1.1)' },
  { id: 'neon', name: 'Neon', css: 'saturate(2.6) hue-rotate(290deg) contrast(1.2)' },
  { id: 'matrix', name: 'Matrix', css: 'grayscale(1) sepia(1) hue-rotate(60deg) saturate(3) contrast(1.2)' },
  { id: 'invert', name: 'Đảo màu', css: 'invert(1)' },
  { id: 'dream', name: 'Mơ màng', css: 'blur(1.2px) brightness(1.15) saturate(1.4)' },
  { id: 'night', name: 'Đêm', css: 'brightness(.85) contrast(1.3) hue-rotate(190deg) saturate(.8)' },
];

// ---------- Tiện ích ----------
function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
async function api(method, url, body) {
  const token = store.get('token', '');
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Có lỗi xảy ra'); e.status = res.status; throw e; }
  return data;
}
function show(view) {
  for (const v of $$('.view')) v.hidden = v.id !== 'view-' + view;
}

// ---------- Trạng thái ----------
const state = {
  me: null,
  game: store.get('game', 'all'),
  country: null,
  ws: null,
  wsRetry: 0,
  inCall: false,
  pc: null,
  mid: null,
  micOn: true,
  camOn: true,
};

// ---------- Đăng nhập / Đăng ký ----------
$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  $('#form-login').hidden = tab.dataset.tab !== 'login';
  $('#form-register').hidden = tab.dataset.tab !== 'register';
}));

async function submitAuth(e, url) {
  e.preventDefault();
  const form = e.target, err = $('.error', form), btn = $('button[type=submit]', form);
  err.textContent = '';
  btn.disabled = true;
  try {
    const data = await api('POST', url, Object.fromEntries(new FormData(form)));
    store.set('token', data.token);
    form.reset();
    enterHome(data.user);
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false;
}
$('#form-login').addEventListener('submit', (e) => submitAuth(e, '/api/login'));
$('#form-register').addEventListener('submit', (e) => submitAuth(e, '/api/register'));

function logout(silent) {
  store.del('token');
  state.me = null;
  endCall();
  camStop();
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  $('.tab[data-tab=login]').click();
  show('auth');
  if (!silent) toast('Đã đăng xuất');
}

// ---------- Trang chủ ----------
function fillCountrySelects() {
  for (const sel of [$('#country'), $('select[name=country]', $('#form-profile'))]) {
    sel.innerHTML = '';
    for (const [code] of COUNTRIES) sel.add(new Option(countryLabel(code), code));
  }
}
// Ảnh game: đặt file vào public/img/<id>.png (hoặc .jpg/.webp), ví dụ public/img/lol.png.
// Nếu chưa có ảnh thì hiện biểu tượng emoji thay thế.
const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
function setGameIcon(box, g) {
  box.textContent = g.icon;
  let i = 0;
  const img = new Image();
  img.alt = '';
  img.onload = () => { box.textContent = ''; box.classList.add('has-img'); box.append(img); };
  img.onerror = () => { if (++i < IMG_EXT.length) img.src = `img/${g.id}.${IMG_EXT[i]}`; };
  img.src = `img/${g.id}.${IMG_EXT[0]}`;
}
function renderGames() {
  const box = $('#games');
  box.innerHTML = '';
  for (const g of GAMES) {
    const b = document.createElement('button');
    b.className = 'game';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', g.id === state.game);
    b.style.setProperty('--c', g.color);
    b.innerHTML = '<span class="ico"></span><span class="nm"></span>';
    setGameIcon($('.ico', b), g);
    $('.nm', b).textContent = g.name;
    b.addEventListener('click', () => {
      state.game = g.id;
      store.set('game', g.id);
      $$('.game', box).forEach((x, i) => x.setAttribute('aria-checked', GAMES[i].id === g.id));
    });
    box.append(b);
  }
}
function applyMe() {
  $('#menu-name').textContent = state.me.name;
  $('#avatar').textContent = (state.me.name[0] || '?').toUpperCase();
}

function enterHome(user) {
  state.me = user;
  applyMe();
  state.country = store.get('country', null) || user.country || 'VN';
  $('#country').value = state.country;
  renderGames();
  show('home');
  connectWS();
}
$('#country').addEventListener('change', (e) => { state.country = e.target.value; store.set('country', state.country); });

// Menu người dùng
const menu = $('#menu'), menuBtn = $('#menu-btn');
function toggleMenu(open) {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', open);
}
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(menu.hidden); });
document.addEventListener('click', () => toggleMenu(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && toggleMenu(false));
menu.addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  toggleMenu(false);
  ({ profile: openProfile, password: openPassword, camera: openCamera, logout: () => logout() })[act]();
});
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// Thay đổi thông tin
function openProfile() {
  const f = $('#form-profile');
  f.name.value = state.me.name;
  f.email.value = state.me.email || '';
  f.country.value = state.me.country;
  $('.error', f).textContent = '';
  $('#dlg-profile').showModal();
}
$('#form-profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const { user } = await api('PUT', '/api/profile', { name: f.name.value, country: f.country.value, email: f.email.value });
    state.me = user;
    state.country = user.country;
    store.set('country', user.country);
    $('#country').value = user.country;
    applyMe();
    $('#dlg-profile').close();
    toast('Đã cập nhật thông tin');
  } catch (ex) { $('.error', f).textContent = ex.message; }
});

// Quên mật khẩu (khôi phục qua Gmail)
let forgotStep = 1;
$('#open-forgot').addEventListener('click', () => {
  const f = $('#form-forgot');
  f.reset();
  forgotStep = 1;
  $('#forgot-step2').hidden = true;
  $('#forgot-submit').textContent = 'Gửi mã';
  $('#forgot-hint').textContent = 'Nhập Gmail đã đăng ký, chúng tôi sẽ gửi mã xác nhận 6 số.';
  $('.error', f).textContent = '';
  f.email.readOnly = false;
  f.code.required = f.new.required = false;
  $('#dlg-forgot').showModal();
});
$('#form-forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('.error', f), btn = $('#forgot-submit');
  err.classList.remove('ok-msg');
  err.textContent = '';
  btn.disabled = true;
  try {
    if (forgotStep === 1) {
      const r = await api('POST', '/api/forgot', { email: f.email.value });
      forgotStep = 2;
      f.email.readOnly = true;
      $('#forgot-step2').hidden = false;
      f.code.required = f.new.required = true;
      btn.textContent = 'Đổi mật khẩu';
      $('#forgot-hint').textContent = r.message + ' Hãy kiểm tra cả mục Spam.';
      f.code.focus();
    } else {
      const r = await api('POST', '/api/reset', { email: f.email.value, code: f.code.value, newPassword: f.new.value });
      store.set('token', r.token);
      $('#dlg-forgot').close();
      toast('Đổi mật khẩu thành công');
      enterHome(r.user);
    }
  } catch (ex) { err.textContent = ex.message; }
  btn.disabled = false;
});

// Đổi mật khẩu
function openPassword() {
  const f = $('#form-password');
  f.reset();
  $('.error', f).textContent = '';
  $('#dlg-password').showModal();
}
$('#form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('.error', f);
  if (f.new.value !== f.again.value) return (err.textContent = 'Mật khẩu nhập lại không khớp');
  try {
    const { token } = await api('PUT', '/api/password', { oldPassword: f.old.value, newPassword: f.new.value });
    store.set('token', token);
    $('#dlg-password').close();
    toast('Đổi mật khẩu thành công');
    connectWS(true); // kết nối lại bằng token mới
  } catch (ex) { err.textContent = ex.message; }
});

// ---------- WebSocket ----------
function connectWS(force) {
  if (force && state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  if (state.ws || !state.me) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(store.get('token', ''))}`);
  state.ws = ws;
  ws.onopen = () => (state.wsRetry = 0);
  ws.onmessage = (e) => onServerMsg(JSON.parse(e.data));
  ws.onclose = (e) => {
    state.ws = null;
    $('#stats').textContent = 'Mất kết nối, đang thử lại…';
    if (e.code === 4001) {
      // Token bị từ chối (hết hạn hoặc vừa đổi mật khẩu): đợi chút để token mới được lưu rồi kiểm tra lại
      return setTimeout(() => api('GET', '/api/me').then(() => connectWS(), () => { toast('Phiên đăng nhập hết hạn', true); logout(true); }), 600);
    }
    if (state.inCall) { endCall(); toast('Mất kết nối máy chủ', true); }
    if (state.me) setTimeout(connectWS, Math.min(1000 * 2 ** state.wsRetry++, 10000));
  };
}
const wsSend = (o) => state.ws && state.ws.readyState === 1 && state.ws.send(JSON.stringify(o));

function onServerMsg(m) {
  switch (m.type) {
    case 'hello':
      if (state.inCall) { closePeer(); search(); } // kết nối lại giữa cuộc gọi: tìm lại
      break;
    case 'stats':
      $('#stats').textContent = `${m.online} người đang online · ${m.waiting} đang chờ ghép`;
      break;
    case 'waiting':
      if (state.inCall) setOverlay('Đang tìm bạn chơi…', `${gameName(state.game)} · ${countryLabel(state.country)}`);
      break;
    case 'matched':
      if (state.inCall) startPeer(m);
      break;
    case 'peer-left':
      if (state.inCall) { closePeer(); toast('Đối phương đã rời đi, đang tìm người mới…'); search(); }
      break;
    case 'signal':
      if (state.inCall && m.mid === state.mid) onSignal(m.data);
      break;
  }
}

// ---------- Camera + filter ----------
const DEFAULT_CAM = { videoId: '', audioId: '', res: '720', mirror: true, brightness: 100, contrast: 100 };
const cam = { settings: { ...DEFAULT_CAM, ...store.get('cam', {}) }, raw: null, out: null, canvas: null, ctx: null, vid: null, timer: null, filter: store.get('filter', 'none'), starting: null };
const RES = { 360: [640, 360], 720: [1280, 720], 1080: [1920, 1080] };
const canvasFilterOK = (() => { try { return 'filter' in CanvasRenderingContext2D.prototype; } catch { return false; } })();

function filterCss() {
  const s = cam.settings;
  const base = (FILTERS.find((f) => f.id === cam.filter) || FILTERS[0]).css;
  return `${base === 'none' ? '' : base} brightness(${s.brightness / 100}) contrast(${s.contrast / 100})`.trim();
}
function drawFrame() {
  const v = cam.vid;
  if (!v.videoWidth) return;
  if (cam.canvas.width !== v.videoWidth) { cam.canvas.width = v.videoWidth; cam.canvas.height = v.videoHeight; }
  cam.ctx.filter = canvasFilterOK ? filterCss() : 'none';
  cam.ctx.drawImage(v, 0, 0, cam.canvas.width, cam.canvas.height);
}

function camStart() {
  if (cam.out) return Promise.resolve(cam.out);
  if (cam.starting) return cam.starting;
  cam.starting = (async () => {
    const s = cam.settings, [w, h] = RES[s.res] || RES[720];
    const mk = (useIds) => ({
      video: { ...(useIds && s.videoId ? { deviceId: { exact: s.videoId } } : {}), width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } },
      audio: { ...(useIds && s.audioId ? { deviceId: { exact: s.audioId } } : {}), echoCancellation: true, noiseSuppression: true },
    });
    let raw;
    try { raw = await navigator.mediaDevices.getUserMedia(mk(true)); }
    catch (e1) {
      try { raw = await navigator.mediaDevices.getUserMedia(mk(false)); }
      catch (e2) {
        // thử chỉ video (không có micro)
        raw = await navigator.mediaDevices.getUserMedia({ video: mk(false).video }).catch(() => { throw e2; });
        toast('Không truy cập được micro, bạn sẽ chỉ có hình', true);
      }
    }
    cam.raw = raw;
    cam.vid = document.createElement('video');
    cam.vid.muted = true; cam.vid.playsInline = true; cam.vid.srcObject = raw;
    await cam.vid.play();
    cam.canvas = document.createElement('canvas');
    cam.canvas.width = cam.vid.videoWidth || w; cam.canvas.height = cam.vid.videoHeight || h;
    cam.ctx = cam.canvas.getContext('2d');
    drawFrame();
    cam.timer = setInterval(drawFrame, 1000 / 30);
    const out = cam.canvas.captureStream(30);
    raw.getAudioTracks().forEach((t) => out.addTrack(t));
    cam.out = out;
    applyToggles();
    return out;
  })().finally(() => (cam.starting = null));
  return cam.starting;
}
function camStop() {
  clearInterval(cam.timer);
  cam.raw && cam.raw.getTracks().forEach((t) => t.stop());
  cam.out && cam.out.getVideoTracks().forEach((t) => t.stop());
  Object.assign(cam, { raw: null, out: null, canvas: null, ctx: null, vid: null, timer: null });
  for (const v of [$('#local'), $('#cam-preview')]) v.srcObject = null;
}
async function camRestart() {
  camStop();
  const out = await camStart();
  attachLocal();
  if (state.pc) {
    for (const t of out.getTracks()) {
      const sender = state.pc.getSenders().find((x) => x.track && x.track.kind === t.kind) || state.pc.getSenders().find((x) => !x.track);
      sender && sender.replaceTrack(t);
    }
  }
}
function attachLocal() {
  for (const v of [$('#local'), $('#cam-preview')]) { v.srcObject = cam.out; v.play().catch(() => {}); }
  applyMirror();
  // Safari/trình duyệt cũ không hỗ trợ filter trong canvas: chỉ áp lên bản xem của mình
  const css = canvasFilterOK ? 'none' : filterCss();
  $('#local').style.filter = css;
  $('#cam-preview').style.filter = css;
}
function applyMirror() {
  $('#local').classList.toggle('mirror', cam.settings.mirror);
  $('#cam-preview').classList.toggle('mirror', cam.settings.mirror);
}
function applyToggles() {
  if (!cam.out) return;
  cam.out.getAudioTracks().forEach((t) => (t.enabled = state.micOn));
  cam.out.getVideoTracks().forEach((t) => (t.enabled = state.camOn));
  $('#btn-mic').classList.toggle('off', !state.micOn);
  $('#btn-cam').classList.toggle('off', !state.camOn);
  $('#btn-mic').textContent = state.micOn ? '🎤' : '🔇';
  $('#btn-cam').textContent = state.camOn ? '📹' : '🚫';
}
$('#btn-mic').addEventListener('click', () => { state.micOn = !state.micOn; applyToggles(); });
$('#btn-cam').addEventListener('click', () => { state.camOn = !state.camOn; applyToggles(); });

// Thanh filter
function renderFilters() {
  const box = $('#filters');
  box.innerHTML = '';
  for (const f of FILTERS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('aria-pressed', f.id === cam.filter);
    b.innerHTML = '<i></i><span></span>';
    $('i', b).style.filter = f.css;
    $('span', b).textContent = f.name;
    b.addEventListener('click', () => {
      cam.filter = f.id;
      store.set('filter', f.id);
      $$('.chip', box).forEach((c, i) => c.setAttribute('aria-pressed', FILTERS[i].id === f.id));
      attachLocal();
    });
    box.append(b);
  }
}
renderFilters();

// Hộp thoại tuỳ chỉnh camera
async function fillDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, label, cur) => {
    sel.innerHTML = '';
    sel.add(new Option('Mặc định', ''));
    devs.filter((d) => d.kind === kind).forEach((d, i) => sel.add(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  };
  fill($('#opt-video'), 'videoinput', 'Camera', cam.settings.videoId);
  fill($('#opt-audio'), 'audioinput', 'Micro', cam.settings.audioId);
}
function syncCamForm() {
  const s = cam.settings;
  $('#opt-res').value = s.res;
  $('#opt-bright').value = s.brightness; $('#out-bright').textContent = s.brightness + '%';
  $('#opt-contrast').value = s.contrast; $('#out-contrast').textContent = s.contrast + '%';
  $('#opt-mirror').checked = s.mirror;
}
async function openCamera() {
  $('#cam-msg').textContent = 'Đang mở camera…';
  syncCamForm();
  $('#dlg-camera').showModal();
  try {
    await camStart();
    attachLocal();
    await fillDevices();
    $('#cam-msg').textContent = '';
  } catch (e) { $('#cam-msg').textContent = 'Không mở được camera: hãy cho phép quyền truy cập camera/micro trên trình duyệt.'; }
}
const saveCam = () => store.set('cam', cam.settings);
$('#opt-bright').addEventListener('input', (e) => { cam.settings.brightness = +e.target.value; $('#out-bright').textContent = e.target.value + '%'; saveCam(); attachLocal(); });
$('#opt-contrast').addEventListener('input', (e) => { cam.settings.contrast = +e.target.value; $('#out-contrast').textContent = e.target.value + '%'; saveCam(); attachLocal(); });
$('#opt-mirror').addEventListener('change', (e) => { cam.settings.mirror = e.target.checked; saveCam(); applyMirror(); });
for (const [id, key] of [['#opt-video', 'videoId'], ['#opt-audio', 'audioId'], ['#opt-res', 'res']]) {
  $(id).addEventListener('change', async (e) => {
    cam.settings[key] = e.target.value; saveCam();
    try { await camRestart(); } catch { $('#cam-msg').textContent = 'Không dùng được thiết bị này'; }
  });
}
$('#cam-reset').addEventListener('click', async () => {
  cam.settings = { ...DEFAULT_CAM }; saveCam(); syncCamForm();
  try { await camRestart(); await fillDevices(); } catch {}
});
$('#dlg-camera').addEventListener('close', () => { if (!state.inCall) camStop(); });
$('#btn-settings').addEventListener('click', openCamera);

// ---------- Cuộc gọi ----------
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

function setOverlay(text, sub = '') {
  $('#overlay').hidden = !text;
  $('#overlay-text').textContent = text || '';
  $('#overlay-sub').textContent = sub;
  $('.spinner').hidden = !text;
}

async function startMatching() {
  if (!state.ws || state.ws.readyState !== 1) return toast('Chưa kết nối máy chủ, thử lại sau giây lát', true);
  if (!navigator.mediaDevices?.getUserMedia) return toast('Trình duyệt cần HTTPS (hoặc localhost) để dùng camera', true);
  $('#start').disabled = true;
  try {
    await camStart();
  } catch (e) {
    $('#start').disabled = false;
    return toast('Cần cho phép camera và micro để ghép cặp', true);
  }
  $('#start').disabled = false;
  state.inCall = true;
  state.micOn = state.camOn = true;
  applyToggles();
  attachLocal();
  show('call');
  search();
}
function search() {
  $('#peer-tag').hidden = true;
  $('#remote').srcObject = null;
  setOverlay('Đang tìm bạn chơi…', `${gameName(state.game)} · ${countryLabel(state.country)}`);
  wsSend({ type: 'find', game: state.game, country: state.country });
}

function closePeer() {
  if (state.pc) { state.pc.onicecandidate = state.pc.ontrack = state.pc.onconnectionstatechange = null; state.pc.close(); }
  state.pc = null; state.mid = null;
  $('#remote').srcObject = null;
  $('#peer-tag').hidden = true;
}
function endCall() {
  closePeer();
  if (state.inCall) wsSend({ type: 'cancel' });
  state.inCall = false;
  if ($('#view-call') && !$('#view-call').hidden && state.me) { camStop(); show('home'); }
}

function startPeer(m) {
  closePeer();
  state.mid = m.mid;
  setOverlay('Đã tìm thấy! Đang kết nối…', m.peer.name);
  const tag = $('#peer-tag');
  tag.hidden = false;
  tag.innerHTML = '<span></span><small></small>';
  tag.firstChild.textContent = m.peer.name;
  tag.lastChild.textContent = `${countryLabel(m.peer.country)} · ${gameName(m.peer.game)}`;

  const pc = new RTCPeerConnection(ICE);
  state.pc = pc;
  const sig = (data) => wsSend({ type: 'signal', mid: m.mid, data });
  cam.out.getTracks().forEach((t) => pc.addTrack(t, cam.out));
  pc.onicecandidate = (e) => e.candidate && sig({ candidate: e.candidate });
  pc.ontrack = (e) => {
    const r = $('#remote');
    if (r.srcObject !== e.streams[0]) r.srcObject = e.streams[0];
    r.play().catch(() => {});
  };
  let failTimer;
  pc.onconnectionstatechange = () => {
    clearTimeout(failTimer);
    if (pc.connectionState === 'connected') setOverlay('');
    else if (pc.connectionState === 'failed') { toast('Kết nối thất bại, tìm người khác…', true); next(); }
    else if (pc.connectionState === 'disconnected') failTimer = setTimeout(() => pc === state.pc && pc.connectionState !== 'connected' && next(), 6000);
  };
  if (m.role === 'caller') {
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => sig({ sdp: pc.localDescription })).catch(console.error);
  }
}

async function onSignal(d) {
  const pc = state.pc;
  if (!pc) return;
  try {
    if (d.sdp) {
      await pc.setRemoteDescription(d.sdp);
      if (d.sdp.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        wsSend({ type: 'signal', mid: state.mid, data: { sdp: pc.localDescription } });
      }
    } else if (d.candidate) {
      await pc.addIceCandidate(d.candidate);
    }
  } catch (e) { console.error('signal', e); }
}

function next() { closePeer(); search(); }
$('#btn-next').addEventListener('click', next);
$('#btn-stop').addEventListener('click', endCall);
$('#start').addEventListener('click', startMatching);
window.addEventListener('beforeunload', () => state.ws && state.ws.close());

// ---------- Khởi động ----------
(async function init() {
  fillCountrySelects();
  const token = store.get('token', '');
  if (!token) return show('auth');
  try { enterHome((await api('GET', '/api/me')).user); }
  catch (e) { if (e.status === 401) store.del('token'); show('auth'); }
})();
