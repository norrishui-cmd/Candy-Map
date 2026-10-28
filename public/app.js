/* 万圣节讨糖地图 · 前端 */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_CENTER = { lat: 31.2304, lng: 121.4737 }; // 无定位时的默认中心（上海人民广场，GCJ-02）

// ================= 状态 =================
const S = {
  cfg: {}, token: localStorage.getItem('cm_token') || '', me: null,
  provider: 'lite', map: null, center: null, myPos: null,
  statuses: new Set(['giving', 'preparing']), houses: [],
  region: { city: '', district: '' }, rankType: 'give', rankScope: 'district',
  form: null,
};

// ================= API =================
async function api(path, body) {
  const opt = { headers: {} };
  if (S.token) opt.headers.Authorization = 'Bearer ' + S.token;
  if (body !== undefined) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { S.token = ''; S.me = null; localStorage.removeItem('cm_token'); }
  if (!r.ok) throw new Error(j.error || '网络开小差了');
  return j;
}

// ================= UI 小工具 =================
let toastT;
function toast(msg, ms = 2000) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }
function modal(html, { center = false } = {}) {
  const m = $('#modal'); $('#modalBody').innerHTML = html;
  m.classList.toggle('center', center); m.classList.remove('hidden');
  return $('#modalBody');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
function boom() {
  const b = document.createElement('div'); b.className = 'boom';
  const em = ['🍬', '🍭', '🍫', '🎃', '👻', '🍬'];
  for (let i = 0; i < 26; i++) { const s = document.createElement('span'); s.textContent = em[i % em.length]; s.style.left = Math.random() * 100 + '%'; s.style.animationDelay = Math.random() * .6 + 's'; b.appendChild(s); }
  document.body.appendChild(b); setTimeout(() => b.remove(), 2600);
}
const fmtTime = ts => { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtShort = ts => { const d = new Date(ts), n = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; if (d.toDateString() === n.toDateString()) return '今天 ' + hm; const t = new Date(n); t.setDate(t.getDate() + 1); if (d.toDateString() === t.toDateString()) return '明天 ' + hm; return `${d.getMonth() + 1}/${d.getDate()} ${hm}`; };
const fmtDist = m => m == null ? '' : m < 1000 ? m + 'm' : (m / 1000).toFixed(1) + 'km';
const STATUS_TEXT = { giving: '发糖中', preparing: '准备中', ended: '已结束', off: '未点亮' };

// ================= 坐标转换（统一存 GCJ-02） =================
const PI = Math.PI, XPI = PI * 3000 / 180, A = 6378245, EE = 0.00669342162296594323;
function outChina(lat, lng) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function tLat(x, y) { let r = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3; r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3; r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3; return r; }
function tLng(x, y) { let r = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x)); r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3; r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3; r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3; return r; }
function wgs2gcj(lat, lng) {
  if (outChina(lat, lng)) return { lat, lng };
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const rad = lat / 180 * PI; let m = Math.sin(rad); m = 1 - EE * m * m; const sm = Math.sqrt(m);
  dLat = dLat * 180 / ((A * (1 - EE)) / (m * sm) * PI); dLng = dLng * 180 / (A / sm * Math.cos(rad) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcj2bd(lat, lng) { const z = Math.sqrt(lng * lng + lat * lat) + .00002 * Math.sin(lat * XPI), t = Math.atan2(lat, lng) + .000003 * Math.cos(lng * XPI); return { lat: z * Math.sin(t) + .006, lng: z * Math.cos(t) + .0065 }; }
function bd2gcj(lat, lng) { const x = lng - .0065, y = lat - .006, z = Math.sqrt(x * x + y * y) - .00002 * Math.sin(y * XPI), t = Math.atan2(y, x) - .000003 * Math.cos(x * XPI); return { lat: z * Math.sin(t), lng: z * Math.cos(t) }; }

// ================= 地图适配层 =================
// 统一接口：setCenter / getCenter / zoomIn / zoomOut / setMarkers / setMyPos / onMoveEnd / search / regeo
function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); setTimeout(() => fail(new Error('timeout')), 12000); });
}
const SDK = {
  async amap() {
    if (window.AMap) return;
    if (S.cfg.amapSecurityCode) window._AMapSecurityConfig = { securityJsCode: S.cfg.amapSecurityCode };
    await loadScript(`https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(S.cfg.amapKey)}&plugin=AMap.PlaceSearch,AMap.Geocoder`);
    if (!window.AMap) throw new Error('amap');
  },
  async baidu() {
    if (window.BMapGL && BMapGL.Map) return;
    await new Promise((ok, fail) => {
      window.__bmapReady = ok;
      loadScript(`https://api.map.baidu.com/api?type=webgl&v=1.0&ak=${encodeURIComponent(S.cfg.baiduAk)}&callback=__bmapReady`).catch(fail);
      setTimeout(() => fail(new Error('timeout')), 12000);
    });
  },
};

function markerEl(h, onClick) {
  const el = document.createElement('div');
  el.className = 'mk ' + h.status;
  el.innerHTML = `<div class="pin"><span>${h.status === 'giving' ? '🍬' : '🎃'}</span></div><label>${esc(h.name)}</label>`;
  el.addEventListener('click', e => { e.stopPropagation(); onClick(h); });
  return el;
}

function AmapAdapter(el, center) {
  const map = new AMap.Map(el, { zoom: 16, center: [center.lng, center.lat], mapStyle: 'amap://styles/dark', viewMode: '2D' });
  let markers = [], me = null; const geocoder = new AMap.Geocoder();
  return {
    raw: map,
    getCenter() { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
    setCenter(p, z) { z ? map.setZoomAndCenter(z, [p.lng, p.lat]) : map.setCenter([p.lng, p.lat]); },
    zoomIn() { map.zoomIn(); }, zoomOut() { map.zoomOut(); },
    radius() { const b = map.getBounds(), ne = b.getNorthEast(), c = map.getCenter(); return Math.max(800, ne.distance(c)); },
    onMoveEnd(fn) { map.on('moveend', fn); map.on('zoomend', fn); },
    setMarkers(list, onClick) {
      map.remove(markers);
      markers = list.map(h => new AMap.Marker({ position: [h.lng, h.lat], content: markerEl(h, onClick), offset: new AMap.Pixel(0, 0), anchor: 'top-left', zIndex: h.status === 'giving' ? 120 : 110 }));
      map.add(markers);
    },
    setMyPos(p) { const d = document.createElement('div'); d.className = 'me-dot'; if (me) map.remove(me); me = new AMap.Marker({ position: [p.lng, p.lat], content: d, anchor: 'top-left', zIndex: 200 }); map.add(me); },
    search(kw, near) {
      return new Promise(ok => {
        const ps = new AMap.PlaceSearch({ pageSize: 10, city: S.region.city || '全国', citylimit: false });
        const cb = (st, r) => ok(st === 'complete' && r.poiList ? r.poiList.pois.filter(p => p.location).map(p => ({ name: p.name, address: (p.cityname || '') + (p.adname || '') + (typeof p.address === 'string' ? p.address : ''), lat: p.location.lat, lng: p.location.lng })) : []);
        near ? ps.searchNearBy(kw, [near.lng, near.lat], 50000, cb) : ps.search(kw, cb);
      });
    },
    regeo(p) {
      return new Promise(ok => geocoder.getAddress([p.lng, p.lat], (st, r) => {
        if (st !== 'complete' || !r.regeocode) return ok(null);
        const a = r.regeocode.addressComponent, city = (typeof a.city === 'string' && a.city) || a.province;
        ok({ city, district: a.district, community: (a.neighborhood && typeof a.neighborhood === 'string' && a.neighborhood) || (a.building && typeof a.building === 'string' && a.building) || '', address: r.regeocode.formattedAddress });
      }));
    },
  };
}

function BaiduAdapter(el, center) {
  const map = new BMapGL.Map(el); const bp = gcj2bd(center.lat, center.lng);
  map.centerAndZoom(new BMapGL.Point(bp.lng, bp.lat), 17); map.enableScrollWheelZoom(true);
  let overlays = [], me = null; const geocoder = new BMapGL.Geocoder();
  const overlay = (p, dom, z) => { const b = gcj2bd(p.lat, p.lng); const o = new BMapGL.CustomOverlay(() => dom, { point: new BMapGL.Point(b.lng, b.lat), anchors: [0, 0], zIndex: z || 1 }); map.addOverlay(o); return o; };
  return {
    raw: map,
    getCenter() { const c = map.getCenter(); return bd2gcj(c.lat, c.lng); },
    setCenter(p, z) { const b = gcj2bd(p.lat, p.lng); const pt = new BMapGL.Point(b.lng, b.lat); z ? map.centerAndZoom(pt, z + 1) : map.setCenter(pt); },
    zoomIn() { map.zoomIn(); }, zoomOut() { map.zoomOut(); },
    radius() { const b = map.getBounds(), ne = b.getNorthEast(), c = map.getCenter(); return Math.max(800, map.getDistance(ne, c)); },
    onMoveEnd(fn) { map.addEventListener('moveend', fn); map.addEventListener('zoomend', fn); },
    setMarkers(list, onClick) { overlays.forEach(o => map.removeOverlay(o)); overlays = list.map(h => overlay(h, markerEl(h, onClick), h.status === 'giving' ? 12 : 11)); },
    setMyPos(p) { if (me) map.removeOverlay(me); const d = document.createElement('div'); d.className = 'me-dot'; me = overlay(p, d, 20); },
    search(kw) {
      return new Promise(ok => {
        const ls = new BMapGL.LocalSearch(S.region.city || map, { pageCapacity: 10, onSearchComplete: r => {
          const out = []; if (r) for (let i = 0; i < r.getCurrentNumPois(); i++) { const p = r.getPoi(i); if (p && p.point) out.push(Object.assign({ name: p.title, address: p.address || '' }, bd2gcj(p.point.lat, p.point.lng))); }
          ok(out);
        } });
        ls.search(kw); setTimeout(() => ok([]), 8000);
      });
    },
    regeo(p) {
      const b = gcj2bd(p.lat, p.lng);
      return new Promise(ok => geocoder.getLocation(new BMapGL.Point(b.lng, b.lat), r => {
        if (!r) return ok(null); const a = r.addressComponents;
        ok({ city: a.city, district: a.district, community: (r.surroundingPois && r.surroundingPois[0] && r.surroundingPois[0].title) || '', address: r.address });
      }));
    },
  };
}

// 未配置地图 Key 或 SDK 加载失败时的备用地图：网格底图 + 拖拽/缩放，保证功能可用
function LiteAdapter(el, center) {
  el.innerHTML = '<div class="lite"><div class="layer"></div><div class="wm">演示地图，配置地图 Key 后显示真实街道</div></div>';
  const root = el.firstChild, layer = root.firstChild;
  let c = Object.assign({}, center), z = 16, moveFns = [], items = [];
  const T = 256, proj = (p, zz) => { const s = T * 2 ** zz, x = (p.lng + 180) / 360 * s, sin = Math.sin(p.lat * PI / 180); return { x, y: (.5 - Math.log((1 + sin) / (1 - sin)) / (4 * PI)) * s }; };
  const unproj = (x, y, zz) => { const s = T * 2 ** zz; const lng = x / s * 360 - 180; const n = PI - 2 * PI * y / s; return { lat: 180 / PI * Math.atan(.5 * (Math.exp(n) - Math.exp(-n))), lng }; };
  function draw() {
    const w = root.clientWidth, h = root.clientHeight, cp = proj(c, z);
    root.style.backgroundPosition = `${(-cp.x + w / 2) % 40}px ${(-cp.y + h / 2) % 40}px`; root.style.backgroundSize = '40px 40px';
    items.forEach(it => { const p = proj(it.p, z); it.el.style.left = (p.x - cp.x + w / 2) + 'px'; it.el.style.top = (p.y - cp.y + h / 2) + 'px'; });
  }
  const fire = () => moveFns.forEach(f => f());
  let drag = null;
  root.addEventListener('pointerdown', e => { if (e.target.closest('.mk')) return; drag = { x: e.clientX, y: e.clientY, c: proj(c, z) }; root.setPointerCapture(e.pointerId); });
  root.addEventListener('pointermove', e => { if (!drag) return; c = unproj(drag.c.x - (e.clientX - drag.x), drag.c.y - (e.clientY - drag.y), z); draw(); });
  root.addEventListener('pointerup', () => { if (drag) { drag = null; fire(); } });
  root.addEventListener('wheel', e => { e.preventDefault(); z = Math.max(10, Math.min(19, z + (e.deltaY < 0 ? 1 : -1))); draw(); fire(); }, { passive: false });
  const place = (p, node, zi) => { const wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;z-index:' + zi; wrap.appendChild(node); layer.appendChild(wrap); const it = { p, el: wrap }; items.push(it); return it; };
  let mk = [], me = null; new ResizeObserver(draw).observe(root); setTimeout(draw);
  return {
    getCenter() { return Object.assign({}, c); },
    setCenter(p, zz) { c = { lat: p.lat, lng: p.lng }; if (zz) z = zz; draw(); fire(); },
    zoomIn() { z = Math.min(19, z + 1); draw(); fire(); }, zoomOut() { z = Math.max(10, z - 1); draw(); fire(); },
    radius() { const w = root.clientWidth, h = root.clientHeight; return Math.max(800, 156543 * Math.cos(c.lat * PI / 180) / 2 ** z * Math.hypot(w, h) / 2); },
    onMoveEnd(fn) { moveFns.push(fn); },
    setMarkers(list, onClick) { mk.forEach(it => { it.el.remove(); items.splice(items.indexOf(it), 1); }); mk = list.map(h => place(h, markerEl(h, onClick), h.status === 'giving' ? 3 : 2)); draw(); },
    setMyPos(p) { if (me) { me.el.remove(); items.splice(items.indexOf(me), 1); } const d = document.createElement('div'); d.className = 'me-dot'; me = place(p, d, 5); draw(); },
    async search(kw) { // 备用：用已登记的糖果屋按小区名搜索
      const r = await api('/api/houses?q=' + encodeURIComponent(kw)).catch(() => ({ list: [] }));
      const seen = new Set(); return r.list.filter(h => !seen.has(h.community) && seen.add(h.community)).map(h => ({ name: h.community || h.name, address: (h.city || '') + (h.district || ''), lat: h.lat, lng: h.lng }));
    },
    async regeo() { return null; },
  };
}

function chooseProvider() {
  const pref = localStorage.getItem('cm_map') || 'auto';
  const has = { amap: !!S.cfg.amapKey, baidu: !!S.cfg.baiduAk };
  if (pref !== 'auto' && has[pref]) return pref;
  // 自动：在百度 App 内打开用百度，其余场景优先高德；只配了一家就用那一家
  if (has.baidu && (/baiduboxapp|baidumap/i.test(navigator.userAgent) || !has.amap)) return 'baidu';
  if (has.amap) return 'amap';
  return 'lite';
}
async function createMap(el, center) {
  const want = chooseProvider();
  try {
    if (want === 'amap') { await SDK.amap(); return { kind: 'amap', m: AmapAdapter(el, center) }; }
    if (want === 'baidu') { await SDK.baidu(); return { kind: 'baidu', m: BaiduAdapter(el, center) }; }
  } catch (e) { console.warn('地图 SDK 加载失败，使用演示地图', e); toast('地图加载失败，已切换为演示地图'); }
  return { kind: 'lite', m: LiteAdapter(el, center) };
}

// ================= 定位 =================
function locate({ quiet } = {}) {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      p => { const g = wgs2gcj(p.coords.latitude, p.coords.longitude); S.myPos = g; S.map && S.map.setMyPos(g); ok(g); },
      () => { if (!quiet) toast('没拿到定位，请在系统设置里允许定位，或直接搜索小区'); ok(null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

// ================= 地图页 =================
let loadT;
async function loadNearby() {
  if (!S.map) return;
  const c = S.map.getCenter(); S.center = c;
  const st = [...S.statuses].join(',');
  try {
    const r = await api(`/api/houses?lat=${c.lat}&lng=${c.lng}&radius=${Math.round(S.map.radius())}&status=${st}`);
    S.houses = r.list;
  } catch (e) { S.houses = []; toast(e.message); }
  S.map.setMarkers(S.houses, openHouse);
  renderNearby();
}
function renderNearby() {
  const n = S.houses.length, g = S.houses.filter(h => h.status === 'giving').length;
  $('#nearbyStat').textContent = n ? `${n} 户糖果屋，${g} 户正在发糖` : '这一片还没有人点亮';
  $('#nearbyList').innerHTML = n ? S.houses.map(h => `
    <button class="ticket ${h.status}" data-house="${h.id}">
      <span class="stub"><span class="emo">${h.status === 'giving' ? '🍬' : '🎃'}</span><span class="dist">${fmtDist(h.distance)}</span></span>
      <span class="body">
        <b>${esc(h.name)}</b>
        <span class="line"><span class="tag ${h.status}">${STATUS_TEXT[h.status]}</span> ${esc(h.community)} ${esc(h.building)}栋</span>
        <span class="line">${esc(h.spot)}</span>
        <span class="line">${h.status === 'giving' ? fmtShort(h.endAt) + ' 收摊' : fmtShort(h.startAt) + ' 开门'}，${h.received} 人打卡</span>
      </span>
    </button>`).join('') : `<div class="empty-ticket"><span class="emo">👻</span><span><b>附近还没有糖果屋</b>搜一下小区，或拖动地图看看别处。</span></div>`;
}
async function initMap() {
  const center = JSON.parse(localStorage.getItem('cm_center') || 'null') || DEFAULT_CENTER;
  const { kind, m } = await createMap($('#map'), center);
  S.provider = kind; S.map = m;
  m.onMoveEnd(() => { clearTimeout(loadT); loadT = setTimeout(() => { loadNearby(); updateRegion(); localStorage.setItem('cm_center', JSON.stringify(S.map.getCenter())); }, 400); });
  loadNearby(); updateRegion();
  const pos = await locate({ quiet: true });
  if (pos) m.setCenter(pos, 16);
}
let regionT;
async function updateRegion() {
  clearTimeout(regionT);
  regionT = setTimeout(async () => { const r = await S.map.regeo(S.map.getCenter()).catch(() => null); if (r) S.region = { city: r.city || '', district: r.district || '' }; }, 300);
}

// 搜索
async function doSearch(input, box, mapObj, after) {
  const kw = input.value.trim(); if (!kw) return;
  box.innerHTML = '<button disabled><span>搜索中…</span></button>'; box.classList.remove('hidden');
  const list = await mapObj.search(kw, S.myPos).catch(() => []);
  box.innerHTML = list.length ? list.map((p, i) => `<button data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.address)}</span></button>`).join('') : '<button disabled><span>没有找到这个小区，换个关键词试试</span></button>';
  box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const p = list[b.dataset.i]; box.classList.add('hidden'); input.blur(); mapObj.setCenter(p, 17); after && after(p); };
}
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); doSearch($('#searchInput'), $('#searchResults'), S.map); });
$('#searchInput').addEventListener('input', e => { if (!e.target.value) $('#searchResults').classList.add('hidden'); });

// 状态筛选
document.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
  const s = b.dataset.status;
  if (S.statuses.has(s) && S.statuses.size === 1) return toast('至少保留一个状态');
  S.statuses.has(s) ? S.statuses.delete(s) : S.statuses.add(s);
  b.classList.toggle('on', S.statuses.has(s)); loadNearby();
}));

// ================= 糖果屋详情 / 打卡 / 导航 =================
async function openHouse(hOrId) {
  let h = typeof hOrId === 'string' ? S.houses.find(x => x.id === hOrId) : hOrId;
  try { h = Object.assign({}, h, await api('/api/house?id=' + (h ? h.id : hOrId))); } catch (e) { return toast(e.message); }
  const dist = S.myPos ? distance(S.myPos, h) : h.distance;
  const body = modal(`
    <span class="tag ${h.status}">${STATUS_TEXT[h.status]}</span>
    <h3 style="margin-top:8px">${h.status === 'giving' ? '🍬' : '🎃'} ${esc(h.name)}</h3>
    <dl class="detail-grid">
      <dt>位置</dt><dd>${esc(h.community)} ${esc(h.building)}栋${h.unit ? esc(h.unit) + '单元' : ''}${h.door ? ' ' + esc(h.door) : ''}</dd>
      <dt>接待点</dt><dd>${esc(h.spot)}</dd>
      <dt>时间</dt><dd>${fmtTime(h.startAt)} 到 ${fmtTime(h.endAt)}</dd>
      ${h.candy ? `<dt>糖果</dt><dd>${esc(h.candy)}</dd>` : ''}
      <dt>主人</dt><dd>${esc(h.host)}</dd>
      ${dist != null ? `<dt>距离</dt><dd>${fmtDist(dist)}</dd>` : ''}
      <dt>打卡</dt><dd>已有 ${h.received} 次</dd>
    </dl>
    <div class="row">
      <button class="btn" data-a="nav">导航过去</button>
      ${h.status === 'giving' ? `<button class="btn primary" data-a="checkin" ${h.checkedToday ? 'disabled' : ''}>${h.checkedToday ? '今天已打卡' : '打卡收糖'}</button>` : `<button class="btn" disabled>还没开门</button>`}
    </div>`);
  body.onclick = e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'nav') navTo(h);
    if (a.dataset.a === 'checkin') checkin(h);
  };
}
function distance(a, b) { const R = 6371000, r = PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(s))); }

// 导航：网页无法读取手机装了哪些 App，所以列出两家，点哪个就唤起哪个，没装会自动打开网页版
function navTo(h) {
  const name = encodeURIComponent(h.name + '（' + h.community + '）'), b = gcj2bd(h.lat, h.lng);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const links = {
    amap: { app: ios ? `iosamap://path?sourceApplication=candymap&dlat=${h.lat}&dlon=${h.lng}&dname=${name}&dev=0&t=2` : `amapuri://route/plan/?sourceApplication=candymap&dlat=${h.lat}&dlon=${h.lng}&dname=${name}&dev=0&t=2`, web: `https://uri.amap.com/navigation?to=${h.lng},${h.lat},${name}&mode=walk&coordinate=gaode&callnative=1` },
    baidu: { app: `baidumap://map/direction?destination=latlng:${h.lat},${h.lng}|name:${name}&coord_type=gcj02&mode=walking&src=candymap`, web: `https://api.map.baidu.com/direction?origin=&destination=latlng:${b.lat},${b.lng}|name:${name}&mode=walking&region=${encodeURIComponent(h.city || '')}&output=html&src=candymap` },
  };
  const first = S.provider === 'baidu' ? ['baidu', 'amap'] : ['amap', 'baidu'];
  const label = { amap: '高德地图', baidu: '百度地图' };
  const body = modal(`<h3>用哪个地图导航？</h3><div class="sheet-actions">${first.map(k => `<button data-k="${k}">${label[k]}</button>`).join('')}<button data-close>取消</button></div>`);
  body.onclick = e => {
    const k = e.target.closest('[data-k]'); if (!k) return;
    const l = links[k.dataset.k]; closeModal();
    const inWx = /MicroMessenger/i.test(navigator.userAgent);
    if (inWx) { location.href = l.web; return; } // 微信内拦截 App 跳转，直接走网页版
    const t = Date.now(); location.href = l.app;
    setTimeout(() => { if (!document.hidden && Date.now() - t < 2500) location.href = l.web; }, 1600);
  };
}

async function checkin(h) {
  if (!S.token) { await ensureAccount(); }
  const body = modal(`<h3>打卡收糖</h3><p class="p">向「${esc(h.name)}」的主人要 4 位打卡暗号，输入后就能记录这次收获。</p>
    <div class="code-input"><input id="ciCode" inputmode="numeric" maxlength="4" pattern="\\d*" placeholder="0000"></div>
    <button class="btn primary" id="ciGo">确认打卡</button>`, { center: true });
  const inp = body.querySelector('#ciCode'); setTimeout(() => inp.focus(), 50);
  body.querySelector('#ciGo').onclick = async () => {
    const code = inp.value.trim(); if (!/^\d{4}$/.test(code)) return toast('请输入 4 位数字暗号');
    const pos = await locate({ quiet: true });
    try {
      await api('/api/checkin', { houseId: h.id, code, lat: pos && pos.lat, lng: pos && pos.lng });
      closeModal(); boom(); toast('收获 +1，谢谢邻居！'); loadNearby();
    } catch (e) { toast(e.message); }
  };
}

// ================= 榜单 =================
async function renderRank() {
  if (!S.region.district && S.map) { const r = await S.map.regeo(S.map.getCenter()).catch(() => null); if (r) S.region = { city: r.city || '', district: r.district || '' }; }
  const { city, district } = S.region; let scope = S.rankScope;
  if (scope === 'district' && !district) scope = city ? 'city' : 'all';
  if (scope === 'city' && !city) scope = 'all';
  document.querySelectorAll('[data-scope]').forEach(b => { b.classList.toggle('on', b.dataset.scope === scope); b.classList.toggle('hidden', (b.dataset.scope === 'district' && !district) || (b.dataset.scope === 'city' && !city)); });
  $('#rankTitle').textContent = scope === 'district' ? `${district}糖果榜` : scope === 'city' ? `${city}糖果榜` : '全国糖果榜';
  $('#rankSub').textContent = `${new Date().getFullYear()}年万圣节，${scope === 'all' ? '统计全部打卡' : '只算在' + (scope === 'district' ? city + district : city) + '完成的打卡'}。`;
  document.querySelectorAll('[data-rank]').forEach(b => b.classList.toggle('on', b.dataset.rank === S.rankType));
  const qs = `type=${S.rankType}` + (scope !== 'all' ? `&city=${encodeURIComponent(city)}` : '') + (scope === 'district' ? `&district=${encodeURIComponent(district)}` : '');
  let list = [];
  try { list = (await api('/api/rank?' + qs)).list; } catch (e) { toast(e.message); }
  const unit = S.rankType === 'give' ? '次' : '颗';
  const faces = S.rankType === 'give' ? ['🏠', '🏡', '🏘️'] : ['🦇', '🧙', '👻'];
  const pod = (r, i) => r ? `<div class="pod p${i + 1} ${r.me ? 'me' : ''}"><span class="face">${faces[i]}</span><span class="who">${esc(r.name)}</span><span class="sub">${esc((r.sub || '').replace(/ · /g, '，'))}</span><div class="block">${r.count}<small>${unit}</small></div></div>` : '<div></div>';
  const top = list.slice(0, 3), rest = list.slice(3);
  $('#rankList').innerHTML = list.length
    ? `<div class="podium">${pod(top[1], 1)}${pod(top[0], 0)}${pod(top[2], 2)}</div>` + rest.map(r => `<div class="rank-row ${r.me ? 'me' : ''}"><div class="rank-no">${r.rank}</div><div class="info"><b>${esc(r.name)}${r.me ? '（我）' : ''}</b>${r.sub ? `<span class="muted small">${esc(r.sub.replace(/ · /g, '，'))}</span>` : ''}</div><div class="rank-count">${r.count}<small>${unit}</small></div></div>`).join('')
    : `<div class="empty"><div class="emo">🏆</div><h3>领奖台还空着</h3><p class="muted">${S.rankType === 'give' ? '点亮糖果屋，有小朋友来打卡就会上榜。' : '去邻居家打卡收糖，收获越多排名越靠前。'}</p><button class="btn ghost" data-go="${S.rankType === 'give' ? 'house' : 'map'}" style="margin-top:16px">${S.rankType === 'give' ? '点亮我的糖果屋' : '去地图找糖果屋'}</button></div>`;
}
document.querySelectorAll('[data-rank]').forEach(b => b.addEventListener('click', () => { S.rankType = b.dataset.rank; renderRank(); }));
document.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => { S.rankScope = b.dataset.scope; renderRank(); }));

// ================= 账号（免短信：起个昵称即可，恢复码用于换设备） =================
function loginView() {
  return `<h1 class="form-title">先登记一下，<br>再出门讨糖</h1><p class="muted">留个手机号就能打卡、点亮糖果屋，和邻居一起上榜。</p>
    <div class="field"><label>手机号</label><input class="input" id="lgPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号"><p class="hint">不会公开显示，也不需要验证码。</p></div>
    <div class="field"><label>榜单昵称 <small>选填</small></label><input class="input" id="lgNick" maxlength="16" placeholder="例如：南瓜小队"><p class="hint">昵称会公开显示，不填会随机起一个。</p></div>
    <label class="check"><input type="checkbox" id="lgAgree"><span>我已阅读并同意<a class="link" data-act="privacy">个人信息说明</a>，同意活动组织者保存我的手机号，用于活动联系和账号找回。</span></label>
    <div id="lgPriv" class="hidden priv-box">${PRIVACY}</div>
    <button class="btn primary" id="lgGo">登记并开始</button>
    <div id="lgRec" class="hidden"><div class="field"><label>恢复码</label><input class="input" id="lgCode" maxlength="9" placeholder="8 位恢复码" style="text-transform:uppercase"><p class="hint">注册时在「我的」页面显示过。</p></div><button class="btn dim" id="lgRecGo">找回账号</button></div>
    <p style="margin-top:22px;display:flex;justify-content:space-between"><a class="link" id="lgRecShow">注册过了？用恢复码找回</a><a class="link" data-act="notice">参与须知</a></p>`;
}
async function setToken(t) { S.token = t; localStorage.setItem('cm_token', t); await loadMe(); }
function bindLogin(root, done) {
  root.querySelector('#lgGo').onclick = async () => {
    const phone = root.querySelector('#lgPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return toast('请输入正确的 11 位手机号');
    if (!root.querySelector('#lgAgree').checked) return toast('请先勾选同意个人信息说明');
    try { await setToken((await api('/api/auth/register', { phone, nickname: root.querySelector('#lgNick').value, agree: true })).token); toast('欢迎，' + S.me.nickname); done(); }
    catch (err) { toast(err.message, 3000); if (/恢复码/.test(err.message)) root.querySelector('#lgRec').classList.remove('hidden'); }
  };
  root.querySelector('#lgRecShow').onclick = () => root.querySelector('#lgRec').classList.toggle('hidden');
  root.querySelector('#lgRecGo').onclick = async () => {
    try { await setToken((await api('/api/auth/recover', { code: root.querySelector('#lgCode').value })).token); toast('已找回：' + S.me.nickname); done(); }
    catch (err) { toast(err.message); }
  };
}
// 需要账号的操作前调用：没有账号就弹出起昵称
function ensureAccount() {
  if (S.token) return Promise.resolve(true);
  return new Promise(ok => {
    const b = modal('<div id="acct">' + loginView() + '</div>', { center: true });
    bindLogin(b, () => { closeModal(); ok(true); });
  });
}
async function loadMe() { if (!S.token) return (S.me = null); try { S.me = await api('/api/me'); } catch (_) { S.me = null; } return S.me; }

// ================= 我的 =================
async function renderMe() {
  const root = $('#meContent');
  await loadMe();
  if (!S.me) { root.innerHTML = loginView(); return bindLogin(root, renderMe); }
  const me = S.me, prefs = localStorage.getItem('cm_map') || 'auto';
  const opts = [['auto', '自动'], ...(S.cfg.amapKey ? [['amap', '高德']] : []), ...(S.cfg.baiduAk ? [['baidu', '百度']] : [])];
  root.innerHTML = `
    <div class="pass">
      <div class="meta">${new Date().getFullYear()} 万圣节讨糖证</div>
      <div class="who">${esc(me.nickname)}</div>
      <div class="meta">绑定手机 ${esc(me.phone)}</div>
      <div class="counts"><div class="count give"><b>${me.given}</b><span>我家发出</span></div><div class="count get"><b>${me.collected}</b><span>我收获的</span></div></div>
    </div>
    <div id="myCheckins"></div>
    <div class="field"><label>榜单昵称 <small>会公开显示</small></label><div class="row"><input class="input" id="nick" maxlength="16" value="${esc(me.nickname)}" style="flex:2"><button class="btn sm" id="saveNick" style="height:52px">保存</button></div></div>
    ${opts.length > 1 ? `<div class="field"><label>地图 <small>当前用的是${{ amap: '高德', baidu: '百度', lite: '演示地图' }[S.provider]}</small></label><div class="scope">${opts.map(([k, v]) => `<button class="mini ${prefs === k ? 'on' : ''}" data-mapset="${k}">${v}</button>`).join('')}</div></div>` : ''}
    <div class="field"><label>恢复码 <small>换手机时用它找回账号</small></label>
    <div class="recov"><b>${esc(me.recovery || '')}</b><button class="btn sm" style="width:auto;padding:0 18px" id="copyRec">复制</button></div><p class="hint">请截图保存，丢了无法找回。</p></div>
    <p style="margin-top:26px;display:flex;justify-content:space-between"><a class="link warn" id="logout">退出账号</a><a class="link" data-act="notice">参与须知</a></p>`;
  root.querySelector('#saveNick').onclick = async () => { try { await api('/api/me/nickname', { nickname: root.querySelector('#nick').value }); toast('已保存'); renderMe(); } catch (e) { toast(e.message); } };
  const cr = root.querySelector('#copyRec'); if (cr) cr.onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(me.recovery) : Promise.reject()).then(() => toast('已复制恢复码')).catch(() => toast('请长按截图保存'));
  root.querySelector('#logout').onclick = async () => {
    if (!confirm('退出后需要用恢复码才能找回这个账号，确定退出吗？')) return; await api('/api/auth/logout', {}).catch(() => {}); S.token = ''; S.me = null; localStorage.removeItem('cm_token'); renderMe(); };
  root.querySelectorAll('[data-mapset]').forEach(b => b.onclick = () => { localStorage.setItem('cm_map', b.dataset.mapset); toast('正在切换地图…'); setTimeout(() => location.reload(), 600); });
  api('/api/me/checkins').then(r => {
    if (!r.list.length) return;
    $('#myCheckins').innerHTML = '<p class="muted small" style="margin:4px 0 8px">最近收获</p>' + r.list.slice(0, 10).map(c => `<div class="rank-row"><div class="rank-no">🍬</div><div class="info"><b>${esc(c.house)}</b><span class="muted small">${esc(c.community)}，${fmtTime(c.at)}</span></div></div>`).join('');
  }).catch(() => {});
}

// ================= 我的糖果屋 =================
function toLocalInput(ts) { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
function defaultWindow() {
  const n = new Date(), y = n.getFullYear(); let d = new Date(y, 9, 31, 18, 0);
  if (n > new Date(y, 9, 31, 21, 0)) { d = new Date(n); d.setHours(18, 0, 0, 0); if (n.getHours() >= 21) d.setDate(d.getDate() + 1); }
  return [d.getTime(), d.getTime() + 3 * 3600e3];
}
async function renderHouse(edit) {
  const root = $('#houseContent');
  await loadMe();
  if (!S.me) { root.innerHTML = loginView(); return bindLogin(root, () => renderHouse()); }
  const h = S.me.house;
  if (h && !edit) return renderHouseCard(root, h);
  const [ds, de] = defaultWindow();
  S.form = h ? { lat: h.lat, lng: h.lng, community: h.community, city: h.city, district: h.district } : { lat: null, lng: null, community: '', city: '', district: '' };
  root.innerHTML = `
    <h1 class="form-title">把自家门口<br>变成一间糖果屋</h1><p class="muted">填好接待位置和发糖时间，点亮后邻居就能在地图上找到你。</p>
    <p class="muted small" style="margin-top:14px">发糖人：${esc(S.me.nickname)}</p>
    <div class="field"><label>给糖果屋起个名字</label><input class="input" id="fName" maxlength="20" placeholder="例如：南瓜小屋" value="${esc(h ? h.name : '')}"></div>
    <div class="field"><label>接待位置</label><button class="locbox" id="fLoc">＋ 在地图上放置南瓜</button><p class="hint">先搜索小区，再把地图上的标记移到接待入口。</p></div>
    <div class="field"><label>小区名称</label><input class="input" id="fComm" maxlength="40" placeholder="选点后自动带出，可修改" value="${esc(h ? h.community : '')}"></div>
    <div class="row"><div class="field"><label>楼栋</label><input class="input" id="fBld" maxlength="10" placeholder="例如：5" value="${esc(h ? h.building : '')}"></div>
    <div class="field"><label>单元 <small>选填</small></label><input class="input" id="fUnit" maxlength="10" placeholder="例如：1" value="${esc(h ? h.unit || '' : '')}"></div></div>
    <div class="field"><label>在哪里接待小朋友</label><input class="input" id="fSpot" maxlength="40" placeholder="例如：一楼大厅，南瓜灯旁" value="${esc(h ? h.spot : '')}"></div>
    <div class="field"><label>门牌号 <small>选填</small></label><input class="input" id="fDoor" maxlength="10" placeholder="例如：601" value="${esc(h ? h.door || '' : '')}"></div>
    <label class="check"><input type="checkbox" id="fShow" ${h && h.showUnit ? 'checked' : ''}>我愿意在公开地图上展示单元和门牌。未勾选时，仅显示楼栋与接待位置。</label>
    <div class="row"><div class="field"><label>开始发糖</label><input class="input" id="fStart" type="datetime-local" value="${toLocalInput(h ? h.startAt : ds)}"></div>
    <div class="field"><label>结束</label><input class="input" id="fEnd" type="datetime-local" value="${toLocalInput(h ? h.endAt : de)}"></div></div>
    <div class="field"><label>准备了什么糖 <small>选填</small></label><input class="input" id="fCandy" maxlength="40" placeholder="例如：独立包装软糖、巧克力" value="${esc(h ? h.candy : '')}"><p class="hint">建议注明是否含坚果、乳制品等常见过敏原。</p></div>
    <label class="check"><input type="checkbox" id="fAgree" ${h ? 'checked' : ''}><span>我已阅读并同意<a class="link" data-act="notice">参与须知</a>，会准备包装完好、在保质期内的食品。</span></label>
    <button class="btn primary" id="fSave">${h ? '保存修改' : '保存糖果屋'}</button>
    ${h ? '<button class="btn" id="fCancel" style="margin-top:10px">取消</button>' : ''}`;
  const syncLoc = () => { const b = root.querySelector('#fLoc'); if (S.form.lat) { b.classList.add('set'); b.innerHTML = `📍 ${esc([S.form.city, S.form.district, S.form.community].filter(Boolean).join(' ') || '已选择位置')}<br><span class="muted small">点一下重新放置</span>`; } };
  syncLoc();
  root.querySelector('#fLoc').onclick = () => openPicker(p => { Object.assign(S.form, p); if (p.community && !root.querySelector('#fComm').value) root.querySelector('#fComm').value = p.community; syncLoc(); });
  if (h) root.querySelector('#fCancel').onclick = () => renderHouse();
  root.querySelector('#fSave').onclick = async () => {
    const v = id => root.querySelector(id).value.trim();
    if (!S.form.lat) return toast('请先在地图上选择接待位置');
    const body = Object.assign({}, S.form, {
      name: v('#fName'), community: v('#fComm'), building: v('#fBld'), unit: v('#fUnit'), spot: v('#fSpot'), door: v('#fDoor'), candy: v('#fCandy'),
      showUnit: root.querySelector('#fShow').checked, agree: root.querySelector('#fAgree').checked,
      startAt: new Date(v('#fStart')).getTime(), endAt: new Date(v('#fEnd')).getTime(),
    });
    try { await api('/api/house', body); toast('糖果屋已保存'); renderHouse(); } catch (e) { toast(e.message); }
  };
}
function renderHouseCard(root, h) {
  const lit = h.lit && h.status !== 'ended';
  const tip = lit ? (h.status === 'giving' ? '门开着，邻居能在地图上看到你。' : '已点亮，到开门时间会自动变成「发糖中」。') : '点亮后，糖果屋会出现在附近邻居的地图上。';
  root.innerHTML = `
    <div class="door ${lit ? 'lit' : ''}">
      <div class="lamp">🎃</div>
      <h3>${esc(h.name)}</h3>
      <div class="meta"><span class="tag ${h.status}">${STATUS_TEXT[h.status]}</span></div>
      <div class="meta" style="margin-top:6px">${esc(h.community)} ${esc(h.building)}栋${h.unit ? esc(h.unit) + '单元' : ''}，${esc(h.spot)}</div>
      <div class="meta">${fmtTime(h.startAt)} 到 ${fmtTime(h.endAt)}</div>
      <div class="code-stub"><div><span>打卡暗号</span><br><b>${esc(h.code)}</b></div><span style="text-align:right">小朋友来领糖时<br>把这 4 个数字告诉他们</span></div>
    </div>
    <button class="btn ${lit ? '' : 'primary'}" id="hLight">${lit ? '熄灭糖果屋' : '点亮糖果屋'}</button>
    ${lit ? `<button class="btn ${h.paused ? 'pink' : ''}" id="hPause" style="margin-top:10px">${h.paused ? '继续发糖' : '糖发完了，先暂停'}</button>` : ''}
    <p class="hint" style="margin-top:12px;text-align:center">${tip}</p>
    <p class="house-stat">已经有<b>${h.received}</b>位小朋友来打卡</p>
    <hr>
    <div class="btns"><button class="btn sm" id="hEdit">修改信息</button><button class="btn sm" id="hShare">分享给邻居</button></div>
    <div class="btns"><button class="btn sm" id="hView">在地图上看</button><button class="btn sm" id="hDel" style="color:var(--warn)">删除糖果屋</button></div>`;
  root.querySelector('#hLight').onclick = async () => {
    try { const r = await api('/api/house/light', { lit: !lit, paused: false }); if (r.lit) { boom(); toast('糖果屋点亮了'); } else toast('已熄灭'); renderHouse(); } catch (e) { toast(e.message); }
  };
  const pb = root.querySelector('#hPause'); if (pb) pb.onclick = async () => { try { await api('/api/house/light', { lit: true, paused: !h.paused }); renderHouse(); } catch (e) { toast(e.message); } };
  root.querySelector('#hEdit').onclick = () => renderHouse(true);
  root.querySelector('#hShare').onclick = () => share(`我在「${h.community}」点亮了糖果屋「${h.name}」，${fmtTime(h.startAt)} 开始发糖，来讨糖吧！`, '#house=' + h.id);
  root.querySelector('#hView').onclick = () => { go('map'); S.map && S.map.setCenter(h, 17); };
  root.querySelector('#hDel').onclick = () => {
    const b = modal('<h3>删除这间糖果屋？</h3><p class="p">删除后地图上不再显示，已收到的打卡记录仍保留在榜单中。</p><div class="row"><button class="btn" data-close>先不删</button><button class="btn pink" id="delOk">删除</button></div>', { center: true });
    b.querySelector('#delOk').onclick = async () => { await api('/api/house/delete', {}).catch(() => {}); closeModal(); toast('已删除'); renderHouse(); };
  };
}

// ================= 选点 =================
let pick = null, pickCb = null;
async function openPicker(cb) {
  pickCb = cb; $('#picker').classList.remove('hidden');
  const start = (S.form && S.form.lat) ? S.form : (S.myPos || (S.map && S.map.getCenter()) || DEFAULT_CENTER);
  if (!pick) {
    pick = (await createMap($('#pickMap'), start)).m;
    let t; pick.onMoveEnd(() => { clearTimeout(t); t = setTimeout(updatePickAddr, 350); });
  } else pick.setCenter(start, 17);
  updatePickAddr();
}
let pickInfo = {};
async function updatePickAddr() {
  const c = pick.getCenter(); pickInfo = { lat: c.lat, lng: c.lng };
  const r = await pick.regeo(c).catch(() => null);
  if (r) Object.assign(pickInfo, { city: r.city || '', district: r.district || '', community: pickInfo.searched || r.community || '' });
  $('#pickAddr').textContent = r ? (r.address || '') : `已选坐标 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
}
$('#pickSearchForm').addEventListener('submit', e => { e.preventDefault(); doSearch($('#pickSearchInput'), $('#pickResults'), pick, p => { pickInfo.searched = p.name; }); });

// ================= 分享 / 须知 =================
function share(text, hash = '') {
  const url = location.origin + location.pathname + hash;
  if (/MicroMessenger/i.test(navigator.userAgent)) return toast('点右上角「···」分享给好友或朋友圈', 2600);
  if (navigator.share) return navigator.share({ title: '万圣节讨糖地图', text, url }).catch(() => {});
  (navigator.clipboard ? navigator.clipboard.writeText(text + ' ' + url) : Promise.reject()).then(() => toast('链接已复制，发给邻居吧')).catch(() => toast(url, 3000));
}
const PRIVACY = `<h3>个人信息说明</h3>
<p class="p"><b>收集什么</b><br>手机号、榜单昵称，以及你设置糖果屋时填写的位置和楼栋信息。</p>
<p class="p"><b>用来做什么</b><br>手机号用于活动组织者与你联系（如活动通知、糖果屋信息核实）和账号找回，不会在页面上公开显示，也不会提供给其他用户。</p>
<p class="p"><b>保存多久</b><br>活动结束后最长保存 12 个月。你可以随时联系活动组织者要求删除。</p>
<p class="p"><b>你的权利</b><br>不同意本说明可以不注册，只浏览地图和榜单不受影响。</p>`;
const NOTICE = `<h3>参与须知</h3>
<p class="p">这是一份给家长和发糖邻居的约定。请完整阅读，尤其留意儿童陪同、食品安全和平台责任范围。</p>
<p class="p"><b>孩子必须由成人全程陪同</b><br>未成年人须由监护人或经监护人委托的成年人全程陪同，不得独自上门讨糖。陪同人应照看孩子，注意夜间出行、道路、电梯和楼梯安全。优先在住户公布的公共区域（大堂、门口）领取，不进入陌生人家中。</p>
<p class="p"><b>食品安全</b><br>发糖家庭请提供来源可靠、独立包装完好、在保质期内的食品，不提供自制食品、散装食品和酒精类食品。家长请检查配料、过敏原及保质期后再让孩子食用。</p>
<p class="p"><b>尊重邻居</b><br>只拜访地图上「发糖中」的糖果屋，按住户公布的接待位置和时间前往；熄灯或暂停时请勿打扰。保持安静，遵守小区管理规定。</p>
<p class="p"><b>信息与隐私</b><br>门牌和单元默认不公开，住户可自行选择。昵称会在榜单公开显示；注册用的手机号不公开，用途见「个人信息说明」。</p>
<p class="p"><b>平台责任</b><br>平台提供信息展示与查找，不保证住户信息的真实性、实时性及食品安全，请自行核实。平台依法应承担的责任不因此免除。</p>
<button class="btn" data-close>我知道了</button>`;

// ================= 路由 / 事件 =================
const PAGES = ['map', 'rank', 'me', 'house'];
function go(p) {
  PAGES.forEach(x => $('#page-' + x).classList.toggle('hidden', x !== p));
  document.querySelectorAll('.tabbar [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === p));
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  if (p === 'rank') renderRank();
  if (p === 'me') renderMe();
  if (p === 'house') renderHouse();
  if (p === 'map') { loadNearby(); }
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { closeModal(); return go(g.dataset.go); }
  const h = e.target.closest('[data-house]'); if (h) return openHouse(h.dataset.house);
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'share') share('今年万圣节，带孩子去邻居家讨糖！看看附近哪些糖果屋在发糖 🍬');
  if (act === 'refresh') { loadNearby(); toast('已刷新'); }
  if (act === 'zoomin') S.map && S.map.zoomIn();
  if (act === 'zoomout') S.map && S.map.zoomOut();
  if (act === 'locate') locate().then(p => p && S.map.setCenter(p, 17));
  if (act === 'toggleSheet') { const s = $('#sheet'); s.classList.toggle('open'); $('#sheetToggle').textContent = s.classList.contains('open') ? '收起' : '全部'; }
  if (act === 'notice') { e.preventDefault(); modal(NOTICE); }
  if (act === 'privacy') { e.preventDefault(); const scope = a.closest('.content, .modal'); const box = scope && scope.querySelector('#lgPriv'); if (box) box.classList.toggle('hidden'); else modal(PRIVACY + '<button class="btn" data-close>我知道了</button>'); }
  if (act === 'closePicker') $('#picker').classList.add('hidden');
  if (act === 'confirmPick') { if (!pickInfo.lat) return; $('#picker').classList.add('hidden'); pickCb && pickCb(Object.assign({}, pickInfo)); }
});
// 有人进出时自动刷新附近列表（发糖状态随时间变化）
setInterval(() => { if (!document.hidden && !$('#page-map').classList.contains('hidden')) loadNearby(); }, 60000);

// ================= 启动 =================
(async function boot() {
  try { S.cfg = await api('/api/config'); } catch (_) {}
  if (S.cfg.storageReady === false) toast('活动数据库还没连接，暂时只能看地图', 4000);
  const hash = location.hash.slice(1);
  const shared = /^house=(\w+)$/.exec(hash);
  go(PAGES.includes(hash) ? hash : 'map');
  await initMap();
  if (shared) { try { const h = await api('/api/house?id=' + shared[1]); go('map'); S.map.setCenter(h, 17); openHouse(h); } catch (e) { toast(e.message); } }
})();
})();
