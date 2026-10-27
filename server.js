// 本地运行：node server.js  → http://localhost:3000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./lib/core');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 兼容 vercel.json 的转发：/api?__p=config → /api/config（Vercel 以 Node 服务模式运行本文件时会走到这里）
  const sub = url.searchParams.get('__p');
  if (url.pathname.replace(/\/+$/, '') === '/api' && sub != null) {
    url.searchParams.delete('__p');
    url.pathname = '/api/' + sub.replace(/^\/+/, '');
  }
  if (!url.pathname.startsWith('/api/')) {
    let p = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!p.startsWith(PUBLIC_DIR) || !fs.existsSync(p) || !fs.statSync(p).isFile()) p = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    return fs.createReadStream(p).pipe(res);
  }
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e5) req.destroy(); });
  req.on('end', async () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) {}
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const [code, obj] = await handle({ method: req.method, pathname: url.pathname, query: url.searchParams, body, headers: req.headers, ip });
    if (obj && obj.__raw != null) {
      res.writeHead(code, { 'Content-Type': obj.__type, 'Content-Disposition': `attachment; filename="${obj.__file}"`, 'Cache-Control': 'no-store' });
      return res.end(obj.__raw);
    }
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  });
}).listen(PORT, () => console.log(`🎃 讨糖地图已启动：http://localhost:${PORT}`));
