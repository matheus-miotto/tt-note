'use strict';
// Modo debug: quando ligado (Configurações → "Modo debug"), grava em userData/logs/debug.log os erros do app (processo principal, janelas,
// chamadas internas que falham e avisos de erro) até ser desligado. Nunca grava o conteúdo das notas, senhas ou tokens.
const fs = require('fs');
const path = require('path');

let on = false;
let dir = '';
let appRef = null;
const MAX = 5 * 1024 * 1024;
const SENSITIVE = /pass|senha|token|auth|login|secret|cred/i;

const file = () => path.join(dir, 'debug.log');
const folder = () => dir;
const enabled = () => on;

function write(line) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = file();
    try { if (fs.statSync(f).size > MAX) fs.renameSync(f, f + '.old'); } catch { /* ainda não existe */ }
    fs.appendFileSync(f, `${new Date().toISOString()} ${line}\n`);
  } catch { /* sem registro */ }
}

function log(src, msg) {
  if (!on) return;
  write(`[${src}] ${String(msg).slice(0, 4000)}`);
}

function header(why) {
  let os = '';
  try { os = `${process.platform} ${require('os').release()} · Electron ${process.versions.electron} · ${appRef.getLocale()}`; } catch { /* sem dados */ }
  write(`[debug] ${why} · TT Note ${appRef.getVersion()} · ${os}`);
}

function setEnabled(v) {
  v = !!v;
  if (v === on) return;
  if (v) { on = true; header('modo debug LIGADO'); } else { write('[debug] modo debug DESLIGADO'); on = false; }
}

// resumo seguro dos argumentos de uma chamada interna (caminhos curtos aparecem; textos longos/de várias linhas viram só o tamanho)
function brief(a) {
  if (typeof a === 'string') return a.length > 260 || /[\r\n]/.test(a) ? `[texto ${a.length} car.]` : JSON.stringify(a);
  if (a == null || typeof a === 'number' || typeof a === 'boolean') return String(a);
  if (a && (a.byteLength != null)) return `[binário ${a.byteLength} bytes]`;
  if (Array.isArray(a)) return `[lista ${a.length}]`;
  return '[objeto]';
}

function init(app, ipcMain) {
  appRef = app;
  dir = path.join(app.getPath('userData'), 'logs');
  try { on = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).debugMode === true; } catch { on = false; }
  if (on) header('app iniciado com o modo debug ligado');

  // chamadas internas (renderer → main) que falham
  const orig = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (ch, fn) => orig(ch, async (...a) => {
    try { return await fn(...a); } catch (e) {
      if (on) log('ipc', `${ch} falhou: ${(e && e.message) || e}` + (SENSITIVE.test(ch) ? '' : ` · args: ${a.slice(1).map(brief).join(', ')}`));
      throw e;
    }
  });

  process.on('uncaughtExceptionMonitor', (e) => log('erro', (e && e.stack) || e));
  process.on('unhandledRejection', (e) => log('promessa', (e && e.stack) || e));
  app.on('render-process-gone', (_e, wc, d) => log('janela', `processo da janela encerrou: ${d && d.reason} (código ${d && d.exitCode})`));
  app.on('child-process-gone', (_e, d) => log('processo', `${d.type} encerrou: ${d.reason} (código ${d.exitCode})`));
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (a, level, message, line, source) => {
      // Electron novo entrega um objeto único; o antigo entrega (evento, nível, texto, linha, origem)
      if (a && typeof a.message === 'string') { level = a.level; message = a.message; line = a.lineNumber; source = a.sourceId; }
      const lv = typeof level === 'string' ? level : ['verbose', 'info', 'warning', 'error'][level] || 'info';
      if (lv === 'warning' || lv === 'error') log('console-' + lv, `${message} (${String(source || '').split(/[\\/]/).pop()}:${line})`);
    });
    wc.on('did-fail-load', (_ev, code, desc, url) => log('janela', `falha ao carregar ${String(url).slice(0, 120)}: ${desc} (${code})`));
    wc.on('unresponsive', () => log('janela', 'janela parou de responder'));
  });

  ipcMain.handle('debug:set', (_e, v) => { setEnabled(v); return on ? file() : ''; });
  ipcMain.handle('debug:log', (_e, src, msg) => { log(String(src || 'app').slice(0, 20), msg); });
  ipcMain.handle('debug:open', async (_e, what) => {
    const { shell } = require('electron');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* já existe */ }
    if (what === 'file') { try { fs.appendFileSync(file(), ''); } catch { /* sem arquivo */ } return shell.openPath(file()); }
    return shell.openPath(dir);
  });
}

module.exports = { init, log, enabled, setEnabled, file, folder };
