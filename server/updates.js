'use strict';
// Atualizações do app distribuídas pelo próprio servidor: o administrador publica o instalador e os apps conectados
// baixam sem passar pelo navegador (arquivos baixados pelo app não recebem a marca de "veio da internet", então o
// SmartScreen não interfere). Pasta: <dados>/updates  (latest.json + os dois últimos instaladores).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const VERSION_RE = /^\d{1,4}\.\d{1,5}\.\d{1,5}$/;
const dirOf = (dir) => path.join(dir, 'updates');
const nameOf = (version) => `TT Note Setup ${version}.exe`;

function latest(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dirOf(dir), 'latest.json'), 'utf8'));
    if (j && VERSION_RE.test(j.version) && fs.existsSync(path.join(dirOf(dir), j.file))) return { version: j.version, size: j.size, sha256: j.sha256, ts: j.ts, file: j.file };
  } catch { /* sem publicação */ }
  return { version: null };
}
const pub = (l) => (l.version ? { version: l.version, size: l.size, sha256: l.sha256, ts: l.ts } : { version: null });

// maior (>0), igual (0) ou menor (<0)
function compare(a, b) {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}

// Traz o instalador de `src` para a pasta de atualizações (mover = o arquivo é um upload temporário) e o torna o mais novo
async function ingest(dir, src, version, move) {
  if (!VERSION_RE.test(String(version))) throw Object.assign(new Error('Versão inválida (use o formato 1.19.2)'), { status: 400 });
  const ud = dirOf(dir);
  fs.mkdirSync(ud, { recursive: true });
  const stat = fs.statSync(src);
  if (stat.size < 1024 * 1024) throw Object.assign(new Error('Esse arquivo é pequeno demais para ser o instalador'), { status: 400 });
  const head = Buffer.alloc(2);
  const fd = fs.openSync(src, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
  if (head.toString('latin1') !== 'MZ') throw Object.assign(new Error('Esse arquivo não é um programa do Windows (.exe)'), { status: 400 });
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(src), hash);
  const sha256 = hash.digest('hex');
  const file = nameOf(version);
  const dest = path.join(ud, file);
  if (path.resolve(src) !== path.resolve(dest)) {
    if (move) { fs.rmSync(dest, { force: true }); fs.renameSync(src, dest); }
    else { const tmp = dest + '.part'; fs.copyFileSync(src, tmp); fs.rmSync(dest, { force: true }); fs.renameSync(tmp, dest); }
  }
  const info = { version, file, size: stat.size, sha256, ts: Date.now() };
  fs.writeFileSync(path.join(ud, 'latest.json.tmp'), JSON.stringify(info));
  fs.renameSync(path.join(ud, 'latest.json.tmp'), path.join(ud, 'latest.json'));
  // guarda só os dois instaladores mais recentes
  const olds = fs.readdirSync(ud).filter((f) => /^TT Note Setup .*\.exe$/.test(f) && f !== file).map((f) => ({ f, t: fs.statSync(path.join(ud, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const o of olds.slice(1)) { try { fs.unlinkSync(path.join(ud, o.f)); } catch { /* em uso */ } }
  return pub(info);
}

module.exports = { latest, pub, compare, ingest, dirOf, VERSION_RE, nameOf };
