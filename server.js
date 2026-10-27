// 万圣节讨糖地图 · 后端（零依赖，Node >= 18）
// 启动：node server.js    环境变量见 README.md
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEV_SMS = process.env.SMS_MODE !== 'prod'; // 开发模式：验证码直接返回给前端
const CHECKIN_RADIUS_M = Number(process.env.CHECKIN_RADIUS_M || 300);

const CONFIG = {
  amapKey: process.env.AMAP_KEY || '',
  amapSecurityCode: process.env.AMAP_SECURITY_CODE || '',
  baiduAk: process.env.BAIDU_AK || '',
  devSms: DEV_SMS,
  checkinRadius: CHECKIN_RADIUS_M,
};

// ---------------- 存储 ----------------
let db = { users: {}, sessions: {}, houses: {}, checkins: [], codes: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (_) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}

// ---------------- 工具 ----------------
const id = () => crypto.randomBytes(8).toString('hex');
const now = () => Date.now();
function dayKey(ts) { // 按北京时间分日
  const d = new Date(ts + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function statusOf(h, t = now()) {
  if (!h.lit) return 'off';
  if (t < h.startAt) return 'preparing';
  if (t > h.endAt) return 'ended';
  if (h.paused) return 'preparing';
  return 'giving';
}
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max);
const maskPhone = p => p.slice(0, 3) + '****' + p.slice(-4);

function publicHouse(h, viewer) {
  const owner = db.users[h.ownerId] || {};
  const out = {
    id: h.id, name: h.name, lat: h.lat, lng: h.lng,
    community: h.community, city: h.city, district: h.district,
    building: h.building, spot: h.spot, candy: h.candy,
    startAt: h.startAt, endAt: h.endAt, status: statusOf(h),
    host: owner.nickname || '神秘邻居', received: h.received || 0,
  };
  if (h.showUnit || (viewer && viewer.id === h.ownerId)) { out.unit = h.unit; out.door = h.door; }
  return out;
}

// ---------------- HTTP ----------------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e5) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
  });
}
function auth(req) {
  const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  const s = m && db.sessions[m[1]];
  return s ? db.users[s.userId] : null;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let p = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!p.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) p = path.join(PUBLIC_DIR, 'index.html'); // SPA 回退
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
}

// 简单限流：每 IP 每分钟 120 次
const hits = new Map();
function limited(ip) {
  const k = ip + ':' + Math.floor(now() / 60000);
  const n = (hits.get(k) || 0) + 1; hits.set(k, n);
  if (hits.size > 5000) hits.clear();
  return n > 120;
}

const routes = {
  'GET /api/config': async () => [200, CONFIG],

  // ---- 登录 ----
  'POST /api/auth/sms': async ({ body }) => {
    const phone = String(body.phone || '');
    if (!/^1\d{10}$/.test(phone)) return [400, { error: '请输入正确的手机号' }];
    const prev = db.codes[phone];
    if (prev && now() - prev.sentAt < 60e3) return [429, { error: '发送太频繁，请 60 秒后再试' }];
    const code = String(crypto.randomInt(100000, 1000000));
    db.codes[phone] = { code, sentAt: now(), tries: 0 }; save();
    // 生产环境：在这里接入阿里云/腾讯云短信，把 code 发给 phone
    return [200, DEV_SMS ? { ok: true, devCode: code } : { ok: true }];
  },
  'POST /api/auth/login': async ({ body }) => {
    const phone = String(body.phone || ''), code = String(body.code || '');
    const rec = db.codes[phone];
    if (!rec || now() - rec.sentAt > 10 * 60e3) return [400, { error: '验证码已过期，请重新获取' }];
    if (++rec.tries > 5) { delete db.codes[phone]; save(); return [400, { error: '错误次数过多，请重新获取' }]; }
    if (rec.code !== code) { save(); return [400, { error: '验证码不正确' }]; }
    delete db.codes[phone];
    let user = Object.values(db.users).find(u => u.phone === phone);
    if (!user) {
      const adj = ['软萌', '勇敢', '甜甜', '调皮', '神秘', '快乐'], noun = ['小熊', '南瓜', '小幽灵', '黑猫', '小蝙蝠', '巫师'];
      user = { id: id(), phone, createdAt: now(),
        nickname: adj[crypto.randomInt(adj.length)] + noun[crypto.randomInt(noun.length)] + crypto.randomInt(1000, 10000) };
      db.users[user.id] = user;
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { userId: user.id, createdAt: now() }; save();
    return [200, { token }];
  },
  'POST /api/auth/logout': async ({ req }) => {
    const m = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
    if (m) { delete db.sessions[m[1]]; save(); }
    return [200, { ok: true }];
  },

  // ---- 我的 ----
  'GET /api/me': async ({ user }) => {
    if (!user) return [401, { error: '未登录' }];
    const year = String(new Date().getFullYear());
    const mine = db.checkins.filter(c => c.day.startsWith(year));
    const house = Object.values(db.houses).find(h => h.ownerId === user.id);
    return [200, {
      id: user.id, nickname: user.nickname, phone: maskPhone(user.phone),
      given: house ? mine.filter(c => c.houseId === house.id).length : 0,
      collected: mine.filter(c => c.userId === user.id).length,
      house: house ? Object.assign(publicHouse(house, user), {
        unit: house.unit, door: house.door, showUnit: !!house.showUnit, lit: !!house.lit,
        paused: !!house.paused, code: house.code,
      }) : null,
    }];
  },
  'POST /api/me/nickname': async ({ user, body }) => {
    if (!user) return [401, { error: '未登录' }];
    const n = clean(body.nickname, 16);
    if (n.length < 2) return [400, { error: '昵称至少 2 个字' }];
    if (/1\d{10}/.test(n)) return [400, { error: '昵称里不要填手机号' }];
    user.nickname = n; save();
    return [200, { ok: true }];
  },
  'GET /api/me/checkins': async ({ user }) => {
    if (!user) return [401, { error: '未登录' }];
    const list = db.checkins.filter(c => c.userId === user.id).slice(-50).reverse()
      .map(c => ({ at: c.at, house: (db.houses[c.houseId] || {}).name || '已删除的糖果屋', community: (db.houses[c.houseId] || {}).community || '' }));
    return [200, { list }];
  },

  // ---- 糖果屋 ----
  'POST /api/house': async ({ user, body }) => { // 新建或更新自己的糖果屋
    if (!user) return [401, { error: '请先登录' }];
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [400, { error: '请在地图上选择接待位置' }];
    const startAt = Number(body.startAt), endAt = Number(body.endAt);
    if (!startAt || !endAt || endAt <= startAt) return [400, { error: '请设置正确的发糖时间' }];
    if (endAt - startAt > 3 * 86400e3) return [400, { error: '发糖时间最长 3 天' }];
    const fields = {
      name: clean(body.name, 20), lat, lng,
      community: clean(body.community, 40), city: clean(body.city, 20), district: clean(body.district, 20),
      building: clean(body.building, 10), unit: clean(body.unit, 10), door: clean(body.door, 10),
      spot: clean(body.spot, 40), candy: clean(body.candy, 40), showUnit: !!body.showUnit,
      startAt, endAt, updatedAt: now(),
    };
    if (!fields.name) return [400, { error: '给糖果屋起个名字吧' }];
    if (!fields.building) return [400, { error: '请填写楼栋' }];
    if (!fields.spot) return [400, { error: '请填写在哪里接待小朋友' }];
    if (!body.agree) return [400, { error: '请先阅读并同意参与须知' }];
    let h = Object.values(db.houses).find(x => x.ownerId === user.id);
    if (!h) {
      h = { id: id(), ownerId: user.id, createdAt: now(), received: 0, lit: false,
        code: String(crypto.randomInt(1000, 10000)) };
      db.houses[h.id] = h;
    }
    Object.assign(h, fields); save();
    return [200, { id: h.id }];
  },
  'POST /api/house/light': async ({ user, body }) => {
    if (!user) return [401, { error: '请先登录' }];
    const h = Object.values(db.houses).find(x => x.ownerId === user.id);
    if (!h) return [400, { error: '还没有设置糖果屋' }];
    if (body.lit && now() > h.endAt) return [400, { error: '发糖时间已过，请先修改时间' }];
    h.lit = !!body.lit;
    if (typeof body.paused === 'boolean') h.paused = body.paused;
    save();
    return [200, { lit: h.lit, paused: !!h.paused, status: statusOf(h) }];
  },
  'POST /api/house/delete': async ({ user }) => {
    if (!user) return [401, { error: '请先登录' }];
    const h = Object.values(db.houses).find(x => x.ownerId === user.id);
    if (h) { delete db.houses[h.id]; save(); }
    return [200, { ok: true }];
  },
  'GET /api/houses': async ({ q, user }) => { // 附近糖果屋
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    const radius = Math.min(Number(q.get('radius')) || 3000, 20000);
    const want = (q.get('status') || 'giving,preparing').split(',');
    const kw = clean(q.get('q'), 30);
    const t = now();
    let list = Object.values(db.houses).filter(h => want.includes(statusOf(h, t)));
    if (kw) list = list.filter(h => (h.community + h.name).includes(kw));
    else if (isFinite(lat) && isFinite(lng)) list = list.filter(h => distM({ lat, lng }, h) <= radius);
    list = list.map(h => {
      const p = publicHouse(h, user);
      if (isFinite(lat) && isFinite(lng)) p.distance = Math.round(distM({ lat, lng }, h));
      return p;
    }).sort((a, b) => (a.status === b.status ? 0 : a.status === 'giving' ? -1 : 1) || (a.distance || 0) - (b.distance || 0));
    return [200, { list: list.slice(0, 200) }];
  },
  'GET /api/house': async ({ q, user }) => {
    const h = db.houses[q.get('id')];
    if (!h || statusOf(h) === 'off') return [404, { error: '这间糖果屋已经熄灯了' }];
    const p = publicHouse(h, user);
    if (user) p.checkedToday = db.checkins.some(c => c.userId === user.id && c.houseId === h.id && c.day === dayKey(now()));
    return [200, p];
  },

  // ---- 收糖打卡 ----
  'POST /api/checkin': async ({ user, body }) => {
    if (!user) return [401, { error: '请先登录' }];
    const h = db.houses[body.houseId];
    if (!h) return [404, { error: '找不到这间糖果屋' }];
    if (statusOf(h) !== 'giving') return [400, { error: '这间糖果屋现在没有在发糖' }];
    if (h.ownerId === user.id) return [400, { error: '不能在自己家打卡哦' }];
    if (String(body.code || '') !== h.code) return [400, { error: '打卡暗号不对，问问发糖的邻居吧' }];
    const lat = Number(body.lat), lng = Number(body.lng);
    if (isFinite(lat) && isFinite(lng) && lat && lng && distM({ lat, lng }, h) > CHECKIN_RADIUS_M)
      return [400, { error: '离糖果屋有点远，到门口再打卡吧' }];
    const day = dayKey(now());
    if (db.checkins.some(c => c.userId === user.id && c.houseId === h.id && c.day === day))
      return [400, { error: '今天已经在这家打过卡啦' }];
    db.checkins.push({ id: id(), userId: user.id, houseId: h.id, at: now(), day, city: h.city, district: h.district });
    h.received = (h.received || 0) + 1; save();
    return [200, { ok: true }];
  },

  // ---- 榜单 ----
  'GET /api/rank': async ({ q, user }) => {
    const type = q.get('type') === 'collect' ? 'collect' : 'give';
    const district = clean(q.get('district'), 20), city = clean(q.get('city'), 20);
    const year = String(new Date().getFullYear());
    const list = db.checkins.filter(c => c.day.startsWith(year) && (!district || c.district === district) && (!city || c.city === city));
    const key = type === 'give' ? 'houseId' : 'userId';
    const agg = new Map();
    for (const c of list) {
      const a = agg.get(c[key]) || { n: 0, first: c.at };
      a.n++; a.last = c.at; agg.set(c[key], a);
    }
    const rows = [...agg.entries()].sort((x, y) => y[1].n - x[1].n || x[1].last - y[1].last).slice(0, 50).map(([k, a], i) => {
      if (type === 'give') {
        const h = db.houses[k] || {}, o = db.users[h.ownerId] || {};
        return { rank: i + 1, name: h.name || '已熄灯的糖果屋', sub: [h.community, o.nickname].filter(Boolean).join(' · '), count: a.n, me: !!user && h.ownerId === user.id };
      }
      const u = db.users[k] || {};
      return { rank: i + 1, name: u.nickname || '神秘小朋友', sub: '', count: a.n, me: !!user && u.id === user.id };
    });
    return [200, { list: rows }];
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(url.pathname));
  if (limited(ip)) return send(res, 429, { error: '操作太频繁，请稍后再试' });
  const fn = routes[req.method + ' ' + url.pathname];
  if (!fn) return send(res, 404, { error: 'not found' });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const [code, obj] = await fn({ req, body, q: url.searchParams, user: auth(req) });
    send(res, code, obj);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: '服务器开小差了' });
  }
}).listen(PORT, () => console.log(`🎃 讨糖地图已启动：http://localhost:${PORT}  (SMS ${DEV_SMS ? '开发模式' : '生产模式'})`));
