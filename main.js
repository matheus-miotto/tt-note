const mainlang = require('./mainlang');
const { tm } = mainlang;
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage, screen, Tray, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { existsSync, statSync, readFileSync, writeFileSync, renameSync } = require('fs');

/* ── codificação de arquivos (manuais .txt do Windows costumam ser ANSI/Windows-1252) ── */
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), enc: 'utf8bom' };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), enc: 'utf16le' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), enc: 'win1252' };
  }
}
function decodeAs(buf, enc) {
  if (enc === 'win1252') return { text: new TextDecoder('windows-1252').decode(buf), enc };
  if (enc === 'utf16le') return { text: (buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2) : buf).toString('utf16le'), enc };
  const b = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  return { text: b.toString('utf8'), enc };
}
const CP1252_REV = new Map();
{
  const dec = new TextDecoder('windows-1252');
  for (let b = 0x80; b <= 0x9f; b++) CP1252_REV.set(dec.decode(Buffer.from([b])), b);
}
// Retorna Buffer, ou null se o texto tiver caracteres que não existem em Windows-1252.
function encodeText(text, enc) {
  if (enc === 'utf8bom') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  if (enc === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  if (enc === 'win1252') {
    const bytes = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
      else if (CP1252_REV.has(ch)) bytes.push(CP1252_REV.get(ch));
      else return null;
    }
    return Buffer.from(bytes);
  }
  return Buffer.from(text, 'utf8');
}

// Windows: identifica o app pelo mesmo ID do instalador (appId). Sem isso, o botão fixado na barra de tarefas é ligado a outro ID
// e se perde quando o instalador recria os atalhos numa atualização.
if (process.platform === 'win32') app.setAppUserModelId('br.matheus.ttnote');

const IGNORE = new Set(['node_modules', '.git', '.obsidian', '.trash', '$RECYCLE.BIN']);
const TEXT_MAX = 1024 * 1024;
const DEFAULTS = {
  fontSize: 14,
  fontFamily: "Consolas, 'Courier New', monospace",
  tabSize: 4,
  insertSpaces: true,
  wordWrap: true,
  theme: 'tt-dark',
  canvasFont: '',
  canvasFontSize: 15,
  canvasPasteMode: 'auto',
  translateAllowed: false, // já confirmou que o texto selecionado pode ir ao serviço de tradução online?
  translateEnabled: true,
  newTabType: 'md', // tipo das novas guias sem título: md (Markdown) ou txt (texto)
  notifyMentions: false,
  hardwareAcceleration: true, // false = sem placa de vídeo (menos memória; vale ao reabrir o app)
  autoUpdate: true, // verifica e baixa a atualização sozinho; só instala quando você clicar
  autoUpdateDelayMs: 20000,
  drawWhitespace: 'selection',
  spellcheck: true,
  noteHotkey: 'Control+Alt+N',
  keepInTray: false,
  gitWrap: true,
  minimap: false,
  livePreview: true,
  autoSave: false,
  tabBar: false,
  hotExit: true,
  formatIndent: 2,
  sqlKeywordCase: 'preserve', // preserve = mantém como está escrito; MAIÚSCULAS / minúsculas em Preferências
  autoLogOnPaste: true,
  debugMode: false,
  language: '', // idioma do aplicativo: pt-BR, en, es ou pt-PT (vazio = o do Windows)
  sqlDialect: '',
  autoWrapWidth: 0,
  autoWrapRulers: [72, 80],
  autoWrapFiles: ['COMMIT_EDITMSG', 'MERGE_MSG', 'TAG_EDITMSG', '*.gitcommit'],
  dailyFolder: 'Daily',
  keybindings: {},
};

// (usado só para testes: perfil separado, sem mexer nas configurações nem na instância em uso)
if (process.env.TT_USER_DATA) app.setPath('userData', process.env.TT_USER_DATA);
if (process.env.TT_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.TT_DEBUG_PORT);

// Modo servidor: "TT Note.exe --servidor [--admin Nome Senha] [--port 8787] [--dir pasta]" roda o servidor colaborativo sem janela
// (usa o Node embutido do app). Tem dados e trava de instância próprios, então convive com o app normal no mesmo computador.
const SERVER_MODE = process.argv.includes('--servidor');
if (SERVER_MODE && !process.env.TT_USER_DATA) app.setPath('userData', path.join(app.getPath('appData'), 'TT Note Server App'));
require('./debuglog').init(app, ipcMain); // modo debug: depois do userData e antes dos ipcMain.handle (para registrar as chamadas que falham)
// Opção "Aceleração de vídeo" (Preferências): desligada, o app não usa a placa de vídeo e gasta ~50 MB a menos de memória (precisa abrir o app de novo)
try { if (!SERVER_MODE && JSON.parse(readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).hardwareAcceleration === false) app.disableHardwareAcceleration(); } catch { /* sem configuração: mantém ligada */ }
function runServer() {
  const fsSync = require('fs');
  const args = process.argv.slice(process.argv.indexOf('--servidor') + 1);
  const { main: serverMain, parseArgs } = require('./server');
  const o = parseArgs(args);
  const dir = o.dir || path.join(process.env.ProgramData || app.getPath('userData'), 'TT Note Server');
  fsSync.mkdirSync(dir, { recursive: true });
  const logf = path.join(dir, 'server.log');
  const log = (...a) => { try { fsSync.appendFileSync(logf, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch { /* sem log */ } };
  console.log = log; console.error = log;
  serverMain(['--dir', dir, ...args.filter((a, i) => !(a === '--dir' || args[i - 1] === '--dir'))])
    .then((srv) => { if (!srv) app.quit(); })
    .catch((e) => { log('ERRO: ' + e.message); app.exit(1); });
}

let win;
let forceClose = false;
let quitAfter = false; // "Sair" pedido pelo usuário (fecha também as notas flutuantes)
let pendingQuit = false;
let quitting = false;

// Instância única: abrir outro arquivo com o app já aberto manda o arquivo para a janela existente.
const argFiles = (argv, cwd) => argv
  .slice(app.isPackaged ? 1 : 2)
  .filter((a) => !a.startsWith('-'))
  .map((a) => path.resolve(cwd, a))
  .filter((p) => existsSync(p));
let launchFiles = argFiles(process.argv, process.cwd());
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv, cwd) => {
  const files = argFiles(argv, cwd);
  if (!win || win.isDestroyed()) { launchFiles = files; createWindow(); return; }
  showMain();
  if (files.length) win.webContents.send('app:open-files', files);
});
ipcMain.handle('app:launchFiles', () => {
  const f = launchFiles;
  launchFiles = [];
  return f;
});
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

// Tamanho, posição e "maximizada" da janela: lembrados entre sessões (só se ainda couberem em alguma tela)
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
let savedMaximized = false;
function initialBounds() {
  const def = { width: 1280, height: 800 };
  try {
    const b = JSON.parse(readFileSync(boundsFile(), 'utf8'));
    savedMaximized = !!b.maximized;
    const visible = screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y < w.y + w.height - 80 && b.y + b.height > w.y + 40;
    });
    if (b.width >= 600 && b.height >= 400 && visible) return { x: b.x, y: b.y, width: b.width, height: b.height };
    if (b.width >= 600 && b.height >= 400) return { width: b.width, height: b.height };
  } catch {}
  return def;
}
function saveBounds() {
  try {
    if (!win || win.isDestroyed()) return;
    writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {}
}
let boundsTimer;
const saveBoundsSoon = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 600); };

function createWindow() {
  forceClose = false;
  win = new BrowserWindow({
    ...initialBounds(),
    backgroundColor: '#282c34',
    title: 'TT Note',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // em segundo plano os timers (salvar rascunhos, diferenças) seguem no ritmo normal
    },
  });
  Menu.setApplicationMenu(null);
  if (savedMaximized) win.maximize();
  win.on('resize', saveBoundsSoon);
  win.on('move', saveBoundsSoon);
  win.loadFile('index.html');

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (input.key === 'F5') win.webContents.reload();
  });
  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    pendingQuit = quitAfter; quitAfter = false;
    win.webContents.send('app:closing');
  });
  win.on('closed', () => { if (quitting) app.quit(); });
}

// quantas vezes o app foi fechado (a janela de apoio aparece a cada 10)
const usageFile = () => path.join(app.getPath('userData'), 'usage.json');
const readUsage = () => { try { return JSON.parse(readFileSync(usageFile(), 'utf8')); } catch { return {}; } };
const writeUsage = (u) => { try { writeFileSync(usageFile(), JSON.stringify(u)); } catch { /* sem gravar */ } };
function countClose() { const u = readUsage(); u.closes = (u.closes || 0) + 1; writeUsage(u); }
ipcMain.handle('app:supportDue', () => {
  const u = readUsage(); const turns = Math.floor((u.closes || 0) / 10);
  if (turns > (u.shown || 0)) { u.shown = turns; writeUsage(u); return true; }
  return false;
});
ipcMain.handle('translate:text', (_e, text, to) => require('./translate').translate(text, to));
ipcMain.handle('app:lang', (_e, l) => { mainlang.setLang(l); try { if (tray) tray.setContextMenu(trayMenu()); } catch { /* sem bandeja */ } return mainlang.getLang(); });
app.whenReady().then(() => {
  if (SERVER_MODE) { runServer(); return; }
  try { const c = readCfg(); mainlang.setLang(c.language || mainlang.detect(app.getLocale())); } catch { /* idioma padrão */ }
  // nada das notas compartilhadas (imagens, arquivos) fica guardado neste PC: limpa o cache de rede ao abrir e ao fechar
  try { require('electron').session.defaultSession.clearCache().catch(() => {}); } catch { /* sem cache a limpar */ }
  createWindow(); startNotes(); require('./shared-client').init({ quit: quitApp }); require('./server-manager').init();
  setTimeout(() => require('./server-manager').restartIfStale().catch(() => {}), 4000); // se o servidor deste PC estiver rodando com código mais antigo que o app (ex.: depois de atualizar), reinicia com o novo
});
app.on('window-all-closed', () => { if (!quitting && readCfg().keepInTray) return; app.quit(); });
let closeCounted = false;
app.on('before-quit', () => { if (!closeCounted && !SERVER_MODE) { closeCounted = true; countClose(); } quitting = true; writeNotes(); try { if (!SERVER_MODE) require('electron').session.defaultSession.clearCache().catch(() => {}); } catch { /* nada */ } });
app.on('will-quit', () => globalShortcut.unregisterAll());

/* ───────────── notas flutuantes (como as Notas Autoadesivas) ───────────── */
const readCfg = () => { try { return JSON.parse(readFileSync(settingsPath(), 'utf8')); } catch { return {}; } };
const notesFile = () => path.join(app.getPath('userData'), 'notes.json');
const NOTE_COLORS = ['#e5c07b', '#61afef', '#98c379', '#e06c75', '#c678dd', '#d19a66', '#56b6c2'];
let notes = []; // { id, text, color, pinned, open, x, y, width, height }
const noteWins = new Map();
let notesTimer;
let tray;
function loadNotes() { try { const a = JSON.parse(readFileSync(notesFile(), 'utf8')); if (Array.isArray(a)) notes = a; } catch {} }
function writeNotes() {
  clearTimeout(notesTimer);
  try { const f = notesFile(); writeFileSync(f + '.tmp', JSON.stringify(notes, null, 1)); renameSync(f + '.tmp', f); } catch {}
}
const saveNotesSoon = () => { clearTimeout(notesTimer); notesTimer = setTimeout(writeNotes, 300); };
const noteById = (id) => notes.find((n) => n.id === id);

function showMain() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function quitApp() {
  quitAfter = true;
  if (win && !win.isDestroyed()) win.close();
  else { quitting = true; app.quit(); }
}

function noteBounds(n) {
  const w = n.width || 300;
  const h = n.height || 260;
  if (typeof n.x === 'number' && typeof n.y === 'number') {
    const ok = screen.getAllDisplays().some((d) => { const a = d.workArea; return n.x < a.x + a.width - 40 && n.x + w > a.x + 40 && n.y < a.y + a.height - 30 && n.y + h > a.y; });
    if (ok) return { x: n.x, y: n.y, width: w, height: h };
  }
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const k = (noteWins.size % 8) * 28;
  return { x: a.x + a.width - w - 40 - k, y: a.y + 60 + k, width: w, height: h };
}

function createNoteWindow(n) {
  const old = noteWins.get(n.id);
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return; }
  n.open = true;
  const w = new BrowserWindow({
    ...noteBounds(n),
    minWidth: 180, minHeight: 110,
    frame: false, skipTaskbar: !!n.pinned, alwaysOnTop: !!n.pinned, // solta do topo → ganha botão na barra de tarefas (para sempre achar)
   
    backgroundColor: '#282c34', title: 'Nota',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  noteWins.set(n.id, w);
  w.loadFile('note.html', { query: { id: n.id } });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const keep = () => { if (w.isDestroyed()) return; Object.assign(n, w.getBounds()); saveNotesSoon(); };
  w.on('move', keep);
  w.on('resize', keep);
  w.on('close', () => { if (!quitting && noteById(n.id)) { n.open = false; saveNotesSoon(); } });
  w.on('closed', () => noteWins.delete(n.id));
  saveNotesSoon();
}

function newNote(text = '') {
  const n = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, color: NOTE_COLORS[notes.length % NOTE_COLORS.length], pinned: true, open: true, created: Date.now() };
  notes.push(n);
  createNoteWindow(n);
  return n.id;
}
function toggleNotes() {
  const wins = [...noteWins.values()].filter((w) => !w.isDestroyed());
  if (wins.some((w) => w.isVisible())) { for (const w of wins) w.hide(); return; }
  for (const n of notes) if (n.open) createNoteWindow(n);
  for (const w of noteWins.values()) if (!w.isDestroyed()) w.show();
}

function trayMenu() {
  const title = (t) => ((t || '').split('\n').find((l) => l.trim()) || tm('(vazia)')).replace(/^[#>\-*\s[\]x]+/i, '').slice(0, 40) || tm('(vazia)');
  const items = notes.map((n) => ({ label: (n.pinned ? '📌 ' : '') + title(n.text), click: () => createNoteWindow(n) }));
  return Menu.buildFromTemplate([
    { label: tm('Nova nota flutuante'), click: () => newNote('') },
    { label: tm('Mostrar / ocultar notas'), click: toggleNotes },
    ...(items.length ? [{ label: tm('Notas ({0})', items.length), submenu: items.slice(-30).reverse() }] : []),
    { label: tm('Abrir o TT Note'), click: showMain },
    { type: 'separator' },
    { label: tm('Sair'), click: quitApp },
  ]);
}

function startNotes() {
  loadNotes();
  for (const n of notes) if (n.open) createNoteWindow(n);
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
    tray.setToolTip('TT Note');
    tray.setContextMenu(trayMenu());
    tray.on('right-click', () => { tray.setContextMenu(trayMenu()); tray.popUpContextMenu(); });
    tray.on('click', showMain);
  } catch {}
  try { globalShortcut.register(readCfg().noteHotkey || 'Control+Alt+N', () => newNote('')); } catch {}
}

ipcMain.handle('note:get', (_e, id) => { const n = noteById(id); return n ? { id: n.id, text: n.text, color: n.color, pinned: !!n.pinned } : null; });
ipcMain.handle('note:save', (_e, id, text) => { const n = noteById(id); if (n) { n.text = String(text); n.updated = Date.now(); saveNotesSoon(); } });
ipcMain.handle('note:set', (_e, id, patch) => {
  const n = noteById(id);
  if (!n) return;
  if (typeof patch.color === 'string') n.color = patch.color;
  if (typeof patch.pinned === 'boolean') { n.pinned = patch.pinned; const w = noteWins.get(id); if (w && !w.isDestroyed()) w.setAlwaysOnTop(n.pinned); w.setSkipTaskbar(n.pinned); }
  saveNotesSoon();
});
ipcMain.handle('note:hide', (_e, id) => { const w = noteWins.get(id); if (w && !w.isDestroyed()) w.close(); });
ipcMain.handle('note:delete', async (_e, id) => {
  const n = noteById(id);
  if (!n) return false;
  const w = noteWins.get(id);
  const r = await dialog.showMessageBox(w && !w.isDestroyed() ? w : win, { type: 'warning', message: tm('Apagar esta nota?'), detail: (n.text || '').trim().slice(0, 120) || tm('(vazia)'), buttons: [tm('Apagar'), tm('Cancelar')], defaultId: 1, cancelId: 1, noLink: true });
  if (r.response !== 0) return false;
  notes = notes.filter((x) => x.id !== id);
  writeNotes();
  if (w && !w.isDestroyed()) w.close();
  return true;
});
ipcMain.handle('notes:new', (_e, text) => newNote(typeof text === 'string' ? text : ''));
ipcMain.handle('notes:list', () => notes.map((n) => ({ id: n.id, text: n.text, color: n.color, pinned: !!n.pinned, open: !!n.open })));
ipcMain.handle('notes:open', (_e, id) => { const n = noteById(id); if (n) createNoteWindow(n); });
ipcMain.handle('notes:toggle', () => toggleNotes());
ipcMain.handle('app:showMain', () => showMain());
// Build (Ctrl+B): roda o comando num processo à parte e manda a saída para o painel, linha a linha
const buildProcs = new Map();
ipcMain.handle('build:run', (_e, { id, cmd, cwd }) => {
  const { spawn } = require('child_process');
  const full = process.platform === 'win32' ? `chcp 65001>nul & ${cmd}` : cmd; // saída em UTF-8 no cmd.exe
  const child = spawn(full, { shell: true, cwd: cwd || undefined, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', FORCE_COLOR: '0' } });
  buildProcs.set(id, child);
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
  child.stdout.on('data', (d) => send('build:data', { id, kind: 'out', text: d.toString('utf8') }));
  child.stderr.on('data', (d) => send('build:data', { id, kind: 'err', text: d.toString('utf8') }));
  child.on('error', (e) => send('build:data', { id, kind: 'err', text: e.message + '\n' }));
  child.on('close', (code, sig) => { buildProcs.delete(id); send('build:end', { id, code, sig }); });
  return { pid: child.pid };
});
ipcMain.handle('build:stop', (_e, id) => {
  const c = buildProcs.get(id);
  if (!c) return false;
  try { if (process.platform === 'win32') require('child_process').spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true }); else c.kill('SIGTERM'); } catch { /* já terminou */ }
  return true;
});
ipcMain.handle('link:preview', async (_e, url) => { try { return await require('./server/linkpreview').fetchPreview(String(url || ''), { allowPrivate: !!process.env.TT_LINKPREVIEW_PRIVATE }); } catch { return null; } }); // prévia de links feita aqui no PC (não depende do servidor)
ipcMain.handle('spell:dict', async () => { // dicionários Hunspell (português e inglês) para o corretor do editor
  const rt = (f) => fs.readFile(path.join(__dirname, 'dict', f), 'utf8');
  const rb = (f) => fs.readFile(path.join(__dirname, 'dict', f));
  const [pa, pd, ea, ed] = await Promise.all([rt('pt-BR.aff'), rb('pt-BR.bin'), rt('en.aff'), rb('en.bin')]);
  return { pt: { aff: pa, dic: new Uint8Array(pd.buffer, pd.byteOffset, pd.byteLength) }, en: { aff: ea, dic: new Uint8Array(ed.buffer, ed.byteOffset, ed.byteLength) } };
});
ipcMain.handle('app:fullscreen', (_e, on) => { if (win && !win.isDestroyed()) win.setFullScreen(!!on); }); // modo sem distração
ipcMain.handle('app:devtools', () => { if (win && !win.isDestroyed()) win.webContents.toggleDevTools(); }); // console do desenvolvedor
// "Chamar atenção" (como o MSN): pisca na barra de tarefas e treme a janela. Janela maximizada não dá para mover: devolve 'css' e o app treme por dentro.
ipcMain.handle('app:shake', () => {
  if (!win || win.isDestroyed()) return 'none';
  try { win.flashFrame(true); } catch { /* sem piscar */ }
  if (win.isMinimized() || !win.isVisible()) return 'flash';
  if (win.isMaximized() || win.isFullScreen()) return 'css';
  const b = win.getBounds();
  const seq = [-12, 12, -10, 10, -8, 8, -6, 6, -4, 4, -2, 2];
  let i = 0;
  const t = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(t); return; }
    if (i >= seq.length) { clearInterval(t); win.setBounds(b); return; }
    win.setPosition(b.x + seq[i], b.y + (i % 2 ? 5 : -5));
    i++;
  }, 40);
  return 'window';
});

ipcMain.handle('app:about', () => dialog.showMessageBox(win, {
  type: 'none',
  title: 'TT Note',
  icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'about.png')),
  message: tm('Editor de texto criado pelo Matheus. Agilidade e organização em um só lugar.'),
  detail: tm('Versão {0}', app.getVersion()),
  buttons: ['OK'],
  noLink: true,
}));
// "Novidades": o histórico de versões vem do novidades.json que vai dentro do app
ipcMain.handle('app:news', async () => {
  try { return JSON.parse(await fs.readFile(path.join(__dirname, 'novidades.json'), 'utf8')); } catch { return []; }
});
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:flags', () => ({ noNews: !!process.env.TT_NO_NEWS })); // (testes: não abrir a janela sozinha)
ipcMain.handle('app:quit', () => quitApp()); // passa pelo aviso de "não salvo"
ipcMain.handle('app:forceClose', () => {
  forceClose = true;
  if (pendingQuit) quitting = true;
  saveBounds();
  win.close();
});

ipcMain.handle('settings:get', async () => {
  const p = settingsPath();
  let text;
  try {
    text = await fs.readFile(p, 'utf8');
  } catch {
    text = JSON.stringify(DEFAULTS, null, 2) + '\n';
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, text);
  }
  return { path: p, text, defaults: DEFAULTS };
});

ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:saveAs', async (_e, defaultPath) => {
  const r = await dialog.showSaveDialog(win, { defaultPath });
  return r.canceled ? null : r.filePath;
});

/* ── exportar a guia para PDF e Word (.docx) ── */
ipcMain.handle('export:pick', async (_e, name, kind) => {
  const filters = kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'Documento do Word', extensions: ['docx'] }];
  const safe = String(name || 'guia').replace(/[\\/:*?"<>|]/g, '-');
  if (process.env.TT_EXPORT_DIR) return path.join(process.env.TT_EXPORT_DIR, `${safe}.${kind}`); // gancho de teste: sem caixa de diálogo
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${safe}.${kind}`), filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('export:write', async (_e, p, bytes) => { await fs.writeFile(p, Buffer.from(bytes)); if (!process.env.TT_EXPORT_DIR) shell.showItemInFolder(p); return true; });
// Lê uma imagem para o Word: arquivo local (caminho absoluto, file: ou relativo à pasta da guia), data: ou http(s)
ipcMain.handle('export:image', async (_e, src, baseDir) => {
  try {
    src = String(src || '');
    const MAX = 30 * 1024 * 1024;
    if (/^data:/i.test(src)) {
      const m = src.match(/^data:([^;,]*)(;base64)?,(.*)$/is);
      if (!m) return { ok: false };
      return { ok: true, data: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])) };
    }
    if (/^https?:/i.test(src)) {
      const r = await fetch(src, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return { ok: false };
      const b = Buffer.from(await r.arrayBuffer());
      return b.length > MAX ? { ok: false } : { ok: true, data: b };
    }
    let p = src;
    if (/^file:/i.test(src)) p = require('url').fileURLToPath(src);
    else { p = decodeURI(src); if (!path.isAbsolute(p) && baseDir) p = path.join(baseDir, p); }
    const st = await fs.stat(p);
    if (!st.isFile() || st.size > MAX) return { ok: false };
    return { ok: true, data: await fs.readFile(p) };
  } catch { return { ok: false }; }
});
// PDF: abre o HTML numa janela escondida (sem scripts), espera as imagens carregarem e imprime em A4
ipcMain.handle('export:pdf', async (_e, html, outPath) => {
  const tmp = path.join(app.getPath('temp'), `ttnote-export-${Date.now()}.html`);
  let w = null;
  try {
    await fs.writeFile(tmp, html, 'utf8');
    w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
    await Promise.race([
      new Promise((res, rej) => { w.webContents.once('did-finish-load', res); w.webContents.once('did-fail-load', (_ev, _c, d) => rej(new Error(d))); w.loadFile(tmp); }),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('As imagens demoraram demais para carregar')), 45000)),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(outPath, pdf);
    if (!process.env.TT_EXPORT_DIR) shell.showItemInFolder(outPath);
    return { ok: true, size: pdf.length };
  } catch (e) { return { ok: false, error: e.message }; } finally {
    try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* nada */ }
    try { await fs.rm(tmp, { force: true }); } catch { /* nada */ }
  }
});
ipcMain.handle('dialog:ask', async (_e, message, buttons) => {
  const r = await dialog.showMessageBox(win, {
    type: 'question', message, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true,
  });
  return r.response;
});
ipcMain.handle('fs:mkdir', (_e, p) => fs.mkdir(p, { recursive: true }));
ipcMain.handle('fs:trash', (_e, p) => shell.trashItem(p));
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

/* ── importar do Sublime Text e do Obsidian (somente leitura) ── */
// JSON "solto" do Sublime: aceita comentários // e /* */ e vírgulas sobrando.
function stripJsonc(src) {
  let out = '', inStr = false, i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
// "/C/Users/x/arq.md" (formato do Sublime no Windows) -> "C:\Users\x\arq.md"
const sublimePath = (p) => {
  const m = p.match(/^\/([A-Za-z])\/(.*)$/);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p.replace(/\//g, '\\');
};

ipcMain.handle('import:sublime', async () => {
  // Sublime Text 4 usa "Sublime Text"; o 3 usa "Sublime Text 3": escolhe a pasta com a sessão mais recente
  const newest = (b) => {
    let t = 0;
    for (const n of ['Auto Save Session.sublime_session', 'Session.sublime_session']) {
      const f = path.join(b, 'Local', n);
      if (existsSync(f)) t = Math.max(t, statSync(f).mtimeMs);
    }
    return t;
  };
  const bases = ['Sublime Text', 'Sublime Text 3'].map((n) => path.join(app.getPath('appData'), n)).filter(existsSync);
  const base = bases.sort((a, b) => newest(b) - newest(a))[0] || path.join(app.getPath('appData'), 'Sublime Text');
  const out = { found: existsSync(base), tabs: [], prefs: {}, recentFiles: [], recentFolders: [], projects: [] };
  if (!out.found) return out;
  const local = path.join(base, 'Local');
  const cands = ['Auto Save Session.sublime_session', 'Session.sublime_session']
    .map((n) => path.join(local, n)).filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs); // a mais recente
  if (cands.length) {
    out.sessionFile = cands[0];
    const s = JSON.parse(await fs.readFile(cands[0], 'utf8'));
    const norm = (x) => x.replace(/\r\n/g, '\n');
    for (const w of s.windows || []) {
      const bufs = w.buffers || [];
      for (const g of w.groups || []) {
        for (const sh of g.sheets || []) {
          const b = bufs[sh.buffer];
          if (!b) continue;
          const sel = sh.settings && sh.settings.selection && sh.settings.selection[0];
          const t = { selection: sel ? sel[1] : 0, eol: /windows/i.test((b.settings && b.settings.line_ending) || '') ? 'crlf' : 'lf' };
          if (b.file) {
            t.file = sublimePath(b.file);
            if (!existsSync(t.file)) { t.missing = true; t.contents = b.contents || ''; t.name = path.basename(t.file); }
            else if (typeof b.contents === 'string') {
              let disk = '';
              try { disk = decode(await fs.readFile(t.file)).text; } catch {}
              if (norm(disk) !== norm(b.contents)) t.contents = b.contents; // alterações que estavam sem salvar
            }
          } else {
            t.contents = b.contents || '';
            t.name = (b.settings && b.settings.name) || '';
          }
          out.tabs.push(t);
        }
      }
    }
    out.recentFiles = (s.file_history || []).map(sublimePath).filter(existsSync).slice(0, 40);
    out.recentFolders = (s.folder_history || []).map(sublimePath).filter(existsSync).slice(0, 20);
  }
  const pf = path.join(base, 'Packages', 'User', 'Preferences.sublime-settings');
  if (existsSync(pf)) {
    try {
      const p = JSON.parse(stripJsonc(await fs.readFile(pf, 'utf8')));
      if (p.font_size) out.prefs.fontSize = Math.round((p.font_size * 96) / 72); // pt -> px
      if (p.tab_size) out.prefs.tabSize = p.tab_size;
      if (typeof p.translate_tabs_to_spaces === 'boolean') out.prefs.insertSpaces = p.translate_tabs_to_spaces;
      if (typeof p.word_wrap === 'boolean') out.prefs.wordWrap = p.word_wrap;
      if (p.font_face) out.prefs.fontFamily = `'${p.font_face}', Consolas, monospace`;
    } catch {}
  }
  // AutoWrap do Sublime: largura e réguas (ex.: Git Commit.sublime-settings com rulers [72, 80])
  for (const n of ['Git Commit.sublime-settings', 'Preferences.sublime-settings']) {
    const f = path.join(base, 'Packages', 'User', n);
    if (!existsSync(f)) continue;
    try {
      const p = JSON.parse(stripJsonc(await fs.readFile(f, 'utf8')));
      if (Array.isArray(p.rulers) && p.rulers.length && !out.prefs.autoWrapRulers) out.prefs.autoWrapRulers = p.rulers;
      const w = p.auto_wrap_width || (n.startsWith('Git') ? p.wrap_width : 0);
      if (w && !out.prefs.autoWrapWidth) out.prefs.autoWrapWidth = w;
    } catch {}
  }
  // projetos do Sublime (.sublime-project) na Área de Trabalho e em Documentos
  const found = [];
  const walk = async (d, depth) => {
    if (depth > 3 || found.length > 30) return;
    let ents;
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name.endsWith('.sublime-project')) found.push(p);
    }
  };
  for (const r of [app.getPath('desktop'), app.getPath('documents')]) await walk(r, 0);
  for (const f of found) {
    try {
      const j = JSON.parse(stripJsonc(await fs.readFile(f, 'utf8')));
      const folders = (j.folders || []).map((x) => path.resolve(path.dirname(f), x.path || '.')).filter(existsSync);
      if (folders.length) out.projects.push({ name: path.basename(f, '.sublime-project'), file: f, folders });
    } catch {}
  }
  return out;
});

// Abas que estavam abertas no Obsidian (podem ser do cofre ou arquivos externos "file:C:/...").
async function obsidianOpenFiles(vault) {
  try {
    const w = JSON.parse(await fs.readFile(path.join(vault, '.obsidian', 'workspace.json'), 'utf8'));
    const files = [];
    (function walk(n) {
      if (!n) return;
      const f = n.state && n.state.state && n.state.state.file;
      if (typeof f === 'string') files.push(f);
      (n.children || []).forEach(walk);
    })(w.main);
    const abs = [];
    for (const f of files) {
      const p = f.startsWith('file:') ? f.slice(5).replace(/\//g, '\\') : path.join(vault, f);
      if (existsSync(p) && !abs.includes(p) && !/\.(png|jpe?g|gif|webp|pdf|svg)$/i.test(p)) abs.push(p);
    }
    return abs;
  } catch { return []; }
}

ipcMain.handle('import:obsidian', async () => {
  const out = { vaults: [] };
  let j;
  try { j = JSON.parse(await fs.readFile(path.join(app.getPath('appData'), 'obsidian', 'obsidian.json'), 'utf8')); } catch { return out; }
  for (const v of Object.values(j.vaults || {})) {
    if (!v.path || !existsSync(v.path)) continue;
    out.vaults.push({ path: v.path, name: path.basename(v.path), open: !!v.open, ts: v.ts || 0, openFiles: await obsidianOpenFiles(v.path) });
  }
  out.vaults.sort((a, b) => b.ts - a.ts);
  return out;
});

ipcMain.handle('fs:tree', async (_e, root) => {
  let count = 0;
  async function walk(dir) {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes = [];
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      if (++count > 20000) break;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) nodes.push({ name: e.name, path: p, dir: true, children: await walk(p) });
      else nodes.push({ name: e.name, path: p, dir: false });
    }
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return nodes;
  }
  return { name: path.basename(root), path: root, dir: true, children: await walk(root) };
});

ipcMain.handle('fs:read', (_e, p) => fs.readFile(p, 'utf8'));
// Lê detectando a codificação (ou forçando uma) e o tipo de quebra de linha.
ipcMain.handle('fs:readFile', async (_e, p, forceEnc) => {
  const buf = await fs.readFile(p);
  const r = forceEnc ? decodeAs(buf, forceEnc) : decode(buf);
  r.eol = r.text.includes('\r\n') ? 'crlf' : 'lf';
  return r;
});
// Grava na codificação pedida; devolve a codificação realmente usada (cai para UTF-8 se não couber em ANSI).
ipcMain.handle('fs:write', async (_e, p, text, enc = 'utf8') => {
  let buf = encodeText(text, enc);
  if (!buf) { enc = 'utf8'; buf = Buffer.from(text, 'utf8'); }
  await fs.mkdir(path.dirname(p), { recursive: true }); // cria as pastas (ex.: grupos de abas)
  await fs.writeFile(p, buf);
  return enc;
});
ipcMain.handle('fs:exists', (_e, p) => existsSync(p));

// Rascunhos e alterações não salvas (como o "hot exit" do Sublime): gravados na pasta de dados do app.
const draftsPath = () => path.join(app.getPath('userData'), 'drafts.json');
ipcMain.handle('drafts:load', async () => {
  try { return JSON.parse(await fs.readFile(draftsPath(), 'utf8')); } catch { return []; }
});
let draftsBackedUp = false;
ipcMain.handle('drafts:save', async (_e, list) => {
  const p = draftsPath();
  if (!draftsBackedUp) { // proteção: guarda a sessão anterior antes da 1ª gravação desta abertura
    draftsBackedUp = true;
    try { if (existsSync(p)) await fs.copyFile(p, p + '.prev'); } catch {}
  }
  if (!list.length) { try { await fs.unlink(p); } catch {} return; }
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(list)); // grava num temporário e troca: não corrompe se o app fechar no meio
  await fs.rename(tmp, p);
});
ipcMain.handle('fs:isDir', async (_e, p) => {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
});
ipcMain.handle('dialog:openFiles', async (_e, kind) => {
  if (process.env.TT_TEST_PICK && kind === 'installer') return [process.env.TT_TEST_PICK]; // gancho de teste: sem caixa de diálogo
  const guess = [app.getPath('downloads'), app.getPath('desktop')].find((d) => existsSync(d)) || app.getPath('desktop');
  const r = await dialog.showOpenDialog(win, {
    properties: kind === 'installer' ? ['openFile'] : ['openFile', 'multiSelections'],
    defaultPath: kind === 'installer' ? guess : app.getPath('desktop'),
    filters: [
      ...(kind === 'installer' ? [{ name: tm('Instalador do TT Note (.exe)'), extensions: ['exe'] }] : []),
      ...(kind === 'image' ? [{ name: tm('Imagens'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }] : kind === 'note' ? [{ name: tm('Notas'), extensions: ['md', 'markdown', 'txt'] }] : []),
      { name: tm('Todos os arquivos'), extensions: ['*'] },
      { name: tm('Texto e código'), extensions: ['txt', 'md', 'markdown', 'json', 'xml', 'html', 'css', 'js', 'csv', 'log', 'yml', 'yaml', 'sql', 'ini'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});
// Imagem colada (Ctrl+V): grava na pasta de anexos (ou na pasta do app, se não houver projeto) sem sobrescrever nada
ipcMain.handle('img:save', async (_e, dir, name, data) => {
  const base = dir || path.join(app.getPath('userData'), 'imagens-coladas');
  await fs.mkdir(base, { recursive: true });
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length).replace(/[\\/:*?"<>|]/g, '-');
  let p = path.join(base, stem + ext);
  for (let n = 2; existsSync(p); n++) p = path.join(base, `${stem} (${n})${ext}`);
  await fs.writeFile(p, Buffer.from(data));
  return p;
});
ipcMain.handle('fs:create', async (_e, p, text) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  try {
    await fs.writeFile(p, text, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
});

ipcMain.handle('fs:rename', async (_e, from, to) => {
  try {
    await fs.access(to);
    return false;
  } catch {}
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return true;
});

ipcMain.handle('fs:mdAll', async (_e, root) => {
  const out = [];
  async function walk(dir) {
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith('.') || out.length >= 5000) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(md|markdown)$/i.test(e.name)) {
        try {
          const st = await fs.stat(p);
          if (st.size <= TEXT_MAX) out.push({ path: p, text: decode(await fs.readFile(p)).text });
        } catch {}
      }
    }
  }
  await walk(root);
  return out;
});

ipcMain.handle('fs:search', async (_e, root, query, caseSensitive) => {
  const out = [];
  const q = caseSensitive ? query : query.toLowerCase();
  async function walk(dir) {
    if (out.length >= 500) return;
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      try {
        const st = await fs.stat(p);
        if (st.size > TEXT_MAX) continue;
        const buf = await fs.readFile(p);
        if (buf.subarray(0, 1024).includes(0)) continue;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length && out.length < 500; i++) {
          const l = caseSensitive ? lines[i] : lines[i].toLowerCase();
          if (l.includes(q)) out.push({ path: p, line: i + 1, text: lines[i].trim().slice(0, 200) });
        }
      } catch {}
    }
  }
  await walk(root);
  return out;
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});
