'use strict';
// Servidor colaborativo do TT Note: API HTTP (JSON) + eventos em tempo real (SSE) + anexos.
// Uso:  node server/index.js [--dir pasta] [--port 8787] [--host 0.0.0.0] [--admin Nome Senha]
//       TT Note.exe --servidor [mesmas opções]        (usa o Node embutido do app, sem instalar nada)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Core, HttpError } = require('./core');
const backup = require('./backup');
const updates = require('./updates');

const JSON_LIMIT = 2 * 1024 * 1024;
const WEB_FILE = path.join(__dirname, 'web', 'index.html');
const WEB_LANG = path.join(__dirname, 'web', 'i18n.js'); // idiomas da página web

function startServer(opts = {}) {
  const dir = opts.dir || process.env.TT_SERVER_DATA || path.join(process.env.ProgramData || process.cwd(), 'TT Note Server');
  fs.mkdirSync(dir, { recursive: true });
  const localKey = crypto.randomBytes(24).toString('hex'); // só para o app parar o servidor local com calma (não sai da máquina)
  const cfgFile = path.join(dir, 'config.json');
  let cfg = { port: 8787, host: '0.0.0.0', maxFileMB: 200, backup: null };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch { fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); }
  if (opts.port) cfg.port = opts.port;
  if (opts.host) cfg.host = opts.host;
  const core = new Core(dir);
  if (opts.admin && !core.hasUsers()) core.createUser(null, { name: opts.admin[0], password: opts.admin[1], role: 'admin' });
  const sse = new Set();

  // Quem está online = quem tem a conexão de eventos aberta (o app/aba aberto). Avisa todo mundo quando muda.
  const onlineIds = () => [...new Set([...sse].map((c) => c.user.id))];
  const presence = () => { const data = `data: ${JSON.stringify({ type: 'presence', online: onlineIds() })}\n\n`; for (const c of sse) c.res.write(data); };
  core.on('event', (ev) => {
    for (const c of sse) {
      if (ev.to) { if (c.user.id === ev.to) c.res.write(`data: ${JSON.stringify(ev)}\n\n`); continue; } // evento só para uma pessoa (chamar atenção)
      if (!ev.pid || core.canSee(c.user, ev.pid)) c.res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
  });

  const send = (res, status, body, headers = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body === undefined ? { ok: true } : body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > JSON_LIMIT) { reject(new HttpError(413, 'Pedido grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'JSON inválido')); } });
    req.on('error', reject);
  });

  // Endereço de quem está acessando. Pelo Tailscale Serve/Funnel todas as conexões chegam de 127.0.0.1; nesse caso (e só nesse)
  // vale o endereço que o próprio proxy anexou ao final de X-Forwarded-For (o que vem antes pode ser inventado pelo cliente).
  const clientIp = (req) => {
    const peer = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return peer;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop();
    const ing = String(req.headers['tailscale-ingress-src'] || '').trim().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const c = xff || ing;
    return c && /^[0-9a-fA-F:.]{2,45}$/.test(c) ? c : peer;
  };
  const tokenOf = (req, url) => {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('t') || '';
  };

  // Publicar o instalador do app (só administrador): chega em partes, vai para um arquivo temporário e vira a versão mais nova
  // Tudo sobre atualizações do app vai para o server.log com o prefixo [atualização] (quem, de onde, tamanhos, tempos, erros)
  const ulog = (...a) => console.log('[atualização]', ...a);
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  async function publishUpdate(req, res, user, url) {
    const version = String(url.searchParams.get('version') || '');
    const t0 = Date.now(); const ip = clientIp(req);
    const declared = Number(req.headers['content-length'] || 0);
    ulog(`recebimento: ${user.name} (${ip}) quer publicar a versão ${version || '(sem versão)'}, tamanho declarado ${declared ? mb(declared) : 'desconhecido'}`);
    try {
      return await publishUpdateInner(req, res, user, url, version, t0, ip);
    } catch (e) {
      ulog(`recebimento: FALHOU depois de ${Math.round((Date.now() - t0) / 1000)} s: ${e.status || ''} ${e.message}`);
      throw e;
    }
  }
  async function publishUpdateInner(req, res, user, url, version, t0, ip) {
    if (!updates.VERSION_RE.test(version)) throw new HttpError(400, 'Versão inválida (use o formato 1.19.2)');
    const max = 600 * 1024 * 1024;
    if (Number(req.headers['content-length'] || 0) > max) throw new HttpError(413, 'Instalador maior que 600 MB');
    const ud = updates.dirOf(dir);
    fs.mkdirSync(ud, { recursive: true });
    const tmp = path.join(ud, `.upload-${Date.now()}.part`);
    let size = 0; let nextLog = 25 * 1024 * 1024;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      req.on('data', (c) => { size += c.length; if (size >= nextLog) { ulog(`recebimento: ${mb(size)} recebidos · ${Math.round((Date.now() - t0) / 1000)} s`); nextLog += 25 * 1024 * 1024; } if (size > max) { reject(new HttpError(413, 'Instalador maior que 600 MB')); req.destroy(); out.destroy(); } });
      req.on('aborted', () => reject(new HttpError(499, `conexão interrompida por quem enviava (chegaram ${mb(size)})`)));
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    }).catch((e) => { try { fs.unlinkSync(tmp); } catch { /* nada */ } throw e; });
    let info;
    try { info = await updates.ingest(dir, tmp, version, true); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* nada */ } throw e; }
    ulog(`recebimento: concluído, versão ${version}, ${mb(info.size)} em ${Math.round((Date.now() - t0) / 1000)} s, SHA-256 ${String(info.sha256 || '').slice(0, 12)}…`);
    core.audit(user, 'app.publish', { version, size: info.size });
    core.notify({ type: 'app', version });
    send(res, 200, info);
  }


  // Envio do instalador em partes (retomável): cada parte é anexada ao arquivo temporário .upload-<id>.part, no deslocamento certo.
  // Se a conexão cair, o app pergunta quanto já chegou (publish-status) e continua dali; no fim, publish-finish publica a versão.
  const UPLOAD_ID_RE = /^[a-f0-9]{16,40}$/;
  const CHUNK_MAX = 16 * 1024 * 1024;
  const partOf = (id) => path.join(updates.dirOf(dir), `.upload-${id}.part`);
  const partSize = (id) => { try { return fs.statSync(partOf(id)).size; } catch { return 0; } };
  function uploadId(url) {
    const id = String(url.searchParams.get('upload') || '');
    if (!UPLOAD_ID_RE.test(id)) throw new HttpError(400, 'Identificador de envio inválido');
    return id;
  }
  function cleanOldParts() {
    try { for (const f of fs.readdirSync(updates.dirOf(dir))) if (/^\.upload-.*\.part$/.test(f)) { const p = path.join(updates.dirOf(dir), f); if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(p); } } catch { /* nada a limpar */ }
  }
  async function publishChunk(req, res, user, url) {
    const id = uploadId(url);
    const offset = Number(url.searchParams.get('offset'));
    const len = Number(req.headers['content-length'] || 0);
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'Deslocamento inválido');
    if (!len) throw new HttpError(400, 'Parte vazia');
    if (len > CHUNK_MAX) throw new HttpError(413, 'Parte maior que 16 MB');
    if (offset + len > 600 * 1024 * 1024) throw new HttpError(413, 'Instalador maior que 600 MB');
    fs.mkdirSync(updates.dirOf(dir), { recursive: true });
    if (offset === 0) cleanOldParts();
    const cur = partSize(id);
    if (offset !== cur) { req.resume(); ulog(`recebimento em partes: ${user.name} mandou a parte em ${mb(offset)}, mas o servidor já tem ${mb(cur)}; pedindo para continuar de lá`); return send(res, 409, { error: 'Deslocamento diferente do recebido', received: cur }); }
    const t0 = Date.now();
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(partOf(id), { flags: 'a' });
      let got = 0;
      req.on('data', (c) => { got += c.length; });
      req.on('aborted', () => { out.destroy(); try { fs.truncateSync(partOf(id), offset); } catch { /* nada */ } reject(new HttpError(499, `parte interrompida (chegaram ${mb(got)} de ${mb(len)})`)); });
      req.pipe(out);
      out.on('finish', () => { if (got !== len) { try { fs.truncateSync(partOf(id), offset); } catch { /* nada */ } reject(new HttpError(400, `Parte incompleta (${got} de ${len} bytes)`)); } else resolve(); });
      out.on('error', reject);
      req.on('error', reject);
    });
    const total = partSize(id);
    if (offset === 0 || Math.floor(total / (25 * 1024 * 1024)) !== Math.floor(offset / (25 * 1024 * 1024))) ulog(`recebimento em partes: ${user.name} (${clientIp(req)}) já enviou ${mb(total)} · parte de ${mb(len)} em ${Date.now() - t0} ms`);
    send(res, 200, { received: total });
  }
  async function publishFinish(req, res, user, url) {
    const id = uploadId(url);
    const version = String(url.searchParams.get('version') || '');
    if (!updates.VERSION_RE.test(version)) throw new HttpError(400, 'Versão inválida (use o formato 1.19.2)');
    const p = partOf(id);
    const expect = Number(url.searchParams.get('size') || 0);
    const have = partSize(id);
    if (!have) throw new HttpError(404, 'Envio não encontrado no servidor (recomece)');
    if (expect && have !== expect) throw new HttpError(409, `Chegaram ${have} bytes, mas eram esperados ${expect}`);
    const t0 = Date.now();
    ulog(`recebimento em partes: ${user.name} (${clientIp(req)}) terminou de enviar a versão ${version} (${mb(have)}); conferindo e publicando`);
    const tmp = path.join(updates.dirOf(dir), `.upload-${Date.now()}.part`);
    fs.renameSync(p, tmp);
    let info;
    try { info = await updates.ingest(dir, tmp, version, true); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* nada */ } ulog(`recebimento em partes: FALHOU na publicação: ${e.message}`); throw e; }
    ulog(`recebimento em partes: concluído, versão ${version}, ${mb(info.size)}, SHA-256 ${String(info.sha256 || '').slice(0, 12)}… (conferência ${Date.now() - t0} ms)`);
    core.audit(user, 'app.publish', { version, size: info.size });
    core.notify({ type: 'app', version });
    send(res, 200, info);
  }

  async function upload(req, res, user, pid, url, sticker) {
    if (!sticker) core.need(user, pid, 'write');
    else if (!/^image\//.test(String(req.headers['content-type'] || ''))) throw new HttpError(400, 'Sticker precisa ser uma imagem');
    const max = sticker ? 4 * 1024 * 1024 : cfg.maxFileMB * 1024 * 1024;
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > max) throw new HttpError(413, sticker ? 'Sticker maior que 4 MB' : `Arquivo maior que o limite de ${cfg.maxFileMB} MB`);
    const id = core.newFileId();
    const dest = core.filePath(id);
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, `Arquivo maior que o limite de ${cfg.maxFileMB} MB`)); req.destroy(); out.destroy(); } });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    }).catch((e) => { try { fs.unlinkSync(dest); } catch { /* nada */ } throw e; });
    if (!size) { fs.unlinkSync(dest); throw new HttpError(400, 'Arquivo vazio'); }
    const meta = { id, name: url.searchParams.get('name'), type: req.headers['content-type'], size };
    const f = sticker ? core.registerSticker(user, meta) : core.registerFile(user, pid, meta);
    send(res, 200, { id: f.id, name: f.name, type: f.type, size: f.size });
  }

  function download(req, res, user, id) {
    const f = core.fileFor(user, id);
    const p = core.filePath(id);
    const stat = fs.statSync(p);
    const base = { 'Content-Type': f.type, 'Accept-Ranges': 'bytes', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
    const m = (req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...base, 'Content-Length': stat.size });
    fs.createReadStream(p).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const method = req.method;
      if (method === 'POST' && url.pathname === '/api/_shutdown') { // parar com calma: só da própria máquina, com a chave do arquivo server.key, e nunca pelo túnel
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
        if (!local || req.headers['x-local-key'] !== localKey) return send(res, 403, { error: 'Não autorizado' });
        send(res, 200);
        setTimeout(() => { api.close().then(() => process.exit(0)); }, 80);
        return;
      }
      if (url.pathname === '/api/ping') return send(res, 200, { app: 'TT Note Server', ok: true, users: core.hasUsers() });
      if (method === 'GET' && url.pathname === '/i18n.js') {
        let js; try { js = fs.readFileSync(WEB_LANG); } catch { return send(res, 404, { error: 'Não encontrado' }); }
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        return res.end(js);
      }
      if (method === 'GET' && (url.pathname === '/' || url.pathname === '/app')) { // página web (celular/navegador)
        let html;
        try { html = fs.readFileSync(WEB_FILE); } catch { return send(res, 404, { error: 'Página web não encontrada neste servidor' }); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src *; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
        return res.end(html);
      }
      if (parts[0] !== 'api') return send(res, 404, { error: 'Não encontrado' });

      if (method === 'POST' && parts[1] === 'login' && parts.length === 2) {
        const b = await readJson(req);
        return send(res, 200, core.login(b.name, b.password, clientIp(req)));
      }
      const token = tokenOf(req, url);
      const user = core.auth(token);
      if (!user) return send(res, 401, { error: 'Entre com seu usuário e senha' });

      // eventos em tempo real
      if (method === 'GET' && parts[1] === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify({ type: 'hello', user: user.id })}\n\n`);
        const c = { res, user };
        sse.add(c);
        presence();
        const hb = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(hb); sse.delete(c); if (![...sse].some((x) => x.user.id === user.id)) core.touchSeen(user.id); presence(); });
        return;
      }
      if (parts[1] === 'files' && method === 'GET' && parts.length === 3) return download(req, res, user, parts[2]);
      if (parts[1] === 'app') {
        if (method === 'GET' && parts[2] === 'latest') { const pl = updates.pub(updates.latest(dir)); ulog(`consulta: ${user.name} (${clientIp(req)}) perguntou a versão; o servidor tem ${pl.version || '(nenhuma)'}`); return send(res, 200, pl); }
        if (method === 'GET' && parts[2] === 'download') {
          const l = updates.latest(dir);
          if (!l.version) { ulog(`envio ao cliente: ${user.name} (${clientIp(req)}) pediu o instalador, mas não há versão publicada`); throw new HttpError(404, 'Nenhuma atualização publicada'); }
          const p = path.join(updates.dirOf(dir), l.file);
          const total = fs.statSync(p).size; const t0 = Date.now(); const ip = clientIp(req);
          ulog(`envio ao cliente: ${user.name} (${ip}) baixando a versão ${l.version} (${mb(total)})`);
          // Range: o app baixa em pedaços (vários ao mesmo tempo) e retoma de onde parou se a conexão cair
          const rg = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          const dlHead = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Disposition': `attachment; filename="${l.file}"`, 'X-Content-Type-Options': 'nosniff' };
          if (rg && (rg[1] || rg[2])) {
            let a = rg[1] === '' ? total - Number(rg[2]) : Number(rg[1]);
            let b = rg[1] === '' || rg[2] === '' ? total - 1 : Math.min(Number(rg[2]), total - 1);
            if (a < 0) a = 0;
            if (a > b || a >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
            res.writeHead(206, { ...dlHead, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${total}` });
            return fs.createReadStream(p, { start: a, end: b }).pipe(res);
          }
          res.writeHead(200, { ...dlHead, 'Content-Length': total });
          res.on('close', () => ulog(`envio ao cliente: ${user.name} (${ip}) ${res.writableFinished ? 'recebeu o instalador completo' : 'INTERROMPEU o download (' + mb(res.socket ? res.socket.bytesWritten : 0) + ' enviados de ' + mb(total) + ')'} em ${Math.round((Date.now() - t0) / 1000)} s`));
          return fs.createReadStream(p).pipe(res);
        }
        if (parts[2] === 'publish-status' && method === 'GET') { if (user.role !== 'admin') throw new HttpError(403, 'Só o administrador publica atualizações'); return send(res, 200, { received: partSize(uploadId(url)) }); }
        if (parts[2] === 'publish-chunk' && method === 'POST') { if (user.role !== 'admin') throw new HttpError(403, 'Só o administrador publica atualizações'); return await publishChunk(req, res, user, url); }
        if (parts[2] === 'publish-finish' && method === 'POST') { if (user.role !== 'admin') throw new HttpError(403, 'Só o administrador publica atualizações'); return await publishFinish(req, res, user, url); }
        if (method === 'POST' && parts[2] === 'publish') { if (user.role !== 'admin') throw new HttpError(403, 'Só o administrador publica atualizações'); return await publishUpdate(req, res, user, url); }
      }

      if (parts[1] === 'link-preview' && method === 'GET') return send(res, 200, { preview: await require('./linkpreview').fetchPreview(url.searchParams.get('url'), { allowPrivate: !!process.env.TT_LINKPREVIEW_PRIVATE }) });
      if (parts[1] === 'search' && method === 'GET') return send(res, 200, core.search(user, url.searchParams.get('q')));
      if (parts[1] === 'presence' && method === 'GET') return send(res, 200, { online: onlineIds() });
      if (parts[1] === 'logout' && method === 'POST') { core.logout(token); return send(res, 200); }
      if (parts[1] === 'me' && method === 'GET') return send(res, 200, { ...core.pub(user), nudge: core.nudgeOf(user) });
      if (parts[1] === 'nudge' && method === 'POST' && parts.length === 2) return send(res, 200, core.nudge(user, await readJson(req), onlineIds()));
      if (parts[1] === 'me' && method === 'PATCH') return send(res, 200, core.updateUser(user, user.id, await readJson(req)));

      if (parts[1] === 'users') {
        if (method === 'GET' && parts.length === 2) return send(res, 200, core.listUsers(user));
        if (method === 'POST' && parts.length === 2) return send(res, 200, core.createUser(user, await readJson(req)));
        if (method === 'PATCH' && parts.length === 3) return send(res, 200, core.updateUser(user, parts[2], await readJson(req)));
        if (method === 'DELETE' && parts.length === 3) { core.removeUser(user, parts[2]); return send(res, 200); }
      }
      if (parts[1] === 'stickers') {
        if (method === 'GET' && parts.length === 2) return send(res, 200, core.listStickers());
        if (method === 'POST' && parts.length === 2) return await upload(req, res, user, null, url, true);
        if (method === 'DELETE' && parts.length === 3) { core.removeSticker(user, parts[2]); return send(res, 200); }
      }
      if (parts[1] === 'groups') {
        if (method === 'GET' && parts.length === 2) return send(res, 200, core.listGroups(user));
        if (method === 'POST' && parts.length === 2) return send(res, 200, core.createGroup(user, await readJson(req)));
        if (method === 'PATCH' && parts.length === 3) return send(res, 200, core.updateGroup(user, parts[2], await readJson(req)));
        if (method === 'DELETE' && parts.length === 3) { core.deleteGroup(user, parts[2]); return send(res, 200); }
      }
      if (parts[1] === 'projects') {
        if (method === 'GET' && parts.length === 2) return send(res, 200, core.listProjects(user));
        if (method === 'POST' && parts.length === 2) return send(res, 200, core.createProject(user, await readJson(req)));
        if (method === 'DELETE' && parts.length === 3) { core.deleteProject(user, parts[2]); return send(res, 200); }
        if (method === 'PATCH' && parts.length === 3) return send(res, 200, core.updateProject(user, parts[2], await readJson(req)));
        if (parts[3] === 'people' && method === 'GET' && parts.length === 4) return send(res, 200, core.listPeople(user, parts[2]));
        if (parts[3] === 'notes') {
          if (method === 'GET' && parts.length === 4) return send(res, 200, core.listNotes(user, parts[2]));
          if (method === 'POST' && parts.length === 4) return send(res, 200, core.createNote(user, parts[2], await readJson(req)));
        }
        if (parts[3] === 'files' && method === 'POST' && parts.length === 4) return await upload(req, res, user, parts[2], url);
      }
      if (parts[1] === 'notes' && parts[2]) {
        const nid = parts[2];
        if (parts.length === 3) {
          if (method === 'GET') return send(res, 200, core.getNote(user, nid));
          if (method === 'PATCH') return send(res, 200, core.updateNote(user, nid, await readJson(req)));
          if (method === 'DELETE') { core.deleteNote(user, nid); return send(res, 200); }
        }
        if (parts[3] === 'read' && method === 'POST') return send(res, 200, core.markRead(user, nid));
        if (parts[3] === 'lock' && parts.length === 4) {
          if (method === 'POST') { const b = await readJson(req); return send(res, 200, core.lockCanvas(user, nid, { force: !!b.force })); }
          if (method === 'DELETE') return send(res, 200, core.unlockCanvas(user, nid));
        }
        if (parts[3] === 'canvas') {
          if (method === 'PUT' && parts.length === 4) return send(res, 200, core.saveCanvas(user, nid, await readJson(req)));
          if (method === 'GET' && parts[4] === 'history') return send(res, 200, core.canvasHistory(user, nid));
          if (method === 'POST' && parts[4] === 'restore') return send(res, 200, core.restoreCanvas(user, nid, (await readJson(req)).version));
        }
        if (parts[3] === 'segments') {
          if (method === 'POST' && parts.length === 4) return send(res, 200, core.addSegment(user, nid, await readJson(req)));
          const sid = parts[4];
          if (sid && parts.length === 5 && method === 'PATCH') return send(res, 200, core.editSegment(user, nid, sid, await readJson(req)));
          if (sid && parts.length === 5 && method === 'DELETE') return send(res, 200, core.deleteSegment(user, nid, sid));
          if (sid && parts[5] === 'pin' && method === 'POST') return send(res, 200, core.pin(user, nid, sid, !!(await readJson(req)).pinned));
          if (sid && parts[5] === 'vote' && method === 'POST') return send(res, 200, core.vote(user, nid, sid, await readJson(req)));
          if (sid && parts[5] === 'poll-close' && method === 'POST') return send(res, 200, core.closePoll(user, nid, sid, !!(await readJson(req)).closed));
          if (sid && parts[5] === 'react' && method === 'POST') return send(res, 200, core.react(user, nid, sid, (await readJson(req)).emoji));
          if (sid && parts[5] === 'check' && method === 'POST') return send(res, 200, core.toggleCheck(user, nid, sid, await readJson(req)));
          if (sid && parts[5] === 'restore' && method === 'POST') return send(res, 200, core.restoreVersion(user, nid, sid, (await readJson(req)).version));
        }
      }
      send(res, 404, { error: 'Não encontrado' });
    } catch (e) {
      if (res.headersSent) return res.end();
      send(res, e.status || 500, { error: e.status ? e.message : 'Erro interno' });
      if (!e.status) console.error(e);
    }
  });

  let backupTimer = null;
  const api = {
    core, server, dir, cfg,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(cfg.port, cfg.host, () => {
        const port = server.address().port;
        api.port = port;
        try { fs.writeFileSync(path.join(dir, 'server.key'), localKey); } catch { /* sem chave */ }
        backupTimer = backup.schedule(core, cfg, (m) => console.log('[backup]', m));
        resolve(port);
      });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(backupTimer);
      try { fs.unlinkSync(path.join(dir, 'server.key')); } catch { /* já removida */ }
      for (const c of sse) c.res.end();
      core.flush();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
  return api;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') o.dir = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--admin') { o.admin = [argv[++i], argv[++i]]; }
    else if (a === '--backup-agora') o.backupNow = true;
    else if (a === '--restaurar') o.restore = argv[++i];
    else if (a === '--senha-backup') o.backupPass = argv[++i];
  }
  return o;
}

async function main(argv) {
  const o = parseArgs(argv);
  const dir = o.dir || process.env.TT_SERVER_DATA || path.join(process.env.ProgramData || process.cwd(), 'TT Note Server');
  if (o.restore) { // restaurar: node server/index.js --restaurar <pasta-do-backup> --dir <destino> --senha-backup <senha>
    const r = await backup.restore(o.restore, dir, o.backupPass || process.env.TT_BACKUP_PASS);
    console.log(`Restaurado em ${dir}: ${r.files} arquivo(s) de anexo.`);
    return;
  }
  const srv = startServer(o);
  if (o.backupNow) { console.log(await backup.run(srv.core, srv.cfg)); return; }
  const port = await srv.listen();
  console.log(`TT Note Server em http://${srv.cfg.host}:${port}  (dados: ${srv.dir})`);
  if (!srv.core.hasUsers()) console.log('Nenhum usuário ainda: inicie com  --admin "Seu Nome" "SuaSenha"  para criar o administrador.');
  const stop = async () => { await srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return srv;
}

module.exports = { startServer, main, parseArgs };
if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
