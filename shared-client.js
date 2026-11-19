'use strict';
// Cliente dos servidores colaborativos (roda no processo principal do app). Pode haver VÁRIOS servidores ao mesmo tempo:
// guarda cada login, faz os pedidos HTTP (o renderizador não fala direto com a rede) e repassa os eventos em tempo real
// para as janelas, sempre com o id da conexão (`conn`).
const { app, ipcMain, safeStorage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const WATCHDOG_MS = Number(process.env.TT_SSE_WATCHDOG_MS) || 60000;
const HEADER_MS = Number(process.env.TT_SSE_HEADER_MS) || 15000;
const conns = new Map(); // id -> { id, url, name, label, token, user, connected, sseAbort, retry, retryTimer }
const file = () => path.join(app.getPath('userData'), 'shared.json');
const idOf = (url, name) => 'c' + crypto.createHash('sha1').update(url.toLowerCase() + '|' + String(name).toLowerCase()).digest('hex').slice(0, 8);

function load() {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return; }
  const list = Array.isArray(j.conns) ? j.conns : (j.url ? [j] : []); // formato antigo: um servidor só
  for (const c of list) {
    try {
      const token = c.enc ? safeStorage.decryptString(Buffer.from(c.token, 'base64')) : c.token;
      const id = c.id || idOf(c.url, c.name);
      conns.set(id, { id, url: c.url, name: c.name, label: c.label || '', token, user: c.user, connected: false, sseAbort: null, retry: 0, retryTimer: null });
    } catch { /* login que não deu para ler: pede de novo */ }
  }
}
function save() {
  try {
    if (!conns.size) { fs.rmSync(file(), { force: true }); return; }
    const enc = safeStorage.isEncryptionAvailable();
    fs.writeFileSync(file(), JSON.stringify({ conns: [...conns.values()].map((c) => ({ id: c.id, url: c.url, name: c.name, label: c.label, user: c.user, enc, token: enc ? safeStorage.encryptString(c.token).toString('base64') : c.token })) }));
  } catch { /* sem gravar o login */ }
}
const broadcast = (ev) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('srv:event', ev); };
const normUrl = (u) => {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
};
const info = (c) => ({ id: c.id, url: c.url, name: c.name, label: c.label, user: c.user, token: c.token, connected: c.connected });
const list = () => [...conns.values()].map(info);

// Estatísticas de latência por conexão (para o indicador do app): últimas 30 requisições
const statsOf = (c) => c.stats || (c.stats = { list: [], fails: 0, reconnects: 0, last: 0 });
function noteStat(c, ms, ok) {
  const st = statsOf(c);
  st.list.push({ ms, ok, at: Date.now() }); if (st.list.length > 30) st.list.shift();
  if (!ok) st.fails++;
  st.last = Date.now();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESET = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ECONNABORTED']); // conexão reaproveitada que já tinha morrido: o pedido nem chegou

async function request(id, method, p, body, raw) {
  const c = conns.get(id);
  if (!c) return { s: 401, j: { error: 'Entre no servidor primeiro' } };
  const isGet = method === 'GET';
  const tries = isGet ? 3 : 2; // GET: até 3 tentativas; envio: só repete se a conexão reaproveitada estava morta
  let last = null;
  for (let i = 0; i < tries; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(c.url + p, {
        method,
        headers: { Authorization: 'Bearer ' + c.token, ...(raw ? { 'Content-Type': raw.type } : body != null ? { 'Content-Type': 'application/json' } : {}) },
        body: raw ? Buffer.from(raw.data) : body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(raw ? 600000 : 25000),
      });
      let j = null;
      try { j = await r.json(); } catch { /* sem corpo */ }
      noteStat(c, Date.now() - t0, true);
      if (r.status === 401) { c.connected = false; broadcast({ type: 'conn', conn: id, ok: false, reason: 'login' }); }
      if (isGet && (r.status === 502 || r.status === 503 || r.status === 504) && i < tries - 1) { await sleep(500 * (i + 1)); continue; }
      return { s: r.status, j };
    } catch (e) {
      const code = e.cause && e.cause.code ? e.cause.code : e.message;
      noteStat(c, Date.now() - t0, false);
      last = { s: 0, j: { error: 'Sem conexão com o servidor (' + code + ')' } };
      const canRetry = i < tries - 1 && (isGet ? !raw : RESET.has(code));
      if (!canRetry) break;
      await sleep(isGet ? 400 * (i + 1) ** 2 : 150);
    }
  }
  return last;
}

async function startEvents(id) {
  const c = conns.get(id);
  if (!c) return;
  stopEvents(c);
  const ctl = new AbortController();
  c.sseAbort = ctl;
  c.lastRx = Date.now();
  let killed = ''; // quem derrubou: 'vigia' (sem dados) ou 'cabeçalho' (o servidor não respondeu a tempo)
  const t0 = Date.now(); let upAt = 0;
  ulog(`eventos: conectando em ${hostOf(c.url)} (tentativa ${c.retry + 1})`);
  // vigia: o servidor manda um sinal a cada 25 s; sem nada por 60 s a conexão morreu em silêncio (Wi-Fi, suspensão, túnel): refaz
  const wd = setInterval(() => { if (Date.now() - (c.lastRx || 0) > WATCHDOG_MS) { killed = 'vigia'; ctl.abort(); } }, Math.min(10000, Math.max(200, WATCHDOG_MS / 4)));
  const ht = setTimeout(() => { killed = 'cabeçalho'; ctl.abort(); }, HEADER_MS); // pedido que nem recebe resposta
  let why = '';
  try {
    const r = await fetch(c.url + '/api/events', { headers: { Authorization: 'Bearer ' + c.token }, signal: ctl.signal });
    clearTimeout(ht);
    if (r.status === 401) { clearInterval(wd); c.connected = false; ulog('eventos: login recusado (401)'); broadcast({ type: 'conn', conn: id, ok: false, reason: 'login' }); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    upAt = Date.now();
    ulog(`eventos: conectado em ${upAt - t0} ms (HTTP ${r.status}, ${r.headers.get('content-type') || '?'})`);
    c.connected = true; c.retry = 0;
    broadcast({ type: 'conn', conn: id, ok: true });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let first = true;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { why = 'o servidor encerrou a conexão'; break; }
      c.lastRx = Date.now();
      if (first) { first = false; ulog(`eventos: primeiros dados após ${c.lastRx - upAt} ms`); }
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const l of chunk.split('\n')) if (l.startsWith('data: ')) { try { broadcast({ ...JSON.parse(l.slice(6)), conn: id }); } catch { /* ignora */ } }
      }
    }
  } catch (e) { why = killed === 'vigia' ? `sem nenhum dado por ${Math.round(WATCHDOG_MS / 1000)} s (vigia)` : killed === 'cabeçalho' ? `sem resposta em ${Math.round(HEADER_MS / 1000)} s` : (e.cause && e.cause.code ? e.cause.code : e.message); } // cai para a reconexão
  clearInterval(wd); clearTimeout(ht);
  if ((ctl.signal.aborted && !killed) || !conns.has(id) || c.sseAbort !== ctl) return;
  ulog(`eventos: caiu${upAt ? ` depois de ${Math.round((Date.now() - upAt) / 1000)} s no ar` : ' antes de conectar'}: ${why}`);
  c.connected = false;
  statsOf(c).reconnects++;
  broadcast({ type: 'conn', conn: id, ok: false, reason: 'network' });
  c.retry = Math.min(c.retry + 1, 6);
  clearTimeout(c.retryTimer);
  const wait = Math.min(15000, 1000 * 2 ** (c.retry - 1)) + Math.random() * 400; // 1 s, 2 s, 4 s, 8 s, 15 s…
  c.retryTimer = setTimeout(() => startEvents(id), wait);
}
function stopEvents(c) { if (c.sseAbort) c.sseAbort.abort(); c.sseAbort = null; clearTimeout(c.retryTimer); }

/* ───────────── atualização do app pelo servidor (sem navegador, sem aviso do SmartScreen) ───────────── */
const cmpVer = (a, b) => {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
let hooks = { quit: () => app.quit() };
// Registro das atualizações (envio, consulta, download, instalação): update.log na pasta de dados do app. Nunca grava senha nem token.
const logFile = () => path.join(app.getPath('userData'), 'update.log');
const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u); } };
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
function ulog(...a) {
  try {
    const f = logFile();
    try { if (fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + '.old'); } catch { /* ainda não existe */ }
    fs.appendFileSync(f, `${new Date().toISOString()} [app ${app.getVersion()}] ${a.join(' ')}\n`);
  } catch { /* sem registro */ }
  try { require('./debuglog').log('atualização', a.join(' ')); } catch { /* sem debug */ }
}
// Consulta todos os servidores e fica com a versão mais nova publicada em qualquer um
async function checkUpdate() {
  if (!conns.size) return { ok: false, error: 'Entre em um servidor (☁ Compartilhado) para verificar atualizações' };
  const cur = app.getVersion();
  let best = null; let anyOk = false; let lastErr = '';
  for (const c of conns.values()) {
    const t0 = Date.now();
    const r = await request(c.id, 'GET', '/api/app/latest');
    if (r.s !== 200) { lastErr = (r.j && r.j.error) || 'Não consegui consultar o servidor'; ulog(`consulta: ${hostOf(c.url)} falhou (HTTP ${r.s}) ${lastErr}`); continue; }
    anyOk = true;
    ulog(`consulta: ${hostOf(c.url)} tem a versão ${r.j.version || '(nenhuma)'}${r.j.size ? ' (' + mb(r.j.size) + ')' : ''} · ${Date.now() - t0} ms`);
    if (r.j.version && (!best || cmpVer(r.j.version, best.version) > 0)) best = { version: r.j.version, size: r.j.size, sha256: r.j.sha256, conn: c.id };
  }
  if (!anyOk) return { ok: false, error: lastErr };
  if (!best) return { ok: true, available: false, current: cur, none: true };
  return { ok: true, available: cmpVer(best.version, cur) > 0, current: cur, ...best };
}
// Download do instalador. Se o servidor aceita "Range" (servidor atualizado): baixa em pedaços de 8 MB, 4 ao mesmo tempo,
// guarda o que já veio (retoma depois de uma queda, até depois de fechar o app) e refaz só o pedaço que falhou.
// Se não aceita (servidor antigo): uma conexão só, com vigia de travamento e novas tentativas.
const DL_CHUNK = 8 * 1024 * 1024;
const DL_PAR = 4;
const DL_STALL = Number(process.env.TT_DL_STALL_MS) || 20000; // sem receber nada por tanto tempo = travou
async function fetchStall(url, headers, stallMs) { // fetch + leitura inteira, abortando se travar
  const ctl = new AbortController();
  let timer = null; const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(new Error('travou (sem dados por ' + Math.round(stallMs / 1000) + ' s)')), stallMs); };
  arm();
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    return { r, ctl, arm, done: () => clearTimeout(timer) };
  } catch (e) { clearTimeout(timer); throw e; }
}
const stage = require('./app-stage');
// Depois de baixar e conferir, deixa a versão nova já extraída ao lado (o app continua aberto): reiniciar vira só trocar de pasta
async function downloadUpdate(opts) {
  const r = await downloadUpdateRaw(opts);
  if (r && r.ok && r.file) {
    broadcast({ type: 'update-progress', pct: 100, version: r.version, prep: true });
    const p = await stage.prepare(app, r.file, r.version, ulog);
    r.fast = !!p.ok;
  }
  return r;
}
async function downloadUpdateRaw(opts) {
  const bg = !!(opts && opts.background); // em segundo plano usa menos conexões (não atrapalha o chat)
  const inf = await checkUpdate();
  if (!inf.ok) return inf;
  if (!inf.available) return { ok: false, error: `Você já está na versão mais nova (${inf.current})` };
  const c = conns.get(inf.conn);
  const dir = path.join(app.getPath('temp'), 'TT Note Update');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `TT Note Setup ${inf.version}.exe`);
  const part = dest + '.part'; const metaF = dest + '.part.json';
  // já baixado antes (até em outra sessão do app) e inteiro: não baixa de novo
  try {
    if (fs.existsSync(dest) && (inf.size ? fs.statSync(dest).size === inf.size : true)) {
      let same = !inf.sha256;
      if (inf.sha256) { const h = crypto.createHash('sha256'); await new Promise((res, rej) => { const s2 = fs.createReadStream(dest); s2.on('data', (d) => h.update(d)); s2.on('end', res); s2.on('error', rej); }); same = h.digest('hex') === inf.sha256; }
      if (same) { ulog(`download: a versão ${inf.version} já estava baixada e confere; nada a baixar`); return { ok: true, file: dest, version: inf.version, already: true }; }
    }
  } catch { /* baixa de novo */ }
  const url = c.url + '/api/app/download';
  const auth = { Authorization: 'Bearer ' + c.token };
  const t0 = Date.now();
  ulog(`download: começando a versão ${inf.version} de ${hostOf(c.url)} (esperado ${inf.size ? mb(inf.size) : '?'}) para ${dest}`);
  let total = inf.size || 0;
  const prog = { got: 0, win: [] }; // janela para calcular a velocidade
  const report = (extra) => {
    const now = Date.now(); prog.win.push([now, prog.got]); while (prog.win.length > 1 && now - prog.win[0][0] > 6000) prog.win.shift();
    const w0 = prog.win[0]; const bps = now > w0[0] ? Math.round(((prog.got - w0[1]) * 1000) / (now - w0[0])) : 0;
    const pct = total ? Math.min(100, Math.floor((prog.got / total) * 100)) : 0;
    broadcast({ type: 'update-progress', pct, version: inf.version, got: prog.got, total, bps, ...(extra || {}) });
  };
  try {
    // 1) o servidor aceita Range? (pede só o primeiro byte)
    let ranged = false;
    try {
      const pr = await fetch(url, { headers: { ...auth, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(20000) });
      if (pr.status === 206) { const m = /\/(\d+)$/.exec(pr.headers.get('content-range') || ''); if (m) { total = Number(m[1]); ranged = true; } }
      try { await pr.arrayBuffer(); } catch { /* descarta */ }
    } catch (e) { ulog('download: sondagem de Range falhou (' + (e.cause && e.cause.code ? e.cause.code : e.message) + '); sigo com conexão única'); }

    if (ranged) {
      const nChunks = Math.ceil(total / DL_CHUNK);
      let done = new Set();
      try { // retomada: só vale para o mesmo instalador
        const m = JSON.parse(fs.readFileSync(metaF, 'utf8'));
        if (m.version === inf.version && m.total === total && m.sha256 === (inf.sha256 || '') && fs.existsSync(part) && fs.statSync(part).size === total) done = new Set(m.done || []);
      } catch { /* começa do zero */ }
      if (!done.size) { fs.rmSync(part, { force: true }); }
      const fd = fs.openSync(part, fs.existsSync(part) ? 'r+' : 'w+');
      if (fs.fstatSync(fd).size !== total) fs.ftruncateSync(fd, total);
      const saveMeta = () => { try { fs.writeFileSync(metaF, JSON.stringify({ version: inf.version, total, sha256: inf.sha256 || '', done: [...done] })); } catch { /* sem gravar */ } };
      const sizeOfChunk = (i) => Math.min(DL_CHUNK, total - i * DL_CHUNK);
      prog.got = [...done].reduce((a, i) => a + sizeOfChunk(i), 0);
      if (done.size) ulog(`download: retomando — ${done.size} de ${nChunks} pedaços já estão no disco (${mb(prog.got)})`);
      const par = bg ? 2 : DL_PAR;
      ulog(`download: servidor aceita Range; ${nChunks} pedaços de ${mb(DL_CHUNK)}, ${par} ao mesmo tempo${bg ? ' (segundo plano)' : ''}`);
      const todo = []; for (let i = 0; i < nChunks; i++) if (!done.has(i)) todo.push(i);
      let fatal = null; let lastRep = 0; let lastLog = -1;
      const worker = async () => {
        while (todo.length && !fatal) {
          const i = todo.shift(); const a = i * DL_CHUNK; const b = a + sizeOfChunk(i) - 1;
          let ok = false; let why = '';
          for (let at = 1; at <= 6 && !ok && !fatal; at++) {
            let got = 0; const bufs = []; let f = null;
            try {
              f = await fetchStall(url, { ...auth, Range: `bytes=${a}-${b}` }, DL_STALL);
              if (f.r.status !== 206) throw new Error('HTTP ' + f.r.status);
              const reader = f.r.body.getReader();
              for (;;) {
                const { done: d, value } = await reader.read();
                if (d) break;
                f.arm(); bufs.push(value); got += value.length; prog.got += value.length; // conta enquanto chega
                const now = Date.now(); if (now - lastRep > 400) { lastRep = now; report(); }
              }
              f.done();
              if (got !== b - a + 1) throw new Error(`pedaço incompleto (${got} de ${b - a + 1} bytes)`);
              const buf = Buffer.concat(bufs); let off = 0; while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off, a + off);
              ok = true;
            } catch (e) {
              if (f) f.done();
              prog.got -= got; // o que veio desse pedaço será baixado de novo
              why = e.cause && e.cause.code ? e.cause.code : (e.message || String(e));
              ulog(`download: pedaço ${i + 1}/${nChunks} falhou na tentativa ${at}/6 (${why})`);
              if (at < 6) await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** (at - 1))));
            }
          }
          if (!ok) { fatal = new Error(`o pedaço ${i + 1} falhou 6 vezes (${why})`); break; }
          done.add(i); saveMeta();
          const pct = Math.floor((prog.got / total) * 100);
          if (pct >= lastLog + 25) { lastLog = pct - (pct % 25); ulog(`download: ${pct}% (${mb(prog.got)}) · ${Math.round((Date.now() - t0) / 1000)} s`); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(par, todo.length) }, worker));
      try { fs.closeSync(fd); } catch { /* nada */ }
      if (fatal) { saveMeta(); throw fatal; } // o que já veio fica guardado para a próxima tentativa
      report();
    } else {
      // servidor sem Range: uma conexão, com vigia e até 4 tentativas (cada uma recomeça do zero)
      let lastErr = null; let okAll = false;
      for (let at = 1; at <= 4 && !okAll; at++) {
        prog.got = 0; prog.win = [];
        try {
          const f = await fetchStall(url, auth, DL_STALL);
          if (!f.r.ok) throw new Error('HTTP ' + f.r.status);
          total = Number(f.r.headers.get('content-length')) || total;
          ulog(`download: servidor respondeu HTTP ${f.r.status}, tamanho ${total ? mb(total) : 'desconhecido'} (sem Range: conexão única${at > 1 ? ', tentativa ' + at : ''})`);
          const out = fs.createWriteStream(part);
          const reader = f.r.body.getReader(); let lastLog = -1; let lastRep = 0;
          try {
            for (;;) {
              const { done: d, value } = await reader.read();
              if (d) break;
              f.arm();
              if (!out.write(value)) await new Promise((res) => out.once('drain', res));
              prog.got += value.length;
              const now = Date.now(); if (now - lastRep > 400) { lastRep = now; report(); }
              const pct = total ? Math.floor((prog.got / total) * 100) : 0;
              if (pct >= lastLog + 25) { lastLog = pct - (pct % 25); ulog(`download: ${pct}% (${mb(prog.got)}) · ${Math.round((Date.now() - t0) / 1000)} s`); }
            }
          } finally { f.done(); await new Promise((res) => out.end(res)); }
          if (total && prog.got !== total) throw new Error(`veio incompleto (${mb(prog.got)} de ${mb(total)})`);
          okAll = true; report();
        } catch (e) {
          lastErr = e.cause && e.cause.code ? e.cause.code : (e.message || String(e));
          ulog(`download: tentativa ${at}/4 falhou (${lastErr})`);
          if (at < 4) await new Promise((r) => setTimeout(r, 1500 * at));
        }
      }
      if (!okAll) throw new Error(lastErr || 'falhou');
    }

    // 2) conferência do arquivo inteiro
    const hash = crypto.createHash('sha256');
    await new Promise((res, rej) => { const s = fs.createReadStream(part); s.on('data', (d) => hash.update(d)); s.on('end', res); s.on('error', rej); });
    const sum = hash.digest('hex');
    if (inf.sha256 && sum !== inf.sha256) {
      fs.rmSync(part, { force: true }); fs.rmSync(metaF, { force: true });
      ulog(`download: FALHOU a conferência (SHA-256 diferente; recebido ${mb(prog.got)}, esperado ${total ? mb(total) : '?'}); descartei o arquivo`);
      return { ok: false, error: 'O arquivo baixado não confere com o do servidor. Tente de novo.' };
    }
    fs.rmSync(dest, { force: true });
    fs.renameSync(part, dest); fs.rmSync(metaF, { force: true });
    ulog(`download: concluído, ${mb(total || prog.got)} em ${Math.round((Date.now() - t0) / 1000)} s, conferência SHA-256 ok`);
    return { ok: true, file: dest, version: inf.version };
  } catch (e) {
    const why = e.cause && e.cause.code ? e.cause.code : e.message;
    ulog(`download: FALHOU depois de ${Math.round((Date.now() - t0) / 1000)} s: ${why}${fs.existsSync(metaF) ? ' (o que já veio fica guardado; ao tentar de novo continua de onde parou)' : ''}`);
    if (!fs.existsSync(metaF)) { try { fs.rmSync(part, { force: true }); } catch { /* nada */ } }
    return { ok: false, error: 'Falha ao baixar a atualização: ' + why + (fs.existsSync(metaF) ? '. Tente de novo: continua de onde parou.' : '') };
  }
}
// Fecha o app pelo caminho normal (guarda rascunhos e a sessão) e só então abre o instalador em silêncio; ele reabre o app sozinho
function installUpdate(f) {
  if (!f || !fs.existsSync(f)) { ulog('instalação: instalador não encontrado ' + f); return { ok: false, error: 'Instalador não encontrado' }; }
  const fast = stage.ready(app, f);
  if (process.env.TT_UPDATE_DRYRUN) return { ok: true, dryRun: true, fast, args: ['/S', '--updated', '--force-run'] };
  if (fast) { // versão já extraída: o app fecha e as pastas são trocadas (poucos segundos)
    ulog(`instalação rápida: o app vai fechar e a pasta nova entra no lugar`);
    app.once('quit', () => { try { stage.swapAndStart(app, ulog); } catch (e) { ulog('instalação rápida falhou (' + e.message + '); abrindo o instalador'); try { spawn(f, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* */ } } });
    hooks.quit();
    return { ok: true, fast: true };
  }
  ulog(`instalação: o app vai fechar e abrir ${f} em modo silencioso`);
  app.once('quit', () => {
    try { spawn(f, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { ulog('instalação: não consegui abrir o instalador: ' + e.message); }
  });
  hooks.quit();
  return { ok: true };
}

// Envio em partes de 8 MB com retomada: guarda o progresso no servidor (identificador fixo para o mesmo arquivo), repete a parte que falhar
// e, se a conexão cair, continua de onde parou. Servidor antigo (sem essa rota) cai para o envio de uma vez só.
const CHUNK = 8 * 1024 * 1024;
async function publishChunked(target, f, version, size, t0) {
  const st = fs.statSync(f);
  const id = crypto.createHash('sha1').update(`${st.size}|${Math.round(st.mtimeMs)}|${version}|${path.basename(f)}`).digest('hex').slice(0, 24);
  const q = `upload=${id}`;
  let r = await request(target.id, 'GET', `/api/app/publish-status?${q}`);
  if (r.s === 404 || r.s === 405) { ulog('envio: o servidor não conhece o envio em partes (versão antiga); usando o envio de uma vez'); return null; }
  if (r.s !== 200) { const err = (r.j && r.j.error) || (r.s === 0 ? 'Sem conexão com o servidor' : 'Erro ' + r.s); ulog(`envio: não consegui começar (HTTP ${r.s}) ${err}`); return { ok: false, error: err }; }
  let offset = r.j.received || 0;
  if (offset > st.size) offset = 0;
  ulog(`envio em partes: id ${id}, partes de ${mb(CHUNK)}${offset ? `, RETOMANDO de ${mb(offset)}` : ''}`);
  broadcast({ type: 'publish-progress', pct: Math.floor((offset / st.size) * 100), version, sent: offset, total: st.size, resumed: offset > 0 });
  const fd = fs.openSync(f, 'r');
  let lastPct = -1; let fails = 0;
  try {
    while (offset < st.size) {
      const len = Math.min(CHUNK, st.size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      const t1 = Date.now();
      const c = await request(target.id, 'POST', `/api/app/publish-chunk?${q}&offset=${offset}`, null, { type: 'application/octet-stream', data: buf });
      if (c.s === 200) { offset += len; fails = 0; const pct = Math.floor((offset / st.size) * 100); broadcast({ type: 'publish-progress', pct, version, sent: offset, total: st.size }); lastPct = pct; if (pct % 20 === 0) ulog(`envio em partes: ${pct}% (${mb(offset)}) · parte em ${Date.now() - t1} ms · ${Math.round((Date.now() - t0) / 1000)} s no total`); continue; }
      if (c.s === 409 && c.j && Number.isInteger(c.j.received)) { ulog(`envio em partes: o servidor tem ${mb(c.j.received)}; ajustando para continuar de lá`); offset = c.j.received; continue; }
      if (c.s === 401 || c.s === 403 || c.s === 413 || c.s === 400) { const err = (c.j && c.j.error) || 'Erro ' + c.s; ulog(`envio em partes: recusado (HTTP ${c.s}) ${err}`); return { ok: false, error: err }; }
      fails++;
      const why = (c.j && c.j.error) || 'HTTP ' + c.s;
      ulog(`envio em partes: a parte em ${mb(offset)} falhou (${why}), tentativa ${fails} de 6`);
      if (fails >= 6) return { ok: false, error: `O envio parou em ${Math.floor((offset / st.size) * 100)}% (${why}). Tente de novo: ele continua de onde parou.` };
      await new Promise((res) => setTimeout(res, Math.min(8000, 1000 * 2 ** (fails - 1))));
      const s2 = await request(target.id, 'GET', `/api/app/publish-status?${q}`); // reconfirma onde o servidor está
      if (s2.s === 200) offset = s2.j.received || 0;
    }
  } finally { fs.closeSync(fd); }
  broadcast({ type: 'publish-progress', pct: 100, version, sent: st.size, total: st.size, phase: 'finishing' }); // o servidor confere o arquivo e publica
  const fin = await request(target.id, 'POST', `/api/app/publish-finish?${q}&version=${encodeURIComponent(version)}&size=${st.size}`, null, { type: 'application/octet-stream', data: Buffer.alloc(0) });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (fin.s === 200) { ulog(`envio em partes: concluído em ${secs} s (servidor guardou ${fin.j && fin.j.size ? mb(fin.j.size) : '?'})`); return { ok: true, mode: 'remote', version, conn: target.id }; }
  const err = (fin.j && fin.j.error) || 'Erro ' + fin.s;
  ulog(`envio em partes: FALHOU ao publicar depois de ${secs} s: HTTP ${fin.s} ${err}`);
  return { ok: false, error: err };
}
// Publica o instalador: no servidor deste computador (cópia direta) e/ou enviando pela conexão escolhida
async function publishUpdate(f, version, connId) {
  if (!f || !fs.existsSync(f)) return { ok: false, error: 'Escolha o arquivo do instalador' };
  version = version || (path.basename(f).match(/(\d+\.\d+\.\d+)/) || [])[1];
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) return { ok: false, error: 'Informe a versão no formato 1.20.2' };
  const target = conns.get(connId) || [...conns.values()].find((c) => c.user && c.user.role === 'admin') || [...conns.values()][0];
  if (!target) return { ok: false, error: 'Entre no servidor como administrador primeiro' };
  const t0 = Date.now();
  const size = fs.statSync(f).size;
  ulog(`envio: publicar a versão ${version} (${mb(size)}, ${path.basename(f)}) em ${hostOf(target.url)} como ${target.user ? target.user.name + ' (' + target.user.role + ')' : '?'}`);
  const mgr = require('./server-manager');
  // 1) servidor neste mesmo computador: copia direto para a pasta de atualizações (sem limite de tamanho da rede/túnel)
  try {
    if ((await mgr.status()).running) {
      ulog('envio: há um servidor rodando neste computador; tentando copiar direto');
      await mgr.publishLocal(f, version);
      let chk = await request(target.id, 'GET', '/api/app/latest');
      if (chk.s === 404) { ulog('envio: servidor com código antigo (404 em /api/app/latest); reiniciando'); await mgr.restartServer(); chk = await request(target.id, 'GET', '/api/app/latest'); } // servidor rodando com código antigo: reinicia com o novo
      if (chk.s === 200 && chk.j.version === version) { ulog(`envio: concluído por cópia local em ${Date.now() - t0} ms`); return { ok: true, mode: 'local', version, conn: target.id }; }
      ulog(`envio: a cópia local não apareceu no servidor escolhido (HTTP ${chk.s}, versão ${chk.j && chk.j.version}); seguindo para o envio pela rede`);
    }
  } catch (e) { ulog('envio: cópia local falhou: ' + e.message); if (e.status === 400) return { ok: false, error: e.message }; }
  // 2) servidor em outro computador: envia pela conexão (precisa ser administrador)
  const chunked = await publishChunked(target, f, version, size, t0);
  if (chunked) return chunked;
  ulog(`envio: enviando ${mb(size)} pela rede para ${hostOf(target.url)} (limite de espera 10 min)`);
  const buf = fs.readFileSync(f);
  const r = await request(target.id, 'POST', `/api/app/publish?version=${encodeURIComponent(version)}`, null, { type: 'application/octet-stream', data: buf });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (r.s === 200) { ulog(`envio: concluído pela rede em ${secs} s (servidor guardou ${r.j && r.j.size ? mb(r.j.size) : '?'})`); return { ok: true, mode: 'remote', version, conn: target.id }; }
  const err = (r.j && r.j.error) || (r.s === 0 ? 'Sem conexão com o servidor' : r.s === 404 ? 'O servidor está com uma versão antiga do programa. Reinicie-o (Arquivo → Servidor neste computador → Reiniciar) e tente de novo.' : 'Erro ' + r.s);
  ulog(`envio: FALHOU depois de ${secs} s: HTTP ${r.s} ${err}`);
  return { ok: false, error: err + (r.s === 413 || r.s === 524 ? ' — o túnel pode estar limitando o tamanho; com o servidor no mesmo computador ou pela VPN funciona' : '') };
}

function init(h) {
  if (h) hooks = { ...hooks, ...h };
  load();
  ipcMain.handle('srv:list', () => list());
  ipcMain.handle('srv:login', async (_e, url, name, password, label) => {
    url = normUrl(url);
    if (!url) return { ok: false, error: 'Informe o endereço do servidor' };
    try {
      const r = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: j.error || 'Não consegui entrar' };
      const id = idOf(url, j.user.name);
      const old = conns.get(id);
      if (old) stopEvents(old);
      const c = { id, url, name: j.user.name, label: label || (old && old.label) || '', token: j.token, user: j.user, connected: false, sseAbort: null, retry: 0, retryTimer: null };
      conns.set(id, c);
      save();
      startEvents(id);
      return { ok: true, conn: info(c) };
    } catch (e) {
      return { ok: false, error: 'Não consegui falar com o servidor (' + (e.cause && e.cause.code ? e.cause.code : e.message) + '). Confira o endereço e se o Tailscale está ligado.' };
    }
  });
  ipcMain.handle('srv:logout', async (_e, id) => {
    const c = conns.get(id);
    if (c) { try { await request(id, 'POST', '/api/logout'); } catch { /* sem rede */ } stopEvents(c); conns.delete(id); save(); }
    return list();
  });
  ipcMain.handle('srv:label', (_e, id, label) => { const c = conns.get(id); if (c) { c.label = String(label || '').slice(0, 40); save(); } return list(); });
  ipcMain.handle('srv:req', (_e, id, method, p, body) => request(id, method, p, body));
  ipcMain.handle('srv:upload', (_e, id, pid, name, type, data) => request(id, 'POST', `/api/projects/${encodeURIComponent(pid)}/files?name=${encodeURIComponent(name)}`, null, { type: type || 'application/octet-stream', data }));
  ipcMain.handle('srv:uploadSticker', (_e, id, name, type, data) => request(id, 'POST', `/api/stickers?name=${encodeURIComponent(name)}`, null, { type: type || 'image/png', data }));
  ipcMain.handle('update:openLog', async () => { try { fs.appendFileSync(logFile(), ''); } catch { /* ainda sem log */ } return require('electron').shell.openPath(logFile()); });
  ipcMain.handle('update:check', () => checkUpdate());
  setTimeout(() => stage.cleanup(app), 15000);
  ipcMain.handle('update:download', (_e, opts) => downloadUpdate(opts));
  ipcMain.handle('update:install', (_e, f) => installUpdate(f));
  ipcMain.handle('update:publish', (_e, f, version, connId) => publishUpdate(f, version, connId).catch((e) => ({ ok: false, error: e.message })));
  ipcMain.handle('srv:retry', (_e, id, force) => { const c = conns.get(id); if (c && (force || !c.connected)) { c.retry = 0; startEvents(id); } return list(); });
  ipcMain.handle('srv:stats', (_e, id) => { const c = conns.get(id); if (!c) return null; const st = statsOf(c); const ok = st.list.filter((x) => x.ok).map((x) => x.ms); const sorted = [...ok].sort((a, b) => a - b); return { last: ok.length ? ok[ok.length - 1] : 0, avg: ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0, worst: sorted.length ? sorted[sorted.length - 1] : 0, n: st.list.length, fails: st.list.filter((x) => !x.ok).length, reconnects: st.reconnects, connected: c.connected, at: st.last }; });
  try { require('electron').powerMonitor.on('resume', () => { for (const c of conns.values()) { c.retry = 0; startEvents(c.id); } }); } catch { /* sem monitor de energia */ } // o PC acordou: as conexões antigas estão mortas
  for (const c of conns.values()) startEvents(c.id);
}

module.exports = { init };
