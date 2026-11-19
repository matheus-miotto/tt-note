'use strict';
// Núcleo do servidor colaborativo do TT Note: usuários, projetos, notas em trechos com autor, histórico de versões,
// anexos e leitura (não lidos). Sem dependências: só módulos do Node. O estado fica em state.json (gravação atômica)
// e toda mudança também vai para events.jsonl (auditoria).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const poll = require('./poll');
const MAX_PINS = 20;
const { EventEmitter } = require('events');

const ROLE_RANK = { read: 1, write: 2, edit: 3, admin: 4 }; // write = escreve e edita só as próprias mensagens; edit = também edita as dos outros
const COLORS = ['#61afef', '#e5c07b', '#98c379', '#e06c75', '#c678dd', '#d19a66', '#56b6c2', '#f78fb3'];
const MAX_TEXT = 200000;
const SESSION_DAYS = 30;
const LOCK_MS = 90 * 1000; // quem edita um canvas renova a trava a cada ~30 s; se o app fechar, ela expira sozinha
const CANVAS_MAX = 900000;
const SNAP_KEEP = 30;
const NUDGE_GAP = 15 * 1000; // entre duas chamadas de atenção da mesma pessoa para a mesma pessoa
const NUDGE_PER_MIN = 6; // e no máximo isso por minuto, no total, por quem chama

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'Sem permissão') => new HttpError(403, m);
const notFound = (m = 'Não encontrado') => new HttpError(404, m);
const uid = (n = 9) => crypto.randomBytes(n).toString('base64url');

class Core extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.state = { users: {}, projects: {}, groups: {}, notes: {}, files: {}, reads: {}, sessions: {} };
    this.fails = new Map(); // limite de tentativas de login
    this.nudgeLast = new Map(); // "quem|para quem" -> hora da última chamada de atenção
    this.nudgeLog = new Map(); // quem chamou -> horas das últimas chamadas
    this.timer = null;
    this.lastBak = 0;
    this.load();
  }

  /* ───────────── persistência ───────────── */
  load() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        const s = JSON.parse(fs.readFileSync(f, 'utf8'));
        this.state = { users: {}, projects: {}, groups: {}, notes: {}, files: {}, reads: {}, sessions: {}, ...s };
        return;
      } catch { /* tenta o backup */ }
    }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    if (fs.existsSync(this.file) && Date.now() - this.lastBak > 10 * 60 * 1000) { try { fs.copyFileSync(this.file, this.file + '.bak'); this.lastBak = Date.now(); } catch { /* sem cópia */ } }
    fs.renameSync(tmp, this.file);
  }
  audit(user, type, extra = {}) {
    try { fs.appendFileSync(path.join(this.dir, 'events.jsonl'), JSON.stringify({ ts: Date.now(), by: user ? user.name : null, type, ...extra }) + '\n'); } catch { /* auditoria é melhor esforço */ }
  }
  notify(ev) { this.emit('event', { ts: Date.now(), ...ev }); }

  /* ───────────── usuários e login ───────────── */
  hashPw(pw, salt = crypto.randomBytes(16)) {
    return { salt: salt.toString('hex'), hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
  }
  checkPw(u, pw) {
    const h = crypto.scryptSync(pw, Buffer.from(u.salt, 'hex'), 32);
    return crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'));
  }
  pub(u) { return { id: u.id, name: u.name, color: u.color, role: u.role, disabled: !!u.disabled, removed: !!u.removed, lastSeen: u.lastSeen || 0 }; }
  userByName(name) { return Object.values(this.state.users).find((u) => !u.removed && u.name.toLowerCase() === String(name).trim().toLowerCase()); }
  hasUsers() { return Object.values(this.state.users).some((u) => !u.removed); }

  createUser(actor, { name, password, color, role }) {
    if (actor && actor.role !== 'admin') throw forbidden();
    name = String(name || '').trim();
    if (!name || name.length > 40) throw bad('Nome inválido');
    if (this.userByName(name)) throw bad('Já existe um usuário com esse nome');
    if (String(password || '').length < 8) throw bad('A senha precisa ter pelo menos 8 caracteres');
    const n = Object.keys(this.state.users).length;
    const u = { id: uid(6), name, color: color || COLORS[n % COLORS.length], role: role === 'admin' ? 'admin' : 'user', ...this.hashPw(password), created: Date.now() };
    this.state.users[u.id] = u;
    this.audit(actor, 'user.create', { user: name });
    this.save();
    return this.pub(u);
  }
  updateUser(actor, id, patch) {
    const u = this.state.users[id];
    if (!u) throw notFound('Usuário não encontrado');
    const self = actor && actor.id === id;
    if (!self && (!actor || actor.role !== 'admin')) throw forbidden();
    if (u.removed) throw notFound('Usuário removido');
    if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) u.color = patch.color;
    if (typeof patch.name === 'string' && actor && actor.role === 'admin') {
      const nn = patch.name.trim();
      if (!nn || nn.length > 40) throw bad('Nome inválido');
      const other = this.userByName(nn);
      if (other && other.id !== id) throw bad('Já existe um usuário com esse nome');
      u.name = nn;
    }
    if (self && patch.nudge !== undefined) { // "chamar atenção" (tremer a tela): só eu mudo quem pode
      const n = patch.nudge || {};
      const mode = ['none', 'all', 'list'].includes(n.mode) ? n.mode : 'none';
      const allow = [...new Set((Array.isArray(n.allow) ? n.allow : []).filter((x) => this.state.users[x] && !this.state.users[x].removed && x !== id))];
      u.nudge = { mode, allow };
      this.audit(actor, 'user.nudge', { mode, allow: allow.length });
    }
    if (typeof patch.password === 'string') {
      if (patch.password.length < 8) throw bad('A senha precisa ter pelo menos 8 caracteres');
      Object.assign(u, this.hashPw(patch.password));
      for (const [k, s] of Object.entries(this.state.sessions)) if (s.uid === id) delete this.state.sessions[k]; // derruba sessões antigas
    }
    if (actor && actor.role === 'admin') {
      if (patch.role === 'admin' || patch.role === 'user') {
        if (patch.role === 'user' && u.role === 'admin' && Object.values(this.state.users).filter((x) => x.role === 'admin' && !x.removed && !x.disabled && x.id !== id).length === 0) throw bad('Precisa existir pelo menos um administrador');
        u.role = patch.role;
      }
      if (typeof patch.disabled === 'boolean') {
        if (patch.disabled && id === actor.id) throw bad('Você não pode desativar a si mesmo');
        u.disabled = patch.disabled;
        if (u.disabled) for (const [k, s] of Object.entries(this.state.sessions)) if (s.uid === id) delete this.state.sessions[k];
      }
    }
    this.audit(actor, 'user.update', { user: u.name, keys: Object.keys(patch).filter((k) => k !== 'password') });
    this.save();
    return this.pub(u);
  }
  // Remover: o usuário deixa de existir para entrar, sai de todos os projetos e some das listas, mas o nome e a cor continuam
  // aparecendo no histórico (o que ele escreveu não é apagado).
  removeUser(actor, id) {
    if (!actor || actor.role !== 'admin') throw forbidden();
    const u = this.state.users[id];
    if (!u || u.removed) throw notFound('Usuário não encontrado');
    if (id === actor.id) throw bad('Você não pode remover a si mesmo');
    if (u.role === 'admin' && Object.values(this.state.users).filter((x) => x.role === 'admin' && !x.removed && !x.disabled && x.id !== id).length === 0) throw bad('Precisa existir pelo menos um administrador');
    u.removed = { by: actor.id, ts: Date.now() };
    u.disabled = true;
    for (const [k, s] of Object.entries(this.state.sessions)) if (s.uid === id) delete this.state.sessions[k];
    for (const p of Object.values(this.state.projects)) delete p.members[id];
    for (const g of Object.values(this.state.groups)) if (g.members) delete g.members[id];
    this.audit(actor, 'user.remove', { user: u.name });
    this.save();
    this.notify({ type: 'project' });
  }
  /* ───────────── chamar a atenção (tremer a tela), só com a permissão de quem recebe ───────────── */
  nudgeOf(u) { const n = u.nudge || {}; return { mode: ['none', 'all', 'list'].includes(n.mode) ? n.mode : 'none', allow: Array.isArray(n.allow) ? n.allow : [] }; }
  nudgeAllows(target, from) {
    if (!target || !from || target.id === from.id || target.removed || target.disabled) return false;
    const n = this.nudgeOf(target);
    return n.mode === 'all' || (n.mode === 'list' && n.allow.includes(from.id));
  }
  shareProject(a, b) { return Object.values(this.state.projects).some((p) => !p.deleted && this.canSee(a, p.id) && this.canSee(b, p.id)); }
  // online = ids de quem está com o app/página aberto agora (quem sabe é o servidor HTTP)
  nudge(actor, { to, nid }, online = []) {
    const t = this.state.users[String(to)];
    if (!t || t.removed || t.disabled) throw notFound('Usuário não encontrado');
    if (t.id === actor.id) throw bad('Você não pode chamar a sua própria atenção');
    if (!this.shareProject(actor, t)) throw forbidden('Vocês não participam de nenhum projeto em comum');
    if (!this.nudgeAllows(t, actor)) throw forbidden(`${t.name} não aceita chamadas de atenção suas`);
    if (!online.includes(t.id)) throw new HttpError(409, `${t.name} não está online agora`);
    const now = Date.now();
    const key = actor.id + '|' + t.id;
    const last = this.nudgeLast.get(key) || 0;
    if (now - last < NUDGE_GAP) throw new HttpError(429, `Aguarde ${Math.ceil((NUDGE_GAP - (now - last)) / 1000)} s para chamar a atenção de ${t.name} de novo`);
    const log = (this.nudgeLog.get(actor.id) || []).filter((x) => now - x < 60000);
    if (log.length >= NUDGE_PER_MIN) throw new HttpError(429, 'Muitas chamadas de atenção seguidas. Aguarde um minuto.');
    let pid;
    if (nid) { const n = this.state.notes[nid]; if (n && !n.deleted && this.canSee(actor, n.pid) && this.canSee(t, n.pid)) pid = n.pid; else nid = undefined; }
    this.nudgeLast.set(key, now);
    log.push(now);
    this.nudgeLog.set(actor.id, log);
    this.audit(actor, 'nudge', { to: t.name });
    this.notify({ type: 'nudge', to: t.id, from: actor.id, nid: nid || undefined, pid });
    return { ok: true, to: t.id, name: t.name };
  }
  listUsers(actor) {
    // todos veem nome, cor e se foi removido (para colorir o histórico); só o admin vê o resto
    return Object.values(this.state.users).map((u) => ({ ...(actor && actor.role === 'admin' ? this.pub(u) : { id: u.id, name: u.name, color: u.color, removed: !!u.removed, lastSeen: u.lastSeen || 0 }), nudge: this.nudgeAllows(u, actor) })); // nudge: este usuário aceita que EU chame a atenção dele
  }

  login(name, password, ip = '') {
    const key = ip + '|' + String(name).toLowerCase();
    const f = this.fails.get(key);
    if (f && f.n >= 5 && Date.now() - f.t < 60000) throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto.');
    const u = this.userByName(name);
    if (!u || u.disabled || u.removed || !this.checkPw(u, String(password || ''))) {
      this.fails.set(key, { n: (f && Date.now() - f.t < 60000 ? f.n : 0) + 1, t: Date.now() });
      this.audit(null, 'login.fail', { name: String(name).slice(0, 40), ip });
      throw new HttpError(401, 'Usuário ou senha inválidos');
    }
    this.fails.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    this.state.sessions[crypto.createHash('sha256').update(token).digest('hex')] = { uid: u.id, exp: Date.now() + SESSION_DAYS * 86400000 };
    this.audit(u, 'login', { ip });
    this.save();
    return { token, user: this.pub(u) };
  }
  auth(token) {
    if (!token) return null;
    const k = crypto.createHash('sha256').update(token).digest('hex');
    const s = this.state.sessions[k];
    if (!s) return null;
    if (s.exp < Date.now()) { delete this.state.sessions[k]; return null; }
    const u = this.state.users[s.uid];
    return u && !u.disabled ? u : null;
  }
  logout(token) {
    delete this.state.sessions[crypto.createHash('sha256').update(token).digest('hex')];
    this.save();
  }

  /* ───────────── projetos ───────────── */
  roleIn(user, pid) {
    if (!user) return null;
    if (user.role === 'admin') return 'admin';
    const p = this.state.projects[pid];
    if (!p) return null;
    // papel no projeto + papel herdado do grupo do projeto: vale o mais alto dos dois
    const own = p.members[user.id] || null;
    const g = p.group ? this.state.groups[p.group] : null;
    const inh = g && g.members ? g.members[user.id] || null : null;
    if (!own) return inh;
    if (!inh) return own;
    return ROLE_RANK[own] >= ROLE_RANK[inh] ? own : inh;
  }
  need(user, pid, level) {
    const p = this.state.projects[pid];
    if (!p || p.deleted) throw notFound('Projeto não encontrado');
    const r = this.roleIn(user, pid);
    if (!r || ROLE_RANK[r] < ROLE_RANK[level]) throw forbidden();
    return p;
  }
  canSee(user, pid) { const r = this.roleIn(user, pid); return !!r; }

  createProject(actor, { name, members, group }) {
    if (!actor || actor.role !== 'admin') throw forbidden('Só o administrador cria projetos');
    name = String(name || '').trim();
    if (!name || name.length > 80) throw bad('Nome do projeto inválido');
    const p = { id: uid(6), name, members: {}, created: Date.now() };
    if (group && this.state.groups[group]) p.group = group;
    for (const [id, r] of Object.entries(members || {})) if (this.state.users[id] && ROLE_RANK[r]) p.members[id] = r;
    this.state.projects[p.id] = p;
    this.audit(actor, 'project.create', { project: name });
    this.save();
    return this.projectInfo(actor, p);
  }
  updateProject(actor, pid, patch) {
    const p = this.need(actor, pid, 'admin');
    if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 80);
    if ('group' in patch) {
      if (actor.role !== 'admin') throw forbidden('Só o administrador do servidor muda o grupo de um projeto');
      if (!patch.group) delete p.group;
      else if (this.state.groups[patch.group]) p.group = patch.group;
      else throw bad('Esse grupo não existe');
    }
    if (patch.members && typeof patch.members === 'object') {
      p.members = {};
      for (const [id, r] of Object.entries(patch.members)) if (this.state.users[id] && ROLE_RANK[r]) p.members[id] = r;
    }
    this.audit(actor, 'project.update', { project: p.name });
    this.save();
    this.notify({ type: 'project', pid });
    return this.projectInfo(actor, p);
  }
  // Apagar projeto (só administrador): some para todos, com as notas; fica guardado no servidor (apagado, não destruído)
  deleteProject(actor, pid) {
    const p = this.need(actor, pid, 'admin');
    p.deleted = { by: actor.id, ts: Date.now() };
    this.audit(actor, 'project.delete', { project: p.name });
    this.save();
    this.notify({ type: 'project', pid });
  }
  projectInfo(user, p) {
    let unread = 0; let mine = 0;
    for (const n of Object.values(this.state.notes)) if (n.pid === p.id && !n.deleted) { unread += this.unreadOf(user, n); mine += this.mineOf(user, n); }
    const isAdm = this.roleIn(user, p.id) === 'admin';
    const g = p.group ? this.state.groups[p.group] : null;
    return { id: p.id, name: p.name, group: g ? g.id : null, role: this.roleIn(user, p.id), members: isAdm ? p.members : undefined, inherited: isAdm && g && g.members ? g.members : undefined, unread, mine };
  }
  /* ───────────── grupos de projetos (pastas na lateral; a permissão continua sendo por projeto) ───────────── */
  cleanMembers(members) {
    const out = {};
    for (const [id, r] of Object.entries(members || {})) if (this.state.users[id] && !this.state.users[id].removed && ROLE_RANK[r]) out[id] = r;
    return out;
  }
  createGroup(actor, { name, members }) {
    if (!actor || actor.role !== 'admin') throw forbidden('Só o administrador cria grupos');
    name = String(name || '').trim();
    if (!name || name.length > 60) throw bad('Nome do grupo inválido');
    if (Object.values(this.state.groups).some((g) => g.name.toLowerCase() === name.toLowerCase())) throw bad('Já existe um grupo com esse nome');
    const g = { id: uid(6), name, members: this.cleanMembers(members), created: Date.now() };
    this.state.groups[g.id] = g;
    this.audit(actor, 'group.create', { group: name });
    this.save();
    this.notify({ type: 'project' });
    return g;
  }
  updateGroup(actor, gid, { name, members }) {
    if (!actor || actor.role !== 'admin') throw forbidden('Só o administrador muda grupos');
    const g = this.state.groups[gid];
    if (!g) throw notFound('Grupo não encontrado');
    if (name !== undefined) {
      name = String(name || '').trim();
      if (!name || name.length > 60) throw bad('Nome do grupo inválido');
      if (Object.values(this.state.groups).some((x) => x.id !== gid && x.name.toLowerCase() === name.toLowerCase())) throw bad('Já existe um grupo com esse nome');
      g.name = name;
      this.audit(actor, 'group.rename', { group: name });
    }
    if (members !== undefined) {
      if (!members || typeof members !== 'object' || Array.isArray(members)) throw bad('Lista de acesso inválida');
      g.members = this.cleanMembers(members);
      this.audit(actor, 'group.access', { group: g.name, members: Object.keys(g.members).length });
    }
    this.save();
    this.notify({ type: 'project' });
    return g;
  }
  deleteGroup(actor, gid) {
    if (!actor || actor.role !== 'admin') throw forbidden('Só o administrador apaga grupos');
    const g = this.state.groups[gid];
    if (!g) throw notFound('Grupo não encontrado');
    for (const p of Object.values(this.state.projects)) if (p.group === gid) delete p.group; // os projetos continuam, só saem do grupo
    delete this.state.groups[gid];
    this.audit(actor, 'group.delete', { group: g.name });
    this.save();
    this.notify({ type: 'project' });
  }
  // administrador vê todos; os demais só os grupos que têm algum projeto que podem ver
  listGroups(user) {
    const visible = new Set(Object.values(this.state.projects).filter((p) => !p.deleted && p.group && this.canSee(user, p.id)).map((p) => p.group));
    return Object.values(this.state.groups)
      .filter((g) => user.role === 'admin' || visible.has(g.id) || (g.members && g.members[user.id]))
      .map((g) => ({ id: g.id, name: g.name, role: user.role === 'admin' ? 'admin' : (g.members && g.members[user.id]) || null, members: user.role === 'admin' ? (g.members || {}) : undefined }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }
  listProjects(user) {
    return Object.values(this.state.projects).filter((p) => !p.deleted && this.canSee(user, p.id)).map((p) => this.projectInfo(user, p));
  }

  /* ───────────── notas e trechos ───────────── */
  lastTs(n) { if (n.type === 'canvas') return Math.max(n.created, n.canvas.ts); let t = n.created; for (const s of n.segments) { const v = s.versions[s.versions.length - 1]; if (v.ts > t) t = v.ts; } return t; }
  unreadOf(user, n) {
    const since = (this.state.reads[user.id] || {})[n.id] || 0;
    if (n.type === 'canvas') return n.canvas.ts > since && n.canvas.by !== user.id ? 1 : 0;
    let c = 0;
    for (const s of n.segments) for (const v of s.versions) if (v.ts > since && v.by !== user.id) c++;
    return c;
  }
  // @nome: acha quem foi mencionado (só quem enxerga o projeto; o autor não menciona a si mesmo; @todos avisa todos do projeto)
  mentionIds(author, pid, text) {
    // código não conta: ```bloco``` e `trecho` viram espaços antes de procurar os @
    let t = ' ' + String(text || '').replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length)).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
    const U = (c) => '(^|[^\\p{L}\\p{N}_])@' + c + '(?![\\p{L}\\p{N}_])';
    const users = Object.values(this.state.users).filter((u) => !u.removed && !u.disabled && u.id !== author.id && this.canSee(u, pid));
    const ids = new Set();
    if (new RegExp(U('(?:todos|everyone)'), 'iu').test(t)) for (const u of users) ids.add(u.id);
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const u of [...users].sort((a, b) => b.name.length - a.name.length)) { // nomes mais compridos primeiro ("@Ana Maria" antes de "@Ana")
      const re = new RegExp(U(esc(u.name)), 'giu');
      if (!re.test(t)) continue;
      ids.add(u.id);
      t = t.replace(new RegExp(U(esc(u.name)), 'giu'), (m, pre) => pre + ' '.repeat(m.length - pre.length));
    }
    return [...ids];
  }
  setMentions(user, n, s, text, ts) {
    const ids = this.mentionIds(user, n.pid, text);
    const old = s.mnt || {};
    s.mentions = ids;
    s.mnt = {};
    for (const id of ids) s.mnt[id] = old[id] || ts; // quem já tinha sido avisado desta mensagem mantém a hora
  }
  // Quantas mensagens "para você" ainda não lidas: menções a mim e respostas às minhas mensagens
  mineOf(user, n) {
    if (n.type === 'canvas') return 0;
    const since = (this.state.reads[user.id] || {})[n.id] || 0;
    const by = new Map(n.segments.map((x) => [x.id, x]));
    let c = 0;
    for (const s of n.segments) {
      if (s.deleted || s.author === user.id) continue;
      const tgt = s.replyTo && by.get(s.replyTo);
      if ((s.mnt && s.mnt[user.id] > since) || (tgt && tgt.author === user.id && s.ts > since)) c++;
    }
    return c;
  }
  // pessoas que enxergam o projeto (para o @ do campo de escrever)
  listPeople(user, pid) {
    this.need(user, pid, 'read');
    return Object.values(this.state.users).filter((u) => !u.removed && !u.disabled && this.canSee(u, pid)).map((u) => ({ id: u.id, name: u.name, color: u.color })).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }
  noteInfo(user, n) {
    const last = n.type === 'canvas' ? { by: n.canvas.by } : n.segments.length ? n.segments[n.segments.length - 1].versions.slice(-1)[0] : null;
    return { id: n.id, pid: n.pid, type: n.type || 'note', by: n.type === 'canvas' ? this.creatorOf(n) : undefined, title: n.title, created: n.created, updated: this.lastTs(n), unread: this.unreadOf(user, n), mine: this.mineOf(user, n), lastBy: last ? last.by : null, count: n.segments.filter((s) => !s.deleted).length };
  }
  listNotes(user, pid) {
    this.need(user, pid, 'read');
    return Object.values(this.state.notes).filter((n) => n.pid === pid && !n.deleted).map((n) => this.noteInfo(user, n)).sort((a, b) => b.updated - a.updated);
  }
  // Busca (título e texto atual dos trechos) só nos projetos que a pessoa pode ver; ignora maiúsculas e acentos
  search(user, q) {
    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    q = norm(q).trim();
    if (q.length < 2) return [];
    const out = [];
    for (const n of Object.values(this.state.notes)) {
      if (n.deleted || !this.canSee(user, n.pid) || !this.state.projects[n.pid] || this.state.projects[n.pid].deleted) continue;
      const proj = this.state.projects[n.pid].name;
      if (norm(n.title).includes(q)) out.push({ nid: n.id, pid: n.pid, project: proj, title: n.title, snippet: '', ts: this.lastTs(n) });
      let hits = 0;
      for (const s of n.segments) {
        if (s.deleted || s.type === 'sticker') continue;
        const t = this.cur(s).text;
        const i = norm(t).indexOf(q);
        if (i < 0) continue;
        const from = Math.max(0, i - 40);
        out.push({ nid: n.id, pid: n.pid, project: proj, title: n.title, snippet: (from ? '…' : '') + t.slice(from, i + q.length + 80).replace(/\s+/g, ' '), sid: s.id, by: s.author, ts: this.cur(s).ts });
        if (++hits >= 3) break;
      }
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
  }

  /* ───────────── canvas compartilhado: um editor por vez (trava com validade), os outros veem ao vivo ───────────── */
  lockInfo(n) { const l = n.lock; return l && l.exp > Date.now() ? { by: l.by, ts: l.ts, exp: l.exp } : null; }
  canvasOf(user, nid, level) {
    const n = this.noteOf(user, nid, level);
    if (n.type !== 'canvas') throw bad('Esta nota não é um canvas');
    return n;
  }
  // quem criou o canvas (canvas antigo, de antes de guardarmos isso: o autor da versão 1, se ainda estiver no histórico)
  creatorOf(n) { return n.by || (n.canvas.version === 1 ? n.canvas.by : (n.snaps && n.snaps[0] && n.snaps[0].version === 1 ? n.snaps[0].by : null)); }
  // Carimba cada cartão: by/ts = quem criou e quando; editedBy/editedTs = quem mexeu por último (texto, posição, tamanho, cor…). O cliente não decide isso.
  stampNodes(user, prevText, j, now) {
    const STAMPS = ['by', 'ts', 'editedBy', 'editedTs'];
    const stable = (v) => (Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v));
    const core = (x) => stable(Object.fromEntries(Object.entries(x).filter(([k]) => !STAMPS.includes(k))));
    const prev = {};
    try { for (const x of (JSON.parse(prevText).nodes || [])) if (x && x.id !== undefined) prev[x.id] = x; } catch { /* sem versão anterior legível */ }
    for (const n of j.nodes || []) {
      if (!n || typeof n !== 'object') continue;
      const p = prev[n.id];
      for (const k of STAMPS) delete n[k];
      if (!p) { n.by = user.id; n.ts = now; continue; }
      for (const k of STAMPS) if (p[k] !== undefined) n[k] = p[k];
      if (core(n) !== core(p)) { n.editedBy = user.id; n.editedTs = now; }
    }
  }
  userName(id) { const u = this.state.users[id]; return u ? u.name : 'Outra pessoa'; }
  snap(n) { // ponto de restauração da versão atual (no começo de cada sessão de edição e a cada 5 min)
    const last = n.snaps[n.snaps.length - 1];
    if (last && last.version === n.canvas.version) return;
    n.snaps.push({ version: n.canvas.version, ts: n.canvas.ts, by: n.canvas.by, text: n.canvas.text });
    while (n.snaps.length > SNAP_KEEP) n.snaps.shift();
  }
  lockCanvas(user, nid, { force } = {}) {
    const n = this.canvasOf(user, nid, 'write');
    const cur = this.lockInfo(n); const now = Date.now();
    if (cur && cur.by !== user.id) {
      if (!(force && user.role === 'admin')) throw new HttpError(409, `${this.userName(cur.by)} está editando este canvas`);
      this.audit(user, 'canvas.lock.break', { note: n.title, from: this.userName(cur.by) });
    }
    const fresh = !cur || cur.by !== user.id;
    n.lock = { by: user.id, ts: fresh ? now : cur.ts, exp: now + LOCK_MS };
    if (fresh) {
      this.snap(n);
      this.audit(user, 'canvas.lock', { note: n.title });
      this.save();
      this.notify({ type: 'note', pid: n.pid, nid, by: user.id, what: 'lock' });
    }
    return { lock: this.lockInfo(n), version: n.canvas.version };
  }
  unlockCanvas(user, nid) {
    const n = this.canvasOf(user, nid, 'write');
    const cur = this.lockInfo(n);
    if (cur && (cur.by === user.id || user.role === 'admin')) {
      n.lock = null;
      this.audit(user, 'canvas.unlock', { note: n.title });
      this.notify({ type: 'note', pid: n.pid, nid, by: user.id, what: 'lock' });
    }
    return { ok: true };
  }
  applyCanvas(user, n, text, kind) {
    const now = Date.now();
    const last = n.snaps[n.snaps.length - 1];
    if (!last || now - last.ts > 5 * 60 * 1000) this.snap(n);
    n.canvas = { text, version: n.canvas.version + 1, by: user.id, ts: now };
    this.audit(user, kind, { note: n.title, version: n.canvas.version });
    this.save();
    this.notify({ type: 'note', pid: n.pid, nid: n.id, by: user.id, what: 'canvas', version: n.canvas.version });
    return { version: n.canvas.version, ts: now };
  }
  saveCanvas(user, nid, { text, baseVersion }) {
    const n = this.canvasOf(user, nid, 'write');
    if (typeof text !== 'string' || text.length > CANVAS_MAX) throw bad('Canvas grande demais');
    let j;
    try { j = JSON.parse(text); } catch { throw bad('O canvas não é um JSON válido'); }
    if (!j || typeof j !== 'object' || Array.isArray(j) || (j.nodes !== undefined && !Array.isArray(j.nodes)) || (j.edges !== undefined && !Array.isArray(j.edges))) throw bad('O canvas precisa ter "nodes" e "edges" em lista');
    const cur = this.lockInfo(n); const now = Date.now();
    if (cur && cur.by !== user.id) throw new HttpError(409, `${this.userName(cur.by)} está editando este canvas`);
    const fresh = !cur;
    n.lock = { by: user.id, ts: fresh ? now : cur.ts, exp: now + LOCK_MS }; // salvar renova (ou retoma, se a trava tinha expirado e ninguém pegou)
    if (fresh) this.notify({ type: 'note', pid: n.pid, nid, by: user.id, what: 'lock' });
    if (Number(baseVersion) !== n.canvas.version) throw new HttpError(409, `O canvas foi alterado por outra pessoa (versão ${n.canvas.version}). Recarregue.`);
    this.stampNodes(user, n.canvas.text, j, now);
    const stamped = JSON.stringify(j, null, 2) + '\n';
    const r = this.applyCanvas(user, n, stamped, 'canvas.save');
    return stamped !== text ? { ...r, text: stamped } : r;
  }
  canvasHistory(user, nid) {
    const n = this.canvasOf(user, nid, 'read');
    return [{ version: n.canvas.version, ts: n.canvas.ts, by: n.canvas.by, size: n.canvas.text.length, current: true }, ...[...n.snaps].reverse().map((s) => ({ version: s.version, ts: s.ts, by: s.by, size: s.text.length }))];
  }
  restoreCanvas(user, nid, version) {
    const n = this.canvasOf(user, nid, 'write');
    const cur = this.lockInfo(n);
    if (!cur || cur.by !== user.id) throw new HttpError(409, 'Clique em Editar antes de restaurar uma versão');
    const s = n.snaps.find((x) => x.version === Number(version));
    if (!s) throw notFound('Versão não encontrada');
    n.lock = { ...n.lock, exp: Date.now() + LOCK_MS };
    return this.applyCanvas(user, n, s.text, 'canvas.restore');
  }
  noteOf(user, nid, level) {
    const n = this.state.notes[nid];
    if (!n || n.deleted) throw notFound('Nota não encontrada');
    this.need(user, n.pid, level);
    return n;
  }
  createNote(user, pid, { title, type }) {
    this.need(user, pid, 'write');
    title = String(title || '').trim().slice(0, 120) || (type === 'canvas' ? 'Novo canvas' : 'Nova nota');
    const n = { id: uid(6), pid, title, created: Date.now(), segments: [] };
    if (type === 'canvas') { n.type = 'canvas'; n.by = user.id; n.canvas = { text: '{"nodes":[],"edges":[]}\n', version: 1, by: user.id, ts: n.created }; n.snaps = []; }
    this.state.notes[n.id] = n;
    this.audit(user, 'note.create', { note: title });
    this.save();
    this.notify({ type: 'note', pid, nid: n.id, by: user.id, what: 'create' });
    return this.noteInfo(user, n);
  }
  updateNote(user, nid, patch) {
    const n = this.noteOf(user, nid, 'write');
    if (typeof patch.title === 'string') {
      n.title = patch.title.trim().slice(0, 120) || n.title;
      this.audit(user, 'note.rename', { note: n.title });
    }
    if (patch.editPolicy !== undefined) {
      if (ROLE_RANK[this.roleIn(user, n.pid)] < ROLE_RANK.admin) throw forbidden('Só quem administra o projeto muda essa regra');
      if (!['project', 'author', 'all'].includes(patch.editPolicy)) throw bad('Regra inválida');
      n.editPolicy = patch.editPolicy;
      this.audit(user, 'note.policy', { note: n.title, policy: n.editPolicy });
    }
    this.save();
    this.notify({ type: 'note', pid: n.pid, nid, by: user.id, what: 'rename' });
    return this.noteInfo(user, n);
  }
  // Quem pode editar/apagar/restaurar um trecho: o próprio autor; o administrador; os demais conforme a regra da nota
  // ("project" = só quem tem o papel "editar" no projeto; "author" = ninguém além do autor/administrador; "all" = todos que escrevem)
  canEdit(user, n, s) {
    const role = this.roleIn(user, n.pid);
    if (!role || ROLE_RANK[role] < ROLE_RANK.write) return false;
    if (s.author === user.id || role === 'admin') return true;
    const pol = n.editPolicy || 'project';
    return pol === 'all' ? true : pol === 'author' ? false : role === 'edit';
  }
  needEdit(user, n, s) {
    if (!this.canEdit(user, n, s)) throw forbidden('Você não tem permissão para editar mensagens de outras pessoas nesta nota');
  }
  deleteNote(user, nid) {
    const n = this.noteOf(user, nid, 'admin');
    n.deleted = { by: user.id, ts: Date.now() };
    this.audit(user, 'note.delete', { note: n.title });
    this.save();
    this.notify({ type: 'note', pid: n.pid, nid, by: user.id, what: 'delete' });
  }
  // Enquete: resultado visto por esta pessoa (anônima: sem quem votou em quê)
  pollView(user, s) {
    const p = poll.firstPoll(this.cur(s).text);
    if (!p) return null;
    const n = p.options.length;
    const counts = new Array(n).fill(0); const voters = p.options.map(() => []); let people = 0;
    for (const [uid, arr] of Object.entries(s.votes || {})) {
      const ok = (arr || []).filter((i) => Number.isInteger(i) && i >= 0 && i < n);
      if (!ok.length) continue;
      people++;
      for (const i of ok) { counts[i]++; voters[i].push(uid); }
    }
    return { counts, people, mine: ((s.votes || {})[user.id] || []).filter((i) => i >= 0 && i < n), voters: p.anonymous ? null : voters, anonymous: p.anonymous, multi: p.multi, closed: s.pollClosed ? { by: s.pollClosed.by, ts: s.pollClosed.ts } : null };
  }
  segOut(user, n, s) {
    const { votes, pollClosed, ...rest } = s;
    const out = { ...rest, canEdit: this.canEdit(user, n, s) };
    const pv = this.pollView(user, s);
    if (pv) out.poll = pv;
    return out;
  }
  vote(user, nid, sid, { options }) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    if (s.deleted) throw bad('Trecho apagado');
    const p = poll.firstPoll(this.cur(s).text);
    if (!p) throw bad('Este trecho não é uma enquete');
    if (s.pollClosed) throw bad('A enquete está encerrada');
    if (!Array.isArray(options)) throw bad('Opções inválidas');
    const list = [...new Set(options.map(Number))];
    if (list.some((i) => !Number.isInteger(i) || i < 0 || i >= p.options.length)) throw bad('Opção inválida');
    if (!p.multi && list.length > 1) throw bad('Esta enquete aceita uma escolha só');
    s.votes = s.votes || {};
    if (list.length) s.votes[user.id] = list.sort((a, b) => a - b); else delete s.votes[user.id];
    this.audit(user, 'poll.vote', { note: n.title, options: list.length });
    this.touch(user, n, 'vote', sid);
    return this.segOut(user, n, s);
  }
  // Fixar a mensagem no alto da conversa (vale para todos; quem pode escrever fixa e desafixa)
  pin(user, nid, sid, pinned) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    if (s.deleted) throw bad('Trecho apagado');
    if (pinned) {
      if (!s.pinned && n.segments.filter((x) => x.pinned && !x.deleted).length >= MAX_PINS) throw bad(`No máximo ${MAX_PINS} mensagens fixadas por nota: desafixe alguma antes`);
      if (!s.pinned) s.pinned = { by: user.id, ts: Date.now() };
    } else delete s.pinned;
    this.audit(user, pinned ? 'segment.pin' : 'segment.unpin', { note: n.title });
    this.touch(user, n, 'pin', sid);
    return this.segOut(user, n, s);
  }
  closePoll(user, nid, sid, closed) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    if (!poll.firstPoll(this.cur(s).text)) throw bad('Este trecho não é uma enquete');
    if (s.author !== user.id && this.roleIn(user, n.pid) !== 'admin') throw forbidden('Só quem criou a enquete (ou o administrador) pode encerrar');
    if (closed) s.pollClosed = { by: user.id, ts: Date.now() }; else delete s.pollClosed;
    this.audit(user, closed ? 'poll.close' : 'poll.reopen', { note: n.title });
    this.touch(user, n, 'poll', sid);
    return this.segOut(user, n, s);
  }
  // Com votos, as opções (e o tipo) da enquete não mudam: só dá para ajustar a pergunta
  checkPollEdit(s, newText) {
    if (!s.votes || !Object.keys(s.votes).length) return;
    const a = poll.firstPoll(this.cur(s).text);
    if (!a) return;
    const b = poll.firstPoll(newText);
    if (!b || !poll.sameStructure(a, b)) throw bad('Esta enquete já tem votos: só dá para mudar a pergunta (não as opções nem o tipo)');
  }
  getNote(user, nid) {
    const n = this.noteOf(user, nid, 'read');
    if (n.type === 'canvas') return { ...this.noteInfo(user, n), readAt: (this.state.reads[user.id] || {})[nid] || 0, role: this.roleIn(user, n.pid), editPolicy: 'project', segments: [], canvas: { ...n.canvas }, lock: this.lockInfo(n) };
    return { ...this.noteInfo(user, n), readAt: (this.state.reads[user.id] || {})[nid] || 0, role: this.roleIn(user, n.pid), editPolicy: n.editPolicy || 'project', segments: n.segments.map((s) => this.segOut(user, n, s)) };
  }
  cleanText(text) {
    text = String(text == null ? '' : text).replace(/\r\n/g, '\n');
    if (text.length > MAX_TEXT) throw bad('Texto grande demais');
    return text;
  }
  seg(n, sid) {
    const s = n.segments.find((x) => x.id === sid);
    if (!s) throw notFound('Trecho não encontrado');
    return s;
  }
  cur(s) { return s.versions[s.versions.length - 1]; }
  touch(user, n, what, sid) {
    this.save();
    this.notify({ type: 'note', pid: n.pid, nid: n.id, sid, by: user.id, what });
  }
  addSegment(user, nid, { text, sticker, replyTo }) {
    const n = this.noteOf(user, nid, 'write');
    if (n.type === 'canvas') throw bad('Esta nota é um canvas: abra no app para editar');
    const ts = Date.now();
    let s;
    if (replyTo !== undefined && replyTo !== null && replyTo !== '') {
      const tgt = n.segments.find((x) => x.id === String(replyTo));
      if (!tgt || tgt.deleted) throw bad('A mensagem que você quer responder não existe mais');
    } else replyTo = null;
    if (sticker) {
      const st = {};
      if (typeof sticker.emoji === 'string' && sticker.emoji && sticker.emoji.length <= 16) st.emoji = sticker.emoji;
      else if (typeof sticker.file === 'string' && this.state.files[sticker.file] && this.state.files[sticker.file].sticker) st.file = sticker.file;
      else throw bad('Sticker inválido');
      s = { id: uid(6), author: user.id, ts, type: 'sticker', sticker: st, versions: [{ n: 1, text: '', by: user.id, ts, kind: 'create' }] };
    } else {
      text = this.cleanText(text);
      if (!text.trim()) throw bad('Texto vazio');
      s = { id: uid(6), author: user.id, ts, versions: [{ n: 1, text, by: user.id, ts, kind: 'create' }] };
      this.setMentions(user, n, s, text, ts);
    }
    if (replyTo) s.replyTo = String(replyTo);
    n.segments.push(s);
    this.audit(user, 'segment.add', { note: n.title });
    this.touch(user, n, 'add', s.id);
    return this.segOut(user, n, s);
  }
  pushVersion(user, s, text, kind, label) {
    const v = { n: s.versions.length + 1, text, by: user.id, ts: Date.now(), kind };
    if (label) v.label = label;
    s.versions.push(v);
    return v;
  }
  editSegment(user, nid, sid, { text }) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    this.needEdit(user, n, s);
    if (s.type === 'sticker') throw bad('Sticker não pode ser editado (apague e envie outro)');
    text = this.cleanText(text);
    if (!text.trim()) throw bad('Texto vazio (para remover, use apagar)');
    if (text === this.cur(s).text) return this.segOut(user, n, s);
    this.checkPollEdit(s, text);
    this.pushVersion(user, s, text, 'edit');
    this.setMentions(user, n, s, text, Date.now());
    this.audit(user, 'segment.edit', { note: n.title, author: this.state.users[s.author] ? this.state.users[s.author].name : '?' });
    this.touch(user, n, 'edit', sid);
    return this.segOut(user, n, s);
  }
  deleteSegment(user, nid, sid) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    this.needEdit(user, n, s);
    s.deleted = { by: user.id, ts: Date.now() };
    this.pushVersion(user, s, this.cur(s).text, 'delete');
    this.audit(user, 'segment.delete', { note: n.title });
    this.touch(user, n, 'delete', sid);
    return this.segOut(user, n, s);
  }
  restoreVersion(user, nid, sid, version) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    this.needEdit(user, n, s);
    const v = s.versions.find((x) => x.n === Number(version));
    if (!v) throw notFound('Versão não encontrada');
    this.checkPollEdit(s, v.text);
    delete s.deleted;
    this.pushVersion(user, s, v.text, 'restore', `versão ${v.n}`);
    if (s.type !== 'sticker') this.setMentions(user, n, s, v.text, Date.now());
    this.audit(user, 'segment.restore', { note: n.title, version: v.n });
    this.touch(user, n, 'restore', sid);
    return this.segOut(user, n, s);
  }
  // Marca/desmarca a tarefa "- [ ] item" da linha indicada, registrando quem fez
  toggleCheck(user, nid, sid, { line, checked }) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    const lines = this.cur(s).text.split('\n');
    const i = Number(line);
    const m = lines[i] && lines[i].match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](.*)$/);
    if (!m) throw bad('Essa linha não é uma tarefa');
    const want = typeof checked === 'boolean' ? checked : m[2] === ' ';
    lines[i] = `${m[1]}[${want ? 'x' : ' '}]${m[3]}`;
    this.pushVersion(user, s, lines.join('\n'), 'check', `${want ? 'marcou' : 'desmarcou'}: ${m[3].trim().slice(0, 80)}`);
    this.audit(user, 'segment.check', { note: n.title, checked: want });
    this.touch(user, n, 'check', sid);
    return this.segOut(user, n, s);
  }
  // Reagir com emoji a um trecho (de novo com o mesmo emoji tira a reação). Não conta como alteração do texto.
  react(user, nid, sid, emoji) {
    const n = this.noteOf(user, nid, 'write');
    const s = this.seg(n, sid);
    if (s.deleted) throw bad('Trecho apagado');
    emoji = String(emoji || '');
    if (/^sticker:[\w-]+$/.test(emoji)) { // reagir com figurinha: "sticker:<id do arquivo>"
      const f = this.state.files[emoji.slice(8)];
      if (!f || !f.sticker) throw bad('Figurinha inválida');
    } else if (!emoji || emoji.length > 16 || /[\s\n<>]/.test(emoji)) throw bad('Emoji inválido');
    s.reactions = s.reactions || {};
    const list = s.reactions[emoji] || [];
    const i = list.indexOf(user.id);
    if (i >= 0) list.splice(i, 1);
    else {
      if (!s.reactions[emoji] && Object.keys(s.reactions).length >= 30) throw bad('Reações demais neste trecho');
      list.push(user.id);
    }
    if (list.length) s.reactions[emoji] = list; else delete s.reactions[emoji];
    this.touch(user, n, 'react', sid);
    return this.segOut(user, n, s);
  }
  // Marca a última vez que a pessoa esteve conectada (aparece para a equipe como "visto há…")
  touchSeen(userId) {
    const u = this.state.users[userId];
    if (u) { u.lastSeen = Date.now(); this.save(); }
  }
  markRead(user, nid) {
    const n = this.noteOf(user, nid, 'read');
    (this.state.reads[user.id] = this.state.reads[user.id] || {})[n.id] = Date.now();
    this.save();
    return { ok: true };
  }

  /* ───────────── anexos ───────────── */
  filePath(id) { return path.join(this.dir, 'files', id); }
  newFileId() { return uid(10); }
  registerFile(user, pid, { id, name, type, size }) {
    this.need(user, pid, 'write');
    const f = { id, pid, name: String(name || 'arquivo').slice(0, 200), type: String(type || 'application/octet-stream').slice(0, 100), size, by: user.id, ts: Date.now() };
    this.state.files[id] = f;
    this.audit(user, 'file.add', { name: f.name, size });
    this.save();
    return f;
  }
  fileFor(user, id) {
    const f = this.state.files[id];
    if (!f) throw notFound('Arquivo não encontrado');
    if (f.sticker) return f; // figurinhas são da equipe toda (e continuam abrindo no histórico mesmo se removidas da lista)
    this.need(user, f.pid, 'read');
    return f;
  }
  registerSticker(user, { id, name, type, size }) {
    if (!/^image\//.test(String(type || ''))) throw bad('Sticker precisa ser uma imagem');
    const f = { id, pid: null, sticker: true, name: String(name || 'sticker').slice(0, 80), type: String(type).slice(0, 100), size, by: user.id, ts: Date.now() };
    this.state.files[id] = f;
    this.audit(user, 'sticker.add', { name: f.name });
    this.save();
    this.notify({ type: 'stickers' });
    return f;
  }
  listStickers() {
    return Object.values(this.state.files).filter((f) => f.sticker && !f.removed).map((f) => ({ id: f.id, name: f.name, by: f.by, ts: f.ts })).sort((a, b) => a.ts - b.ts);
  }
  removeSticker(user, id) {
    const f = this.state.files[id];
    if (!f || !f.sticker || f.removed) throw notFound('Sticker não encontrado');
    if (f.by !== user.id && user.role !== 'admin') throw forbidden('Só quem enviou (ou o administrador) remove o sticker');
    f.removed = true; // sai da lista, mas as mensagens antigas continuam mostrando a imagem
    this.audit(user, 'sticker.remove', { name: f.name });
    this.save();
    this.notify({ type: 'stickers' });
  }
}

module.exports = { Core, HttpError, ROLE_RANK, MAX_TEXT };
