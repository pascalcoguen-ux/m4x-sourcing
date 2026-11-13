// Simulateur local de Cloudflare Pages (D1 + R2) — pour tester sans compte Cloudflare.
// Usage : node dev/server.mjs  → http://localhost:8788
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { onRequest } = await import(pathToFileURL(path.join(root, 'functions/api/[[path]].js')).href);

const db = new DatabaseSync(process.env.DB_FILE || ':memory:');
db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const D1 = { prepare(sql) { const st = db.prepare(sql); let args = [];
  const o = { bind(...a) { args = a; return o; },
    async first() { return st.get(...args) ?? null; },
    async all() { return { results: st.all(...args) }; },
    async run() { st.run(...args); return { success: true }; } };
  return o; } };
const store = new Map();
const R2 = { async put(k, buf, opts) { store.set(k, { buf: Buffer.from(buf), opts }); },
  async get(k) { const v = store.get(k); return v ? { body: v.buf, httpMetadata: v.opts?.httpMetadata } : null; },
  async delete(k) { store.delete(k); } };
const env = { DB: D1, FILES: R2, ADMIN_EMAILS: process.env.ADMIN_EMAILS || 'admin@test.fr' };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await onRequest({ request: new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' }), env });
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!p.startsWith(path.join(root, 'public')) || !fs.existsSync(p)) p = path.join(root, 'public', 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
}).listen(+process.env.PORT || 8788, () => console.log('M4X Sourcing (local) → http://localhost:' + (process.env.PORT || 8788)));
