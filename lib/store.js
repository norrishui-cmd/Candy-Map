// 存储层：线上用 Upstash Redis（REST），本地开发用内存 + data.json 模拟同样的命令
'use strict';
const fs = require('fs');
const path = require('path');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const toObj = arr => { if (!Array.isArray(arr)) return arr || {}; const o = {}; for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const norm = (cmd, r) => (cmd[0] === 'HGETALL' ? toObj(r) : r);

function upstash() {
  async function call(p, body) {
    const res = await fetch(URL_ + p, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error('redis: ' + (j.error || res.status));
    return j;
  }
  return {
    ready: true,
    async cmd(c) { return norm(c, (await call('', c.map(String))).result); },
    async pipe(cs) { const r = await call('/pipeline', cs.map(c => c.map(String))); return r.map((x, i) => { if (x.error) throw new Error('redis: ' + x.error); return norm(cs[i], x.result); }); },
  };
}

function local() {
  const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
  let d = {}; try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const exp = {}; let t;
  const save = () => { clearTimeout(t); t = setTimeout(() => fs.writeFileSync(file, JSON.stringify(d)), 200); };
  const alive = k => { if (exp[k] && exp[k] < Date.now()) { delete d[k]; delete exp[k]; } return d[k]; };
  function run([op, k, ...a]) {
    alive(k);
    switch (op) {
      case 'HGET': return d[k] && d[k][a[0]] != null ? d[k][a[0]] : null;
      case 'HSET': (d[k] = d[k] || {})[a[0]] = String(a[1]); save(); return 1;
      case 'HSETNX': if (d[k] && d[k][a[0]] != null) return 0; (d[k] = d[k] || {})[a[0]] = String(a[1]); save(); return 1;
      case 'HDEL': if (d[k]) delete d[k][a[0]]; save(); return 1;
      case 'HGETALL': return Object.assign({}, d[k] || {});
      case 'RPUSH': (d[k] = d[k] || []).push(String(a[0])); save(); return d[k].length;
      case 'LRANGE': return (d[k] || []).slice();
      case 'EXISTS': return d[k] != null ? 1 : 0;
      case 'INCR': d[k] = (Number(d[k]) || 0) + 1; return d[k];
      case 'EXPIRE': exp[k] = Date.now() + a[0] * 1000; return 1;
      case 'SET': { if (a.includes('NX') && d[k] != null) return null; d[k] = String(a[0]); const i = a.indexOf('EX'); if (i > -1) exp[k] = Date.now() + a[i + 1] * 1000; save(); return 'OK'; }
      default: throw new Error('unsupported ' + op);
    }
  }
  return { ready: true, async cmd(c) { return run(c); }, async pipe(cs) { return cs.map(run); } };
}

let inst;
function getStore() {
  if (inst) return inst;
  if (URL_ && TOKEN) inst = upstash();
  else if (process.env.VERCEL) inst = { ready: false }; // 线上没连数据库：只读配置，其他接口返回 503
  else inst = local();
  return inst;
}
module.exports = { getStore };
