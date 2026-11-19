'use strict';
// Atualização "rápida": com o instalador já baixado e conferido (SHA-256), o app extrai a versão nova numa pasta ao lado
// ("TT Note.next") ENQUANTO continua aberto. Quando o usuário clica em "Reiniciar", o app fecha e um script minúsculo só
// renomeia as pastas (antiga → .old, nova → no lugar) e abre o app: poucos segundos, em vez de rodar o instalador inteiro.
// O pacote vem de dentro do próprio instalador (o NSIS do electron-builder carrega um .7z com o app; o tar.exe do Windows lê .7z).
// Qualquer falha aqui só desliga o atalho: quem chama cai no caminho antigo (instalador silencioso).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const SIG = Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]); // assinatura de um arquivo .7z
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const MARK = '.tt-staged.json';

const trim = (d) => String(d).replace(/[\\/]+$/, '');
const nextOf = (d) => trim(d) + '.next';
const oldOf = (d) => trim(d) + '.old';

// pasta onde o app está instalado (em desenvolvimento não há o que trocar; TT_UPDATE_APPDIR serve para testes)
function appDir(app) {
  if (process.env.TT_UPDATE_APPDIR) return process.env.TT_UPDATE_APPDIR;
  return app && app.isPackaged ? path.dirname(process.execPath) : null;
}

function writable(dir) {
  try {
    const p = path.join(dir, '.tt-write-test-' + process.pid);
    fs.writeFileSync(p, 'x'); fs.rmSync(p, { force: true });
    return true;
  } catch { return false; }
}

// procura o .7z dentro do instalador: devolve { start, length } ou null
async function findPayload(file) {
  const size = fs.statSync(file).size;
  const fd = await fs.promises.open(file, 'r');
  try {
    const CH = 8 * 1024 * 1024;
    const buf = Buffer.alloc(CH + SIG.length);
    let pos = 0;
    while (pos < size) {
      const { bytesRead } = await fd.read(buf, 0, CH + SIG.length, pos);
      if (bytesRead < SIG.length) break;
      let i = -1;
      const view = buf.subarray(0, bytesRead);
      while ((i = view.indexOf(SIG, i + 1)) >= 0) {
        const start = pos + i;
        const h = Buffer.alloc(32);
        await fd.read(h, 0, 32, start);
        if (h[6] !== 0 || h[7] < 2 || h[7] > 5) continue; // versão do formato: 0.2 a 0.5
        const nhOff = Number(h.readBigUInt64LE(12)); const nhSize = Number(h.readBigUInt64LE(20));
        const length = 32 + nhOff + nhSize;
        if (length > 1024 * 1024 && start + length <= size) return { start, length };
      }
      pos += CH;
    }
    return null;
  } finally { await fd.close(); }
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const c = execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, _o, se) => (err ? reject(new Error((se || err.message || '').toString().slice(0, 300))) : resolve()));
    try { if (c.pid) os.setPriority(c.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sem ajustar prioridade */ }
  });
}

function readMark(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(nextOf(dir), MARK), 'utf8')); } catch { return null; }
}
const valid = (d) => fs.existsSync(path.join(d, 'TT Note.exe')) && fs.existsSync(path.join(d, 'resources', 'app.asar'));

// Extrai a versão nova para <pasta>.next. Devolve { ok, reason? }; nunca lança.
async function prepare(app, file, version, log) {
  const say = (m) => { try { log && log('rápida: ' + m); } catch { /* */ } };
  try {
    const dir = appDir(app);
    if (!dir) return { ok: false, reason: 'não é a versão instalada' };
    if (process.platform !== 'win32' || !fs.existsSync(TAR)) return { ok: false, reason: 'tar.exe do Windows não encontrado' };
    const mk = readMark(dir);
    if (mk && mk.version === version && mk.file === file && valid(nextOf(dir))) { say(`a ${version} já estava preparada`); return { ok: true, already: true }; }
    if (!writable(dir) || !writable(path.dirname(dir))) return { ok: false, reason: 'sem permissão de escrita na pasta de instalação' };
    const fr = fs.statfsSync(path.dirname(dir));
    if (fr.bavail * fr.bsize < 700 * 1024 * 1024) return { ok: false, reason: 'pouco espaço em disco' };
    const t0 = Date.now();
    const pl = await findPayload(file);
    if (!pl) return { ok: false, reason: 'pacote do app não encontrado no instalador' };
    const nx = nextOf(dir);
    fs.rmSync(nx, { recursive: true, force: true });
    fs.mkdirSync(nx, { recursive: true });
    const tmp7 = path.join(os.tmpdir(), `tt-note-${version}.7z`);
    await new Promise((res, rej) => {
      const out = fs.createWriteStream(tmp7);
      const rs = fs.createReadStream(file, { start: pl.start, end: pl.start + pl.length - 1 });
      rs.on('error', rej); out.on('error', rej); out.on('finish', res); rs.pipe(out);
    });
    try { await run(TAR, ['-xf', tmp7, '-C', nx], 5 * 60 * 1000); } finally { fs.rmSync(tmp7, { force: true }); }
    if (!valid(nx)) { fs.rmSync(nx, { recursive: true, force: true }); return { ok: false, reason: 'o pacote extraído está incompleto' }; }
    fs.writeFileSync(path.join(nx, MARK), JSON.stringify({ version, file, ts: Date.now() }));
    say(`a ${version} ficou pronta em ${nx} (${Math.round((Date.now() - t0) / 1000)} s)`);
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(nextOf(appDir(app)), { recursive: true, force: true }); } catch { /* */ }
    say('não consegui preparar (' + e.message + ')');
    return { ok: false, reason: e.message };
  }
}

// há uma versão preparada que veio deste instalador?
function ready(app, file) {
  const dir = appDir(app);
  if (!dir) return false;
  const mk = readMark(dir);
  return !!(mk && mk.file === file && valid(nextOf(dir)) && valid(dir));
}

// Chamar DEPOIS que o app terminou de fechar (evento 'quit'): troca as pastas e abre o app novo.
function swapAndStart(app, log) {
  const dir = trim(appDir(app));
  const nx = nextOf(dir); const old = oldOf(dir);
  const bat = [
    '@echo off',
    `set "D=${dir}"`, `set "N=${nx}"`, `set "O=${old}"`, 'set /a t=0',
    ':retry',
    'if exist "%O%" rmdir /s /q "%O%" >nul 2>&1',
    'move "%D%" "%O%" >nul 2>&1',
    'if not errorlevel 1 goto moved',
    'set /a t+=1',
    'if %t% geq 60 goto fail',
    'ping -n 2 127.0.0.1 >nul',
    'goto retry',
    ':moved',
    'move "%N%" "%D%" >nul 2>&1',
    'if errorlevel 1 goto undo',
    'robocopy "%O%" "%D%" /E /XC /XN /XO /R:0 /W:0 /NFL /NDL /NJH /NJS /NP >nul 2>&1', // traz o desinstalador e o que não veio no pacote
    'del /q "%D%\\' + MARK + '" >nul 2>&1',
    'start "" "%D%\\TT Note.exe" --updated',
    'rmdir /s /q "%O%" >nul 2>&1',
    'exit /b 0',
    ':undo',
    'move "%O%" "%D%" >nul 2>&1',
    ':fail',
    'start "" "%D%\\TT Note.exe"',
    'exit /b 1',
    '',
  ].join('\r\n');
  const f = path.join(os.tmpdir(), 'tt-note-swap.cmd');
  fs.writeFileSync(f, bat);
  try { log && log('rápida: trocando as pastas e abrindo a versão nova'); } catch { /* */ }
  spawn('cmd.exe', ['/c', f], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() }).unref();
}

// ao abrir: apaga restos (a pasta .old de uma troca anterior e uma .next que já não serve)
function cleanup(app) {
  try {
    const dir = appDir(app);
    if (!dir) return;
    fs.rmSync(oldOf(dir), { recursive: true, force: true });
    const mk = readMark(dir);
    const cmp = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
    if (fs.existsSync(nextOf(dir)) && (!mk || cmp(mk.version, app.getVersion()) <= 0)) fs.rmSync(nextOf(dir), { recursive: true, force: true });
  } catch { /* fica para a próxima */ }
}

module.exports = { prepare, ready, swapAndStart, cleanup, findPayload, appDir };
