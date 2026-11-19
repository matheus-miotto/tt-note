// Projetos compartilhados: cliente do servidor colaborativo (login, projetos, notas em trechos com autor, histórico,
// checkbox com autor, anexos e "não lidos"). O servidor é o dono dos dados; aqui só se desenha e se pede.
import { Marked } from 'marked';
import { EMOJI_CATS, BIG_STICKERS } from './emoji.js';
import { decodeGif, encodeGif } from './gif.js';
import { searchEmoji } from './emoji-search.js';
import { cacheGet, cachePut, cacheClear } from './notecache.js';
import { copyText } from './livepreview.js';
import { findPolls, parsePoll, firstPoll, buildPoll } from '../server/poll.js';
import { openPollDialog } from './polldialog.js';
import { spellBox } from './spell.js';

const COLORS = ['#61afef', '#e5c07b', '#98c379', '#e06c75', '#c678dd', '#d19a66', '#56b6c2', '#f78fb3'];
const KIND = { create: 'criou', edit: 'editou', check: 'marcou tarefa', restore: 'restaurou', delete: 'apagou' };
const ROLE_SHORT = { read: 'Só lê', write: 'Escreve', edit: 'Edita todos', admin: 'Administra' };
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Texto dos colegas é "não confiável": HTML cru vira texto (só o Markdown é interpretado)
const md = new Marked({ gfm: true, breaks: true, renderer: { html: (tok) => esc(typeof tok === 'string' ? tok : tok.text || '') } });
const pad = (n) => String(n).padStart(2, '0');
// arquivos colados: algumas origens só informam em items (não em files)
const clipFiles = (e) => { const d = e.clipboardData; if (!d) return []; const out = [...(d.files || [])]; const tp = (d.getData('text/plain') || '').trim(); if (tp && (!out.some((f) => /^image\//.test(f.type)) || /[\t\r\n]/.test(tp) || /<table/i.test(d.getData('text/html') || ''))) return []; /* texto de verdade (ex.: células do Excel): cola o texto, não a imagem que vem junto */ if (!out.length) for (const it of [...(d.items || [])]) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); } return out; };
function fmt(ts) {
  const d = new Date(ts); const n = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === n.toDateString() ? hm : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}`;
}

function createServerView(env, conn0) {
  const api = window.api;
  const cid = conn0.id;
  let st = { url: conn0.url, user: conn0.user, token: conn0.token, connected: !!conn0.connected, label: conn0.label || '' };
  let users = new Map();
  let projects = [];
  const notesByPid = new Map();
  const expanded = new Set();
  let groups = []; // pastas de projetos (só organização; a permissão continua por projeto)
  const gKey = 'tt.shGroups:' + cid;
  const gCollapsed = new Set((() => { try { return JSON.parse(localStorage.getItem(gKey) || '[]'); } catch { return []; } })());
  const saveGroups = () => { try { localStorage.setItem(gKey, JSON.stringify([...gCollapsed])); } catch { /* sem gravar */ } };
  let treeOpen = true;
  let online = new Set(); // quem está com o app aberto agora
  let onlineRefresh = null;
  let open = null; // nota aberta numa aba: { host, pid, nid, note, newSince, editing, ui }
  const drafts = new Map(); // nid -> texto digitado e ainda não enviado

  let lastOk = 0; // última vez que o servidor respondeu a um pedido
  const call = (m, p, b) => api.srvReq(cid, m, p, b).then((r) => { if (r && r.s > 0) lastOk = Date.now(); return r; });
  const reachable = () => Date.now() - lastOk < 40000;
  const hostOf = () => { try { return new URL(st.url).host; } catch { return st.url; } };
  const me = () => st.user;
  const isAdmin = () => !!st.user && st.user.role === 'admin';
  const who = (id) => users.get(id) || { id, name: 'usuário removido', color: '#7f848e' };
  const nameSpan = (id) => { const u = who(id); const s = el('span', 'sh-name', u.removed ? `${u.name} (removido)` : u.name); s.style.color = u.color; if (u.removed) s.title = 'Usuário removido'; return s; };
  const fileUrl = (id) => `${st.url}/api/files/${encodeURIComponent(id)}?t=${encodeURIComponent(st.token || '')}`;

  async function req(method, path, body) {
    const r = await call(method, path, body);
    if (r.s >= 200 && r.s < 300) return r.j;
    throw new Error((r.j && r.j.error) || 'Erro ' + r.s);
  }
  const tryReq = async (...a) => { try { return await req(...a); } catch (e) { env.toast(e.message); return null; } };

  /* ───────────── dados ───────────── */
  async function refreshProjects() { // completo: tudo em paralelo (antes era um pedido depois do outro)
    if (!st.user) { projects = []; return; }
    try {
      const [pr, gr, us] = await Promise.all([req('GET', '/api/projects'), req('GET', '/api/groups').catch(() => []), req('GET', '/api/users')]);
      projects = pr; groups = gr; users = new Map(us.map((u) => [u.id, u]));
      await Promise.all([...expanded].map(async (pid) => {
        if (!projects.some((p) => p.id === pid)) { expanded.delete(pid); return; }
        try { notesByPid.set(pid, await req('GET', `/api/projects/${pid}/notes`)); } catch { /* mantém a lista antiga */ }
      }));
    } catch (e) { /* sem rede: mantém o que já tinha */ }
    env.rerenderTree();
  }
  // Atualização leve (chegou mensagem, marcou como lida): só a lista de projetos (contadores) e as notas do projeto que mudou.
  // Pedidos próximos viram um só.
  let liteTimer = null; let liteP = null; const liteLists = new Set();
  function refreshLite(pid) {
    if (pid && expanded.has(pid)) liteLists.add(pid);
    if (!liteP) {
      liteP = new Promise((res) => {
        liteTimer = setTimeout(async () => {
          const lists = [...liteLists]; liteLists.clear(); liteP = null;
          try {
            const [pr] = await Promise.all([req('GET', '/api/projects'), ...lists.map(async (id) => { try { notesByPid.set(id, await req('GET', `/api/projects/${id}/notes`)); } catch { /* mantém */ } })]);
            if (st.user) projects = pr;
          } catch { /* sem rede */ }
          env.rerenderTree(); res();
        }, 250);
      });
    }
    return liteP;
  }
  async function loadNotes(pid) {
    try { notesByPid.set(pid, await req('GET', `/api/projects/${pid}/notes`)); } catch (e) { env.toast(e.message); }
    env.rerenderTree();
  }

  async function refreshOnline() {
    try { online = new Set(((await req('GET', '/api/presence')) || {}).online || []); env.rerenderTree(); updateOnlineUi(); if (onlineRefresh) onlineRefresh(); } catch { /* sem rede */ }
  }
  async function init() {
    if (st.user) { await refreshProjects(); loadStickers(); refreshOnline(); }
    env.rerenderTree();
  }

  function onEvent(ev) {
    if (ev.type === 'conn') {
      st.connected = !!ev.ok;
      if (ev.reason === 'login') { st.user = null; projects = []; env.toast(`Sua sessão em ${st.label || hostOf()} expirou: entre de novo (＋ no bloco Compartilhado)`); }
      if (ev.ok) { refreshProjects(); refreshOnline(); if (open && open.host.isConnected) reload(); } else env.rerenderTree(); // voltou a conexão: confere de novo o que ficou para trás
      if (open) renderBanner();
      return;
    }
    if (ev.type === 'presence') {
      online = new Set(ev.online || []);
      env.rerenderTree();
      updateOnlineUi();
      if ([...online].some((i) => !users.has(i))) req('GET', '/api/users').then((l) => { users = new Map(l.map((u) => [u.id, u])); if (onlineRefresh) onlineRefresh(); }).catch(() => {}); // só pede de novo se apareceu alguém desconhecido
      return;
    }
    if (ev.type === 'project') { refreshProjects(); return; }
    if (ev.type === 'stickers') { loadStickers(); return; }
    if (ev.type === 'nudge') { if (env.nudged) env.nudged(cid, { ...ev, fromName: who(ev.from).name }); return; }
    if (ev.type === 'note') {
      if (env.canvasEvent) env.canvasEvent(cid, ev);
      const before = (projects.find((p) => p.id === ev.pid) || {}).mine || 0;
      const ownAdd = ev.by === (me() && me().id) && ev.what === 'add' && open && open.nid === ev.nid; // minha própria mensagem na nota aberta: os contadores não mudam
      (ownAdd ? Promise.resolve() : refreshLite(ev.pid)).then(() => {
        const p = projects.find((x) => x.id === ev.pid);
        if (!p || (p.mine || 0) <= before || ev.by === (me() && me().id)) return;
        if (!(env.notifyMine && env.notifyMine())) return;
        if (document.hasFocus() && open && open.nid === ev.nid) return; // já está olhando para essa nota
        try {
          const nt = new Notification(`${who(ev.by).name} escreveu para você`, { body: `${p.name}${st.label ? ' · ' + st.label : ''}`, silent: false });
          nt.onclick = () => { window.focus(); env.openTab({ conn: cid, pid: ev.pid, nid: ev.nid, title: '' }); };
        } catch { /* sem permissão de aviso */ }
      });
      if (open && open.nid === ev.nid && open.host.isConnected) noteChanged(ev);
    }
  }

  /* ───────────── perguntas pela paleta ───────────── */
  const ask = (placeholder, o = {}) => new Promise((res) => env.showPalette({ placeholder, password: !!o.password, initial: o.initial || '', onFree: (t) => res(t.trim()), items: () => [] }));
  const pick = (placeholder, items) => new Promise((res) => env.showPalette({ placeholder, items: () => items, onSelect: (it) => res(it) }));

  const logout = () => { cacheClear(cid + ':'); return env.removeServer(cid); };

  /* ───────────── quem está online ───────────── */
  const ago = (ts) => {
    if (!ts) return 'nunca entrou';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'visto agora há pouco';
    if (m < 60) return `visto há ${m} min`;
    if (m < 1440) return `visto há ${Math.round(m / 60)} h`;
    return `visto há ${Math.round(m / 1440)} dia(s)`;
  };
  function updateOnlineUi() {
    if (!open || !open.ui.onl) return;
    const n = online.size;
    open.ui.onl.textContent = `👥 ${n} online`;
    open.ui.onl.classList.toggle('on', n > 0);
    open.ui.onl.title = n ? 'Online agora: ' + [...online].map((i) => who(i).name).join(', ') : 'Ninguém online agora';
  }
  function onlineModal() {
    const { panel } = modal('Quem está online', () => { onlineRefresh = null; });
    const body = el('div', 'sh-ubody');
    panel.append(body);
    const draw = () => {
      if (!body.isConnected) { onlineRefresh = null; return; }
      body.textContent = '';
      const list = [...users.values()].filter((u) => !u.removed && !u.disabled).sort((a, b) => (online.has(b.id) ? 1 : 0) - (online.has(a.id) ? 1 : 0) || (b.lastSeen || 0) - (a.lastSeen || 0) || a.name.localeCompare(b.name));
      body.append(el('div', 'sh-usub', `${online.size} online agora`));
      for (const u of list) {
        const row = el('div', 'sh-urow' + (online.has(u.id) ? '' : ' off'));
        const dot = el('span', 'sh-pdot' + (online.has(u.id) ? ' on' : ''));
        const nm = el('span', 'sh-uname2', u.name); nm.style.color = u.color;
        row.append(dot, nm);
        if (st.user && u.id === st.user.id) row.append(el('span', 'sh-chip', 'você'));
        row.append(el('span', 'sh-sp'), el('span', 'sh-chip', online.has(u.id) ? 'online agora' : ago(u.lastSeen)));
        if (st.user && u.id !== st.user.id && online.has(u.id) && u.nudge) { const nb = el('button', 'sh-btn', '📳'); nb.title = `Chamar a atenção de ${u.name}`; nb.onclick = () => sendNudge(u); row.append(nb); }
        body.append(row);
      }
    };
    onlineRefresh = draw;
    draw();
  }

  /* ───────────── chamar a atenção (tremer a janela da pessoa), só com a permissão dela ───────────── */
  async function sendNudge(u) {
    const r = await call('POST', '/api/nudge', { to: u.id, nid: open ? open.nid : undefined });
    if (r.s >= 200 && r.s < 300) env.toast(`📳 Chamei a atenção de ${u.name}`);
    else env.toast((r.j && r.j.error) || 'Não consegui chamar a atenção');
  }
  async function nudgePick() {
    if (!open) return;
    try { users = new Map((await req('GET', '/api/users')).map((u) => [u.id, u])); } catch { /* usa a lista que já tinha */ }
    let people = open.people;
    if (!people) { try { people = await req('GET', `/api/projects/${open.pid}/people`); } catch { people = []; } }
    const items = people.filter((p) => !st.user || p.id !== st.user.id).map((p) => {
      const u = users.get(p.id) || p;
      const isOn = online.has(p.id);
      const why = !isOn ? 'offline agora' : !u.nudge ? 'não aceita chamadas de atenção' : 'online · aceita';
      return { label: p.name, detail: why, u, ok: isOn && !!u.nudge, why };
    }).sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || a.label.localeCompare(b.label));
    if (!items.length) return env.toast('Não há outras pessoas neste projeto.');
    const it = await pick('Chamar a atenção de quem? (só aparece "aceita" para quem permitiu)', items);
    if (!it) return;
    if (!it.ok) return env.toast(`${it.label}: ${it.why}. ${it.u.nudge ? '' : 'Ela precisa permitir em ☁ Compartilhado → Chamar atenção…'}`);
    sendNudge(it.u);
  }
  // Quem pode tremer a MINHA tela (só eu decido; padrão: ninguém)
  async function nudgeSettings() {
    let cfg;
    try { cfg = (await req('GET', '/api/me')).nudge || { mode: 'none', allow: [] }; } catch (e) { return env.toast(e.message); }
    try { users = new Map((await req('GET', '/api/users')).map((u) => [u.id, u])); } catch { /* usa o que tem */ }
    const { panel } = modal('Chamar a minha atenção (tremer a tela)');
    panel.append(el('div', 'sh-hint', 'Quando alguém usa "📳 Chamar atenção" para você, a janela do app pisca na barra de tarefas, treme e toca um som. Só acontece se você permitir aqui, e você pode mudar ou desligar a qualquer hora. Para não virar incômodo: cada pessoa só pode te chamar 1 vez a cada 15 segundos (e 6 por minuto no total).'));
    const box = el('div', 'sh-ubody'); panel.append(box);
    let chain = Promise.resolve();
    const save = () => { chain = chain.then(() => tryReq('PATCH', '/api/me', { nudge: { mode: cfg.mode, allow: cfg.allow } })); return chain; };
    const draw = () => {
      box.textContent = '';
      for (const [v, label] of [['none', 'Ninguém (padrão)'], ['list', 'Só as pessoas que eu escolher'], ['all', 'Todos que dividem projeto comigo']]) {
        const row = el('label', 'sh-urow'); row.style.cursor = 'pointer';
        const r = document.createElement('input'); r.type = 'radio'; r.name = 'nudge-mode'; r.checked = cfg.mode === v;
        r.onchange = async () => { cfg.mode = v; await save(); draw(); env.toast(v === 'none' ? 'Ninguém pode chamar a sua atenção' : v === 'all' ? 'Todos podem chamar a sua atenção' : 'Só quem você escolher pode chamar a sua atenção'); };
        row.append(r, el('span', null, ' ' + label));
        box.append(row);
      }
      if (cfg.mode === 'list') {
        box.append(el('div', 'sh-usub', 'Quem pode me chamar:'));
        for (const u of [...users.values()].filter((x) => !x.removed && !x.disabled && (!st.user || x.id !== st.user.id)).sort((a, b) => a.name.localeCompare(b.name))) {
          const row = el('label', 'sh-urow'); row.style.cursor = 'pointer';
          const c = document.createElement('input'); c.type = 'checkbox'; c.checked = cfg.allow.includes(u.id);
          c.onchange = async () => { cfg.allow = c.checked ? [...new Set([...cfg.allow, u.id])] : cfg.allow.filter((x) => x !== u.id); await save(); };
          const dot = el('span', 'sh-dot2'); dot.style.background = u.color;
          const nm = el('span', 'sh-uname2', u.name); nm.style.color = u.color;
          row.append(c, dot, nm);
          box.append(row);
        }
      }
    };
    draw();
  }

  /* ───────────── administração (só o administrador): janelas de usuários e de acesso ───────────── */
  const ROLE_NAME = { read: 'só lê', write: 'escreve (edita só o que é dele)', edit: 'escreve e edita o dos outros', admin: 'administra o projeto' };
  function modal(title, onClose) {
    const ov = el('div', 'sh-lightbox sh-modal');
    const panel = el('div', 'sh-panel');
    panel.onclick = (e) => e.stopPropagation();
    const hd = el('div', 'sh-phead');
    hd.append(el('b', null, title), el('span', 'sh-sp'));
    const x = el('button', 'sh-ic', '×');
    x.onclick = () => { ov.remove(); if (onClose) onClose(); };
    hd.append(x);
    panel.append(hd);
    ov.append(panel);
    ov.onclick = () => { ov.remove(); if (onClose) onClose(); };
    document.body.append(ov);
    return { ov, panel };
  }
  const field = (label, input) => { const f = el('label', 'sh-field'); f.append(el('span', null, label), input); return f; };
  const mkSelect = (opts, value, onchange) => {
    const s = document.createElement('select');
    s.className = 'sh-select';
    for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; s.append(o); }
    s.value = value;
    s.onchange = () => onchange(s.value);
    return s;
  };

  // Janela "Usuários": criar, editar (nome, cor, senha, tipo), desativar e remover — tudo numa tela
  async function usersModal() {
    const { panel } = modal('Usuários do servidor');
    const body = el('div', 'sh-ubody');
    panel.append(body);
    let showRemoved = false;
    let editingPw = null;
    async function draw() {
      const list = await tryReq('GET', '/api/users');
      if (!list || !body.isConnected) return;
      users = new Map(list.map((u) => [u.id, u]));
      body.textContent = '';
      // novo usuário
      const form = el('div', 'sh-unew');
      const nm = el('input', 'sh-input'); nm.placeholder = 'Nome (como vai aparecer nas notas)'; nm.maxLength = 40;
      const pw = el('input', 'sh-input'); pw.type = 'password'; pw.placeholder = 'Senha (mínimo 8)'; pw.autocomplete = 'new-password';
      const rl = mkSelect([['user', 'Usuário comum'], ['admin', 'Administrador']], 'user', () => {});
      const col = el('input', 'sh-color'); col.type = 'color'; col.value = COLORS[users.size % COLORS.length]; col.title = 'Cor do nome';
      const go = el('button', 'sh-send', '＋ Criar usuário');
      const create = async () => {
        if (!nm.value.trim() || pw.value.length < 8) { env.toast('Informe o nome e uma senha de pelo menos 8 caracteres'); return; }
        const u = await tryReq('POST', '/api/users', { name: nm.value.trim(), password: pw.value, role: rl.value, color: col.value });
        if (u) { env.toast(`Usuário ${u.name} criado`); await draw(); refreshProjects(); }
      };
      go.onclick = create;
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); e.stopPropagation(); });
      nm.addEventListener('keydown', (e) => e.stopPropagation());
      form.append(nm, pw, rl, col, go);
      body.append(el('div', 'sh-usub', 'Novo usuário'), form);
      // lista
      const head = el('div', 'sh-usub');
      head.append('Usuários ');
      const chk = el('label', 'sh-chk');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = showRemoved;
      cb.onchange = () => { showRemoved = cb.checked; draw(); };
      chk.append(cb, ' mostrar removidos');
      head.append(el('span', 'sh-sp'), chk);
      body.append(head);
      for (const u of [...users.values()].filter((x) => showRemoved || !x.removed).sort((a, b) => (a.removed ? 1 : 0) - (b.removed ? 1 : 0) || a.name.localeCompare(b.name))) {
        const row = el('div', 'sh-urow' + (u.removed ? ' gone' : '') + (u.disabled ? ' off' : ''));
        const c = el('input', 'sh-color'); c.type = 'color'; c.value = u.color; c.title = 'Mudar a cor'; c.disabled = !!u.removed;
        c.onchange = async () => { await tryReq('PATCH', `/api/users/${u.id}`, { color: c.value }); draw(); };
        const name = el('input', 'sh-uname'); name.value = u.name; name.disabled = !!u.removed; name.title = 'Clique para renomear (Enter salva)';
        name.style.color = u.color;
        name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); else if (e.key === 'Escape') { name.value = u.name; name.blur(); } });
        name.onblur = async () => { const v = name.value.trim(); if (v && v !== u.name) { await tryReq('PATCH', `/api/users/${u.id}`, { name: v }); draw(); refreshProjects(); } else name.value = u.name; };
        row.append(c, name);
        if (u.removed) { row.append(el('span', 'sh-chip', 'removido'), el('span', 'sh-sp')); body.append(row); continue; }
        const role = mkSelect([['user', 'Usuário'], ['admin', 'Administrador']], u.role, async (v) => { await tryReq('PATCH', `/api/users/${u.id}`, { role: v }); draw(); });
        row.append(role);
        if (u.disabled) row.append(el('span', 'sh-chip', 'desativado'));
        if (st.user && u.id === st.user.id) row.append(el('span', 'sh-chip', 'você'));
        row.append(el('span', 'sh-sp'));
        const mk = (txt, title, fn, cls) => { const b = el('button', 'sh-btn' + (cls ? ' ' + cls : ''), txt); b.title = title; b.onclick = fn; row.append(b); };
        mk('🔑 Senha', 'Trocar a senha', () => { editingPw = editingPw === u.id ? null : u.id; draw(); });
        if (!(st.user && u.id === st.user.id)) {
          mk(u.disabled ? '▶ Reativar' : '⏸ Desativar', u.disabled ? 'Deixar entrar de novo' : 'Impede o login sem apagar nada', async () => { await tryReq('PATCH', `/api/users/${u.id}`, { disabled: !u.disabled }); draw(); });
          mk('🗑 Remover', 'Remove o usuário (o que ele escreveu continua nas notas)', async () => {
            if ((await env.confirm(`Remover o usuário "${u.name}"?\n\nEle perde o acesso e sai de todos os projetos. O que ele escreveu continua nas notas, com o nome dele.`, ['Remover', 'Cancelar'])) !== 0) return;
            if (await tryReq('DELETE', `/api/users/${u.id}`).then((r) => r !== null)) { env.toast(`Usuário ${u.name} removido`); draw(); refreshProjects(); }
          }, 'danger');
        }
        body.append(row);
        if (editingPw === u.id) {
          const pr = el('div', 'sh-pwrow');
          const p1 = el('input', 'sh-input'); p1.type = 'password'; p1.placeholder = `Nova senha de ${u.name} (mínimo 8)`; p1.autocomplete = 'new-password';
          const ok = el('button', 'sh-send', 'Salvar senha');
          const save = async () => { if (p1.value.length < 8) { env.toast('Mínimo de 8 caracteres'); return; } if (await tryReq('PATCH', `/api/users/${u.id}`, { password: p1.value }).then((r) => r !== null)) { env.toast('Senha trocada (as sessões antigas foram derrubadas)'); editingPw = null; draw(); } };
          ok.onclick = save;
          p1.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') save(); });
          pr.append(p1, ok);
          body.append(pr);
          setTimeout(() => p1.focus(), 0);
        }
      }
    }
    draw();
  }
  async function newGroup() {
    const name = await ask('Nome do novo grupo de projetos (ex.: Clientes, Pessoal)');
    if (!name) return null;
    const g = await tryReq('POST', '/api/groups', { name });
    if (g) await refreshProjects();
    return g;
  }
  async function moveToGroup(p) {
    const items = groups.map((g) => ({ label: '▤ ' + g.name, detail: p.group === g.id ? 'grupo atual' : '', gid: g.id }));
    items.push({ label: '— Sem grupo —', detail: p.group ? '' : 'situação atual', gid: '' }, { label: '＋ Novo grupo…', gid: '__new' });
    const it = await pick(`Mover "${p.name}" para qual grupo?`, items);
    if (!it) return;
    let gid = it.gid;
    if (gid === '__new') { const g = await newGroup(); if (!g) return; gid = g.id; }
    if (await tryReq('PATCH', `/api/projects/${p.id}`, { group: gid || null })) { if (gid) { gCollapsed.delete(gid); saveGroups(); } refreshProjects(); }
  }
  async function newProject(group) {
    const name = await ask('Nome do novo projeto');
    if (!name) return;
    const p = await tryReq('POST', '/api/projects', { name, group: group || undefined });
    if (!p) return;
    await refreshProjects();
    expanded.add(p.id);
    accessModal(p.id);
  }
  // Janela "Quem acessa este grupo": o papel vale para TODOS os projetos do grupo (somado ao papel direto no projeto: vale o mais alto)
  async function groupAccessModal(gid) {
    await refreshProjects();
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    const { panel } = modal(`Quem acessa o grupo "${g.name}"`, () => refreshProjects());
    panel.append(el('div', 'sh-hint', 'O papel escolhido vale para todos os projetos deste grupo (inclusive os que forem criados depois). Se a pessoa também tiver um papel direto em um projeto, vale o mais alto dos dois. Administradores do servidor sempre têm acesso total.'));
    const legend = el('div', 'sh-legend');
    for (const [k, v] of Object.entries(ROLE_NAME)) { const l = el('div'); l.append(el('b', null, ROLE_SHORT[k] + ': '), v); legend.append(l); }
    panel.append(legend);
    const members = { ...(g.members || {}) };
    const list = el('div', 'sh-ubody');
    panel.append(list);
    let chain = Promise.resolve();
    for (const u of [...users.values()].filter((x) => !x.removed && !x.disabled).sort((a, b) => a.name.localeCompare(b.name))) {
      const row = el('div', 'sh-urow');
      const dot = el('span', 'sh-dot2'); dot.style.background = u.color;
      const nm = el('span', 'sh-uname2', u.name); nm.style.color = u.color;
      row.append(dot, nm);
      if (u.role === 'admin') { row.append(el('span', 'sh-sp'), el('span', 'sh-chip', 'administrador do servidor: acesso total')); list.append(row); continue; }
      const sel = mkSelect([['', 'Sem acesso pelo grupo'], ['read', 'Só lê'], ['write', 'Escreve (edita só as dele)'], ['edit', 'Escreve e edita as dos outros'], ['admin', 'Administra os projetos do grupo']], members[u.id] || '', async (v) => {
        if (v) members[u.id] = v; else delete members[u.id];
        chain = chain.then(() => tryReq('PATCH', `/api/groups/${gid}`, { members: { ...members } })); // uma mudança de cada vez, sempre com a lista completa
        const r = await chain;
        if (r) env.toast(`${u.name}: ${v ? ROLE_NAME[v] : 'sem acesso pelo grupo'}`);
      });
      row.append(el('span', 'sh-sp'), sel);
      list.append(row);
    }
    if (!list.children.length) list.append(el('div', 'sh-hint', 'Ainda não há outros usuários. Crie-os em ☁ Compartilhado → Usuários…'));
  }
  // Janela "Quem acessa este projeto": uma lista com todos os usuários e o que cada um pode fazer
  async function accessModal(pid) {
    await refreshProjects();
    const p = projects.find((x) => x.id === pid);
    if (!p) return;
    const { panel } = modal(`Quem acessa "${p.name}"`, () => refreshProjects());
    panel.append(el('div', 'sh-hint', 'Escolha o que cada pessoa pode fazer neste projeto. A mudança vale na hora. Administradores do servidor sempre têm acesso total.'));
    const legend = el('div', 'sh-legend');
    for (const [k, v] of Object.entries(ROLE_NAME)) { const l = el('div'); l.append(el('b', null, ROLE_SHORT[k] + ': '), v); legend.append(l); }
    panel.append(legend);
    const members = { ...(p.members || {}) };
    const list = el('div', 'sh-ubody');
    panel.append(list);
    const NONE = '';
    let chain = Promise.resolve();
    for (const u of [...users.values()].filter((x) => !x.removed && !x.disabled).sort((a, b) => a.name.localeCompare(b.name))) {
      const row = el('div', 'sh-urow');
      const dot = el('span', 'sh-dot2'); dot.style.background = u.color;
      const nm = el('span', 'sh-uname2', u.name); nm.style.color = u.color;
      row.append(dot, nm);
      if (u.role === 'admin') { row.append(el('span', 'sh-sp'), el('span', 'sh-chip', 'administrador do servidor: acesso total')); list.append(row); continue; }
      const sel = mkSelect([[NONE, 'Sem acesso'], ['read', 'Só lê'], ['write', 'Escreve (edita só as dele)'], ['edit', 'Escreve e edita as dos outros'], ['admin', 'Administra o projeto']], members[u.id] || NONE, async (v) => {
        if (v) members[u.id] = v; else delete members[u.id];
        chain = chain.then(() => tryReq('PATCH', `/api/projects/${pid}`, { members: { ...members } })); // uma mudança de cada vez, sempre com a lista completa
        const r = await chain;
        if (r) env.toast(`${u.name}: ${v ? ROLE_NAME[v] : 'sem acesso'}`);
      });
      row.append(el('span', 'sh-sp'));
      const inh = p.inherited && p.inherited[u.id];
      if (inh) { const c = el('span', 'sh-chip', `do grupo: ${ROLE_SHORT[inh] || inh}`); c.title = 'Esta pessoa já recebe esse papel pelo grupo do projeto. Vale o mais alto entre o do grupo e o do projeto.'; row.append(c); }
      row.append(sel);
      list.append(row);
    }
    if (!list.children.length) list.append(el('div', 'sh-hint', 'Ainda não há outros usuários. Crie-os em ☁ Compartilhado → Usuários…'));
  }

  /* ───────────── árvore na lateral ───────────── */
  function renderTree(box) {
    const head = el('div', 'row root shared-root');
    const dot = el('span', 'sh-dot' + (st.user ? (st.connected ? ' on' : ' off') : ''));
    dot.title = st.user ? (st.connected ? 'Conectado' : 'Sem conexão — reconectando…') : 'Sessão encerrada';
    const total = projects.reduce((a, p) => a + (p.unread || 0), 0);
    const label = st.label || hostOf();
    head.append(el('span', 'tw', treeOpen ? '▾' : '▸'), el('span', 'rn', '☁ ' + label), dot);
    if (st.connected && online.size) { const oc = el('span', 'sh-onchip', `👥 ${online.size}`); oc.title = 'Online agora: ' + [...online].map((i) => who(i).name).join(', ') + ' — clique para ver'; oc.onclick = (e) => { e.stopPropagation(); onlineModal(); }; head.append(oc); }
    if (total) head.append(el('span', 'sh-badge', String(total)));
    head.title = `${st.user ? st.user.name : '(sem login)'} em ${st.url}`;
    head.onclick = () => { treeOpen = !treeOpen; env.rerenderTree(); };
    head.oncontextmenu = (e) => {
      e.preventDefault(); e.stopPropagation();
      const items = [];
      if (isAdmin()) items.push(['Novo projeto…', () => newProject()], ['Novo grupo de projetos…', newGroup], ['Usuários…', usersModal], null);
      if (!st.user) items.unshift(['Entrar de novo…', () => env.reconnect({ url: st.url, name: conn0.name, label: st.label })], null);
      if (st.user) items.push(['Quem está online…', onlineModal], ['Chamar atenção: quem pode tremer a minha tela…', nudgeSettings]);
      items.push(['Atualizar', refreshProjects], ['Renomear este servidor…', async () => { const t = await ask('Nome para este servidor', { initial: st.label || hostOf() }); if (t) env.renameServer(cid, t); }]);
      if (st.user) items.push(['Alterar minha senha…', async () => { const pw = await ask('Sua nova senha (mínimo 8)', { password: true }); if (pw && await tryReq('PATCH', '/api/me', { password: pw })) env.toast('Senha trocada. Entre de novo.'); }]);
      items.push(null, [`Sair deste servidor${st.user ? ' (' + st.user.name + ')' : ''}`, logout]);
      env.showMenu(e.clientX, e.clientY, items);
    };
    box.append(head);
    if (!st.user || !treeOpen) return;
    if (!projects.length) box.append(el('div', 'empty', isAdmin() ? 'Nenhum projeto ainda. Clique direito no servidor → Novo projeto…' : 'Você ainda não tem acesso a nenhum projeto.'));
    const renderProject = (p, pad) => {
      const row = el('div', 'row sh-proj');
      row.style.paddingLeft = pad + 'px';
      row.append(el('span', 'tw', expanded.has(p.id) ? '▾' : '▸'), el('span', 'rn', p.name));
      if (p.mine) { const mb = el('span', 'sh-badge sh-mine', '@' + p.mine); mb.title = 'Mensagens para você neste projeto'; row.append(mb); }
      if (p.unread) row.append(el('span', 'sh-badge', String(p.unread)));
      row.title = `${p.name} — ${ROLE_NAME[p.role] || p.role}`;
      row.onclick = () => { if (expanded.has(p.id)) expanded.delete(p.id); else { expanded.add(p.id); loadNotes(p.id); } env.rerenderTree(); };
      row.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        const items = [];
        if (p.role !== 'read') items.push(['Nova nota…', () => newNote(p.id)], ['Novo canvas…', () => newNote(p.id, 'canvas')]);
        if (p.role === 'admin') items.push(['Quem acessa este projeto…', () => accessModal(p.id)], ['Renomear projeto…', async () => { const n = await ask('Novo nome do projeto', { initial: p.name }); if (n) { await tryReq('PATCH', `/api/projects/${p.id}`, { name: n }); refreshProjects(); } }]);
        if (p.role === 'admin') items.push(['Mover para o grupo…', () => moveToGroup(p)]);
        if (p.role === 'admin') items.push(['Apagar projeto…', async () => { if ((await env.confirm(`Apagar o projeto "${p.name}" e todas as suas notas para todos?

Os dados ficam guardados no servidor, mas o projeto some para todos.`, ['Apagar', 'Cancelar'])) !== 0) return; if (await tryReq('DELETE', `/api/projects/${p.id}`).then((r) => r !== null)) { for (const n of notesByPid.get(p.id) || []) env.closeSrvTab(cid, n.id); expanded.delete(p.id); env.toast(`Projeto "${p.name}" apagado`); refreshProjects(); } }, 'danger']);
        env.showMenu(e.clientX, e.clientY, items);
      };
      box.append(row);
      if (!expanded.has(p.id)) return;
      for (const n of notesByPid.get(p.id) || []) {
        const r = el('div', 'row sh-note' + (env.activeSrv()?.nid === n.id && env.activeSrv()?.conn === cid ? ' active' : '') + (env.isOpenSrv(cid, n.id) ? ' open' : ''));
        r.style.paddingLeft = (pad + 16) + 'px';
        r.append(el('span', 'rn', (n.type === 'canvas' ? '▦ ' : '') + n.title));
        if (n.mine) { const mb = el('span', 'sh-badge sh-mine', '@' + n.mine); mb.title = 'Mensagens para você (menções e respostas) que você ainda não leu'; r.append(mb); }
        if (n.unread) r.append(el('span', 'sh-badge', String(n.unread)));
        r.title = `${n.title}${n.type === 'canvas' && n.by ? '\nCriado por ' + who(n.by).name : ''}\nÚltima alteração: ${fmt(n.updated)}${n.lastBy ? ' por ' + who(n.lastBy).name : ''}`;
        r.onclick = () => openNote(p.id, n.id, n.title, n.type);
        r.oncontextmenu = (e) => {
          e.preventDefault(); e.stopPropagation();
          const items = [];
          if (p.role !== 'read') items.push(['Renomear nota…', async () => { const t = await ask('Novo título', { initial: n.title }); if (t) { await tryReq('PATCH', `/api/notes/${n.id}`, { title: t }); env.setTabTitle(cid, n.id, t); loadNotes(p.id); } }]);
          if (p.role === 'admin') items.push(['Apagar nota', async () => { if ((await env.confirm(`Apagar a nota "${n.title}" para todos?`, ['Apagar', 'Cancelar'])) === 0) { await tryReq('DELETE', `/api/notes/${n.id}`); env.closeSrvTab(cid, n.id); loadNotes(p.id); } }, 'danger']);
          env.showMenu(e.clientX, e.clientY, items);
        };
        box.append(r);
      }
      if (!(notesByPid.get(p.id) || []).length) { const e0 = el('div', 'row dim', 'Sem notas'); e0.style.paddingLeft = (pad + 16) + 'px'; box.append(e0); }
    };
    const byGroup = new Map();
    const loose = [];
    for (const p of projects) {
      if (p.group && groups.some((g) => g.id === p.group)) { if (!byGroup.has(p.group)) byGroup.set(p.group, []); byGroup.get(p.group).push(p); } else loose.push(p);
    }
    for (const g of groups) {
      const list = byGroup.get(g.id) || [];
      if (!list.length && !isAdmin()) continue;
      const gr = el('div', 'row sh-group');
      gr.style.paddingLeft = '14px';
      const closed = gCollapsed.has(g.id);
      gr.append(el('span', 'tw', closed ? '▸' : '▾'), el('span', 'rn', '▤ ' + g.name), el('span', 'sh-gcount', String(list.length)));
      const gu = list.reduce((a, p) => a + (p.unread || 0), 0);
      if (gu) gr.append(el('span', 'sh-badge', String(gu)));
      gr.title = `Grupo ${g.name} — ${list.length} projeto(s)`;
      gr.onclick = () => { if (gCollapsed.has(g.id)) gCollapsed.delete(g.id); else gCollapsed.add(g.id); saveGroups(); env.rerenderTree(); };
      gr.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        const items = [];
        if (isAdmin()) items.push(['Novo projeto neste grupo…', () => newProject(g.id)], ['Quem acessa este grupo…', () => groupAccessModal(g.id)], ['Renomear grupo…', async () => { const n = await ask('Novo nome do grupo', { initial: g.name }); if (n) { await tryReq('PATCH', `/api/groups/${g.id}`, { name: n }); refreshProjects(); } }], ['Apagar grupo…', async () => { if ((await env.confirm(`Apagar o grupo "${g.name}"?\n\nOs projetos dentro dele NÃO são apagados: só saem do grupo.`, ['Apagar grupo', 'Cancelar'])) !== 0) return; if (await tryReq('DELETE', `/api/groups/${g.id}`).then((r) => r !== null)) { gCollapsed.delete(g.id); saveGroups(); refreshProjects(); } }, 'danger']);
        if (items.length) env.showMenu(e.clientX, e.clientY, items);
      };
      box.append(gr);
      if (closed) continue;
      if (!list.length) { const e0 = el('div', 'row dim', 'Grupo vazio'); e0.style.paddingLeft = '34px'; box.append(e0); }
      for (const p of list) renderProject(p, 26);
    }
    for (const p of loose) renderProject(p, 14);
  }
  async function newNote(pid, type) {
    const title = await ask(type === 'canvas' ? 'Nome do novo canvas' : 'Título da nova nota');
    if (!title) return;
    const n = await tryReq('POST', `/api/projects/${pid}/notes`, { title, type });
    if (!n) return;
    expanded.add(pid);
    await loadNotes(pid);
    openNote(pid, n.id, n.title, n.type);
  }
  function openNote(pid, nid, title, type) { env.openTab({ conn: cid, pid, nid, title, canvas: type === 'canvas' }); }

  /* ───────────── nota aberta ───────────── */
  function show(host, srv) {
    if (open && open.nid !== srv.nid) drafts.set(open.nid, open.ui?.composer?.value || '');
    host.textContent = '';
    const ui = {};
    open = { host, pid: srv.pid, nid: srv.nid, note: null, newSince: null, editing: null, replyTo: null, people: null, thread: null, pending: [], ui };
    const opened = open;
    cacheGet(cid + ':' + srv.nid).then((c) => { // mostra já a última versão guardada; a rede atualiza em seguida
      if (open !== opened || opened.note || !c || !c.note) return;
      opened.note = c.note; opened.fromCache = true; opened.fromCacheFirst = true; opened.newSince = Number.MAX_SAFE_INTEGER;
      renderNote(true); opened.ui.status.textContent = 'Atualizando…';
    });
    req('GET', `/api/projects/${srv.pid}/people`).then((p) => { if (open === opened) opened.people = p; }).catch(() => {});
    const head = el('div', 'sh-head');
    ui.title = el('span', 'sh-title', srv.title || 'Nota');
    ui.title.title = 'Clique para renomear';
    ui.title.onclick = async () => {
      if (!open.note || open.note.role === 'read') return;
      const t = await ask('Novo título da nota', { initial: open.note.title });
      if (t) { await tryReq('PATCH', `/api/notes/${open.nid}`, { title: t }); env.setTabTitle(cid, open.nid, t); reload(); }
    };
    ui.meta = el('span', 'sh-meta');
    ui.gear = el('button', 'sh-btn', '⚙ Regras');
    ui.gear.title = 'Quem pode editar as mensagens de outras pessoas nesta nota';
    ui.gear.hidden = true;
    ui.gear.onclick = rulesModal;
    const refresh = el('button', 'sh-btn', '↻'); refresh.title = 'Atualizar'; refresh.onclick = () => reload();
    ui.onl = el('button', 'sh-btn sh-onl', '👥 0 online'); ui.onl.onclick = onlineModal;
    ui.nudge = el('button', 'sh-btn', '📳 Chamar atenção'); ui.nudge.onclick = nudgePick;
    ui.nudge.title = 'Faz a janela de uma pessoa tremer (como no MSN). Só funciona com quem permitiu.';
    ui.imgBtn = el('button', 'sh-btn', '🖼 Esconder imagens'); ui.imgBtn.onclick = toggleAllMedia;
    ui.imgBtn.title = 'Esconde (ou mostra) todas as imagens e vídeos desta nota. Cada imagem também tem a sua setinha.';
    ui.lat = el('button', 'sh-btn sh-lat', '⏱ …'); ui.lat.onclick = latTest;
    ui.pinBtn = el('button', 'sh-btn', '📌 Fixadas'); ui.pinBtn.title = 'Ver todas as mensagens fixadas'; ui.pinBtn.onclick = pinsModal;
    head.append(ui.title, ui.meta, el('span', 'sh-sp'), ui.pinBtn, ui.lat, ui.imgBtn, ui.nudge, ui.onl, ui.gear, refresh);
    ui.banner = el('div', 'sh-banner'); ui.banner.hidden = true;
    ui.pinBar = el('div', 'sh-pinbar'); ui.pinBar.hidden = true;
    ui.threadBar = el('div', 'sh-threadbar'); ui.threadBar.hidden = true;
    ui.list = el('div', 'sh-list');
    const comp = el('div', 'sh-comp');
    ui.replyBar = el('div', 'sh-replybar'); ui.replyBar.hidden = true;
    ui.composer = el('textarea', 'sh-ta');
    ui.composer.placeholder = 'Escreva aqui…  (Enter envia · Ctrl+Enter quebra a linha · cole uma imagem para anexar)';
    ui.composer.value = drafts.get(srv.nid) || '';
    ui.composer.addEventListener('input', () => { drafts.set(open.nid, ui.composer.value); mentionUpdate(ui.composer); compPreviewSoon(); });
    ui.composer.addEventListener('blur', () => setTimeout(closeMention, 120));
    ui.composer.addEventListener('keydown', (e) => { // Enter envia; Ctrl+Enter (ou Shift+Enter) quebra a linha
      if (mentionKey(e)) { e.stopPropagation(); return; }
      if (e.key === 'Escape' && open.replyTo) { e.preventDefault(); clearReply(); e.stopPropagation(); return; }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) insertAt(ui.composer, '\n'); else send(); }
      e.stopPropagation();
    });
    ui.composer.addEventListener('paste', (e) => { const fs = clipFiles(e); if (fs.length) { e.preventDefault(); e.stopPropagation(); attachModal(fs); } });
    const bar = el('div', 'sh-compbar');
    const attach = el('button', 'sh-btn', '📎 Anexar'); attach.title = 'Imagem, arquivo ou vídeo';
    const fi = document.createElement('input'); fi.type = 'file'; fi.multiple = true; fi.hidden = true;
    fi.onchange = () => { attachModal([...fi.files]); fi.value = ''; };
    attach.onclick = () => fi.click();
    const emo = el('button', 'sh-btn sh-pickbtn', '😊'); emo.title = 'Emoji e stickers';
    emo.onclick = () => { if (picker) closePicker(); else openPicker(emo, { stickers: false, keepOpen: true, onEmoji: (e) => insertAt(ui.composer, e), onSticker: sendSticker }); };
    const stk = el('button', 'sh-btn sh-pickbtn', '🏷 Figurinhas'); stk.title = 'Figurinhas: usar, criar e guardar';
    stk.onclick = () => { if (picker) closePicker(); else openStickerPanel(stk); };
    ui.send = el('button', 'sh-send', 'Enviar'); ui.send.onclick = send;
    ui.status = el('span', 'sh-upl');
    const pbtn = el('button', 'sh-btn', '📊 Enquete'); pbtn.title = 'Criar uma enquete (uma ou várias escolhas)';
    pbtn.onclick = async () => {
      const o0 = open; if (!o0) return;
      const saveImage = async (file) => { // otimiza (como nos anexos) e envia ao projeto; a opção guarda só o endereço
        const f = await optimizeImage(file);
        const name = f.name && f.name.toLowerCase() !== 'image.png' ? f.name : `imagem ${fmt(Date.now()).replace(/[/:]/g, '-')}.png`;
        const r = await api.srvUpload(cid, o0.pid, name, f.type, await f.arrayBuffer());
        if (!(r.s >= 200 && r.s < 300)) throw new Error((r.j && r.j.error) || 'o servidor recusou');
        return { src: 'srv-file:' + r.j.id, alt: name.replace(/\.[^.]+$/, '') };
      };
      const r = await openPollDialog({ shared: true, okLabel: 'Enviar enquete', saveImage });
      if (r && open) queueSend(open, buildPoll(r));
    };
    bar.append(emo, stk, attach, pbtn, fi, ui.status, el('span', 'sh-sp'), ui.send);
    ui.linkPrev = el('div', 'sh-linkprev'); ui.linkPrev.hidden = true;
    comp.append(ui.replyBar, ui.linkPrev, spellBox(ui.composer), bar);
    compPreview();
    host.addEventListener('dragover', (e) => e.preventDefault());
    host.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); attachModal([...e.dataTransfer.files]); } });
    host.append(head, ui.banner, ui.pinBar, ui.threadBar, ui.list, comp);
    renderBanner();
    updateOnlineUi();
    reload(true);
    startLat();
  }
  /* ───────────── latência da conexão (⏱) ───────────── */
  let latTimer = null;
  async function updateLat() {
    const o = open; if (!o || !o.ui.lat || !o.host.isConnected) return;
    let s = null; try { s = await api.srvStats(cid); } catch { /* sem dados */ }
    const b = o.ui.lat;
    if (!st.connected && !reachable()) { b.textContent = '⏱ sem conexão'; b.dataset.q = 'bad'; b.title = 'Sem conexão com o servidor'; return; }
    if (!s || !s.n) { b.textContent = '⏱ …'; b.dataset.q = ''; return; }
    b.textContent = `⏱ ${s.last} ms${st.connected ? '' : ' · sem tempo real'}`;
    b.dataset.q = s.last < 300 ? 'good' : s.last < 1000 ? 'mid' : 'bad';
    b.title = `Último pedido: ${s.last} ms · média ${s.avg} ms · pior ${s.worst} ms (últimos ${s.n})\nFalhas: ${s.fails} · reconexões: ${s.reconnects}\nClique para testar agora.`;
  }
  function startLat() {
    clearInterval(latTimer);
    updateLat();
    latTimer = setInterval(async () => {
      if (!open || !open.host.isConnected) { clearInterval(latTimer); return; }
      let s = null; try { s = await api.srvStats(cid); } catch { /* */ }
      if (st.connected && (!s || Date.now() - s.at > 20000)) { try { await req('GET', '/api/presence'); } catch { /* sem rede */ } } // sem tráfego há um tempo: mede com um pedido leve
      updateLat(); renderBanner();
    }, 6000);
  }
  async function latTest() {
    const t = [];
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); try { await req('GET', '/api/presence'); t.push(Math.round(performance.now() - t0)); } catch { t.push(null); } }
    const ok = t.filter((x) => x != null);
    env.toast(ok.length ? `Latência: ${t.map((x) => (x == null ? 'falhou' : x + ' ms')).join(' · ')} — média ${Math.round(ok.reduce((a, b) => a + b, 0) / ok.length)} ms` : 'Sem resposta do servidor');
    updateLat();
  }
  window.addEventListener('online', () => { api.srvRetry(cid, true); }); // a rede voltou: reconecta já, sem esperar o próximo ciclo
  window.addEventListener('focus', () => { if (!st.connected) api.srvRetry(cid); });

  function renderBanner() {
    if (!open) return;
    const b = open.ui.banner;
    b.classList.remove('soft');
    if (st.connected) { b.hidden = true; return; }
    b.hidden = false; b.textContent = '';
    if (reachable()) { // os pedidos funcionam, só o aviso em tempo real está fora: segue atualizando de poucos em poucos segundos
      b.classList.add('soft');
      b.append('Tempo real indisponível — o servidor responde e a conversa se atualiza a cada poucos segundos. ');
    } else b.append('Sem conexão com o servidor — tentando reconectar. O que você digitar fica guardado aqui. ');
    const r = el('button', 'sh-btn', 'Tentar agora'); r.onclick = async () => { await api.srvRetry(cid, true); }; b.append(r);
  }
  // Sem a conexão em tempo real, vai buscando de tempos em tempos (a nota aberta a cada 5 s; a lista de projetos a cada 20 s)
  let pollN = 0;
  setInterval(() => {
    if (st.connected || !st.user) { pollN = 0; return; }
    pollN++;
    if (open && open.host.isConnected && !document.hidden) fresh();
    if (pollN % 4 === 0) refreshLite();
  }, 5000);

  // Atualizar a nota: nunca duas descargas ao mesmo tempo. Cada pedido (seu ou de um evento) vale "uma descarga que comece
  // depois dele"; se já tem uma em andamento que começou antes, faz mais uma ao terminar; pedidos juntos viram uma só.
  function fresh(first) {
    const o = open;
    if (!o) return Promise.resolve();
    o.seq = (o.seq || 0) + 1;
    if (first) o.wantFirst = true;
    if (o.loading) return o.loading;
    o.loading = (async () => {
      try {
        while ((o.done || 0) < o.seq) {
          const target = o.seq; const f = o.wantFirst; o.wantFirst = false;
          o.lastLoad = Date.now();
          await loadOnce(o, f);
          o.done = target;
        }
      } finally { o.loading = null; }
    })();
    return o.loading;
  }
  const reload = (first) => fresh(first);
  // Avisos do servidor: espera um instante (rajadas viram uma só atualização); ignora o aviso da própria mensagem que já entrou
  function noteChanged(ev) {
    const o = open;
    (o.evs = o.evs || []).push({ at: Date.now(), ev });
    clearTimeout(o.evTimer);
    o.evTimer = setTimeout(() => {
      const list = o.evs; o.evs = [];
      const mine = me() && me().id;
      const need = list.filter((x) => !(x.ev.by === mine && x.ev.what === 'add' && x.ev.sid && o.note && o.note.segments.some((g) => g.id === x.ev.sid)) && !(x.ev.by === mine && (x.ev.what === 'vote' || x.ev.what === 'poll' || x.ev.what === 'pin')) && x.at > (o.lastLoad || 0));
      if (need.length && open === o) fresh();
    }, 120);
  }
  let putTimer = null;
  function cacheSoon(o) { clearTimeout(putTimer); putTimer = setTimeout(() => { if (o.note) cachePut(cid + ':' + o.nid, { at: Date.now(), note: o.note }); }, 800); }
  async function loadOnce(o, first) {
    try {
      const n = await req('GET', `/api/notes/${o.nid}`);
      if (open !== o) return;
      if (first || o.newSince == null || o.fromCache) o.newSince = n.readAt || 0;
      o.note = n; o.fromCache = false; o.ui.status.textContent = '';
      cacheSoon(o);
      if (n.segments.some((g) => !users.has(g.author))) { try { users = new Map((await req('GET', '/api/users')).map((u) => [u.id, u])); } catch { /* usa o que tem */ } }
      env.setTabTitle(cid, o.nid, n.title);
      renderNote(first || o.fromCacheFirst);
      o.fromCacheFirst = false;
      if (o.host.isConnected && !o.host.hidden) {
        const newest = n.segments.reduce((m, g) => Math.max(m, g.versions[g.versions.length - 1].ts), 0);
        if (newest > (n.readAt || 0)) { await call('POST', `/api/notes/${o.nid}/read`); refreshLite(o.pid); } // só marca como lida se há algo novo
      }
    } catch (e) {
      if (open !== o) return;
      if (o.note) { o.ui.status.textContent = 'Sem conexão — mostrando a última versão salva'; return; }
      o.ui.list.textContent = ''; o.ui.list.append(el('div', 'sh-err', e.message));
    }
  }

  function taskLines(text) {
    const out = []; let fence = false;
    text.split('\n').forEach((l, i) => { if (/^\s*(```|~~~)/.test(l)) fence = !fence; else if (!fence && TASK.test(l)) out.push(i); });
    return out;
  }
  // Imagens e vídeos das mensagens podem ser escondidos (setinha na própria imagem) ou todos de uma nota (botão no topo)
  const hideMap = () => { try { return JSON.parse(localStorage.getItem('tt.imgHide') || '{}'); } catch { return {}; } };
  const saveHide = (m) => { try { localStorage.setItem('tt.imgHide', JSON.stringify(m)); } catch { /* sem gravar */ } };
  const allHidden = () => !!(open && hideMap()['n:' + open.nid]);
  function mediaWrap(node, fid, label) {
    const wrap = el('div', 'sh-media');
    const tog = el('button', 'sh-mtog');
    const hidden = () => { const v = hideMap()[fid]; return v === undefined ? allHidden() : v === 1; };
    const apply = () => { const h = hidden(); node.hidden = h; wrap.classList.toggle('hid', h); tog.textContent = `${h ? '▸' : '▾'} ${label}`; tog.title = h ? 'Mostrar' : 'Esconder'; };
    tog.onclick = () => { const m = hideMap(); m[fid] = hidden() ? 0 : 1; saveHide(m); apply(); };
    wrap.append(tog, node);
    apply();
    return wrap;
  }
  function toggleAllMedia() {
    if (!open || !open.note) return;
    const m = hideMap();
    const k = 'n:' + open.nid;
    const now = !m[k];
    m[k] = now ? 1 : 0;
    for (const s of open.note.segments) for (const v of s.versions) for (const x of v.text.matchAll(/srv-file:([\w-]+)/g)) delete m[x[1]]; // vale para todas as imagens da nota
    saveHide(m);
    renderNote();
  }



  /* ───────────── ocultar / exibir mensagem (só no seu aparelho) ───────────── */
  // Oculta: fica só o nome da pessoa e "👁 Exibir"; as respostas a ela também somem. Qualquer interação nova com a mensagem
  // (resposta, reação, edição, tarefa marcada, apagar) exibe de novo: o "carimbo" guardado deixa de bater com o atual.
  const hidMap = () => { try { return JSON.parse(localStorage.getItem('tt.msgHide') || '{}'); } catch { return {}; } };
  const saveHid = (m) => { try { localStorage.setItem('tt.msgHide', JSON.stringify(m)); } catch { /* sem gravar */ } };
  function descendants(n, id) { // respostas (diretas e em cadeia) que ainda existem
    const ids = new Set([id]); const out = []; let grew = true;
    while (grew) { grew = false; for (const s of n.segments) if (s.replyTo && ids.has(s.replyTo) && !ids.has(s.id)) { ids.add(s.id); if (!s.deleted) out.push(s); grew = true; } }
    return out;
  }
  const stampOf = (seg, n) => [seg.versions.length, Object.values(seg.reactions || {}).reduce((a, l) => a + l.length, 0), descendants(n, seg.id).length, seg.deleted ? 1 : 0].join('|');
  function isHidden(seg, n) {
    const m = hidMap(); const st = m[seg.id];
    if (!st) return false;
    if (st !== stampOf(seg, n)) { delete m[seg.id]; saveHid(m); return false; } // houve interação: volta a aparecer
    return true;
  }
  function toggleHide(seg) {
    const m = hidMap();
    if (m[seg.id]) delete m[seg.id]; else m[seg.id] = stampOf(seg, open.note);
    saveHid(m);
    renderNote();
  }
  function unhide(id) { const m = hidMap(); if (m[id]) { delete m[id]; saveHid(m); return true; } return false; }

  /* ───────────── ver só uma conversa (mensagem + respostas) ───────────── */
  function threadOf(n, id) { // a raiz da conversa e todas as respostas (diretas e em cadeia)
    const by = new Map(n.segments.map((s) => [s.id, s]));
    let root = by.get(id); const seen = new Set();
    while (root && root.replyTo && by.has(root.replyTo) && !seen.has(root.id)) { seen.add(root.id); root = by.get(root.replyTo); }
    if (!root) return null;
    const ids = new Set([root.id]);
    let grew = true;
    while (grew) { grew = false; for (const s of n.segments) if (s.replyTo && ids.has(s.replyTo) && !ids.has(s.id)) { ids.add(s.id); grew = true; } }
    return { root: root.id, ids };
  }
  function openThread(seg) {
    const o = open;
    const t = threadOf(o.note, seg.id);
    if (!t) return;
    unhide(t.root); unhide(seg.id);
    o.thread = { root: t.root, ids: t.ids, back: seg.id };
    o.ui.composer.placeholder = 'Responder neste fio…  (Enter envia · Ctrl+Enter quebra a linha)';
    renderNote(true);
    o.ui.list.scrollTop = o.ui.list.scrollHeight;
  }
  function closeThread() {
    const o = open;
    if (!o || !o.thread) return;
    const back = o.thread.back;
    o.thread = null;
    o.ui.composer.placeholder = 'Escreva aqui…  (Enter envia · Ctrl+Enter quebra a linha · cole uma imagem para anexar)';
    renderNote();
    let x = o.ui.list.querySelector(`[data-sid="${back}"]`);
    if (!x) { o.limit = 1e9; renderNote(); x = o.ui.list.querySelector(`[data-sid="${back}"]`); }
    if (x) { x.scrollIntoView({ block: 'center' }); x.classList.add('flash'); setTimeout(() => x.classList.remove('flash'), 1600); }
  }
  function drawThreadBar() {
    const o = open; const bar = o.ui.threadBar;
    bar.textContent = '';
    bar.hidden = !o.thread;
    if (!o.thread) return;
    const root = o.note.segments.find((s) => s.id === o.thread.root);
    const back = el('button', 'sh-btn', '← Voltar a todas as mensagens'); back.onclick = closeThread;
    const cur = root && root.versions[root.versions.length - 1];
    bar.append(el('span', null, '💬 Só esta conversa'), root ? el('span', 'sh-tinfo', ` — ${who(root.author).name}: ${root.deleted ? '(mensagem apagada)' : root.type === 'sticker' ? '(figurinha)' : snippet(cur.text)}`) : '', el('span', 'sh-sp'), el('span', 'sh-tcount', `${o.thread.ids.size} mensage${o.thread.ids.size > 1 ? 'ns' : 'm'}`), back);
  }

  /* ───────────── responder e @menção ───────────── */
  const snippet = (t) => { const x = String(t || '').replace(/```enquete[^\n]*\n([^\n]*)[\s\S]*?\n```/g, '📊 $1').replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_>#~]/g, '').replace(/\s+/g, ' ').trim(); return x.length > 110 ? x.slice(0, 110) + '…' : x; };
  function setReply(seg) {
    const o = open;
    if (!o) return;
    const cur = seg.versions[seg.versions.length - 1];
    o.replyTo = { id: seg.id, name: who(seg.author).name, color: who(seg.author).color, text: seg.type === 'sticker' ? '(figurinha)' : snippet(cur.text) };
    drawReply();
    o.ui.composer.focus();
  }
  function threadTarget() { // dentro de um fio, a mensagem nova entra no fio (responde à última do fio)
    const o = open;
    if (!o || !o.thread) return undefined;
    const live = o.note.segments.filter((x) => o.thread.ids.has(x.id) && !x.deleted);
    return live.length ? live[live.length - 1].id : undefined;
  }
  function clearReply() { if (open) { open.replyTo = null; drawReply(); } }
  function drawReply() {
    const o = open; const bar = o.ui.replyBar;
    bar.textContent = '';
    bar.hidden = !o.replyTo;
    if (!o.replyTo) return;
    bar.style.setProperty('--uc', o.replyTo.color);
    const x = el('button', 'sh-ic', '✕'); x.title = 'Cancelar a resposta (Esc)'; x.onclick = clearReply;
    bar.append(el('span', 'sh-sp0', '↩ Respondendo a '), el('b', null, o.replyTo.name), ' — ' + o.replyTo.text, el('span', 'sh-sp'), x);
  }
  function quoteOf(seg, n) { // citação em cima da resposta; clicar leva até a mensagem original
    const t = n.segments.find((x) => x.id === seg.replyTo);
    const q = el('div', 'sh-quote');
    if (!t || t.deleted) { q.textContent = '↩ mensagem apagada'; q.classList.add('gone'); return q; }
    const cur = t.versions[t.versions.length - 1];
    q.style.setProperty('--uc', who(t.author).color);
    q.append(el('b', null, '↩ ' + who(t.author).name), ' ' + (t.type === 'sticker' ? '(figurinha)' : snippet(cur.text)));
    q.title = 'Ir para a mensagem original';
    q.onclick = () => jumpTo(t.id);
    return q;
  }
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Destaca @nome (só de quem foi realmente mencionado, segundo o servidor) e @todos
  function highlightMentions(box, seg) {
    if (!seg) return;
    const names = (seg.mentions || []).map((i) => ({ name: who(i).name, color: who(i).color, me: i === me().id }));
    const txt = seg.versions[seg.versions.length - 1].text;
    const all = /(^|[^\p{L}\p{N}_])@(todos|everyone)(?![\p{L}\p{N}_])/iu.test(txt);
    if (!names.length && !all) return;
    const alt = [...names.map((n) => escRe(n.name)), ...(all ? ['todos', 'everyone'] : [])].sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp('(^|[^\\p{L}\\p{N}_])@(' + alt + ')(?![\\p{L}\\p{N}_])', 'giu');
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('code, pre, a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const tn of nodes) {
      const t = tn.nodeValue;
      re.lastIndex = 0;
      if (!re.test(t)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0; let m;
      while ((m = re.exec(t))) {
        const at = m.index + m[1].length;
        frag.append(t.slice(last, at));
        const hit = names.find((x) => x.name.toLowerCase() === m[2].toLowerCase());
        const span = el('span', 'sh-mention' + (!hit || hit.me ? ' me' : ''), '@' + m[2]);
        if (hit) span.style.setProperty('--uc', hit.color);
        frag.append(span);
        last = at + 1 + m[2].length;
      }
      frag.append(t.slice(last));
      tn.replaceWith(frag);
    }
  }
  // Lista de sugestões ao digitar @ (só quem enxerga o projeto)
  let mpop = null; let mst = null;
  function closeMention() { if (mpop) { mpop.remove(); mpop = null; } mst = null; }
  function mentionUpdate(ta) {
    const o = open;
    if (!o || !o.people) return closeMention();
    const before = ta.value.slice(0, ta.selectionStart);
    const m = /(^|[\s(])@([\p{L}\p{N}_]*(?: [\p{L}\p{N}_]*)?)$/u.exec(before);
    if (!m) return closeMention();
    const q = m[2].toLowerCase();
    const pool = [...o.people.filter((u) => u.id !== me().id), { id: '*', name: 'todos', color: '#98a1ad', hint: 'avisa todo o projeto' }];
    const items = pool.filter((u) => { const n = u.name.toLowerCase(); return n.startsWith(q) || (!q.includes(' ') && n.split(' ').some((w) => w.startsWith(q))); }).slice(0, 7);
    if (!items.length) return closeMention();
    mst = { ta, items, idx: 0, from: ta.selectionStart - m[2].length - 1, to: ta.selectionStart };
    if (!mpop) { mpop = el('div', 'sh-mpop'); ta.parentElement.append(mpop); }
    mpop.textContent = '';
    items.forEach((u, i) => {
      const r = el('div', 'sh-mrow' + (i === 0 ? ' on' : ''));
      const dot = el('span', 'sh-dot2'); dot.style.background = u.color;
      r.append(dot, el('span', null, u.name));
      if (u.hint) r.append(el('span', 'sh-mhint', u.hint));
      r.onmousedown = (e) => { e.preventDefault(); mst.idx = i; pickMention(); };
      mpop.append(r);
    });
  }
  function pickMention() {
    if (!mst) return;
    const { ta, items, idx, from, to } = mst;
    const u = items[idx];
    const ins = '@' + u.name + ' ';
    ta.value = ta.value.slice(0, from) + ins + ta.value.slice(to);
    ta.setSelectionRange(from + ins.length, from + ins.length);
    closeMention();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }
  function mentionKey(e) { // devolve true se a tecla foi usada pela lista
    if (!mst) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      mst.idx = (mst.idx + (e.key === 'ArrowDown' ? 1 : -1) + mst.items.length) % mst.items.length;
      [...mpop.children].forEach((c, i) => c.classList.toggle('on', i === mst.idx));
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); closeMention(); return true; }
    return false;
  }
  /* ───────────── mensagens fixadas ───────────── */
  function jumpTo(sid) {
    const o = open; if (!o) return;
    if (unhide(sid)) renderNote();
    const find = () => o.ui.list.querySelector(`[data-sid="${sid}"]`);
    let t = find();
    if (!t && o.thread) { closeThread(); t = find(); }
    if (!t) { o.limit = 1e9; renderNote(); t = find(); }
    if (!t) return;
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600);
  }
  const pinnedList = () => { const o = open; return o && o.note ? o.note.segments.filter((x) => x.pinned && !x.deleted).sort((a, b) => b.pinned.ts - a.pinned.ts) : []; };
  async function togglePin(seg) {
    const o = open; if (!o) return;
    const r = await call('POST', `/api/notes/${o.nid}/segments/${seg.id}/pin`, { pinned: !seg.pinned });
    if (r.s >= 200 && r.s < 300 && r.j) { if (r.j.pinned) seg.pinned = r.j.pinned; else delete seg.pinned; cacheSoon(o); if (open === o) renderNote(); }
    else env.toast((r.j && r.j.error) || 'Não consegui fixar');
  }
  function drawPinUi() {
    const o = open; if (!o || !o.ui.pinBar) return;
    const pins = pinnedList();
    o.ui.pinBtn.textContent = pins.length ? `📌 Fixadas (${pins.length})` : '📌 Fixadas';
    const bar = o.ui.pinBar; bar.textContent = '';
    bar.hidden = !pins.length;
    if (!pins.length) return;
    const last = pins[0]; const cur = last.versions[last.versions.length - 1];
    const txt = el('span', 'sh-pinbar-t'); txt.append('📌 ', nameSpan(last.author), ': ' + (last.type === 'sticker' ? '(figurinha)' : snippet(cur.text)));
    txt.title = 'Ir para a mensagem fixada'; txt.onclick = () => jumpTo(last.id);
    bar.append(txt);
    if (pins.length > 1) { const all = el('button', 'sh-link', `ver as ${pins.length} fixadas`); all.onclick = pinsModal; bar.append(all); }
  }
  function pinsModal() {
    const o = open; if (!o) return;
    const { ov, panel } = modal('📌 Mensagens fixadas');
    const draw = () => {
      for (const x of [...panel.querySelectorAll('.sh-pinrow, .sh-hint')]) x.remove();
      const pins = pinnedList();
      if (!pins.length) { panel.append(el('div', 'sh-hint', 'Nenhuma mensagem fixada. Use o 📌 no canto de uma mensagem para fixar.')); return; }
      for (const seg of pins) {
        const cur = seg.versions[seg.versions.length - 1];
        const row = el('div', 'sh-pinrow');
        const top = el('div', 'sh-pinrow-top'); top.append(nameSpan(seg.author), el('span', 'sh-time', ' ' + fmt(seg.ts)), el('span', 'sh-sp'), el('span', 'sh-pinby', `fixada por ${who(seg.pinned.by).name} · ${fmt(seg.pinned.ts)}`));
        row.append(top, el('div', 'sh-pinrow-t', seg.type === 'sticker' ? '(figurinha)' : snippet(cur.text) || '(sem texto)'));
        const bt = el('div', 'sh-pinrow-bt');
        const go = el('button', 'sh-btn', 'Ir para a mensagem'); go.onclick = (e) => { e.stopPropagation(); ov.remove(); jumpTo(seg.id); };
        bt.append(go);
        if (o.note.role !== 'read') { const un = el('button', 'sh-btn', 'Desafixar'); un.onclick = async (e) => { e.stopPropagation(); await togglePin(seg); draw(); }; bt.append(un); }
        row.append(bt); row.onclick = () => { ov.remove(); jumpTo(seg.id); };
        panel.append(row);
      }
    };
    draw();
  }

  /* ───────────── enquete ───────────── */
  // Troca o bloco ```enquete``` pelo cartão (só o primeiro bloco válido vale, como no servidor)
  function pollCards(box, text, seg) {
    if (!text.includes('```enquete')) return;
    const codes = [...box.querySelectorAll('pre > code.language-enquete')];
    const blocks = findPolls(text);
    let used = false;
    codes.forEach((code, i) => {
      const b = blocks[i]; if (!b || used) return;
      const p = parsePoll(b.info, b.body);
      if (!p.ok) return;
      used = true;
      code.parentElement.replaceWith(pollCard(seg, p));
    });
  }
  // endereço da imagem de uma opção: arquivo do projeto (srv-file:ID) ou http(s)
  function pollImg(im) { if (!im) return ''; const m = /^srv-file:([\w-]+)/.exec(im.src); return m ? fileUrl(m[1]) : (/^https?:\/\//i.test(im.src) ? im.src : ''); }
  function pollImgEl(im, cls) {
    const i = document.createElement('img'); i.className = cls; i.src = pollImg(im); i.alt = im.alt || ''; i.loading = 'lazy'; i.decoding = 'async';
    i.onclick = (e) => { e.stopPropagation(); lightbox(i.src); }; // ampliar, sem votar
    return i;
  }
  function pollCard(seg, p) {
    const card = el('div', 'sh-poll');
    const draw = () => {
      const o = open; const pv = seg.poll; const canVote = !!pv && !seg.pending && !pv.closed && !seg.deleted && o && o.note && o.note.role !== 'read';
      card.textContent = '';
      card.classList.toggle('closed', !!(pv && pv.closed));
      const head = el('div', 'sh-poll-head');
      head.append(el('span', 'sh-poll-q', '📊 ' + p.question), el('span', 'sh-poll-kind', (p.multi ? 'várias escolhas' : 'uma escolha') + (p.anonymous ? ' · anônima' : '')));
      card.append(head);
      card.classList.toggle('grid', p.options.every((x) => pollImg(x.image)));
      if (p.image && pollImg(p.image)) card.append(pollImgEl(p.image, 'sh-poll-qimg'));
      const optsBox = el('div', 'sh-poll-opts'); card.append(optsBox);
      const counts = pv ? pv.counts : p.options.map(() => 0);
      const mine = new Set(pv ? pv.mine : []);
      const total = counts.reduce((a, c) => a + c, 0); const people = pv ? pv.people : 0;
      const max = Math.max(1, ...counts);
      p.options.forEach((opt, i) => {
        const row = el('button', 'sh-poll-opt' + (mine.has(i) ? ' mine' : '') + (counts[i] && counts[i] === Math.max(...counts) ? ' lead' : ''));
        row.type = 'button'; row.disabled = !canVote;
        const bar = el('span', 'sh-poll-bar'); bar.style.width = (people ? Math.round((counts[i] / people) * 100) : 0) + '%';
        const mark = el('span', 'sh-poll-mark', p.multi ? (mine.has(i) ? '☑' : '☐') : (mine.has(i) ? '◉' : '○'));
        const txt = el('span', 'sh-poll-text', opt.text);
        const pic = opt.image && pollImg(opt.image) ? pollImgEl(opt.image, 'sh-poll-img') : null;
        const num = el('span', 'sh-poll-num', pv ? `${counts[i]}${people ? ' · ' + Math.round((counts[i] / people) * 100) + '%' : ''}` : '');
        if (pic) row.append(bar, pic, mark, txt, num); else row.append(bar, mark, txt, num);
        if (pv && pv.voters && pv.voters[i] && pv.voters[i].length) {
          const names = pv.voters[i].map((id) => who(id).name);
          row.title = 'Votaram: ' + names.join(', ');
          const sub = el('span', 'sh-poll-who', names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : ''));
          row.append(sub);
        }
        row.onclick = () => votePoll(seg, i, p, draw);
        optsBox.append(row);
      });
      const foot = el('div', 'sh-poll-foot');
      if (!pv) foot.append(el('span', 'sh-poll-note', seg.pending ? 'enviando…' : 'Para votar, o servidor precisa ser atualizado.'));
      else {
        foot.append(el('span', null, `${total} voto${total === 1 ? '' : 's'} · ${people} pessoa${people === 1 ? '' : 's'}`));
        if (pv.closed) foot.append(el('span', 'sh-poll-closed', `🔒 encerrada por ${who(pv.closed.by).name}`));
        const me_ = me();
        if (canVote && mine.size) { const clear = el('button', 'sh-link', 'tirar meu voto'); clear.onclick = () => setVote(seg, [], p, draw); foot.append(clear); }
        if (o && o.note && !seg.deleted && !seg.pending && me_ && (seg.author === me_.id || o.note.role === 'admin')) {
          const cl = el('button', 'sh-link', pv.closed ? 'reabrir' : 'encerrar enquete');
          cl.onclick = async () => {
            const r = await call('POST', `/api/notes/${o.nid}/segments/${seg.id}/poll-close`, { closed: !pv.closed });
            if (r.s >= 200 && r.s < 300 && r.j && r.j.poll) { seg.poll = r.j.poll; draw(); } else env.toast((r.j && r.j.error) || 'Não consegui alterar a enquete');
          };
          foot.append(cl);
        }
      }
      card.append(foot);
    };
    draw();
    return card;
  }
  function votePoll(seg, i, p, draw) {
    const pv = seg.poll; if (!pv) return;
    const cur = new Set(pv.mine); let next;
    if (p.multi) { if (cur.has(i)) cur.delete(i); else cur.add(i); next = [...cur].sort((a, b) => a - b); }
    else next = cur.has(i) ? [] : [i];
    setVote(seg, next, p, draw);
  }
  // Voto otimista: o cartão muda na hora; o servidor confirma (ou desfaz). Votos seguidos saem em ordem.
  function setVote(seg, options, p, draw) {
    const pv = seg.poll; const o = open; if (!pv || !o) return;
    const before = JSON.parse(JSON.stringify(pv)); const me_ = me().id;
    for (const i of pv.mine) { pv.counts[i]--; if (pv.voters && pv.voters[i]) pv.voters[i] = pv.voters[i].filter((x) => x !== me_); }
    if (pv.mine.length) pv.people--;
    pv.mine = options;
    for (const i of options) { pv.counts[i]++; if (pv.voters && pv.voters[i]) pv.voters[i] = [...pv.voters[i], me_]; }
    if (options.length) pv.people++;
    draw();
    seg._voteChain = (seg._voteChain || Promise.resolve()).then(async () => {
      let r = null;
      try { r = await call('POST', `/api/notes/${o.nid}/segments/${seg.id}/vote`, { options }); } catch { /* sem rede */ }
      if (r && r.s >= 200 && r.s < 300 && r.j && r.j.poll) { seg.poll = r.j.poll; }
      else { seg.poll = before; env.toast((r && r.j && r.j.error) || 'Não consegui registrar o voto'); }
      if (open === o) { const fresh = o.ui.list.querySelector(`[data-sid="${seg.id}"] .sh-poll`); if (fresh === null) return; draw(); }
    });
  }

  function body(text, seg) {
    const box = el('div', 'sh-md');
    box.innerHTML = md.parse(text);
    pollCards(box, text, seg);
    for (const pre of box.querySelectorAll('pre')) { const b = el('button', 'sh-copy', 'Copiar'); b.onclick = (e) => { e.stopPropagation(); copyText(pre.querySelector('code') ? pre.querySelector('code').textContent : pre.textContent).then(() => { b.textContent = '✓ Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1300); }); }; pre.append(b); }
    highlightMentions(box, seg);
    for (const img of box.querySelectorAll('img')) {
      const m = (img.getAttribute('src') || '').match(/^srv-file:([\w-]+)(#video)?$/);
      if (!m) continue;
      const url = fileUrl(m[1]);
      const lab = '🖼 ' + ((img.alt || '').slice(0, 40) || 'imagem');
      if (m[2]) { const v = document.createElement('video'); v.controls = true; v.preload = 'metadata'; v.src = url; v.className = 'sh-video'; img.replaceWith(mediaWrap(v, m[1], '🎞 ' + ((img.alt || '').slice(0, 40) || 'vídeo'))); continue; }
      img.src = url; img.className = 'sh-img'; img.title = 'Clique para ampliar'; img.loading = 'lazy'; img.decoding = 'async';
      img.onclick = () => lightbox(url);
      const ph = document.createComment('');
      img.replaceWith(ph);
      ph.replaceWith(mediaWrap(img, m[1], lab));
    }
    for (const a of box.querySelectorAll('a')) {
      const m = (a.getAttribute('href') || '').match(/^srv-file:([\w-]+)/);
      a.onclick = (e) => { e.preventDefault(); if (m) api.openExternal(fileUrl(m[1])); else if (/^https?:/i.test(a.href)) api.openExternal(a.href); };
      if (m) a.removeAttribute('href');
    }
    const seenLinks = new Set();
    for (const a of box.querySelectorAll('a')) {
      const h = a.href || '';
      if (!/^https?:/i.test(h) || seenLinks.has(h) || seenLinks.size >= 2) continue;
      seenLinks.add(h);
      box.append(linkCard(h));
    }
    const tasks = taskLines(text);
    const canWrite = open && open.note && open.note.role !== 'read';
    box.querySelectorAll('input[type=checkbox]').forEach((cb, i) => {
      if (tasks[i] === undefined || !canWrite) return;
      cb.disabled = false;
      cb.onchange = async () => {
        const want = cb.checked;
        const r = await call('POST', `/api/notes/${open.nid}/segments/${seg.id}/check`, { line: tasks[i], checked: want });
        if (!(r.s >= 200 && r.s < 300)) { cb.checked = !want; env.toast((r.j && r.j.error) || 'Não consegui marcar'); } else reload();
      };
    });
    return box;
  }
  function lightbox(url) {
    const d = el('div', 'sh-lightbox');
    const i = el('img'); i.src = url;
    d.append(i);
    d.onclick = () => d.remove();
    document.body.append(d);
  }

  function renderNote(first) {
    const o = open; const n = o.note;
    if (o.editing) { const ta = o.ui.list.querySelector('.sh-edit textarea'); if (ta) o.editing.text = ta.value; }
    const wasBottom = o.ui.list.scrollHeight - o.ui.list.scrollTop - o.ui.list.clientHeight < 80;
    const prevTop = o.ui.list.scrollTop;
    o.ui.title.textContent = n.title;
    o.ui.meta.textContent = `${n.segments.filter((s) => !s.deleted).length} trecho(s)${n.role === 'read' ? ' · só leitura' : ''}${POLICY_SHORT[n.editPolicy] ? ' · ' + POLICY_SHORT[n.editPolicy] : ''}`;
    o.ui.gear.hidden = n.role !== 'admin';
    o.ui.imgBtn.textContent = allHidden() ? '🖼 Mostrar imagens' : '🖼 Esconder imagens';
    o.ui.composer.parentElement.hidden = n.role === 'read';
    const list = o.ui.list;
    list.textContent = '';
    let segs = n.segments;
    if (o.thread) { const t = threadOf(n, o.thread.root); if (t) { o.thread.ids = t.ids; segs = n.segments.filter((x) => t.ids.has(x.id)); } else o.thread = null; }
    drawThreadBar();
    let olderHidden = 0;
    if (!o.thread) { // conversas muito longas: desenha só as últimas (o resto fica um clique acima)
      const lim = o.limit || 150;
      if (segs.length > lim) { olderHidden = segs.length - lim; segs = segs.slice(-lim); }
    }
    if (olderHidden) {
      const more = el('button', 'sh-more', `▲ Mostrar mais ${Math.min(200, olderHidden)} mensagens anteriores (${olderHidden} escondidas)`);
      more.onclick = () => { const h0 = list.scrollHeight; o.limit = (o.limit || 150) + 200; renderNote(); list.scrollTop += list.scrollHeight - h0; };
      list.append(more);
    }
    const kids = new Map(); // quantas respostas diretas cada mensagem tem
    for (const x of n.segments) if (x.replyTo && !x.deleted) kids.set(x.replyTo, (kids.get(x.replyTo) || 0) + 1);
    if (!n.segments.length) list.append(el('div', 'sh-empty', 'Nenhum trecho ainda. Escreva abaixo para começar — seu nome aparece em cima do que você escrever.'));
    let firstNew = null;
    const hid = new Set(); const covered = new Set(); // ocultas e as respostas que ficam ocultas junto
    for (const x of n.segments) if (!x.deleted && isHidden(x, n)) { hid.add(x.id); for (const d of descendants(n, x.id)) covered.add(d.id); }
    let prevSeg = null; let prevBlk = null; // mensagens seguidas da mesma pessoa (até 5 min) ficam "meio juntas"
    for (const seg of segs) {
      const cur = seg.versions[seg.versions.length - 1];
      if (covered.has(seg.id) && !hid.has(seg.id)) continue; // resposta a uma mensagem oculta
      if (seg.deleted) {
        const d = el('div', 'sh-del');
        d.append('Trecho de ', nameSpan(seg.author), ' apagado por ', nameSpan(seg.deleted.by), ` · ${fmt(seg.deleted.ts)}  `);
        if (seg.canEdit) {
          const r = el('button', 'sh-link', 'Restaurar'); r.onclick = () => restoreLast(seg);
          d.append(r, ' · ');
        }
        const h = el('button', 'sh-link', 'Histórico'); h.onclick = () => history(seg);
        d.append(h);
        list.append(d);
        prevSeg = null; prevBlk = null;
        continue;
      }
      if (hid.has(seg.id)) { // só o nome + Exibir
        const row = el('div', 'sh-seg sh-hidrow');
        row.dataset.sid = seg.id;
        row.style.setProperty('--uc', who(seg.author).color);
        const k = descendants(n, seg.id).length;
        row.append(nameSpan(seg.author), el('span', 'sh-hidnote', ` · mensagem oculta${k ? ` · ${k} resposta${k > 1 ? 's' : ''} oculta${k > 1 ? 's' : ''}` : ''}`), el('span', 'sh-sp'));
        const eb = el('button', 'sh-btn sh-hidbtn', '👁 Exibir'); eb.title = 'Mostrar a mensagem de novo'; eb.onclick = (e) => { e.stopPropagation(); toggleHide(seg); };
        row.append(eb);
        row.onclick = () => toggleHide(seg);
        list.append(row);
        prevSeg = null; prevBlk = null;
        continue;
      }
      const isNew = cur.ts > o.newSince && cur.by !== me().id;
      const tgtSeg = seg.replyTo && n.segments.find((x) => x.id === seg.replyTo);
      const forMe = seg.author !== me().id && ((seg.mnt && seg.mnt[me().id] > o.newSince) || (tgtSeg && tgtSeg.author === me().id && seg.ts > o.newSince));
      const cont = !!prevSeg && prevSeg.author === seg.author && seg.ts - prevSeg.ts <= 5 * 60 * 1000;
      const blk = el('div', 'sh-seg' + (isNew ? ' new' : '') + (forMe ? ' forme' : '') + (cont ? ' cont' : '') + (seg.pinned ? ' pinned' : ''));
      if (cont && prevBlk) prevBlk.classList.add('has-cont');
      blk.dataset.sid = seg.id;
      if (isNew && !firstNew) firstNew = blk;
      blk.style.setProperty('--uc', who(seg.author).color);
      const h = el('div', 'sh-sh');
      h.append(nameSpan(seg.author), el('span', 'sh-time', fmt(seg.ts)));
      const lastEdit = [...seg.versions].reverse().find((v) => v.kind === 'edit' || v.kind === 'restore');
      if (lastEdit) {
        const e = el('span', 'sh-edited');
        if (cont) { e.textContent = lastEdit.kind === 'restore' ? '✎ restaurado' : '✎ editado'; e.title = `${lastEdit.kind === 'restore' ? 'Restaurado por' : 'Editado por'} ${who(lastEdit.by).name} · ${fmt(lastEdit.ts)}`; }
        else e.append(lastEdit.kind === 'restore' ? 'restaurado por ' : 'editado por ', nameSpan(lastEdit.by), ` · ${fmt(lastEdit.ts)}`);
        h.append(e);
      }
      if (isNew) h.append(el('span', 'sh-new', 'novo'));
      if (forMe) h.append(el('span', 'sh-forme', '@ para você'));
      if (seg.pinned) { const pn = el('span', 'sh-pinned', cont ? '📌' : `📌 fixada por ${who(seg.pinned.by).name}`); pn.title = `Fixada por ${who(seg.pinned.by).name} · ${fmt(seg.pinned.ts)}`; h.append(pn); }
      h.append(el('span', 'sh-sp'));
      if (n.role !== 'read') { const rp = el('button', 'sh-ic', '↩'); rp.title = 'Responder'; rp.onclick = () => setReply(seg); h.append(rp); }
      if (seg.replyTo || kids.get(seg.id)) { const tb = el('button', 'sh-ic', '💬'); tb.title = 'Ver só esta conversa (a mensagem e as respostas)'; tb.onclick = () => openThread(seg); h.append(tb); }
      if (seg.canEdit) {
        if (seg.type !== 'sticker') { const ed = el('button', 'sh-ic', '✎'); ed.title = seg.author === me().id ? 'Editar (a versão antiga fica guardada)' : 'Editar a mensagem de outra pessoa (a versão antiga fica guardada)'; ed.onclick = () => startEdit(seg); h.append(ed); }
        const dl = el('button', 'sh-ic', '🗑'); dl.title = 'Apagar (dá para restaurar)'; dl.onclick = () => delSeg(seg);
        h.append(dl);
      }
      const hb = el('button', 'sh-ic', '👁'); hb.title = 'Ocultar esta mensagem e as respostas a ela (fica só o nome; volta sozinha se alguém interagir)'; hb.onclick = () => toggleHide(seg); h.append(hb);
      if (n.role !== 'read') { const pb = el('button', 'sh-ic' + (seg.pinned ? ' on' : ''), '📌'); pb.title = seg.pinned ? 'Desafixar esta mensagem' : 'Fixar esta mensagem no alto da conversa'; pb.onclick = () => togglePin(seg); h.append(pb); }
      const hi = el('button', 'sh-ic', '🕘'); hi.title = `Histórico (${seg.versions.length} versão/ões)`; hi.onclick = () => history(seg);
      h.append(hi);
      blk.append(h);
      if (seg.replyTo) blk.append(quoteOf(seg, n));
      if (o.editing && o.editing.sid === seg.id) {
        const box = el('div', 'sh-edit');
        const ta = el('textarea', 'sh-ta');
        ta.value = o.editing.text != null ? o.editing.text : cur.text;
        ta.addEventListener('input', () => mentionUpdate(ta));
        ta.addEventListener('keydown', (e) => { if (mentionKey(e)) { e.stopPropagation(); return; } if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) insertAt(ta, '\n'); else saveEdit(seg, ta.value); } else if (e.key === 'Escape') { o.editing = null; renderNote(); } e.stopPropagation(); });
        ta.addEventListener('paste', (e) => { const fs = clipFiles(e); if (fs.length) { e.preventDefault(); e.stopPropagation(); upload(fs, ta); } });
        const bar = el('div', 'sh-compbar');
        const ok = el('button', 'sh-send', 'Salvar'); ok.onclick = () => saveEdit(seg, ta.value);
        const no = el('button', 'sh-btn', 'Cancelar'); no.onclick = () => { o.editing = null; renderNote(); };
        bar.append(el('span', 'sh-upl', seg.author !== me().id ? `Você está editando o texto de ${who(seg.author).name}. A versão dele fica guardada.` : ''), el('span', 'sh-sp'), no, ok);
        box.append(spellBox(ta), bar);
        blk.append(box);
        setTimeout(() => ta.focus(), 0);
      } else if (seg.type === 'sticker') {
        const sb = el('div', 'sh-sticker');
        if (seg.sticker && seg.sticker.file) { const im = el('img'); im.src = fileUrl(seg.sticker.file); im.alt = 'sticker'; im.onclick = () => lightbox(im.src); sb.append(im); }
        else sb.append(el('span', 'sh-bigemoji', (seg.sticker && seg.sticker.emoji) || '❔'));
        blk.append(sb);
      } else blk.append(body(cur.text, seg));
      blk.append(reactionsRow(seg, n));
      if (kids.get(seg.id) && !o.thread) { const k = kids.get(seg.id); const tl = el('button', 'sh-threadlink', `💬 ${k} resposta${k > 1 ? 's' : ''}`); tl.title = 'Ver só esta conversa'; tl.onclick = () => openThread(seg); blk.append(tl); }
      const checks = seg.versions.filter((v) => v.kind === 'check');
      if (checks.length) {
        const log = el('div', 'sh-log');
        const shown = blk._all ? checks : checks.slice(-3);
        for (const v of shown) { const l = el('div', 'sh-logl'); l.append('● ', nameSpan(v.by), ` ${v.label || 'marcou'} · ${fmt(v.ts)}`); log.append(l); }
        if (checks.length > 3) { const m = el('button', 'sh-link', `ver as ${checks.length} marcações`); m.onclick = () => history(seg); log.append(m); }
        blk.append(log);
      }
      list.append(blk);
      prevSeg = seg; prevBlk = blk;
    }
    drawPending();
    drawPinUi();
    if (first) { if (firstNew) list.scrollTop = Math.max(0, firstNew.offsetTop - 60); else list.scrollTop = list.scrollHeight; }
    else if (wasBottom) list.scrollTop = list.scrollHeight;
    else list.scrollTop = prevTop;
  }

  const POLICY_SHORT = { author: 'só o autor edita', all: 'todos que escrevem editam' };
  function reactionsRow(seg, n) {
    const row = el('div', 'sh-reacts');
    const canReact = n.role !== 'read';
    for (const [emoji, ids] of Object.entries(seg.reactions || {})) {
      const mine = ids.includes(me().id);
      const b = el('button', 'sh-react' + (mine ? ' mine' : ''));
      if (emoji.startsWith('sticker:')) { const im = el('img', 'sh-rimg'); im.src = fileUrl(emoji.slice(8)); im.alt = 'figurinha'; b.append(im, ` ${ids.length}`); }
      else b.textContent = `${emoji} ${ids.length}`;
      b.title = ids.map((i) => who(i).name).join(', ');
      if (canReact) b.onclick = () => react(seg, emoji); else b.disabled = true;
      row.append(b);
    }
    if (canReact) {
      const add = el('button', 'sh-react add sh-pickbtn', '☺＋');
      add.title = 'Reagir com emoji ou figurinha';
      add.onclick = () => { if (picker) closePicker(); else openPicker(add, { stickers: true, onEmoji: (e) => react(seg, e), onSticker: (st2) => react(seg, st2.file ? 'sticker:' + st2.file : st2.emoji) }); };
      row.append(add);
    }
    row.hidden = !row.children.length;
    return row;
  }
  // Regra da nota (por guia): quem pode editar as mensagens de outras pessoas
  function rulesModal() {
    const o = open;
    if (!o || !o.note) return;
    const { panel } = modal(`Regras da nota "${o.note.title}"`);
    panel.append(el('div', 'sh-hint', 'Vale só para esta nota (guia). O dono de cada mensagem sempre pode editar a própria, e quem administra o projeto edita qualquer uma. A versão antiga é sempre guardada.'));
    const sel = mkSelect([
      ['project', 'Seguir o papel de cada pessoa no projeto (só quem tem "Edita todos")'],
      ['author', 'Só o autor edita a própria mensagem (ninguém edita a dos outros)'],
      ['all', 'Todos que escrevem podem editar as mensagens de todos'],
    ], o.note.editPolicy || 'project', async (v) => {
      const r = await tryReq('PATCH', `/api/notes/${o.nid}`, { editPolicy: v });
      if (r) { env.toast('Regra da nota atualizada'); reload(); }
    });
    sel.className = 'sh-select wide';
    panel.append(field('Quem edita mensagens de outras pessoas', sel));
  }
  function startEdit(seg) { open.editing = { sid: seg.id, text: null }; renderNote(); }
  async function saveEdit(seg, text) {
    if (!text.trim()) { env.toast('O texto não pode ficar vazio (use apagar)'); return; }
    if (open.savingEdit) return; // Enter repetido
    open.savingEdit = true;
    try {
      const r = await call('PATCH', `/api/notes/${open.nid}/segments/${seg.id}`, { text });
      if (r.s >= 200 && r.s < 300) { open.editing = null; reload(); } else env.toast((r.j && r.j.error) || 'Não consegui salvar');
    } finally { if (open) open.savingEdit = false; }
  }
  async function delSeg(seg) {
    if ((await env.confirm('Apagar este trecho? Ele fica no histórico e pode ser restaurado.', ['Apagar', 'Cancelar'])) !== 0) return;
    await tryReq('DELETE', `/api/notes/${open.nid}/segments/${seg.id}`);
    reload();
  }
  async function restoreLast(seg) {
    const v = [...seg.versions].reverse().find((x) => x.kind !== 'delete');
    if (v) { await tryReq('POST', `/api/notes/${open.nid}/segments/${seg.id}/restore`, { version: v.n }); reload(); }
  }
  // Envio otimista: a mensagem aparece na hora ("enviando…") e o campo já fica livre. Quando o servidor confirma, ela vira a
  // mensagem de verdade (sem baixar a nota inteira de novo). Se falhar, fica marcada com "Reenviar". Vai uma por vez, em ordem.
  let pendSeq = 0;
  function send() {
    const o = open;
    if (!o) return;
    const text = o.ui.composer.value;
    if (!text.trim()) return;
    o.ui.composer.value = '';
    drafts.delete(o.nid);
    compPreview();
    closeMention();
    queueSend(o, text);
    o.ui.composer.focus();
  }
  function queueSend(o, text) {
    const reply = o.replyTo;
    const p = { id: 'p' + (++pendSeq), text, replyTo: reply ? reply.id : threadTarget(), state: 'sending', ts: Date.now() };
    o.pending.push(p);
    clearReply();
    drawPending();
    o.ui.list.scrollTop = o.ui.list.scrollHeight;
    enqueue(o, p);
  }
  function enqueue(o, p) { o.chain = (o.chain || Promise.resolve()).then(() => transmit(o, p)); }
  async function transmit(o, p) {
    p.state = 'sending'; if (open === o) drawPending();
    try {
      const r = await call('POST', `/api/notes/${o.nid}/segments`, { text: p.text, replyTo: p.replyTo });
      if (r.s >= 200 && r.s < 300 && r.j) { o.pending = o.pending.filter((x) => x !== p); appendSent(o, r.j); return; }
      p.err = (r.j && r.j.error) || 'Erro ' + r.s;
    } catch (e) { p.err = e.message || 'Falhou'; }
    p.state = 'failed';
    if (open === o) drawPending();
    env.toast('Não consegui enviar: ' + p.err);
  }
  // a mensagem confirmada entra na lista que já temos (o aviso do servidor sobre ela é ignorado em noteChanged)
  function appendSent(o, seg) {
    if (!o.note) return;
    if (!o.note.segments.some((g) => g.id === seg.id)) o.note.segments.push({ ...seg, canEdit: true });
    cacheSoon(o);
    if (open === o) { renderNote(); o.ui.list.scrollTop = o.ui.list.scrollHeight; }
  }
  function drawPending() {
    const o = open;
    if (!o || !o.ui) return;
    const list = o.ui.list;
    for (const e of list.querySelectorAll('.sh-pending')) e.remove();
    if (o.thread || !o.pending.length) return;
    const wasBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    for (const p of o.pending) {
      const blk = el('div', 'sh-seg sh-pending' + (p.state === 'failed' ? ' failed' : ''));
      blk.style.setProperty('--uc', who(me().id).color);
      const h = el('div', 'sh-sh');
      h.append(nameSpan(me().id), el('span', 'sh-time', p.state === 'failed' ? 'não enviada' : 'enviando…'));
      blk.append(h);
      const b = body(p.text, { id: p.id, versions: [{ text: p.text }], pending: true });
      for (const cb of b.querySelectorAll('input[type=checkbox]')) cb.disabled = true;
      blk.append(b);
      if (p.state === 'failed') {
        const bar = el('div', 'sh-pend-bar');
        bar.append(el('span', 'sh-pend-err', p.err || 'Falhou'));
        const rb = el('button', 'sh-btn', 'Reenviar'); rb.onclick = () => { drawPending(); enqueue(o, p); };
        const db = el('button', 'sh-btn', 'Descartar');
        db.onclick = () => { o.pending = o.pending.filter((x) => x !== p); o.ui.composer.value = o.ui.composer.value ? p.text + '\n' + o.ui.composer.value : p.text; drafts.set(o.nid, o.ui.composer.value); drawPending(); };
        bar.append(rb, db); blk.append(bar);
      }
      list.append(blk);
    }
    if (wasBottom) list.scrollTop = list.scrollHeight;
  }
  function history(seg) {
    const o = open;
    const ov = el('div', 'sh-lightbox sh-modal');
    const panel = el('div', 'sh-panel');
    panel.onclick = (e) => e.stopPropagation();
    const hd = el('div', 'sh-phead');
    hd.append(el('b', null, 'Histórico do trecho de '), nameSpan(seg.author));
    const x = el('button', 'sh-ic', '×'); x.onclick = () => ov.remove();
    hd.append(el('span', 'sh-sp'), x);
    panel.append(hd);
    const cur = seg.versions[seg.versions.length - 1];
    for (const v of [...seg.versions].reverse()) {
      const r = el('div', 'sh-ver' + (v === cur ? ' cur' : ''));
      const t = el('div', 'sh-vt');
      t.append(`v${v.n} · `, nameSpan(v.by), ` ${KIND[v.kind] || v.kind}${v.label ? ' (' + v.label + ')' : ''} · ${fmt(v.ts)}`);
      if (v === cur) t.append(el('span', 'sh-new', 'atual'));
      t.append(el('span', 'sh-sp'));
      if (v !== cur && seg.canEdit && v.kind !== 'delete') {
        const b = el('button', 'sh-btn', 'Restaurar esta versão');
        b.onclick = async () => { await tryReq('POST', `/api/notes/${o.nid}/segments/${seg.id}/restore`, { version: v.n }); ov.remove(); reload(); };
        t.append(b);
      }
      r.append(t, el('pre', 'sh-vp', v.text));
      panel.append(r);
    }
    ov.append(panel);
    ov.onclick = () => ov.remove();
    document.body.append(ov);
  }

  /* ───────────── emojis, reações e stickers ───────────── */
  let stickers = [];
  async function loadStickers() { try { stickers = await req('GET', '/api/stickers'); } catch { /* sem lista */ } }
  const recent = () => { try { return JSON.parse(localStorage.getItem('tt.emojiRecent') || '[]'); } catch { return []; } };
  const pushRecent = (e) => { try { localStorage.setItem('tt.emojiRecent', JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24))); } catch { /* sem gravar */ } };
  let picker = null;
  function closePicker() { if (picker) { picker.remove(); picker = null; document.removeEventListener('mousedown', outside, true); } }
  function outside(e) { if (picker && !picker.contains(e.target) && !e.target.closest?.('.sh-pickbtn')) closePicker(); }
  // opts: { stickers: bool, onEmoji(e), onSticker({emoji|file}) }
  function openPicker(anchor, opts) {
    closePicker();
    const p = el('div', 'sh-picker');
    picker = p;
    let tab = 'emoji';
    const head = el('div', 'sh-ptabs');
    const body = el('div', 'sh-pbody');
    const tabs = [['emoji', 'Emoji'], ...(opts.stickers ? [['stickers', 'Stickers']] : [])];
    const drawTabs = () => { head.textContent = ''; for (const [k, l] of tabs) { const b = el('button', 'sh-ptab' + (tab === k ? ' on' : ''), l); b.onclick = () => { tab = k; draw(); }; head.append(b); } };
    function draw() {
      drawTabs();
      body.textContent = '';
      if (tab === 'emoji') {
        const q = el('input', 'sh-input'); q.placeholder = 'Buscar emoji: gato, cat, coração, feliz, pizza…';
        q.title = 'Busca em português e inglês (ignora acento; “gat” já acha gato). Também filtra por categoria: rostos, gestos, festa…';
        q.addEventListener('keydown', (e) => e.stopPropagation());
        const grid = el('div', 'sh-pgrid');
        const fill = () => {
          grid.textContent = '';
          const f = q.value.trim().toLowerCase();
          const sections = [];
          if (!f && recent().length) sections.push(['Recentes', recent()]);
          const names = new Map(); // emoji -> "nome em português · nome em inglês" (dica ao passar o mouse)
          for (const [, name, list] of EMOJI_CATS) if (!f || name.toLowerCase().includes(f)) sections.push([name, list.split(' ')]);
          if (f) { // busca por nome/palavra-chave em português e inglês, na lista completa
            const found = searchEmoji(f);
            for (const x of found) names.set(x.emoji, `${x.pt} · ${x.en}`);
            if (found.length) sections.unshift([`Resultados para “${q.value.trim()}” (${found.length})`, found.map((x) => x.emoji)]);
          }
          for (const [name, list] of sections) {
            grid.append(el('div', 'sh-pcat', name));
            const row = el('div', 'sh-prow');
            for (const e of list) { const b = el('button', 'sh-pe', e); if (names.has(e)) b.title = names.get(e); b.onclick = () => { pushRecent(e); opts.onEmoji(e); if (!opts.keepOpen) closePicker(); }; row.append(b); }
            grid.append(row);
          }
          if (!sections.length) grid.append(el('div', 'sh-hint', 'Nenhum emoji encontrado. Tente outra palavra, em português ou inglês.'));
        };
        q.oninput = fill; fill();
        body.append(q, grid);
        setTimeout(() => q.focus(), 0);
      } else {
        const g1 = el('div', 'sh-pcat', 'Grandes (emoji)');
        const r1 = el('div', 'sh-prow big');
        for (const e of BIG_STICKERS) { const b = el('button', 'sh-pe big', e); b.onclick = () => { opts.onSticker({ emoji: e }); closePicker(); }; r1.append(b); }
        const g2 = el('div', 'sh-pcat', 'Da equipe (imagens)');
        const r2 = el('div', 'sh-prow big');
        for (const s of stickers) {
          const b = el('button', 'sh-pe img');
          const im = el('img'); im.src = fileUrl(s.id); im.alt = s.name; im.title = s.name;
          b.append(im);
          b.onclick = () => { opts.onSticker({ file: s.id }); closePicker(); };
          if (st.user && (s.by === st.user.id || isAdmin())) {
            const x = el('span', 'sh-px', '×'); x.title = 'Remover este sticker da lista';
            x.onclick = async (ev) => { ev.stopPropagation(); if (await tryReq('DELETE', `/api/stickers/${s.id}`).then((r) => r !== null)) { await loadStickers(); draw(); } };
            b.append(x);
          }
          r2.append(b);
        }
        const add = el('button', 'sh-btn', '＋ Adicionar sticker (imagem)');
        const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true;
        fi.onchange = async () => {
          const f = fi.files[0]; if (!f) return;
          if (f.size > 4 * 1024 * 1024) { env.toast('O sticker precisa ter até 4 MB'); return; }
          const r = await api.srvUploadSticker(cid, f.name, f.type, await f.arrayBuffer());
          if (r.s >= 200 && r.s < 300) { await loadStickers(); draw(); env.toast('Sticker adicionado para a equipe toda'); } else env.toast((r.j && r.j.error) || 'Não consegui enviar o sticker');
        };
        add.onclick = () => fi.click();
        body.append(g1, r1, g2, r2, add, fi);
        if (!stickers.length) r2.append(el('div', 'sh-hint', 'Ainda não há stickers de imagem. Adicione o primeiro!'));
      }
    }
    p.append(head, body);
    document.body.append(p);
    draw();
    const r = anchor.getBoundingClientRect();
    const w = 340; const h = 330;
    p.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    p.style.top = (r.top - h - 6 > 8 ? r.top - h - 6 : r.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  /* ───────────── figurinhas: painel (como no WhatsApp/Mattermost) e criador ───────────── */
  const recentStk = () => { try { return JSON.parse(localStorage.getItem('tt.stkRecent.' + cid) || '[]'); } catch { return []; } };
  const pushStk = (id) => { try { localStorage.setItem('tt.stkRecent.' + cid, JSON.stringify([id, ...recentStk().filter((x) => x !== id)].slice(0, 12))); } catch { /* sem gravar */ } };
  // Envia GIF/imagem pronta como figurinha, sem mexer no arquivo (o GIF animado continua animado)
  async function uploadReadyStickers(files, after) {
    let n = 0;
    for (const f of files) {
      if (!/^image\//.test(f.type || '')) { env.toast(`"${f.name}" não é uma imagem`); continue; }
      if (f.size > 4 * 1024 * 1024) { env.toast(`"${f.name}" tem mais de 4 MB (limite das figurinhas)`); continue; }
      const r = await api.srvUploadSticker(cid, f.name, f.type, await f.arrayBuffer());
      if (r.s >= 200 && r.s < 300) n++; else env.toast((r.j && r.j.error) || `Não consegui enviar "${f.name}"`);
    }
    if (n) { await loadStickers(); env.toast(n === 1 ? 'Figurinha adicionada à coleção.' : `${n} figurinhas adicionadas à coleção.`); }
    if (after) after();
  }
  async function openStickerPanel(anchor) {
    closePicker();
    await loadStickers();
    const p = el('div', 'sh-picker sh-stk');
    picker = p;
    const top = el('div', 'sh-stktop');
    const q = el('input', 'sh-input');
    q.placeholder = 'Buscar figurinha pelo nome…';
    q.addEventListener('keydown', (e) => e.stopPropagation());
    const mkb = el('button', 'sh-send', '＋ Criar');
    mkb.title = 'Criar uma figurinha nova e deixá-la salva';
    mkb.onclick = () => { closePicker(); stickerCreator(); };
    const upb = el('button', 'sh-btn', '🎞 GIF');
    upb.title = 'Enviar um GIF (animado) ou uma imagem pronta como figurinha, sem alterar o arquivo';
    const upf = document.createElement('input'); upf.type = 'file'; upf.accept = 'image/*'; upf.multiple = true; upf.hidden = true;
    upf.onchange = () => { const fs = [...upf.files]; upf.value = ''; uploadReadyStickers(fs, () => { if (picker) fill(); }); };
    upb.onclick = () => upf.click();
    top.append(q, upb, upf, mkb);
    const body = el('div', 'sh-pbody');
    p.append(top, body);
    const stkBtn = (s) => {
      const b = el('button', 'sh-pe img');
      const im = el('img'); im.src = fileUrl(s.id); im.alt = s.name; im.title = s.name;
      b.append(im);
      b.onclick = () => { pushStk(s.id); sendSticker({ file: s.id }); closePicker(); };
      if (st.user && (s.by === st.user.id || isAdmin())) {
        const x = el('span', 'sh-px', '×'); x.title = 'Apagar esta figurinha da coleção';
        x.onclick = async (ev) => { ev.stopPropagation(); if ((await env.confirm(`Apagar a figurinha "${s.name}" da coleção?\n\nAs mensagens que já a usam continuam mostrando a imagem.`, ['Apagar', 'Cancelar'])) !== 0) return; if (await tryReq('DELETE', `/api/stickers/${s.id}`).then((r) => r !== null)) { await loadStickers(); fill(); } };
        b.append(x);
      }
      return b;
    };
    const section = (title, list) => { if (!list.length) return; body.append(el('div', 'sh-pcat', title)); const row = el('div', 'sh-prow'); for (const s of list) row.append(stkBtn(s)); body.append(row); };
    function fill() {
      body.textContent = '';
      const f = q.value.trim().toLowerCase();
      const ok = (s) => !f || s.name.toLowerCase().includes(f);
      if (!f) section('Recentes', recentStk().map((id) => stickers.find((s) => s.id === id)).filter(Boolean));
      section('Minhas figurinhas', stickers.filter((s) => st.user && s.by === st.user.id && ok(s)));
      section('Da equipe', stickers.filter((s) => !(st.user && s.by === st.user.id) && ok(s)));
      if (!f) {
        body.append(el('div', 'sh-pcat', 'Emoji grandes'));
        const row = el('div', 'sh-prow big');
        for (const e of BIG_STICKERS) { const b = el('button', 'sh-pe big', e); b.onclick = () => { sendSticker({ emoji: e }); closePicker(); }; row.append(b); }
        body.append(row);
      }
      if (!stickers.length) body.append(el('div', 'sh-hint', 'Você ainda não tem figurinhas. Clique em ＋ Criar para fazer a primeira — ela fica salva aqui para sempre.'));
      else if (f && !body.querySelector('.sh-pe')) body.append(el('div', 'sh-hint', 'Nenhuma figurinha com esse nome.'));
    }
    q.oninput = fill;
    fill();
    document.body.append(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(window.innerWidth - 408, r.left)) + 'px';
    p.style.top = (r.top - 436 > 8 ? r.top - 436 : r.bottom + 6) + 'px';
    setTimeout(() => { document.addEventListener('mousedown', outside, true); q.focus(); }, 0);
  }

  // Criador: imagem (arquivo, colada ou arrastada) ou emoji, com zoom/posição, forma, fundo e texto (fonte, estilo, cor, contorno e
  // posição livre); salva como figurinha da coleção
  const FONTS = ['Impact', 'Arial Black', 'Segoe UI Black', 'Comic Sans MS', 'Segoe UI', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Brush Script MT'];
  function stickerCreator() {
    const { ov, panel } = modal('Criar figurinha');
    panel.style.width = 'min(820px, 95vw)';
    const wrap = el('div', 'sh-sc');
    const left = el('div', 'sh-scl');
    const right = el('div', 'sh-scr');
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 512; cv.className = 'sh-sccv';
    left.append(cv, el('div', 'sh-hint', 'Arraste para mover (a imagem ou o texto, conforme a opção) · roda do mouse dá zoom · Ctrl+V cola uma imagem · ou solte um arquivo aqui'));
    const S = { frames: null, file: null, img: null, emoji: '', zoom: 1, ox: 0, oy: 0, fit: 'cover', shape: 'round', bg: '', text: '', font: 'Impact', bold: false, italic: false, size: 80, color: '#ffffff', stroke: true, strokeColor: '#000000', tx: 256, ty: 440, grab: 'image' };
    const g = cv.getContext('2d');
    const shapePath = () => { g.beginPath(); if (S.shape === 'circle') g.arc(256, 256, 256, 0, Math.PI * 2); else if (S.shape === 'round') { if (g.roundRect) g.roundRect(0, 0, 512, 512, 80); else g.rect(0, 0, 512, 512); } else g.rect(0, 0, 512, 512); };
    function draw() {
      g.clearRect(0, 0, 512, 512);
      g.save();
      shapePath();
      g.clip();
      if (S.bg) { g.fillStyle = S.bg; g.fillRect(0, 0, 512, 512); }
      if (S.img) {
        const iw = S.img.naturalWidth || S.img.width; const ih = S.img.naturalHeight || S.img.height;
        const base = S.fit === 'cover' ? Math.max(512 / iw, 512 / ih) : Math.min(512 / iw, 512 / ih);
        const w = iw * base * S.zoom; const h = ih * base * S.zoom;
        g.drawImage(S.img, (512 - w) / 2 + S.ox, (512 - h) / 2 + S.oy, w, h);
      } else if (S.emoji) {
        g.font = `${Math.round(380 * S.zoom)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(S.emoji, 256 + S.ox, 270 + S.oy);
      }
      g.restore();
      if (S.text.trim()) {
        const lines = S.text.split('\n').slice(0, 4);
        const fam = `"${S.font}","Segoe UI",sans-serif`;
        const style = `${S.italic ? 'italic ' : ''}${S.bold ? 'bold ' : ''}`;
        let fs = S.size;
        g.font = `${style}${fs}px ${fam}`;
        const widest = Math.max(...lines.map((l) => g.measureText(l).width));
        if (widest > 480) fs = Math.floor(fs * 480 / widest);
        g.font = `${style}${fs}px ${fam}`;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        const lh = fs * 1.15; const total = lh * lines.length;
        lines.forEach((l, i) => {
          const y = S.ty - total / 2 + lh * (i + 0.5);
          if (S.stroke) { g.lineWidth = Math.max(3, fs / 7); g.strokeStyle = S.strokeColor; g.strokeText(l, S.tx, y); }
          g.fillStyle = S.color; g.fillText(l, S.tx, y);
        });
      }
    }
    // pré-visualização animada (GIF) e exportação quadro a quadro
    let animTimer = null; let animIdx = 0;
    const stopAnim = () => { clearTimeout(animTimer); animTimer = null; };
    const tick = () => {
      if (!S.frames || !ov.isConnected) return;
      animIdx = (animIdx + 1) % S.frames.length;
      S.img = S.frames[animIdx].bmp; draw();
      animTimer = setTimeout(tick, S.frames[animIdx].delay);
    };
    const startAnim = () => { stopAnim(); animIdx = 0; if (S.frames && S.frames.length > 1 && animOn.checked) { S.img = S.frames[0].bmp; draw(); animTimer = setTimeout(tick, S.frames[0].delay); } else if (S.frames) { S.img = S.frames[0].bmp; draw(); } };
    async function exportAnimated(size) {
      stopAnim();
      const keepImg = S.img;
      const tmp = document.createElement('canvas'); tmp.width = size; tmp.height = size;
      const tg = tmp.getContext('2d', { willReadFrequently: true });
      const list = [];
      for (const f of S.frames) {
        S.img = f.bmp; draw();
        tg.clearRect(0, 0, size, size); tg.drawImage(cv, 0, 0, size, size);
        list.push({ data: tg.getImageData(0, 0, size, size).data, delay: f.delay });
        await new Promise((r) => setTimeout(r, 0)); // deixa a tela respirar
      }
      S.img = keepImg; draw(); startAnim();
      return encodeGif(list, size, size);
    }
    const err = el('div', 'sh-ferr'); err.hidden = true;
    const showErr = (m) => { err.textContent = m; err.hidden = !m; };
    const loadImg = (f) => {
      if (!f || !/^image\//.test(f.type || '')) { showErr('Esse arquivo não é uma imagem (use PNG, JPG, GIF ou WebP).'); return; }
      showErr('');
      // createImageBitmap não depende da política de segurança de imagens (blob: seria bloqueado)
      S.file = f;
      stopAnim(); S.frames = null; animRow.hidden = true;
      gifBox.hidden = !/^image\/(gif|webp|apng)$/.test(f.type);
      const done = (im) => { S.img = im; S.emoji = ''; S.zoom = 1; S.ox = 0; S.oy = 0; emo.value = ''; if (!nameIn.value) nameIn.value = (f.name || 'figurinha').replace(/\.[^.]+$/, '').slice(0, 40) || 'figurinha'; draw(); };
      const still = () => createImageBitmap(f).then(done).catch(() => {
        const rd = new FileReader();
        rd.onload = () => { const im = new Image(); im.onload = () => done(im); im.onerror = () => showErr('Não consegui abrir essa imagem.'); im.src = rd.result; };
        rd.onerror = () => showErr('Não consegui ler essa imagem.');
        rd.readAsDataURL(f);
      });
      if (f.type === 'image/gif') { // GIF: decodifica os quadros para poder pôr texto/forma/fundo em todos e manter a animação
        decodeGif(f).then((g) => {
          if (g.frames.length > 1) { S.frames = g.frames; done(g.frames[0].bmp); animRow.hidden = false; animOn.checked = true; startAnim(); } else still();
        }).catch(() => still());
      } else still();
    };
    const imageOf = (dt) => {
      if (!dt) return null;
      const f = [...(dt.files || [])].find((x) => /^image\//.test(x.type));
      if (f) return f;
      for (const it of [...(dt.items || [])]) if (it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile();
      return null;
    };
    // arrastar (imagem ou texto) e zoom
    let drag = null;
    cv.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, ox: S.ox, oy: S.oy, tx: S.tx, ty: S.ty }; e.preventDefault(); };
    const mv = (e) => {
      if (!drag) return;
      const k = 512 / cv.getBoundingClientRect().width;
      const dx = (e.clientX - drag.x) * k; const dy = (e.clientY - drag.y) * k;
      if (S.grab === 'text') { S.tx = Math.max(0, Math.min(512, drag.tx + dx)); S.ty = Math.max(0, Math.min(512, drag.ty + dy)); } else { S.ox = drag.ox + dx; S.oy = drag.oy + dy; }
      draw();
    };
    const up = () => { drag = null; };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); S.zoom = Math.max(0.2, Math.min(4, S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); draw(); }, { passive: false });
    const onPaste = (e) => { if (!ov.isConnected) { document.removeEventListener('paste', onPaste, true); return; } const f = imageOf(e.clipboardData); if (f) { e.preventDefault(); e.stopPropagation(); loadImg(f); } };
    document.addEventListener('paste', onPaste, true);
    for (const t of [cv, panel]) { t.addEventListener('dragover', (e) => e.preventDefault()); t.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); loadImg(imageOf(e.dataTransfer)); }); }

    // controles
    const row = (label, ...els) => { const r = el('div', 'sh-scrow'); r.append(el('span', 'sh-sclab', label), ...els); right.append(r); return r; };
    const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true;
    fi.onchange = () => { loadImg(fi.files[0]); fi.value = ''; };
    const pick = el('button', 'sh-btn', '🖼 Escolher imagem…'); pick.onclick = () => fi.click();
    const pasteBtn = el('button', 'sh-btn', '📋 Colar');
    pasteBtn.title = 'Colar a imagem que está na área de transferência (ou use Ctrl+V)';
    pasteBtn.onclick = async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) { const type = it.types.find((t) => /^image\//.test(t)); if (type) { const blob = await it.getType(type); loadImg(new File([blob], 'colada.png', { type })); return; } }
        showErr('Não há imagem na área de transferência. Copie uma imagem e tente de novo.');
      } catch { showErr('O Windows não deixou ler a área de transferência por aqui: clique na janela e use Ctrl+V.'); }
    };
    const emo = el('input', 'sh-input'); emo.placeholder = 'ou um emoji: 😎'; emo.style.minWidth = '100px'; emo.style.maxWidth = '120px';
    emo.addEventListener('keydown', (e) => e.stopPropagation());
    emo.oninput = () => { S.emoji = emo.value.trim(); if (S.emoji) { S.img = null; S.file = null; gifBox.hidden = true; S.zoom = 1; S.ox = 0; S.oy = 0; } draw(); };
    row('Base', pick, pasteBtn, emo, fi);
    row('Ajuste', mkSelect([['cover', 'Preencher (corta)'], ['contain', 'Mostrar inteira']], S.fit, (v) => { S.fit = v; draw(); }));
    row('Forma', mkSelect([['round', 'Cantos arredondados'], ['square', 'Quadrada'], ['circle', 'Redonda']], S.shape, (v) => { S.shape = v; draw(); }));
    const bgOn = document.createElement('input'); bgOn.type = 'checkbox';
    const bgc = el('input', 'sh-color'); bgc.type = 'color'; bgc.value = '#ffffff';
    bgOn.onchange = () => { S.bg = bgOn.checked ? bgc.value : ''; draw(); };
    bgc.oninput = () => { if (bgOn.checked) { S.bg = bgc.value; draw(); } };
    const bgl = el('label', 'sh-chk'); bgl.append(bgOn, ' cor de fundo ', bgc);
    row('Fundo', bgl, el('span', 'sh-hint', 'sem marcar = transparente'));
    right.append(el('div', 'sh-scsep'));
    const tx = el('textarea', 'sh-ta'); tx.rows = 2; tx.placeholder = 'Texto na figurinha (opcional; Enter pula linha)'; tx.style.minHeight = '44px';
    tx.addEventListener('keydown', (e) => e.stopPropagation());
    tx.oninput = () => { S.text = tx.value; draw(); };
    row('Texto', tx);
    const fontSel = document.createElement('select'); fontSel.className = 'sh-select';
    for (const f of FONTS) { const o = document.createElement('option'); o.value = f; o.textContent = f; o.style.fontFamily = `"${f}"`; fontSel.append(o); }
    fontSel.value = S.font; fontSel.onchange = () => { S.font = fontSel.value; draw(); };
    const bold = el('button', 'sh-btn sh-tog', 'B'); bold.style.fontWeight = '800'; bold.title = 'Negrito';
    const ital = el('button', 'sh-btn sh-tog', 'I'); ital.style.fontStyle = 'italic'; ital.title = 'Itálico';
    bold.onclick = () => { S.bold = !S.bold; bold.classList.toggle('on', S.bold); draw(); };
    ital.onclick = () => { S.italic = !S.italic; ital.classList.toggle('on', S.italic); draw(); };
    row('Fonte', fontSel, bold, ital);
    const sz = document.createElement('input'); sz.type = 'range'; sz.min = 24; sz.max = 160; sz.value = S.size; sz.oninput = () => { S.size = Number(sz.value); draw(); };
    const tc = el('input', 'sh-color'); tc.type = 'color'; tc.value = S.color; tc.title = 'Cor da letra'; tc.oninput = () => { S.color = tc.value; draw(); };
    row('Tamanho', sz, tc);
    const stOn = document.createElement('input'); stOn.type = 'checkbox'; stOn.checked = true;
    const stc = el('input', 'sh-color'); stc.type = 'color'; stc.value = S.strokeColor; stc.title = 'Cor do contorno';
    stOn.onchange = () => { S.stroke = stOn.checked; draw(); };
    stc.oninput = () => { S.strokeColor = stc.value; draw(); };
    const stl = el('label', 'sh-chk'); stl.append(stOn, ' contorno ', stc);
    const posSel = mkSelect([['bottom', 'Embaixo'], ['center', 'No meio'], ['top', 'No topo']], 'bottom', (v) => { S.tx = 256; S.ty = v === 'top' ? 76 : v === 'center' ? 256 : 440; draw(); });
    row('Contorno', stl, posSel);
    const gImg = document.createElement('input'); gImg.type = 'radio'; gImg.name = 'grab'; gImg.checked = true;
    const gTxt = document.createElement('input'); gTxt.type = 'radio'; gTxt.name = 'grab';
    gImg.onchange = () => { if (gImg.checked) S.grab = 'image'; };
    gTxt.onchange = () => { if (gTxt.checked) S.grab = 'text'; };
    const l1 = el('label', 'sh-chk'); l1.append(gImg, ' a imagem');
    const l2 = el('label', 'sh-chk'); l2.append(gTxt, ' o texto');
    row('Arrastar', l1, l2);
    right.append(el('div', 'sh-scsep'));
    const nameIn = el('input', 'sh-input'); nameIn.placeholder = 'Nome da figurinha'; nameIn.maxLength = 40;
    nameIn.addEventListener('keydown', (e) => e.stopPropagation());
    row('Nome', nameIn);
    const gifBox = el('div', 'sh-gifbox'); gifBox.hidden = true;
    gifBox.append(el('div', 'sh-hint', 'Esta imagem pode ser animada. Com “manter a animação” marcado, o texto, a forma e o fundo entram em todos os quadros e a figurinha sai como GIF animado. O botão abaixo envia o arquivo original, sem alterações.'));
    const animRow = el('label', 'sh-chk'); animRow.hidden = true;
    const animOn = document.createElement('input'); animOn.type = 'checkbox'; animOn.checked = true;
    animOn.onchange = () => startAnim();
    animRow.append(animOn, ' manter a animação (texto, forma e fundo valem para todos os quadros)');
    const keep = el('button', 'sh-btn', '🎞 Salvar o GIF original (mantém a animação)');
    keep.onclick = async () => {
      showErr('');
      if (!S.file) return;
      if (S.file.size > 4 * 1024 * 1024) { showErr('Esse arquivo tem mais de 4 MB, o limite das figurinhas.'); return; }
      keep.disabled = true;
      const ext = (S.file.type.split('/')[1] || 'gif').replace('apng', 'png');
      const nm = (nameIn.value.trim() || (S.file.name || 'figurinha').replace(/\.[^.]+$/, '')) + '.' + ext;
      const r = await api.srvUploadSticker(cid, nm, S.file.type, await S.file.arrayBuffer());
      keep.disabled = false;
      if (r.s >= 200 && r.s < 300) { await loadStickers(); env.toast(`Figurinha "${nm}" salva (animação mantida).`); close(); } else showErr((r.j && r.j.error) || 'O servidor recusou o arquivo.');
    };
    gifBox.append(animRow, keep);
    right.append(gifBox, err);
    const bar = el('div', 'sh-compbar');
    const cancel = el('button', 'sh-btn', 'Cancelar');
    const save = el('button', 'sh-send', '💾 Criar e salvar na minha coleção');
    const close = () => { stopAnim(); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.removeEventListener('paste', onPaste, true); ov.remove(); };
    cancel.onclick = close;
    const toBlob = (type, q) => new Promise((res) => cv.toBlob(res, type, q));
    save.onclick = async () => {
      showErr('');
      if (!S.img && !S.emoji && !S.text.trim()) { showErr('Escolha uma imagem, um emoji ou escreva um texto.'); return; }
      save.disabled = true; save.textContent = 'Salvando…';
      try {
        if (S.frames && S.frames.length > 1 && animOn.checked) { // GIF animado com texto/forma/fundo
          let bytes = null;
          for (const size of [256, 200, 160]) { bytes = await exportAnimated(size); if (bytes.length <= 3.9 * 1024 * 1024) break; }
          if (bytes.length > 4 * 1024 * 1024) throw new Error('O GIF ficou maior que 4 MB mesmo reduzido. Use um GIF com menos quadros ou desmarque "manter a animação".');
          const nm = (nameIn.value.trim() || 'figurinha') + '.gif';
          const r2 = await api.srvUploadSticker(cid, nm, 'image/gif', bytes.buffer);
          if (r2.s >= 200 && r2.s < 300) { await loadStickers(); env.toast(`Figurinha animada "${nm.replace(/\.gif$/, '')}" salva na sua coleção.`); close(); return; }
          throw new Error((r2.j && r2.j.error) || 'O servidor recusou a figurinha (erro ' + r2.s + ').');
        }
        let blob = await toBlob('image/png');
        let ext = 'png';
        if (!blob || blob.size > 1.8 * 1024 * 1024) { blob = await toBlob('image/webp', 0.92); ext = 'webp'; }
        if (!blob) throw new Error('Não consegui gerar a imagem da figurinha.');
        const name = (nameIn.value.trim() || 'figurinha') + '.' + ext;
        const r = await api.srvUploadSticker(cid, name, blob.type || 'image/png', await blob.arrayBuffer());
        if (r.s >= 200 && r.s < 300) { await loadStickers(); env.toast(`Figurinha "${name.replace(/\.\w+$/, '')}" salva na sua coleção. Abra 🏷 Figurinhas para usar.`); close(); return; }
        throw new Error((r.j && r.j.error) || 'O servidor recusou a figurinha (erro ' + r.s + ').');
      } catch (e) { showErr(e.message); }
      save.disabled = false; save.textContent = '💾 Criar e salvar na minha coleção';
    };
    bar.append(el('span', 'sh-sp'), cancel, save);
    right.append(bar);
    wrap.append(left, right);
    panel.append(wrap);
    ov.onclick = null;
    draw();
  }
  function insertAt(ta, text) {
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd ?? at);
    ta.selectionStart = ta.selectionEnd = at + text.length;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  }
  async function react(seg, emoji) {
    const r = await call('POST', `/api/notes/${open.nid}/segments/${seg.id}/react`, { emoji });
    if (!(r.s >= 200 && r.s < 300)) env.toast((r.j && r.j.error) || 'Não consegui reagir');
  }
  async function sendSticker(sticker) {
    const o = open;
    if (!o || o.sending) return; // clique repetido não manda a figurinha duas vezes
    o.sending = true;
    try {
      const r = await call('POST', `/api/notes/${o.nid}/segments`, { sticker, replyTo: o.replyTo ? o.replyTo.id : threadTarget() });
      if (!(r.s >= 200 && r.s < 300)) { env.toast((r.j && r.j.error) || 'Não consegui enviar o sticker'); return; }
      clearReply();
      appendSent(o, r.j);
    } finally { o.sending = false; }
  }

  /* ───────────── miniatura de links (como no WhatsApp) ───────────── */
  const lpCache = new Map(); // url -> prévia | null
  const lpFlight = new Map(); // url -> Promise (pedido em andamento)
  const lpDisk = (() => { try { return JSON.parse(localStorage.getItem('tt.lp') || '{}'); } catch { return {}; } })(); // url -> { t, v }: vale 1 dia (sem prévia: 1 hora)
  const lpSave = () => {
    const k = Object.keys(lpDisk);
    if (k.length > 150) for (const x of k.sort((a, b) => lpDisk[a].t - lpDisk[b].t).slice(0, k.length - 150)) delete lpDisk[x];
    try { localStorage.setItem('tt.lp', JSON.stringify(lpDisk)); } catch { /* sem gravar */ }
  };
  let lpRun = 0; const lpWait = [];
  const lpSlot = () => new Promise((res) => { if (lpRun < 3) { lpRun++; res(); } else lpWait.push(() => { lpRun++; res(); }); });
  const lpFree = () => { lpRun--; const n = lpWait.shift(); if (n) n(); };
  function lpGet(url) {
    if (lpCache.has(url)) return Promise.resolve(lpCache.get(url));
    const d = lpDisk[url];
    if (d && Date.now() - d.t < (d.v ? 86400000 : 3600000)) { lpCache.set(url, d.v || null); return Promise.resolve(d.v || null); }
    if (lpFlight.has(url)) return lpFlight.get(url);
    const p = (async () => {
      await lpSlot();
      try {
        let v = null; let local = true;
        try { v = await api.linkPreview(url); } catch { local = false; } // busca aqui no PC; só pergunta ao servidor se esta busca não existir
        if (!v && !local) { try { const r = await call('GET', '/api/link-preview?url=' + encodeURIComponent(url)); if (r.s === 200 && r.j && r.j.preview) v = r.j.preview; } catch { /* servidor sem prévia */ } }
        lpCache.set(url, v || null); lpDisk[url] = { t: Date.now(), v: v || null }; lpSave();
        return v || null;
      } finally { lpFree(); lpFlight.delete(url); }
    })();
    lpFlight.set(url, p);
    return p;
  }
  function linkCard(url) {
    const card = el('a', 'sh-lc'); card.hidden = true; card.title = url;
    card.onclick = (e) => { e.preventDefault(); e.stopPropagation(); api.openExternal(url); };
    const fill = (p) => {
      if (!p || !(p.title || p.description || p.image)) return;
      card.textContent = '';
      if (p.image) { const im = el('img', 'sh-lc-img'); im.loading = 'lazy'; im.alt = ''; im.referrerPolicy = 'no-referrer'; im.src = p.image; im.onerror = () => im.remove(); card.append(im); }
      const tx = el('div', 'sh-lc-tx');
      tx.append(el('div', 'sh-lc-site', p.site || ''));
      if (p.title) tx.append(el('div', 'sh-lc-title', p.title));
      if (p.description) tx.append(el('div', 'sh-lc-desc', p.description));
      card.append(tx); card.hidden = false;
    };
    const known = lpCache.get(url);
    if (known && !(known instanceof Promise)) fill(known); else lpGet(url).then(fill);
    return card;
  }

  // prévia do link enquanto você escreve (como no WhatsApp): aparece acima do campo
  let cpTimer = null; let cpUrl = '';
  function compPreviewSoon() { clearTimeout(cpTimer); cpTimer = setTimeout(compPreview, 500); }
  function compPreview() {
    const o = open; if (!o || !o.ui || !o.ui.linkPrev) return;
    const m = /https?:\/\/[^\s<>"'`)\]]+/i.exec(o.ui.composer.value || '');
    const url = m ? m[0].replace(/[.,;:!?]+$/, '') : '';
    if (url === cpUrl && (url ? !o.ui.linkPrev.hidden || lpCache.get(url) === null : o.ui.linkPrev.hidden)) return;
    cpUrl = url; o.ui.linkPrev.textContent = ''; o.ui.linkPrev.hidden = true;
    if (!url) return;
    const card = linkCard(url);
    const x = el('button', 'sh-linkprev-x', '×'); x.title = 'Tirar a prévia'; x.onclick = () => { o.ui.linkPrev.hidden = true; o.ui.linkPrev.textContent = ''; };
    o.ui.linkPrev.append(card, x);
    const show = () => { o.ui.linkPrev.hidden = card.hidden; };
    new MutationObserver(show).observe(card, { attributes: true, attributeFilter: ['hidden'] }); show();
  }

  /* ───────────── tela de envio de anexos (como no WhatsApp) ───────────── */
  // Prints e fotos grandes demoram para subir: reduz para no máximo 1920 px e salva em WebP (bem menor). Só usa o resultado se ficar menor.
  async function optimizeImage(file) {
    if (!/^image\/(png|jpe?g|webp|bmp)$/i.test(file.type) || file.size < 150 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 400 * 1024) { bmp.close && bmp.close(); return file; }
      const w = Math.round(bmp.width * k); const h = Math.round(bmp.height * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.86));
      if (!blob || blob.size >= file.size * 0.9) return file;
      return new File([blob], (file.name || 'imagem').replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
    } catch { return file; }
  }
  const sizeOf = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  function attachModal(files) {
    const o = open;
    if (!o || !files.length) return;
    if (document.querySelector('.sh-att')) return;
    const items = []; let cur = 0; let busy = false;
    const ov = el('div', 'sh-att');
    const top = el('div', 'sh-att-top'); const x = el('button', 'sh-att-x', '✕'); x.title = 'Fechar (Esc)'; top.append(x);
    const stage = el('div', 'sh-att-stage');
    const bottom = el('div', 'sh-att-bottom');
    const capRow = el('div', 'sh-att-caprow'); const cap = el('input', 'sh-att-cap'); cap.placeholder = 'Digite uma mensagem'; const pre = o.ui.composer.value; cap.value = pre; capRow.append(cap);
    const strip = el('div', 'sh-att-strip');
    const send = el('button', 'sh-att-send', '➤'); send.title = 'Enviar (Enter)';
    const foot = el('div', 'sh-att-foot'); foot.append(el('span', 'sh-sp'), strip, el('span', 'sh-sp'), send);
    const msg = el('div', 'sh-att-msg');
    // qualidade das imagens: Otimizada (padrão) ou Original
    let quality = 'opt'; try { quality = localStorage.getItem('tt.imgQuality') || 'opt'; } catch { /* padrão */ }
    const qrow = el('div', 'sh-att-q'); const qsel = el('select'); qsel.innerHTML = '<option value="opt">Imagens: otimizadas (envio mais rápido)</option><option value="orig">Imagens: qualidade original</option>'; qsel.value = quality;
    const qinfo = el('span', 'sh-att-qinfo'); qrow.append(qsel, qinfo);
    qsel.onchange = () => { quality = qsel.value; try { localStorage.setItem('tt.imgQuality', quality); } catch { /* */ } for (const it of items) if (it.img && quality === 'opt' && !it.optP) startOpt(it); draw(); };
    bottom.append(capRow, qrow, foot, msg);
    ov.append(top, stage, bottom);
    const fi = document.createElement('input'); fi.type = 'file'; fi.multiple = true; fi.hidden = true;
    const add = (list) => {
      for (const f of list) {
        const it = { f, name: f.name && f.name.toLowerCase() !== 'image.png' ? f.name : `imagem ${fmt(Date.now()).replace(/[/:]/g, '-')}.png`, img: /^image\//.test(f.type), url: '' };
        items.push(it);
        if (it.img) { const r = new FileReader(); r.onload = () => { it.url = String(r.result); draw(); }; r.readAsDataURL(f); if (quality === 'opt') startOpt(it); }
      }
      cur = Math.min(cur, items.length - 1); if (list.length) cur = items.length - list.length;
      draw();
    };
    fi.onchange = () => { add([...fi.files]); fi.value = ''; };
    const startOpt = (it) => { it.optP = optimizeImage(it.f).then((f) => { it.opt = f; draw(); return f; }); };
    const outFile = (it) => (it.img && quality === 'opt' && it.opt ? it.opt : it.f);
    function draw() {
      const imgs = items.filter((x) => x.img); qrow.hidden = !imgs.length;
      const before = imgs.reduce((a, x) => a + x.f.size, 0); const after = imgs.reduce((a, x) => a + outFile(x).size, 0);
      qinfo.textContent = imgs.length && quality === 'opt' && after < before ? `${sizeOf(before)} → ${sizeOf(after)}` : '';
      stage.textContent = ''; strip.textContent = '';
      const it = items[cur];
      if (it) {
        if (it.img && it.url) { const im = el('img'); im.src = it.url; im.alt = ''; stage.append(im); }
        else { const b = el('div', 'sh-att-file'); b.append(el('div', 'ico', it.img ? '🖼' : /^video\//.test(it.f.type) ? '🎞' : '📎'), el('div', 'nm', it.name), el('div', 'sz', sizeOf(it.f.size))); stage.append(b); }
      }
      items.forEach((m, i) => {
        const t = el('button', 'sh-att-th' + (i === cur ? ' on' : '')); t.title = m.name;
        if (m.img && m.url) { const im = el('img'); im.src = m.url; im.alt = ''; t.append(im); } else t.textContent = m.img ? '🖼' : '📎';
        t.onclick = () => { cur = i; draw(); };
        if (items.length > 1) { const rm = el('span', 'rm', '×'); rm.title = 'Tirar'; rm.onclick = (e) => { e.stopPropagation(); items.splice(i, 1); if (!items.length) return close(); cur = Math.min(cur, items.length - 1); draw(); }; t.append(rm); }
        strip.append(t);
      });
      const plus = el('button', 'sh-att-plus', '+'); plus.title = 'Adicionar mais arquivos'; plus.onclick = () => fi.click(); strip.append(plus);
    }
    const close = () => { ov.remove(); fi.remove(); document.removeEventListener('keydown', onKey, true); if (open === o) o.ui.composer.focus(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) close(); }
    };
    document.addEventListener('keydown', onKey, true);
    x.onclick = () => { if (!busy) close(); };
    async function go() {
      if (busy || !items.length) return;
      busy = true; send.disabled = true;
      const lines = [];
      try {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          msg.textContent = `Enviando ${i + 1} de ${items.length}…`;
          if (it.img && quality === 'opt' && it.optP) await it.optP;
          const f = outFile(it); const nm = f === it.f ? it.name : it.name.replace(/\.[^.]+$/, '') + '.webp';
          msg.textContent = `Enviando ${i + 1} de ${items.length} · ${nm} (${sizeOf(f.size)})…`;
          const buf = await f.arrayBuffer();
          const r = await api.srvUpload(cid, o.pid, nm, f.type, buf);
          if (!(r.s >= 200 && r.s < 300)) throw new Error((r.j && r.j.error) || 'Não consegui enviar o arquivo');
          const id = r.j.id;
          lines.push(it.img ? `![${nm}](srv-file:${id})` : /^video\//.test(f.type) ? `![${nm}](srv-file:${id}#video)` : `[📎 ${nm}](srv-file:${id})`);
        }
        const text = lines.join('\n') + (cap.value.trim() ? '\n\n' + cap.value.trim() : '');
        const reply = o.replyTo;
        const r = await call('POST', `/api/notes/${o.nid}/segments`, { text, replyTo: reply ? reply.id : threadTarget() });
        if (!(r.s >= 200 && r.s < 300)) throw new Error((r.j && r.j.error) || 'Não consegui enviar');
        if (o.ui.composer.value === pre) { o.ui.composer.value = ''; drafts.delete(o.nid); compPreview(); } // o texto que estava no campo foi junto
        if (open === o) { clearReply(); o.ui.list.scrollTop = 1e9; }
        appendSent(o, r.j);
        busy = false; close();
      } catch (e) { busy = false; send.disabled = false; msg.textContent = e.message || 'Falhou'; }
    }
    send.onclick = go;
    cap.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    cap.addEventListener('paste', (e) => { const fs = clipFiles(e); if (fs.length) { e.preventDefault(); e.stopPropagation(); add(fs); } });
    ov.addEventListener('dragover', (e) => e.preventDefault());
    ov.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); add([...e.dataTransfer.files]); } });
    document.body.append(ov, fi);
    add(files);
    cap.focus();
  }

  /* ───────────── anexos ───────────── */
  async function upload(files, ta) {
    const o = open;
    for (const f of files) {
      o.ui.status.textContent = `Enviando ${f.name || 'imagem'}…`;
      const buf = await f.arrayBuffer();
      const name = f.name && f.name.toLowerCase() !== 'image.png' ? f.name : `imagem ${fmt(Date.now()).replace(/[/:]/g, '-')}.png`;
      const r = await api.srvUpload(cid, o.pid, name, f.type, buf);
      if (!(r.s >= 200 && r.s < 300)) { env.toast((r.j && r.j.error) || 'Não consegui enviar o arquivo'); continue; }
      const id = r.j.id;
      const ins = /^image\//.test(f.type) ? `![${name}](srv-file:${id})` : /^video\//.test(f.type) ? `![${name}](srv-file:${id}#video)` : `[📎 ${name}](srv-file:${id})`;
      const at = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, at) + (at && !/\n$/.test(ta.value.slice(0, at)) ? '\n' : '') + ins + '\n' + ta.value.slice(ta.selectionEnd ?? at);
      if (ta === o.ui.composer) drafts.set(o.nid, ta.value);
    }
    o.ui.status.textContent = '';
    ta.focus();
  }

  return {
    cid, init, renderTree, show, refreshProjects, onEvent,
    usersModal, accessModal,
    label: () => st.label || hostOf(),
    setLabel: (l) => { st.label = l; },
    update: (c) => { st = { ...st, url: c.url, user: c.user, token: c.token, connected: !!c.connected, label: c.label || st.label }; },
    isAdmin: () => isAdmin(),
    // Canvas compartilhado (um editor por vez): o app usa estas chamadas
    canvas: {
      me: () => st.user,
      who,
      fileUrl,
      load: (nid) => req('GET', `/api/notes/${nid}`),
      lock: (nid, force) => call('POST', `/api/notes/${nid}/lock`, force ? { force: true } : {}),
      unlock: (nid) => call('DELETE', `/api/notes/${nid}/lock`),
      save: (nid, text, baseVersion) => call('PUT', `/api/notes/${nid}/canvas`, { text, baseVersion }),
      history: (nid) => req('GET', `/api/notes/${nid}/canvas/history`),
      restore: (nid, version) => call('POST', `/api/notes/${nid}/canvas/restore`, { version }),
      rename: async (nid, title) => { const r = await tryReq('PATCH', `/api/notes/${nid}`, { title }); if (r) refreshProjects(); return !!r; },
      markRead: (nid) => call('POST', `/api/notes/${nid}/read`, {}),
      upload: async (pid, file) => {
        const name = file.name && file.name.toLowerCase() !== 'image.png' ? file.name : `imagem ${Date.now()}.png`;
        const r = await api.srvUpload(cid, pid, name, file.type, await file.arrayBuffer());
        if (!(r.s >= 200 && r.s < 300)) { env.toast((r.j && r.j.error) || 'Não consegui enviar a imagem'); return null; }
        return { id: r.j.id, name };
      },
    },
    hide() { if (open) { drafts.set(open.nid, open.ui.composer?.value || ''); } },
    totalUnread: () => projects.reduce((a, p) => a + (p.unread || 0), 0),
    totalMine: () => projects.reduce((a, p) => a + (p.mine || 0), 0),
  };
}

// Vários servidores ao mesmo tempo: cada conexão tem a sua visão (projetos, notas, usuários, stickers) e o seu login
export function createShared(env) {
  const api = window.api;
  const views = new Map();
  const wrap = {
    ...env,
    reconnect: (c) => manager.login(c),
    removeServer: async (cid) => { await api.srvLogout(cid); views.delete(cid); env.rerenderTree(); },
    renameServer: async (cid, label) => { await api.srvLabel(cid, label); const v = views.get(cid); if (v) v.setLabel(label); env.rerenderTree(); },
  };
  const manager = { login: (pre) => login(pre) };
  const addView = (c) => { let v = views.get(c.id); if (!v) { v = createServerView(wrap, c); views.set(c.id, v); } return v; };
  const ask = (placeholder, o = {}) => new Promise((res) => env.showPalette({ placeholder, password: !!o.password, initial: o.initial || '', onFree: (t) => res(t.trim()), items: () => [] }));

  async function init() {
    for (const c of await api.srvList()) await addView(c).init();
    api.onSrvEvent((ev) => {
      if (ev.type === 'conn' || ev.type === 'project' || ev.type === 'note' || ev.type === 'stickers' || ev.type === 'presence' || ev.type === 'nudge') { const v = views.get(ev.conn); if (v) v.onEvent(ev); }
    });
    env.rerenderTree();
  }
  // Formulário para conectar em um servidor (novo ou de novo): endereço, usuário, senha e um nome opcional
  function login(pre = {}) {
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const ov = mk('div', 'sh-lightbox sh-modal');
    const panel = mk('div', 'sh-panel');
    panel.style.width = 'min(460px, 94vw)';
    panel.onclick = (e) => e.stopPropagation();
    const close = () => ov.remove();
    const hd = mk('div', 'sh-phead');
    hd.append(mk('b', null, pre.url ? 'Entrar no servidor' : 'Conectar a um servidor'), mk('span', 'sh-sp'));
    const x = mk('button', 'sh-ic', '×'); x.onclick = close; hd.append(x);
    panel.append(hd, mk('div', 'sh-hint', 'Use o endereço, o usuário e a senha que o administrador do servidor passou para você.'));
    const field = (label, input, hint) => { const f = mk('label', 'sh-field'); f.append(mk('span', null, label), input); if (hint) f.append(mk('span', 'sh-fhint', hint)); panel.append(f); return input; };
    const input = (ph, type = 'text') => { const i = mk('input', 'sh-input'); i.type = type; i.placeholder = ph; i.spellcheck = false; i.autocomplete = 'off'; i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } else if (e.key === 'Escape') close(); }); return i; };
    const url = field('Endereço do servidor', input('100.64.0.5:8787'), 'Ex.: 100.64.0.5:8787 (Tailscale) · 192.168.0.10:8787 (mesma rede) · https://nome.trycloudflare.com (túnel)');
    const dl = mk('datalist'); dl.id = 'sh-urls'; url.setAttribute('list', 'sh-urls'); panel.append(dl);
    api.srvList().then((l) => { for (const c of l) { const o = mk('option'); o.value = c.url.replace(/^http:\/\//, ''); dl.append(o); } }).catch(() => {});
    const user = field('Usuário', input('seu nome de usuário'));
    const pwBox = mk('div', 'sh-pwbox');
    const pw = input('sua senha', 'password'); pw.autocomplete = 'current-password';
    const eye = mk('button', 'sh-btn', '👁'); eye.type = 'button'; eye.title = 'Mostrar/ocultar a senha';
    eye.onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; pw.focus(); };
    pwBox.append(pw, eye);
    const pf = mk('label', 'sh-field'); pf.append(mk('span', null, 'Senha'), pwBox); panel.append(pf);
    const label = field('Nome para este servidor (opcional)', input('ex.: Equipe, Cliente X'), 'Só aparece aqui na lateral, para você diferenciar os servidores.');
    url.value = (pre.url || '').replace(/^http:\/\//, '') || (() => { try { return (localStorage.getItem('tt.lastSrvUrl') || '').replace(/^http:\/\//, ''); } catch { return ''; } })();
    user.value = pre.name || '';
    label.value = pre.label || '';
    const err = mk('div', 'sh-ferr'); err.hidden = true; panel.append(err);
    const bar = mk('div', 'sh-compbar');
    const cancel = mk('button', 'sh-btn', 'Cancelar'); cancel.onclick = close;
    const ok = mk('button', 'sh-send', 'Conectar');
    bar.append(mk('span', 'sh-sp'), cancel, ok);
    panel.append(bar);
    let busy = false;
    async function go() {
      if (busy) return;
      err.hidden = true;
      if (!url.value.trim()) { err.textContent = 'Informe o endereço do servidor.'; err.hidden = false; url.focus(); return; }
      if (!user.value.trim()) { err.textContent = 'Informe o seu usuário.'; err.hidden = false; user.focus(); return; }
      if (!pw.value) { err.textContent = 'Informe a senha.'; err.hidden = false; pw.focus(); return; }
      busy = true; ok.disabled = true; ok.textContent = 'Conectando…';
      const r = await api.srvLogin(url.value.trim(), user.value.trim(), pw.value, label.value.trim());
      busy = false; ok.disabled = false; ok.textContent = 'Conectar';
      if (!r.ok) { err.textContent = r.error; err.hidden = false; pw.select(); return; }
      try { localStorage.setItem('tt.lastSrvUrl', r.conn.url); } catch { /* sem gravar */ }
      close();
      env.toast(`Conectado como ${r.conn.user.name}`);
      const v = addView(r.conn);
      v.update(r.conn);
      await v.init();
      env.rerenderTree();
    }
    ok.onclick = go;
    ov.append(panel);
    ov.onclick = close;
    document.body.append(ov);
    setTimeout(() => (!url.value ? url : !user.value ? user : pw).focus(), 0);
  }
  function renderTree(box) {
    if (!views.size) {
      const row = document.createElement('div');
      row.className = 'row sh-empty-row';
      row.textContent = '＋ Entrar em um servidor…';
      row.title = 'Conectar nos projetos compartilhados de uma equipe';
      row.onclick = () => login();
      box.append(row);
      return;
    }
    for (const v of views.values()) v.renderTree(box);
  }
  const first = (cid) => views.get(cid) || [...views.values()][0];
  return {
    init, login, renderTree,
    show: (host, srv) => { const v = views.get(srv.conn); if (v) v.show(host, srv); else { host.textContent = 'Este servidor não está mais na lista. Entre de novo em ☁ Compartilhado.'; } },
    hide: () => { for (const v of views.values()) v.hide(); },
    count: () => views.size,
    totalUnread: () => [...views.values()].reduce((a, v) => a + v.totalUnread(), 0),
    totalMine: () => [...views.values()].reduce((a, v) => a + v.totalMine(), 0),
    list: () => [...views.values()].map((v) => ({ id: v.cid, label: v.label(), admin: v.isAdmin() })),
    canvasApi: (cid) => (views.get(cid) || {}).canvas || null,
    usersModal: (cid) => first(cid) && first(cid).usersModal(),
    accessModal: (cid, pid) => first(cid) && first(cid).accessModal(pid),
  };
}
