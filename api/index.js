// Vercel 函数入口：vercel.json 把 /api/* 都转到这里，原路径放在 __p 参数里
'use strict';
const { handle } = require('../lib/core');

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const sub = url.searchParams.get('__p');
  url.searchParams.delete('__p');
  const pathname = sub != null ? '/api/' + sub.replace(/^\/+/, '') : url.pathname;
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const [code, obj] = await handle({ method: req.method, pathname, query: url.searchParams, body, headers: req.headers, ip });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = code;
  res.end(JSON.stringify(obj));
};
