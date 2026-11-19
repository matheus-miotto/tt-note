'use strict';
// Backup do servidor para uma pasta (ex.: a pasta do Google Drive para computador): estado em arquivo datado,
// anexos copiados uma vez só (são imutáveis), tudo criptografado com AES-256-GCM antes de sair do notebook.
// Formato de cada arquivo .ttb:  "TTB1" + IV(12) + dados criptografados + TAG(16).  A chave vem da senha do backup (scrypt + salt.bin).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('TTB1');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;

function keyFor(dir, pass, create) {
  if (!pass) throw new Error('Defina a senha do backup (config.json → backup.passphrase)');
  const f = path.join(dir, 'salt.bin');
  let salt;
  if (fs.existsSync(f)) salt = fs.readFileSync(f);
  else if (create) { salt = crypto.randomBytes(16); fs.writeFileSync(f, salt); }
  else throw new Error('salt.bin não encontrado: essa pasta não é um backup do TT Note');
  return crypto.scryptSync(pass, salt, 32);
}

function encryptBuffer(key, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, enc, c.getAuthTag()]);
}
function decryptBuffer(key, buf) {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('Arquivo de backup inválido');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(buf.length - 16));
  try { return Buffer.concat([d.update(buf.subarray(16, buf.length - 16)), d.final()]); } catch { throw new Error('Senha do backup incorreta ou arquivo corrompido'); }
}
async function encryptFile(key, src, dest) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const tmp = dest + '.tmp';
  const out = fs.createWriteStream(tmp);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(fs.createReadStream(src), c, out, { end: false });
  out.end(c.getAuthTag());
  await new Promise((r, j) => { out.on('finish', r); out.on('error', j); });
  fs.renameSync(tmp, dest);
}
async function decryptFile(key, src, dest) {
  const size = fs.statSync(src).size;
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(16); const tag = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.readSync(fd, tag, 0, 16, size - 16);
  fs.closeSync(fd);
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('Arquivo de backup inválido: ' + path.basename(src));
  const d = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(4, 16));
  d.setAuthTag(tag);
  await pipeline(fs.createReadStream(src, { start: 16, end: size - 17 }), d, fs.createWriteStream(dest));
}

// Mantém as últimas `daily` datas e uma por semana para as `weekly` semanas seguintes
function prune(dir, daily, weekly) {
  const files = fs.readdirSync(dir).filter((f) => /^estado-\d{4}-\d{2}-\d{2}_\d{4}\.ttb$/.test(f)).sort().reverse();
  const days = new Set(); const weeks = new Set(); const keep = new Set();
  for (const f of files) {
    const [y, m, d] = f.slice(7, 17).split('-').map(Number);
    const day = f.slice(7, 17);
    if (!days.has(day) && days.size < daily) { days.add(day); keep.add(f); continue; }
    if (days.has(day)) continue;
    const wk = `${y}-${Math.floor((Date.UTC(y, m - 1, d) / 86400000 + 4) / 7)}`;
    if (!weeks.has(wk) && weeks.size < weekly) { weeks.add(wk); keep.add(f); }
  }
  for (const f of files) if (!keep.has(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* segue */ } }
}

async function run(core, cfg) {
  const b = cfg.backup;
  if (!b || !b.dir) throw new Error('Backup não configurado (config.json → backup.dir e backup.passphrase)');
  fs.mkdirSync(path.join(b.dir, 'files'), { recursive: true });
  const key = keyFor(b.dir, b.passphrase, true);
  core.flush();
  const snap = JSON.parse(JSON.stringify(core.state));
  snap.sessions = {}; // sessões não vão para o backup
  const name = `estado-${stamp()}.ttb`;
  fs.writeFileSync(path.join(b.dir, name + '.tmp'), encryptBuffer(key, zlib.gzipSync(Buffer.from(JSON.stringify(snap)))));
  fs.renameSync(path.join(b.dir, name + '.tmp'), path.join(b.dir, name));
  let copied = 0;
  for (const id of Object.keys(core.state.files)) {
    const dest = path.join(b.dir, 'files', id + '.ttb');
    if (fs.existsSync(dest) || !fs.existsSync(core.filePath(id))) continue;
    await encryptFile(key, core.filePath(id), dest);
    copied++;
  }
  prune(b.dir, b.keepDaily || 14, b.keepWeekly || 8);
  fs.writeFileSync(path.join(core.dir, 'backup-state.json'), JSON.stringify({ last: Date.now(), day: stamp().slice(0, 10) }));
  return `Backup ${name} (${copied} anexo(s) novo(s))`;
}

function schedule(core, cfg, log) {
  const check = async () => {
    const b = cfg.backup;
    if (!b || !b.dir || !b.passphrase) return;
    let last = {};
    try { last = JSON.parse(fs.readFileSync(path.join(core.dir, 'backup-state.json'), 'utf8')); } catch { /* nunca rodou */ }
    const now = new Date();
    if (last.day === stamp(now).slice(0, 10) || now.getHours() < (b.hour ?? 3)) return;
    try { log(await run(core, cfg)); } catch (e) { log('falhou: ' + e.message); }
  };
  setTimeout(check, 5000).unref?.();
  const t = setInterval(check, 10 * 60 * 1000);
  t.unref?.();
  return t;
}

// Restaura o backup mais recente (ou o arquivo `estado-….ttb` indicado) em destDir
async function restore(srcDir, destDir, pass, which) {
  const key = keyFor(srcDir, pass, false);
  const states = fs.readdirSync(srcDir).filter((f) => /^estado-.*\.ttb$/.test(f)).sort();
  if (!states.length) throw new Error('Nenhum estado-*.ttb nessa pasta');
  const pick = which || states[states.length - 1];
  const state = JSON.parse(zlib.gunzipSync(decryptBuffer(key, fs.readFileSync(path.join(srcDir, pick)))).toString('utf8'));
  fs.mkdirSync(path.join(destDir, 'files'), { recursive: true });
  fs.writeFileSync(path.join(destDir, 'state.json'), JSON.stringify(state));
  let files = 0;
  for (const id of Object.keys(state.files || {})) {
    const src = path.join(srcDir, 'files', id + '.ttb');
    if (!fs.existsSync(src)) continue;
    await decryptFile(key, src, path.join(destDir, 'files', id));
    files++;
  }
  return { state: pick, files };
}

module.exports = { run, schedule, restore, prune, encryptBuffer, decryptBuffer };
