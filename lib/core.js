// 讨糖地图 · 业务逻辑（本地 Node 与 Vercel 函数共用）
'use strict';
const crypto = require('crypto');
const { getStore } = require('./store');

const CHECKIN_RADIUS_M = Number(process.env.CHECKIN_RADIUS_M || 300);

const id = () => crypto.randomBytes(8).toString('hex');
const now = () => Date.now();
const dayKey = ts => new Date(ts + 8 * 3600e3).toISOString().slice(0, 10); // 北京时间分日
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max);
const J = s => (s ? JSON.parse(s) : null);
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
  return h.paused ? 'preparing' : 'giving';
}
// 恢复码：8 位，去掉易混字符
const RC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const recoveryCode = () => Array.from({ length: 8 }, () => RC[crypto.randomInt(RC.length)]).join('');
function randomNick() {
  const adj = ['软萌', '勇敢', '甜甜', '调皮', '神秘', '快乐'], noun = ['小熊', '南瓜', '小幽灵', '黑猫', '小蝙蝠', '巫师'];
  return adj[crypto.randomInt(6)] + noun[crypto.randomInt(6)] + crypto.randomInt(1000, 10000);
}

// ---------- 数据访问 ----------
async function loadAll(st) {
  const [h, c, u] = await st.pipe([['HGETALL', 'h'], ['LRANGE', 'c', 0, -1], ['HGETALL', 'u']]);
  const houses = Object.values(h || {}).map(J), checkins = (c || []).map(J), users = {};
  for (const [k, v] of Object.entries(u || {})) users[k] = J(v);
  const received = {};
  for (const x of checkins) received[x.houseId] = (received[x.houseId] || 0) + 1;
  return { houses, checkins, users, received };
}
async function myHouse(st, userId) {
  const hid = await st.cmd(['HGET', 'o', userId]);
  return hid ? J(await st.cmd(['HGET', 'h', hid])) : null;
}
function publicHouse(h, viewer, users, received) {
  const owner = users[h.ownerId] || {};
  const out = {
    id: h.id, name: h.name, lat: h.lat, lng: h.lng, community: h.community, city: h.city, district: h.district,
    building: h.building, spot: h.spot, candy: h.candy, startAt: h.startAt, endAt: h.endAt,
    status: statusOf(h), host: owner.nickname || '神秘邻居', received: received[h.id] || 0,
  };
  if (h.showUnit || (viewer && viewer.id === h.ownerId)) { out.unit = h.unit; out.door = h.door; }
  return out;
}
async function limitHit(st, key, max) { // 按分钟限流
  const k = `rl:${key}:${Math.floor(now() / 60000)}`;
  const [n] = await st.pipe([['INCR', k], ['EXPIRE', k, 120]]);
  return n > max;
}
async function newSession(st, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await st.cmd(['HSET', 's', token, userId]);
  return token;
}

// ---------- 路由 ----------
const routes = {
  'GET /api/config': async ({ st }) => [200, {
    amapKey: process.env.AMAP_KEY || '', amapSecurityCode: process.env.AMAP_SECURITY_CODE || '',
    baiduAk: process.env.BAIDU_AK || '', checkinRadius: CHECKIN_RADIUS_M, storageReady: st.ready,
  }],

  // 注册：手机号必填（不发验证码），同号已注册则需恢复码登录，防止冒用
  'POST /api/auth/register': async ({ st, body, ip }) => {
    if (await limitHit(st, 'reg:' + ip, 10)) return [429, { error: '注册太频繁，请稍后再试' }];
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) return [400, { error: '请输入正确的 11 位手机号' }];
    if (!body.agree) return [400, { error: '请先勾选同意个人信息说明' }];
    if (await st.cmd(['HGET', 'p', phone])) return [409, { error: '这个手机号已经注册过，请用恢复码登录', needRecovery: true }];
    let nickname = clean(body.nickname, 16);
    if (/1\d{10}/.test(nickname)) return [400, { error: '昵称里不要填手机号' }];
    if (nickname.length < 2) nickname = randomNick();
    const user = { id: id(), phone, nickname, createdAt: now(), recovery: recoveryCode(), consentAt: now() };
    const set = await st.cmd(['HSETNX', 'p', phone, user.id]);
    if (!set) return [409, { error: '这个手机号已经注册过，请用恢复码登录', needRecovery: true }];
    await st.pipe([['HSET', 'u', user.id, JSON.stringify(user)], ['HSET', 'r', user.recovery, user.id]]);
    return [200, { token: await newSession(st, user.id) }];
  },
  'POST /api/auth/recover': async ({ st, body, ip }) => {
    if (await limitHit(st, 'rec:' + ip, 10)) return [429, { error: '尝试太频繁，请稍后再试' }];
    const code = clean(body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const uid = code && await st.cmd(['HGET', 'r', code]);
    if (!uid) return [400, { error: '恢复码不正确' }];
    return [200, { token: await newSession(st, uid) }];
  },
  'POST /api/auth/logout': async ({ st, token }) => { if (token) await st.cmd(['HDEL', 's', token]); return [200, { ok: true }]; },

  'GET /api/me': async ({ st, user }) => {
    if (!user) return [401, { error: '未登录' }];
    const { checkins, users, received } = await loadAll(st);
    const year = String(new Date().getFullYear());
    const mine = checkins.filter(c => c.day.startsWith(year));
    const house = await myHouse(st, user.id);
    return [200, {
      id: user.id, nickname: user.nickname, recovery: user.recovery, phone: user.phone ? user.phone.slice(0, 3) + '****' + user.phone.slice(-4) : '',
      given: house ? mine.filter(c => c.houseId === house.id).length : 0,
      collected: mine.filter(c => c.userId === user.id).length,
      house: house ? Object.assign(publicHouse(house, user, users, received), {
        unit: house.unit, door: house.door, showUnit: !!house.showUnit, lit: !!house.lit, paused: !!house.paused, code: house.code,
      }) : null,
    }];
  },
  'POST /api/me/nickname': async ({ st, user, body }) => {
    if (!user) return [401, { error: '未登录' }];
    const n = clean(body.nickname, 16);
    if (n.length < 2) return [400, { error: '昵称至少 2 个字' }];
    if (/1\d{10}/.test(n)) return [400, { error: '昵称里不要填手机号' }];
    user.nickname = n; await st.cmd(['HSET', 'u', user.id, JSON.stringify(user)]);
    return [200, { ok: true }];
  },
  'GET /api/me/checkins': async ({ st, user }) => {
    if (!user) return [401, { error: '未登录' }];
    const { houses, checkins } = await loadAll(st);
    const byId = Object.fromEntries(houses.map(h => [h.id, h]));
    const list = checkins.filter(c => c.userId === user.id).slice(-50).reverse()
      .map(c => ({ at: c.at, house: (byId[c.houseId] || {}).name || c.houseName || '已删除的糖果屋', community: (byId[c.houseId] || {}).community || '' }));
    return [200, { list }];
  },

  'POST /api/house': async ({ st, user, body }) => {
    if (!user) return [401, { error: '请先起个昵称' }];
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!isFinite(lat) || !isFinite(lng) || !lat || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [400, { error: '请在地图上选择接待位置' }];
    const startAt = Number(body.startAt), endAt = Number(body.endAt);
    if (!startAt || !endAt || endAt <= startAt) return [400, { error: '请设置正确的发糖时间' }];
    if (endAt - startAt > 3 * 86400e3) return [400, { error: '发糖时间最长 3 天' }];
    const f = {
      name: clean(body.name, 20), lat, lng, community: clean(body.community, 40), city: clean(body.city, 20), district: clean(body.district, 20),
      building: clean(body.building, 10), unit: clean(body.unit, 10), door: clean(body.door, 10), spot: clean(body.spot, 40),
      candy: clean(body.candy, 40), showUnit: !!body.showUnit, startAt, endAt, updatedAt: now(),
    };
    if (!f.name) return [400, { error: '给糖果屋起个名字吧' }];
    if (!f.building) return [400, { error: '请填写楼栋' }];
    if (!f.spot) return [400, { error: '请填写在哪里接待小朋友' }];
    if (!body.agree) return [400, { error: '请先阅读并同意参与须知' }];
    let h = await myHouse(st, user.id);
    if (!h) h = { id: id(), ownerId: user.id, createdAt: now(), lit: false, code: String(crypto.randomInt(1000, 10000)) };
    Object.assign(h, f);
    await st.pipe([['HSET', 'h', h.id, JSON.stringify(h)], ['HSET', 'o', user.id, h.id]]);
    return [200, { id: h.id }];
  },
  'POST /api/house/light': async ({ st, user, body }) => {
    if (!user) return [401, { error: '请先起个昵称' }];
    const h = await myHouse(st, user.id);
    if (!h) return [400, { error: '还没有设置糖果屋' }];
    if (body.lit && now() > h.endAt) return [400, { error: '发糖时间已过，请先修改时间' }];
    h.lit = !!body.lit; if (typeof body.paused === 'boolean') h.paused = body.paused;
    await st.cmd(['HSET', 'h', h.id, JSON.stringify(h)]);
    return [200, { lit: h.lit, paused: !!h.paused, status: statusOf(h) }];
  },
  'POST /api/house/delete': async ({ st, user }) => {
    if (!user) return [401, { error: '请先起个昵称' }];
    const h = await myHouse(st, user.id);
    if (h) await st.pipe([['HDEL', 'h', h.id], ['HDEL', 'o', user.id]]);
    return [200, { ok: true }];
  },
  'GET /api/houses': async ({ st, q, user }) => {
    const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
    const radius = Math.min(Number(q.get('radius')) || 3000, 20000);
    const want = (q.get('status') || 'giving,preparing').split(',');
    const kw = clean(q.get('q'), 30), t = now();
    const { houses, users, received } = await loadAll(st);
    const hasPos = isFinite(lat) && isFinite(lng) && q.get('lat');
    let list = houses.filter(h => want.includes(statusOf(h, t)));
    if (kw) list = list.filter(h => (h.community + h.name).includes(kw));
    else if (hasPos) list = list.filter(h => distM({ lat, lng }, h) <= radius);
    list = list.map(h => { const p = publicHouse(h, user, users, received); if (hasPos) p.distance = Math.round(distM({ lat, lng }, h)); return p; })
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'giving' ? -1 : 1) || (a.distance || 0) - (b.distance || 0));
    return [200, { list: list.slice(0, 200) }];
  },
  'GET /api/house': async ({ st, q, user }) => {
    const h = J(await st.cmd(['HGET', 'h', clean(q.get('id'), 32)]));
    if (!h || statusOf(h) === 'off') return [404, { error: '这间糖果屋已经熄灯了' }];
    const { users, received } = await loadAll(st);
    const p = publicHouse(h, user, users, received);
    if (user) p.checkedToday = !!(await st.cmd(['EXISTS', `d:${user.id}:${h.id}:${dayKey(now())}`]));
    return [200, p];
  },

  'POST /api/checkin': async ({ st, user, body }) => {
    if (!user) return [401, { error: '请先起个昵称' }];
    if (await limitHit(st, 'ci:' + user.id, 20)) return [429, { error: '打卡太频繁，请稍后再试' }];
    const h = J(await st.cmd(['HGET', 'h', clean(body.houseId, 32)]));
    if (!h) return [404, { error: '找不到这间糖果屋' }];
    if (statusOf(h) !== 'giving') return [400, { error: '这间糖果屋现在没有在发糖' }];
    if (h.ownerId === user.id) return [400, { error: '不能在自己家打卡哦' }];
    if (String(body.code || '') !== h.code) return [400, { error: '打卡暗号不对，问问发糖的邻居吧' }];
    const lat = Number(body.lat), lng = Number(body.lng);
    if (lat && lng && isFinite(lat) && isFinite(lng) && distM({ lat, lng }, h) > CHECKIN_RADIUS_M) return [400, { error: '离糖果屋有点远，到门口再打卡吧' }];
    const day = dayKey(now());
    const ok = await st.cmd(['SET', `d:${user.id}:${h.id}:${day}`, '1', 'NX', 'EX', 3 * 86400]);
    if (!ok) return [400, { error: '今天已经在这家打过卡啦' }];
    await st.cmd(['RPUSH', 'c', JSON.stringify({ userId: user.id, houseId: h.id, houseName: h.name, at: now(), day, city: h.city, district: h.district })]);
    return [200, { ok: true }];
  },

  // 管理员导出用户：需要环境变量 ADMIN_TOKEN（至少 16 位），访问 /api/admin/export?token=xxx
  'GET /api/admin/export': async ({ st, q }) => {
    const tk = process.env.ADMIN_TOKEN || '';
    if (tk.length < 16 || q.get('token') !== tk) return [403, { error: 'forbidden' }];
    const { houses, checkins, users } = await loadAll(st);
    const byOwner = Object.fromEntries(houses.map(h => [h.ownerId, h]));
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const fmt = ts => ts ? new Date(ts + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
    const rows = [['昵称', '手机号', '注册时间', '糖果屋', '小区', '收到打卡', '收获打卡'].map(cell).join(',')];
    for (const u of Object.values(users)) {
      const h = byOwner[u.id];
      rows.push([u.nickname, u.phone, fmt(u.createdAt), h && h.name, h && h.community,
        h ? checkins.filter(c => c.houseId === h.id).length : 0, checkins.filter(c => c.userId === u.id).length].map(cell).join(','));
    }
    return [200, { __raw: '\ufeff' + rows.join('\r\n'), __type: 'text/csv; charset=utf-8', __file: 'candy-map-users.csv' }];
  },

  'GET /api/rank': async ({ st, q, user }) => {
    const type = q.get('type') === 'collect' ? 'collect' : 'give';
    const district = clean(q.get('district'), 20), city = clean(q.get('city'), 20);
    const year = String(new Date().getFullYear());
    const { houses, checkins, users } = await loadAll(st);
    const byId = Object.fromEntries(houses.map(h => [h.id, h]));
    const list = checkins.filter(c => c.day.startsWith(year) && (!district || c.district === district) && (!city || c.city === city));
    const key = type === 'give' ? 'houseId' : 'userId', agg = new Map();
    for (const c of list) { const a = agg.get(c[key]) || { n: 0, name: c.houseName }; a.n++; a.last = c.at; agg.set(c[key], a); }
    const rows = [...agg.entries()].sort((x, y) => y[1].n - x[1].n || x[1].last - y[1].last).slice(0, 50).map(([k, a], i) => {
      if (type === 'give') {
        const h = byId[k] || {}, o = users[h.ownerId] || {};
        return { rank: i + 1, name: h.name || a.name || '已熄灯的糖果屋', sub: [h.community, o.nickname].filter(Boolean).join(' · '), count: a.n, me: !!user && h.ownerId === user.id };
      }
      const u = users[k] || {};
      return { rank: i + 1, name: u.nickname || '神秘小朋友', sub: '', count: a.n, me: !!user && k === user.id };
    });
    return [200, { list: rows }];
  },
};

// 统一入口：返回 [状态码, JSON]
async function handle({ method, pathname, query, body, headers, ip }) {
  const fn = routes[method + ' ' + pathname];
  if (!fn) return [404, { error: 'not found' }];
  const st = getStore();
  if (!st.ready) return pathname === '/api/config' ? fn({ st }) : [503, { error: '数据库还没连接，请联系活动组织者' }];
  try {
    if (await limitHit(st, 'ip:' + ip, 150)) return [429, { error: '操作太频繁，请稍后再试' }];
    const m = /^Bearer (\w+)$/.exec(headers.authorization || '');
    const token = m && m[1];
    let user = null;
    if (token) { const uid = await st.cmd(['HGET', 's', token]); if (uid) user = J(await st.cmd(['HGET', 'u', uid])); }
    return await fn({ st, body: body || {}, q: query, user, token, ip });
  } catch (e) {
    console.error(e);
    return [500, { error: '服务器开小差了' }];
  }
}
module.exports = { handle };
