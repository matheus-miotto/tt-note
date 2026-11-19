'use strict';
// Gerencia o servidor colaborativo neste computador, de dentro do app: prepara uma cópia do executável com outro nome
// ("TT Note Server.exe") + o código do servidor numa pasta própria, inicia em segundo plano, para, e liga a
// inicialização com o Windows. Como o processo do servidor NÃO se chama "TT Note.exe", atualizar o app não o derruba.
const { app, ipcMain, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const PD = process.env.ProgramData || app.getPath('userData');
const DATA = () => process.env.TT_SERVER_DATA || path.join(PD, 'TT Note Server');
const RT = () => process.env.TT_SERVER_RUNTIME || path.join(PD, 'TT Note Server Runtime');
const STARTUP = () => process.env.TT_SERVER_STARTUP || path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const EXE = () => path.join(RT(), 'TT Note Server.exe');
const RUNJS = () => path.join(RT(), 'app', 'server', 'run.js');
const VBS = () => path.join(STARTUP(), 'TT Note Server.vbs');
const RT_FILES = ['icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin']; // o mínimo que o Electron precisa para rodar como Node
const SERVER_FILES = ['core.js', 'index.js', 'backup.js', 'updates.js', 'run.js', 'linkpreview.js', 'poll.js'];
const SERVER_WEB_FILES = ['index.html', 'i18n.js'];

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const port = () => Number(readJson(path.join(DATA(), 'config.json'), {}).port) || 8787;

async function ping() {
  try {
    const r = await fetch(`http://127.0.0.1:${port()}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && j.app === 'TT Note Server' ? j : null;
  } catch { return null; }
}

async function status() {
  const j = await ping();
  const pidf = path.join(DATA(), 'server.pid');
  let pid = null;
  try { pid = Number(fs.readFileSync(pidf, 'utf8')) || null; } catch { /* sem pid */ }
  return {
    running: !!j, users: j ? !!j.users : null, port: port(), pid: j ? pid : null,
    hasData: fs.existsSync(path.join(DATA(), 'state.json')),
    prepared: fs.existsSync(EXE()) && fs.existsSync(RUNJS()),
    autostart: fs.existsSync(VBS()),
    dataDir: DATA(),
  };
}

// Copia o executável (uma vez, ou quando a versão do Electron muda) e SEMPRE o código do servidor (para pegar a versão nova)
async function prepare() {
  const rt = RT();
  await fsp.mkdir(path.join(rt, 'app', 'server'), { recursive: true });
  const meta = readJson(path.join(rt, 'runtime.json'), {});
  const srcDir = path.dirname(process.execPath);
  const need = !fs.existsSync(EXE()) || meta.electron !== process.versions.electron;
  if (need) {
    const tmp = EXE() + '.new';
    await fsp.copyFile(process.execPath, tmp);
    await fsp.rm(EXE(), { force: true });
    await fsp.rename(tmp, EXE());
    for (const f of RT_FILES) await fsp.copyFile(path.join(srcDir, f), path.join(rt, f));
    await fsp.writeFile(path.join(rt, 'runtime.json'), JSON.stringify({ electron: process.versions.electron }));
  }
  for (const f of SERVER_FILES) await fsp.writeFile(path.join(rt, 'app', 'server', f), await fsp.readFile(path.join(__dirname, 'server', f)));
  await fsp.mkdir(path.join(rt, 'app', 'server', 'web'), { recursive: true }); // página web do servidor (celular/navegador)
  for (const f of SERVER_WEB_FILES) await fsp.writeFile(path.join(rt, 'app', 'server', 'web', f), await fsp.readFile(path.join(__dirname, 'server', 'web', f)));
  await fsp.writeFile(path.join(rt, 'app', 'server', 'VERSION'), app.getVersion());
  return { copiedRuntime: need };
}

async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 300)); }
  return false;
}

async function start(opts = {}) {
  if ((await ping())) return { ...(await status()), already: true };
  const prep = await prepare();
  const st0 = await status();
  if (!st0.hasData && !(opts.adminName && opts.adminPass)) return { ...st0, error: 'Primeira vez: informe o nome e a senha do administrador' };
  fs.mkdirSync(DATA(), { recursive: true });
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (opts.adminName && opts.adminPass) { env.TT_ADMIN_NAME = String(opts.adminName); env.TT_ADMIN_PASS = String(opts.adminPass); }
  const child = spawn(EXE(), [RUNJS(), '--dir', DATA()], { detached: true, stdio: 'ignore', windowsHide: true, env });
  child.unref();
  const up = await waitFor(async () => !!(await ping()), 15000);
  const st = await status();
  return { ...st, copiedRuntime: prep.copiedRuntime, error: up ? null : 'O servidor não respondeu a tempo. Veja o registro (server.log) na pasta de dados.' };
}

// Publicação local: copia o instalador direto para a pasta de atualizações do servidor deste computador
async function publishLocal(file, version) {
  const updates = require('./server/updates');
  return updates.ingest(DATA(), file, version, false);
}
// Depois de uma atualização do app: se o servidor deste computador está rodando com código antigo, reinicia com o novo
async function restartServer() { await stop(); return start({}); }
async function restartIfStale() {
  const st = await status();
  if (!st.running) return;
  let v = '';
  try { v = fs.readFileSync(path.join(RT(), 'app', 'server', 'VERSION'), 'utf8').trim(); } catch { /* sem versão */ }
  if (v !== app.getVersion()) { await stop(); await start({}); } // sem VERSION também reinicia (cópia antiga)
}

async function stop() {
  const st = await status();
  if (!st.running) return { ...st, already: true };
  let key = '';
  try { key = fs.readFileSync(path.join(DATA(), 'server.key'), 'utf8'); } catch { /* sem chave */ }
  try { await fetch(`http://127.0.0.1:${st.port}/api/_shutdown`, { method: 'POST', headers: { 'X-Local-Key': key }, signal: AbortSignal.timeout(4000) }); } catch { /* cai para o pid */ }
  let down = await waitFor(async () => !(await ping()), 6000);
  if (!down && st.pid) { try { process.kill(st.pid); } catch { /* já saiu */ } down = await waitFor(async () => !(await ping()), 4000); }
  return { ...(await status()), error: down ? null : 'Não consegui parar o servidor' };
}

// Inicia junto com o Windows: um .vbs na pasta Inicializar (sem janela), apontando para a cópia — não depende da pasta do app
async function setAutostart(on) {
  if (!on) { await fsp.rm(VBS(), { force: true }); return status(); }
  await prepare();
  await fsp.mkdir(STARTUP(), { recursive: true });
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    'sh.Environment("Process")("ELECTRON_RUN_AS_NODE") = "1"',
    `sh.Run ${q(q(EXE()) + ' ' + q(RUNJS()) + ' --dir ' + q(DATA()))}, 0, False`,
    '',
  ].join('\r\n');
  await fsp.writeFile(VBS(), vbs);
  return status();
}

// Endereços para entrar no servidor: neste computador, na mesma rede e na VPN (Tailscale, faixa 100.64.0.0/10)
function addresses() {
  const p = port();
  const out = [{ label: 'Neste computador (para o seu próprio TT Note)', address: `127.0.0.1:${p}`, kind: 'local' }];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const vpn = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address) || /tailscale/i.test(name);
      out.push(vpn
        ? { label: 'Tailscale (VPN) — é o endereço para os colegas, de qualquer lugar', address: `${a.address}:${p}`, kind: 'vpn' }
        : { label: `Mesma rede (${name}) — só funciona para quem está no mesmo Wi-Fi/rede`, address: `${a.address}:${p}`, kind: 'lan' });
    }
  }
  return out;
}

function init() {
  ipcMain.handle('server:addresses', () => addresses());
  ipcMain.handle('server:status', () => status());
  ipcMain.handle('server:start', (_e, o) => start(o || {}).catch((e) => ({ error: e.message })));
  ipcMain.handle('server:stop', () => stop().catch((e) => ({ error: e.message })));
  ipcMain.handle('server:restart', async (_e, o) => { const s = await stop().catch((e) => ({ error: e.message })); if (s.error) return s; return start(o || {}).catch((e) => ({ error: e.message })); });
  ipcMain.handle('server:autostart', (_e, on) => setAutostart(!!on).catch((e) => ({ error: e.message })));
  ipcMain.handle('server:openData', () => { fs.mkdirSync(DATA(), { recursive: true }); return shell.openPath(DATA()); });
  ipcMain.handle('server:openLog', () => shell.openPath(path.join(DATA(), 'server.log')));
}

module.exports = { init, status, start, stop, publishLocal, restartIfStale, restartServer };
