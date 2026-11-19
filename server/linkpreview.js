// Prévia de links (título, descrição, imagem), como no WhatsApp.
// Roda no servidor: o cliente pede /api/link-preview?url=… e mostra o cartão.
// Segurança: só http/https, não acessa endereços privados/locais (SSRF), limita tamanho, tempo e redirecionamentos.
'use strict';
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const MAX_BYTES = 600 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const TTL_OK = 60 * 60 * 1000;
const TTL_FAIL = 10 * 60 * 1000;
const cache = new Map(); // url -> { at, ttl, value }

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (m) return privateIp(m[1]);
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

// "lookup" que só devolve endereços públicos: vale também para o que o socket realmente conecta (anula DNS rebinding)
function safeLookup(allowPrivate) {
  return (host, opts, cb) => {
    dns.lookup(host, { all: true }, (err, list) => {
      if (err) return cb(err);
      const ok = list.filter((a) => allowPrivate || !privateIp(a.address));
      if (!ok.length) return cb(new Error('Endereço não permitido'));
      if (opts && opts.all) return cb(null, ok);
      cb(null, ok[0].address, ok[0].family);
    });
  };
}

function getOnce(u, allowPrivate) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'GET', lookup: safeLookup(allowPrivate), timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TTNoteLinkPreview/1.0)', Accept: 'text/html,application/xhtml+xml,image/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
    }, (res) => {
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({ redirect: new URL(res.headers.location, u).href }); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      if (/^image\//.test(type)) { res.resume(); return resolve({ image: u.href }); }
      if (!/html|xml/.test(type)) { res.resume(); return reject(new Error('Tipo sem prévia')); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; chunks.push(c); if (n > MAX_BYTES) { res.destroy(); resolve({ html: decode(Buffer.concat(chunks), type) }); } });
      res.on('end', () => resolve({ html: decode(Buffer.concat(chunks), type) }));
      res.on('error', () => resolve({ html: decode(Buffer.concat(chunks), type) }));
    });
    req.on('timeout', () => req.destroy(new Error('Demorou demais')));
    req.on('error', reject);
    req.end();
  });
}

function decode(buf, type) {
  let cs = (/charset=([\w-]+)/i.exec(type) || [])[1];
  if (!cs) cs = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1')) || [])[1];
  try { return new TextDecoder(cs || 'utf-8').decode(buf); } catch { return buf.toString('utf8'); }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ''; } }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

function parse(html, base) {
  const head = html.slice(0, 200000);
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (/(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const val = (/content\s*=\s*"([^"]*)"/i.exec(tag) || /content\s*=\s*'([^']*)'/i.exec(tag) || [])[1];
    if (key && val != null && !(key.toLowerCase() in meta)) meta[key.toLowerCase()] = val;
  }
  const titleTag = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1];
  const title = unent(meta['og:title'] || meta['twitter:title'] || titleTag);
  const description = unent(meta['og:description'] || meta['twitter:description'] || meta.description);
  let image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  if (image) { try { image = new URL(unent(image), base).href; } catch { image = ''; } }
  if (!/^https?:/i.test(image)) image = '';
  const site = unent(meta['og:site_name']) || new URL(base).hostname.replace(/^www\./, '');
  return { title: title.slice(0, 200), description: description.slice(0, 300), image, site: site.slice(0, 80) };
}

async function fetchPreview(rawUrl, opts = {}) {
  const allowPrivate = !!opts.allowPrivate;
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const key = u.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  let value = null;
  try {
    let cur = u;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      if (!/^https?:$/.test(cur.protocol)) throw new Error('Protocolo não permitido');
      if (net.isIP(cur.hostname) && !allowPrivate && privateIp(cur.hostname)) throw new Error('Endereço não permitido');
      const r = await getOnce(cur, allowPrivate);
      if (r.redirect) { cur = new URL(r.redirect); continue; }
      if (r.image) value = { url: key, title: decodeURIComponent(cur.pathname.split('/').pop() || '') || cur.hostname, description: '', image: r.image, site: cur.hostname.replace(/^www\./, '') };
      else if (r.html) { const p = parse(r.html, cur.href); if (p.title || p.description || p.image) value = { url: key, ...p }; }
      break;
    }
  } catch { value = null; }
  cache.set(key, { at: Date.now(), ttl: value ? TTL_OK : TTL_FAIL, value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

module.exports = { fetchPreview, privateIp, parse };
