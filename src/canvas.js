// Canvas: quadro infinito de cartões (texto, notas, imagens, grupos) ligados por setas — formato JSON Canvas (.canvas).
// O quadro é só uma "visão" do texto JSON da aba: tudo o que se faz vira uma edição do documento
// (por isso salvar, desfazer, rascunhos e hot exit funcionam como nos outros arquivos).
import { marked } from 'marked';
import { locale } from './i18n.js';

const PRESET = { 1: 'var(--red)', 2: '#d19a66', 3: 'var(--tag)', 4: 'var(--green)', 5: '#56b6c2', 6: 'var(--link)' };
const colorOf = (c) => (c ? (PRESET[c] || c) : null);
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
export const isImagePath = (p) => IMG.test(p || '');
const uid = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const COLOR_KEYS = ['1', '2', '3', '4', '5', '6'];

/*
 env: {
   undo(), redo(), setText(json), toggleJson(), toast(msg),
   readText(absPath) -> Promise<string|null>, fileUrl(absPath), toAbs(stored), toStored(abs),
   renderMd(text, dir) -> Element, pickNote(cb), pickImage(cb), openNote(abs), saveNote(abs, text),
   pathOf(File), onTreePath? (não usado)
 }
*/
// HTML copiado (Word, navegador, VS Code…) → Markdown, mantendo negrito, itálico, links, listas, títulos, tabelas e
// código (fonte monoespaçada vira bloco de código). Quebras de linha e linhas em branco são preservadas.
const MONO = /mono|consolas|courier|menlo|fira ?code|jetbrains|source code|cascadia|lucida console/i;
function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;
  const styleOf = (n) => (n.getAttribute && n.getAttribute('style')) || '';
  const isMono = (n) => !!n.getAttribute && (MONO.test(styleOf(n)) || /^(pre|code|kbd|samp|tt)$/i.test(n.tagName) || MONO.test(n.getAttribute('face') || ''));
  const lines = (n) => { // texto puro com quebras (para blocos de código)
    let out = '';
    const w = (x) => {
      if (x.nodeType === 3) { out += x.nodeValue.replace(/\u00a0/g, ' '); return; }
      if (x.nodeType !== 1) return;
      if (/^br$/i.test(x.tagName)) { out += '\n'; return; }
      const block = /^(div|p|li|tr|pre)$/i.test(x.tagName);
      if (block && out && !out.endsWith('\n')) out += '\n';
      for (const c of x.childNodes) w(c);
      if (block && !out.endsWith('\n')) out += '\n';
    };
    w(n);
    return out.replace(/\n+$/, '');
  };
  const esc = (t) => t.replace(/([\\`*_~[\]])/g, '\\$1');
  const wrap = (m, inner) => (inner.trim() ? `${m}${inner.trim()}${m}` : inner);
  const inline = (n) => {
    let out = '';
    for (const c of n.childNodes) out += node(c);
    return out;
  };
  const list = (n, depth) => {
    const ordered = /^ol$/i.test(n.tagName);
    let i = 0; let out = '';
    for (const li of n.children) {
      if (!/^li$/i.test(li.tagName)) continue;
      i++;
      let text = ''; let sub = '';
      for (const c of li.childNodes) { if (c.nodeType === 1 && /^(ul|ol)$/i.test(c.tagName)) sub += list(c, depth + 1); else text += node(c); }
      out += `${'  '.repeat(depth)}${ordered ? i + '.' : '-'} ${text.trim()}\n${sub}`;
    }
    return out;
  };
  const table = (n) => {
    const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inline(c).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
    if (!rows.length) return '';
    const w = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(w - r.length).fill('')];
    return `\n\n| ${pad(rows[0]).join(' | ')} |\n|${' --- |'.repeat(w)}\n${rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`).join('\n')}\n\n`;
  };
  function node(n) {
    if (n.nodeType === 3) return esc(n.nodeValue.replace(/[\r\n]+/g, ' ').replace(/\u00a0/g, ' '));
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    const st = styleOf(n);
    if (/^(script|style|meta|link|head|title)$/.test(tag)) return '';
    if (tag === 'br') return '\n';
    if (tag === 'pre') return `\n\n\`\`\`\n${lines(n)}\n\`\`\`\n\n`;
    if (/^(code|kbd|samp|tt)$/.test(tag)) { const t = lines(n); return t.includes('\n') ? `\n\n\`\`\`\n${t}\n\`\`\`\n\n` : '`' + t.replace(/`/g, "'") + '`'; }
    if (tag === 'a') { const t = inline(n).trim(); const h = n.getAttribute('href') || ''; return /^https?:|^mailto:/i.test(h) && t ? `[${t}](${h})` : t; }
    if (tag === 'img') { const src = n.getAttribute('src') || ''; return /^https?:/i.test(src) ? `![${n.getAttribute('alt') || ''}](${src})` : ''; }
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${inline(n).trim()}\n\n`;
    if (tag === 'ul' || tag === 'ol') return `\n\n${list(n, 0)}\n`;
    if (tag === 'table') return table(n);
    if (tag === 'blockquote') return `\n\n${inline(n).trim().split('\n').map((l) => '> ' + l).join('\n')}\n\n`;
    if (tag === 'hr') return '\n\n---\n\n';
    let inner = inline(n);
    if (tag === 'b' || tag === 'strong' || /font-weight:\s*(bold|[6-9]00)/i.test(st)) inner = wrap('**', inner);
    if (tag === 'i' || tag === 'em' || /font-style:\s*italic/i.test(st)) inner = wrap('*', inner);
    if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/i.test(st)) inner = wrap('~~', inner);
    if (tag !== 'div' && tag !== 'p' && isMono(n) && inner.trim() && !inner.includes('\n')) inner = '`' + n.textContent.replace(/`/g, "'") + '`';
    if (tag === 'p') return `\n\n${inner.trim()}\n\n`;
    if (tag === 'div' || tag === 'li' || tag === 'section' || tag === 'article') return `\n${inner}\n`;
    return inner;
  }
  // tudo em fonte monoespaçada (ex.: copiado do VS Code/Sublime): vira um bloco de código só, com a indentação original
  const first = root.firstElementChild;
  if (first && (isMono(first) || /white-space:\s*pre/i.test(styleOf(first)) && isMono(root))) return `\`\`\`\n${lines(first)}\n\`\`\``;
  if (isMono(root)) return `\`\`\`\n${lines(root)}\n\`\`\``;
  return node(root).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
}
// Texto simples com cara de código (indentação, chaves, SQL…) também vira bloco de código para não perder o espaçamento
function looksLikeCode(text) {
  const ls = text.split('\n');
  if (ls.length < 2) return false;
  const indented = ls.filter((l) => /^(\t| {2,})\S/.test(l)).length;
  const tokens = /[{};]\s*$|=>|\b(function|const|let|var|return|select|insert|update|delete|from|where|import|class|def|public|private)\b|<\/?[a-z][^>]*>/i;
  const hits = ls.filter((l) => tokens.test(l)).length;
  const aligned = ls.filter((l) => /\S {2,}\S|\t/.test(l)).length; // colunas alinhadas com espaços/tabs (calendário, tabela de terminal…)
  return indented >= 2 || aligned >= 2 || hits >= Math.max(2, Math.ceil(ls.length / 2));
}

export function createCanvas(host, env) {
  host.textContent = '';
  host.tabIndex = 0;
  const bar = el('div', 'cv-bar');
  const stage = el('div', 'cv-stage');
  const world = el('div', 'cv-world');
  const layerG = el('div', 'cv-layer');
  const svg = sv('svg', { class: 'cv-edges' });
  const layerN = el('div', 'cv-layer');
  const layerL = el('div', 'cv-layer');
  world.append(layerG, svg, layerN, layerL);
  const tools = el('div', 'cv-tools');
  tools.hidden = true;
  const hint = el('div', 'cv-hint', 'Canvas vazio — dê dois cliques para criar um cartão de texto, ou arraste notas e imagens para cá.');
  const err = el('div', 'cv-err');
  err.hidden = true;
  stage.append(world, hint, err);
  const main = el('div', 'cv-main');
  const outline0 = null; // (a árvore é criada mais abaixo)
  host.append(bar, main, tools);
  main.append(stage);

  let data = { nodes: [], edges: [] };
  let valid = true;
  let lastText = null;
  let T = { x: 0, y: 0, z: 1 };
  let tabKey = null;
  const transforms = new WeakMap();
  let sel = null; // { kind: 'node'|'edge', id }
  let editing = null; // id do cartão em edição
  const mdCache = new Map(); // texto do cartão -> html pronto (evita renderizar de novo a cada movimento)

  const RO = () => !!(env.readOnly && env.readOnly()); // canvas compartilhado sem a trava de edição: só ver, mover a tela e dar zoom
  const nodeById = (id) => data.nodes.find((n) => n.id === id);
  const stageRect = () => stage.getBoundingClientRect();
  const toWorld = (cx, cy) => { const r = stageRect(); return { x: (cx - r.left - T.x) / T.z, y: (cy - r.top - T.y) / T.z }; };
  const center = () => { const r = stageRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

  /* ── persistência: o JSON vai para o documento da aba ── */
  function commit() {
    if (!valid) return;
    const text = JSON.stringify(data, null, 2) + '\n';
    if (text === lastText) return;
    lastText = text;
    env.setText(text);
  }

  function load(text) {
    lastText = text;
    err.hidden = true;
    try {
      const j = text.trim() ? JSON.parse(text) : {};
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('o arquivo não é um canvas');
      j.nodes = Array.isArray(j.nodes) ? j.nodes : [];
      j.edges = Array.isArray(j.edges) ? j.edges : [];
      data = j;
      valid = true;
    } catch (e) {
      valid = false;
      data = { nodes: [], edges: [] };
      err.textContent = 'Este arquivo não é um JSON válido (' + e.message + '). Use "Ver JSON" para corrigir.';
      err.hidden = false;
    }
  }

  /* ── desenho ── */
  function applyT() {
    world.style.transform = `translate(${T.x}px, ${T.y}px) scale(${T.z})`;
    stage.style.backgroundPosition = `${T.x}px ${T.y}px`;
    stage.style.backgroundSize = `${24 * T.z}px ${24 * T.z}px`;
    placeTools();
    if (tabKey) transforms.set(tabKey, { ...T });
  }

  function anchor(n, side) {
    const x = n.x, y = n.y, w = n.width, h = n.height;
    return side === 'top' ? { x: x + w / 2, y } : side === 'bottom' ? { x: x + w / 2, y: y + h } : side === 'left' ? { x, y: y + h / 2 } : { x: x + w, y: y + h / 2 };
  }
  function nearestSide(n, p) {
    const c = { x: n.x + n.width / 2, y: n.y + n.height / 2 };
    const dx = (p.x - c.x) / n.width; const dy = (p.y - c.y) / n.height;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  }
  function bestSides(a, b) { // lados que ficam de frente um para o outro
    const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    return [nearestSide(a, cb), nearestSide(b, ca)];
  }
  function edgeGeom(e) {
    const a = nodeById(e.fromNode); const b = nodeById(e.toNode);
    if (!a || !b) return null;
    const p1 = anchor(a, e.fromSide || 'right'); const p2 = anchor(b, e.toSide || 'left');
    const n1 = NORMAL[e.fromSide || 'right']; const n2 = NORMAL[e.toSide || 'left'];
    const off = Math.max(50, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35);
    const c1 = { x: p1.x + n1[0] * off, y: p1.y + n1[1] * off };
    const c2 = { x: p2.x + n2[0] * off, y: p2.y + n2[1] * off };
    return { p1, p2, c1, c2, n1, n2, mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 } };
  }
  const arrowPts = (tip, n, size) => { // ponta de seta apontando para dentro do cartão (direção = -n)
    const d = [-n[0], -n[1]]; const px = [-d[1], d[0]];
    const bx = tip.x - d[0] * size; const by = tip.y - d[1] * size;
    return `${tip.x},${tip.y} ${bx + px[0] * size * 0.55},${by + px[1] * size * 0.55} ${bx - px[0] * size * 0.55},${by - px[1] * size * 0.55}`;
  };

  function drawEdges() {
    svg.textContent = '';
    layerL.textContent = '';
    for (const e of data.edges) {
      const g = edgeGeom(e);
      if (!g) continue;
      const col = colorOf(e.color) || 'var(--border2)';
      const isSel = sel && sel.kind === 'edge' && sel.id === e.id;
      const d = `M ${g.p1.x} ${g.p1.y} C ${g.c1.x} ${g.c1.y}, ${g.c2.x} ${g.c2.y}, ${g.p2.x} ${g.p2.y}`;
      const grp = sv('g', { class: 'cv-edge' + (isSel ? ' sel' : ''), 'data-edge': e.id });
      grp.append(sv('path', { d, class: 'cv-hit' }), sv('path', { d, class: 'cv-line', stroke: col, 'stroke-width': isSel ? 3.5 : 2 }));
      if (e.toEnd !== 'none') grp.append(sv('polygon', { points: arrowPts(g.p2, g.n2, 11), fill: col }));
      if (e.fromEnd === 'arrow') grp.append(sv('polygon', { points: arrowPts(g.p1, g.n1, 11), fill: col }));
      svg.append(grp);
      if (e.label || (editing === 'edge:' + e.id)) {
        const lb = el('div', 'cv-elabel', e.label || '');
        lb.style.left = g.mid.x + 'px'; lb.style.top = g.mid.y + 'px';
        lb.dataset.edge = e.id;
        if (isSel) lb.classList.add('sel');
        layerL.append(lb);
      }
    }
  }

  function setBox(div, n) {
    div.style.left = n.x + 'px'; div.style.top = n.y + 'px';
    div.style.width = n.width + 'px'; div.style.height = n.height + 'px';
  }

  async function fillFile(body, n) {
    const abs = env.toAbs(n.file || '');
    if (isImagePath(abs)) {
      const img = el('img', 'cv-img');
      img.draggable = false;
      img.src = env.fileUrl(abs);
      img.onerror = () => { body.textContent = ''; body.append(el('div', 'cv-missing', '🖼 imagem não encontrada: ' + (n.file || ''))); };
      body.append(img);
      return;
    }
    const text = await env.readText(abs);
    if (text == null) { body.append(el('div', 'cv-missing', 'Nota não encontrada: ' + (n.file || ''))); return; }
    if (!body.isConnected) return;
    body.textContent = '';
    body.append(env.renderMd(text, abs.replace(/[\\/][^\\/]*$/, '')));
  }

  function mkNode(n) {
    const type = n.type || 'text';
    const div = el('div', 'cv-node t-' + type);
    div.dataset.node = n.id;
    setBox(div, n);
    const col = colorOf(n.color);
    if (col) div.style.setProperty('--nc', col);
    if (sel && sel.kind === 'node' && sel.id === n.id) div.classList.add('sel');
    if (foundIds.has(n.id)) div.classList.add('found');
    if (type === 'group') {
      if (editing === n.id) {
        const inp = el('input', 'cv-ginput');
        inp.value = n.label || '';
        inp.spellcheck = false;
        div.append(inp);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        let done = false;
        const fin = (save) => { if (done) return; done = true; editing = null; if (save) { if (inp.value.trim()) n.label = inp.value.trim(); else delete n.label; commit(); } render(); };
        inp.addEventListener('blur', () => fin(true));
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); fin(true); host.focus(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(false); host.focus(); }
          if (!(e.ctrlKey || e.metaKey || e.altKey)) e.stopPropagation();
        });
      } else div.append(el('div', 'cv-glabel', n.label || 'Grupo'));
    } else {
      const head = type === 'file' ? el('div', 'cv-title', (n.file || '').split('/').pop().replace(/\.md$/i, '')) : null;
      if (head && isImagePath(n.file)) head.hidden = true;
      if (head) div.append(head);
      const body = el('div', 'cv-body');
      if (type === 'text') {
        if (editing === n.id) {
          const ta = el('textarea', 'cv-ta');
          ta.value = n.text || '';
          ta.spellcheck = false;
          body.append(ta);
          setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
          const done = (save) => {
            if (editing !== n.id) return;
            editing = null;
            if (save && ta.value !== (n.text || '')) n.text = ta.value;
            mdCache.delete(n.text);
            commit(); render();
          };
          ta.addEventListener('blur', () => done(true));
          ta.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(true); host.focus(); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(true); host.focus(); }
            if (!(e.ctrlKey || e.metaKey || e.altKey)) e.stopPropagation(); // letras não disparam atalhos do app
          });
        } else {
          const t = n.text || '';
          if (!t.trim()) body.append(el('div', 'cv-empty', 'Duplo clique para escrever…'));
          else {
            let box = mdCache.get(t);
            if (!box) { box = env.renderMd(t, '', true); mdCache.set(t, box); if (mdCache.size > 300) mdCache.delete(mdCache.keys().next().value); }
            body.append(box.cloneNode(true));
          }
        }
      } else if (type === 'file') {
        if (editing === n.id) {
          const ta = el('textarea', 'cv-ta');
          ta.spellcheck = false;
          ta.value = '…';
          ta.disabled = true;
          body.append(ta);
          env.readText(env.toAbs(n.file)).then((text) => {
            if (text == null) { editing = null; render(); return; }
            ta.value = text; ta.disabled = false; ta.focus();
          });
          const done = (save) => {
            if (editing !== n.id) return;
            editing = null;
            if (save && !ta.disabled) env.saveNote(env.toAbs(n.file), ta.value);
            render();
          };
          ta.addEventListener('blur', () => done(true));
          ta.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(true); host.focus(); }
            if (!(e.ctrlKey || e.metaKey || e.altKey)) e.stopPropagation();
          });
        } else fillFile(body, n);
      } else if (type === 'link') {
        const a = el('a', 'cv-link', n.url || '');
        a.href = n.url || '#';
        body.append(a);
      }
      div.append(body);
    }
    div.append(el('div', 'cv-rz'));
    for (const s of ['top', 'right', 'bottom', 'left']) { const h = el('div', 'cv-h ' + s); h.dataset.side = s; div.append(h); }
    if (type !== 'group' && (n.by || n.editedBy) && env.whoIs) { // canvas compartilhado: quem fez e quem mexeu por último
      const c = n.by && env.whoIs(n.by); const e = n.editedBy && env.whoIs(n.editedBy);
      const when = (ts) => (ts ? new Date(ts).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
      const shown = e || c;
      if (shown) {
        const tag = el('div', 'cv-by', (e ? '✎ ' : '') + shown.name);
        tag.style.setProperty('--uc', shown.color);
        tag.title = [c ? `Criado por ${c.name}${n.ts ? ' em ' + when(n.ts) : ''}` : '', e ? `Editado por ${e.name}${n.editedTs ? ' em ' + when(n.editedTs) : ''}` : ''].filter(Boolean).join('\n');
        div.append(tag);
      }
    }
    return div;
  }

  function render() {
    layerG.textContent = '';
    layerN.textContent = '';
    for (const n of data.nodes) (n.type === 'group' ? layerG : layerN).append(mkNode(n));
    drawEdges();
    hint.hidden = data.nodes.length > 0 || !valid;
    placeTools();
    renderOutline();
    if (!find.hidden) { runFind(); }
  }

  /* ── árvore do canvas: tudo o que tem no quadro, no lado direito (fixável) ── */
  const outline = el('div', 'cv-outline');
  outline.hidden = true;
  let oPrefs = { pinned: false, open: false, mode: 'group' };
  try { oPrefs = { ...oPrefs, ...JSON.parse(localStorage.getItem('tt.cvOutline') || '{}') }; } catch { /* padrão */ }
  const saveO = () => { try { localStorage.setItem('tt.cvOutline', JSON.stringify(oPrefs)); } catch { /* sem gravar */ } };
  const nodeLabel = (n) => {
    if (n.type === 'group') return '▣ ' + (n.label || 'Grupo');
    if (n.type === 'file') { const nm = (n.file || '').split('/').pop(); return isImagePath(n.file) ? '🖼 ' + nm : '📄 ' + nm.replace(/\.(md|markdown|txt)$/i, ''); }
    if (n.type === 'link') return '🔗 ' + (n.url || '');
    const t = (n.text || '').split('\n').map((l) => l.replace(/^[#>*\-\s[\]xX]+/, '').trim()).find(Boolean);
    return '▭ ' + (t ? (t.length > 38 ? t.slice(0, 38) + '…' : t) : '(vazio)');
  };
  function reveal(kind, id) {
    const r = stageRect();
    if (kind === 'node') {
      const n = nodeById(id);
      if (!n) return;
      select({ kind: 'node', id });
      T.x = r.width / 2 - (n.x + n.width / 2) * T.z; T.y = r.height / 2 - (n.y + n.height / 2) * T.z;
    } else {
      const e = data.edges.find((x) => x.id === id); const g = e && edgeGeom(e);
      if (!g) return;
      select({ kind: 'edge', id });
      T.x = r.width / 2 - g.mid.x * T.z; T.y = r.height / 2 - g.mid.y * T.z;
    }
    applyT();
  }
  function renderOutline() {
    outline.hidden = !oPrefs.open;
    outline.classList.toggle('pinned', !!oPrefs.pinned);
    if (!oPrefs.open) return;
    outline.textContent = '';
    const head = el('div', 'cv-oh');
    head.append(el('b', null, 'Estrutura'), el('span', 'cv-sp'));
    const mk = (txt, title, fn, on) => { const b = el('button', 'cv-ob' + (on ? ' on' : ''), txt); b.title = title; b.onmousedown = (e) => e.preventDefault(); b.onclick = fn; head.append(b); };
    mk('Grupos', 'Agrupar pelas áreas do quadro', () => { oPrefs.mode = 'group'; saveO(); renderOutline(); }, oPrefs.mode === 'group');
    mk('Ligações', 'Seguir as setas (bom para mapa mental)', () => { oPrefs.mode = 'links'; saveO(); renderOutline(); }, oPrefs.mode === 'links');
    mk('📌', oPrefs.pinned ? 'Fixada: ocupa espaço ao lado. Clique para soltar' : 'Solta: fica por cima e some ao clicar no quadro. Clique para fixar', () => { oPrefs.pinned = !oPrefs.pinned; saveO(); renderOutline(); }, oPrefs.pinned);
    mk('×', 'Fechar', () => { oPrefs.open = false; saveO(); renderOutline(); }, false);
    const body = el('div', 'cv-obody');
    const item = (label, depth, kind, id, extra) => {
      const d = el('div', 'cv-oi' + (sel && sel.kind === kind && sel.id === id ? ' sel' : ''));
      d.style.paddingLeft = 8 + depth * 14 + 'px';
      d.textContent = label;
      if (extra) d.append(el('span', 'cv-oe', extra));
      d.onclick = () => reveal(kind, id);
      body.append(d);
    };
    const nodes = data.nodes;
    const area = (n) => n.width * n.height;
    const inside = (a, b) => b !== a && b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1;
    const byPos = (a, b) => (a.y - b.y) || (a.x - b.x);
    if (oPrefs.mode === 'group') {
      const groups = nodes.filter((n) => n.type === 'group');
      const parentOf = (n) => groups.filter((g) => inside(g, n)).sort((a, b) => area(a) - area(b))[0] || null;
      const walk = (g, depth) => {
        item(nodeLabel(g), depth, 'node', g.id);
        for (const c of groups.filter((x) => parentOf(x) === g).sort(byPos)) walk(c, depth + 1);
        for (const c of nodes.filter((x) => x.type !== 'group' && parentOf(x) === g).sort(byPos)) item(nodeLabel(c), depth + 1, 'node', c.id);
      };
      for (const g of groups.filter((x) => !parentOf(x)).sort(byPos)) walk(g, 0);
      const free = nodes.filter((x) => x.type !== 'group' && !parentOf(x)).sort(byPos);
      if (free.length && groups.length) body.append(el('div', 'cv-os', 'Fora de grupos'));
      for (const c of free) item(nodeLabel(c), 0, 'node', c.id);
      if (data.edges.length) {
        body.append(el('div', 'cv-os', `Setas (${data.edges.length})`));
        for (const e of data.edges) {
          const a = nodeById(e.fromNode); const b = nodeById(e.toNode);
          if (a && b) item(`${nodeLabel(a).slice(2, 24)} → ${nodeLabel(b).slice(2, 24)}`, 0, 'edge', e.id, e.label || '');
        }
      }
    } else {
      const flow = nodes.filter((n) => n.type !== 'group');
      const incoming = new Set(data.edges.map((e) => e.toNode));
      const seen = new Set();
      const walk = (n, depth, via) => {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        item(nodeLabel(n), depth, 'node', n.id, via || '');
        for (const e of data.edges.filter((x) => x.fromNode === n.id).sort((a, b) => byPos(nodeById(a.toNode) || a, nodeById(b.toNode) || b))) {
          const c = nodeById(e.toNode);
          if (c && c.type !== 'group') walk(c, depth + 1, e.label || '');
        }
      };
      for (const n of flow.filter((x) => !incoming.has(x.id)).sort(byPos)) walk(n, 0);
      for (const n of flow.sort(byPos)) walk(n, 0); // ciclos e sobras
    }
    if (!body.children.length) body.append(el('div', 'cv-oempty', 'O quadro está vazio.'));
    outline.append(head, body);
  }

  /* ── Ctrl+F: buscar no canvas (texto dos cartões, notas, nomes de arquivo, rótulos) ── */
  const find = el('div', 'cv-find');
  find.hidden = true;
  const fIn = el('input', 'cv-fin');
  fIn.placeholder = 'Buscar no canvas…';
  fIn.spellcheck = false;
  const fCnt = el('span', 'cv-fcnt');
  const fX = el('button', 'cv-ob', '×');
  const fList = el('div', 'cv-flist');
  const fTop = el('div', 'cv-ftop');
  fTop.append(fIn, fCnt, fX);
  find.append(fTop, fList);
  stage.append(find);
  let fRes = []; let fIdx = 0;
  const foundIds = new Set();
  const noteTexts = new Map();
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  async function loadNoteTexts() {
    noteTexts.clear();
    for (const n of data.nodes) if (n.type === 'file' && !isImagePath(n.file) && !noteTexts.has(n.file)) noteTexts.set(n.file, (await env.readText(env.toAbs(n.file))) || '');
    if (!find.hidden) runFind();
  }
  function paintFound() { for (const d of host.querySelectorAll('.cv-node')) d.classList.toggle('found', foundIds.has(d.dataset.node)); }
  function runFind() {
    const q = norm(fIn.value.trim());
    fRes = []; foundIds.clear();
    if (q) {
      for (const n of data.nodes) {
        const hay = n.type === 'group' ? (n.label || '') : n.type === 'file' ? (n.file || '') + '\n' + (noteTexts.get(n.file) || '') : n.type === 'link' ? (n.url || '') : (n.text || '');
        const i = norm(hay).indexOf(q);
        if (i < 0) continue;
        const from = Math.max(0, i - 24);
        fRes.push({ kind: 'node', id: n.id, label: nodeLabel(n), snip: (from ? '…' : '') + hay.slice(from, i + q.length + 40).replace(/\s+/g, ' ') });
        foundIds.add(n.id);
      }
      for (const e of data.edges) if (e.label && norm(e.label).includes(q)) fRes.push({ kind: 'edge', id: e.id, label: '→ seta', snip: e.label });
    }
    if (fIdx >= fRes.length) fIdx = 0;
    fCnt.textContent = q ? (fRes.length ? `${fIdx + 1}/${fRes.length}` : 'nada') : '';
    fList.textContent = '';
    fRes.slice(0, 40).forEach((r, i) => {
      const d = el('div', 'cv-fi' + (i === fIdx ? ' on' : ''));
      d.append(el('b', null, r.label), el('span', null, '  ' + r.snip));
      d.onclick = () => { fIdx = i; goFind(); };
      fList.append(d);
    });
    paintFound();
  }
  function goFind() {
    const r = fRes[fIdx];
    if (!r) return;
    reveal(r.kind, r.id);
    runFind();
  }
  function openFind() {
    find.hidden = false;
    fIn.focus(); fIn.select();
    runFind();
    loadNoteTexts();
  }
  function closeFind() { find.hidden = true; foundIds.clear(); paintFound(); host.focus({ preventScroll: true }); }
  fX.onclick = closeFind;
  fIn.addEventListener('input', () => { fIdx = 0; runFind(); if (fRes.length) reveal(fRes[0].kind, fRes[0].id); });
  fIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!fRes.length) return; fIdx = (fIdx + (e.shiftKey ? fRes.length - 1 : 1)) % fRes.length; goFind(); }
    else if (e.key === 'ArrowDown' && fRes.length) { e.preventDefault(); fIdx = (fIdx + 1) % fRes.length; goFind(); }
    else if (e.key === 'ArrowUp' && fRes.length) { e.preventDefault(); fIdx = (fIdx + fRes.length - 1) % fRes.length; goFind(); }
  });
  main.append(outline);

  /* ── barra de ferramentas do cartão/seta selecionado ── */
  function placeTools() {
    tools.textContent = '';
    tools.hidden = true;
    if (RO() || !sel || editing || drag) return;
    const r = stageRect(); const hr = host.getBoundingClientRect();
    let wx, wy;
    if (sel.kind === 'node') { const n = nodeById(sel.id); if (!n) return; wx = n.x + n.width / 2; wy = n.y; }
    else { const e = data.edges.find((x) => x.id === sel.id); const g = e && edgeGeom(e); if (!g) return; wx = g.mid.x; wy = g.mid.y - 14; }
    const mk = (txt, title, fn, cls) => { const b = el('button', 'cv-tb' + (cls ? ' ' + cls : ''), txt); b.title = title; b.onmousedown = (ev) => ev.preventDefault(); b.onclick = fn; return b; };
    const item = sel.kind === 'node' ? nodeById(sel.id) : data.edges.find((x) => x.id === sel.id);
    for (const k of COLOR_KEYS) {
      const d = mk('', 'Cor', () => { item.color = item.color === k ? undefined : k; if (!item.color) delete item.color; commit(); render(); }, 'cv-dot' + (item.color === k ? ' on' : ''));
      d.style.background = PRESET[k];
      tools.append(d);
    }
    tools.append(mk('∅', 'Sem cor', () => { delete item.color; commit(); render(); }));
    if (sel.kind === 'node') {
      if (item.type === 'text' || item.type === 'group') tools.append(mk('✎', 'Editar (Enter)', () => startEdit(item.id)));
      if (item.type === 'text') tools.append(mk('⌗', 'Preservar espaços e quebras exatamente (liga/desliga o bloco de código)', () => {
        const t = item.text || '';
        const fenced = /^```[^\n]*\n[\s\S]*\n```\s*$/.test(t);
        item.text = fenced ? t.replace(/^```[^\n]*\n/, '').replace(/\n```\s*$/, '') : '```\n' + t + '\n```';
        commit(); render();
      }));
      if (item.type === 'file') {
        tools.append(mk('↗', 'Abrir a nota numa aba', () => env.openNote(env.toAbs(item.file))));
        if (!isImagePath(item.file)) tools.append(mk('✎', 'Editar a nota aqui (Enter)', () => startEdit(item.id)));
      }
      tools.append(mk('⧉', 'Duplicar (Ctrl+D)', duplicateSel));
      tools.append(mk('→', 'Novo cartão ligado (Tab)', addChild));
    } else {
      tools.append(mk('Aa', 'Rótulo da seta', () => editEdgeLabel(item.id)));
      tools.append(mk('⇄', 'Seta nas duas pontas', () => { if (item.fromEnd === 'arrow') delete item.fromEnd; else item.fromEnd = 'arrow'; commit(); render(); }));
      tools.append(mk('⇆', 'Inverter sentido', () => { [item.fromNode, item.toNode] = [item.toNode, item.fromNode]; [item.fromSide, item.toSide] = [item.toSide, item.fromSide]; commit(); render(); }));
    }
    tools.append(mk('🗑', 'Apagar (Delete)', deleteSel, 'danger'));
    tools.hidden = false;
    const sx = r.left - hr.left + T.x + wx * T.z;
    const sy = r.top - hr.top + T.y + wy * T.z;
    tools.style.left = clamp(sx - tools.offsetWidth / 2, 4, hr.width - tools.offsetWidth - 4) + 'px';
    tools.style.top = Math.max(r.top - hr.top + 4, sy - tools.offsetHeight - 10) + 'px';
  }

  /* ── operações ── */
  function select(s) {
    if (sel && s && sel.kind === s.kind && sel.id === s.id) return;
    sel = s;
    for (const d of host.querySelectorAll('.cv-node.sel')) d.classList.remove('sel');
    if (sel && sel.kind === 'node') host.querySelector(`.cv-node[data-node="${sel.id}"]`)?.classList.add('sel');
    drawEdges();
    placeTools();
    renderOutline();
  }
  function startEdit(id) { editing = id; render(); }
  function editEdgeLabel(id) {
    const e = data.edges.find((x) => x.id === id); const g = e && edgeGeom(e);
    if (!g) return;
    const inp = el('input', 'cv-einput');
    inp.value = e.label || '';
    inp.style.left = g.mid.x + 'px'; inp.style.top = g.mid.y + 'px';
    layerL.append(inp);
    tools.hidden = true;
    inp.focus(); inp.select();
    let done = false;
    const fin = (save) => { if (done) return; done = true; if (save) { if (inp.value.trim()) e.label = inp.value.trim(); else delete e.label; commit(); } inp.remove(); render(); };
    inp.addEventListener('blur', () => fin(true));
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); fin(true); host.focus(); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fin(false); host.focus(); } ev.stopPropagation(); });
  }
  function deleteSel() {
    if (!sel) return;
    if (sel.kind === 'node') {
      data.nodes = data.nodes.filter((n) => n.id !== sel.id);
      data.edges = data.edges.filter((e) => e.fromNode !== sel.id && e.toNode !== sel.id);
    } else data.edges = data.edges.filter((e) => e.id !== sel.id);
    sel = null;
    commit(); render();
  }
  function freeSpot(w, h, near) { // acha um lugar livre perto do ponto (evita cartões empilhados)
    let x = near.x - w / 2; let y = near.y - h / 2;
    for (let i = 0; i < 40; i++) {
      const hit = data.nodes.some((n) => n.type !== 'group' && x < n.x + n.width && x + w > n.x && y < n.y + n.height && y + h > n.y);
      if (!hit) break;
      x += 28; y += 28;
    }
    return { x: Math.round(x), y: Math.round(y) };
  }
  function addNode(props, near) {
    const w = props.width || 260; const h = props.height || 120;
    const p = props.type === 'group' ? { x: Math.round((near || center()).x - w / 2), y: Math.round((near || center()).y - h / 2) } : freeSpot(w, h, near || center());
    const n = { id: uid(), type: 'text', ...props, x: p.x, y: p.y, width: w, height: h };
    data.nodes.push(n);
    return n;
  }
  function addText(near) { const n = addNode({ type: 'text', text: '' }, near); sel = { kind: 'node', id: n.id }; editing = n.id; commit(); render(); return n; }
  function addGroup() { const n = addNode({ type: 'group', label: 'Grupo', width: 420, height: 280 }); sel = { kind: 'node', id: n.id }; commit(); render(); startEdit(n.id); }
  async function addFile(abs, near) {
    const stored = env.toStored(abs);
    let w = 300; let h = 200;
    if (isImagePath(abs)) {
      const dim = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([4, 3]); im.src = env.fileUrl(abs); });
      const k = Math.min(1, 360 / Math.max(1, dim[0]));
      w = Math.max(120, Math.round(dim[0] * k)); h = Math.max(80, Math.round(dim[1] * k));
    }
    const n = addNode({ type: 'file', file: stored, width: w, height: h }, near);
    sel = { kind: 'node', id: n.id };
    commit(); render();
  }
  function connect(a, b, fromSide, toSide) {
    const [fs, ts] = bestSides(a, b);
    const e = { id: uid(), fromNode: a.id, fromSide: fromSide || fs, toNode: b.id, toSide: toSide || ts };
    data.edges.push(e);
    return e;
  }
  function addChild() { // Tab: novo cartão de texto à direita do selecionado, já ligado por uma seta
    if (!sel || sel.kind !== 'node') return;
    const p = nodeById(sel.id);
    if (!p || p.type === 'group') return;
    const kids = data.edges.filter((e) => e.fromNode === p.id).length;
    const n = addNode({ type: 'text', text: '', width: 220, height: 90 }, { x: p.x + p.width + 90 + 110, y: p.y + p.height / 2 + kids * 110 });
    connect(p, n, 'right', 'left');
    sel = { kind: 'node', id: n.id }; editing = n.id;
    commit(); render();
  }
  function duplicateSel() {
    if (!sel || sel.kind !== 'node') return;
    const o = nodeById(sel.id);
    if (!o) return;
    const c = { ...o, id: uid(), x: o.x + 30, y: o.y + 30 };
    data.nodes.push(c);
    sel = { kind: 'node', id: c.id };
    commit(); render();
  }
  function fit() {
    const r = stageRect();
    const ns = data.nodes;
    if (!ns.length) { T = { x: r.width / 2, y: r.height / 2, z: 1 }; applyT(); return; }
    const x1 = Math.min(...ns.map((n) => n.x)); const y1 = Math.min(...ns.map((n) => n.y));
    const x2 = Math.max(...ns.map((n) => n.x + n.width)); const y2 = Math.max(...ns.map((n) => n.y + n.height));
    const z = clamp(Math.min((r.width - 80) / (x2 - x1), (r.height - 80) / (y2 - y1)), 0.15, 1);
    T = { z, x: (r.width - (x2 - x1) * z) / 2 - x1 * z, y: (r.height - (y2 - y1) * z) / 2 - y1 * z };
    applyT();
  }

  /* ── mouse: arrastar fundo, cartões, redimensionar, ligar ── */
  let drag = null;
  stage.addEventListener('mousedown', (ev) => {
    if (ev.button === 2) return;
    const t = ev.target;
    if (t.closest('textarea, input')) return;
    host.focus({ preventScroll: true });
    if (oPrefs.open && !oPrefs.pinned && !t.closest('.cv-outline')) { oPrefs.open = false; saveO(); renderOutline(); }
    const hd = t.closest('.cv-h');
    const rz = t.closest('.cv-rz');
    const nd = t.closest('.cv-node');
    const eg = t.closest('.cv-edge, .cv-elabel');
    if (ev.button === 1) { ev.preventDefault(); drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: T.x, oy: T.y }; return; }
    if (RO()) { if (t.closest('a')) return; ev.preventDefault(); select(null); drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: T.x, oy: T.y }; stage.classList.add('panning'); return; }
    if (hd && nd) {
      ev.preventDefault();
      select({ kind: 'node', id: nd.dataset.node });
      drag = { kind: 'link', from: nodeById(nd.dataset.node), side: hd.dataset.side, line: sv('path', { class: 'cv-tmp' }) };
      svg.append(drag.line);
      return;
    }
    if (rz && nd) {
      ev.preventDefault();
      const n = nodeById(nd.dataset.node);
      select({ kind: 'node', id: n.id });
      drag = { kind: 'resize', n, sx: ev.clientX, sy: ev.clientY, w: n.width, h: n.height, div: nd, moved: false };
      return;
    }
    if (nd) {
      ev.preventDefault();
      const n = nodeById(nd.dataset.node);
      select({ kind: 'node', id: n.id });
      const kids = n.type === 'group' ? data.nodes.filter((o) => o !== n && o.x >= n.x && o.y >= n.y && o.x + o.width <= n.x + n.width && o.y + o.height <= n.y + n.height) : [];
      drag = { kind: 'move', items: [n, ...kids].map((o) => ({ o, x: o.x, y: o.y })), sx: ev.clientX, sy: ev.clientY, moved: false };
      return;
    }
    if (eg) { select({ kind: 'edge', id: (eg.dataset.edge || eg.closest('[data-edge]').dataset.edge) }); return; }
    ev.preventDefault(); // não deixa o arrastar selecionar o texto de aviso
    select(null);
    drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, ox: T.x, oy: T.y };
    stage.classList.add('panning');
  });

  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    if (drag.kind === 'pan') { T.x = drag.ox + ev.clientX - drag.sx; T.y = drag.oy + ev.clientY - drag.sy; applyT(); return; }
    if (drag.kind === 'move') {
      const dx = (ev.clientX - drag.sx) / T.z; const dy = (ev.clientY - drag.sy) / T.z;
      if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
      drag.moved = true;
      tools.hidden = true;
      for (const it of drag.items) {
        it.o.x = Math.round(it.x + dx); it.o.y = Math.round(it.y + dy);
        const d = host.querySelector(`.cv-node[data-node="${it.o.id}"]`);
        if (d) setBox(d, it.o);
      }
      drawEdges();
      return;
    }
    if (drag.kind === 'resize') {
      drag.moved = true;
      tools.hidden = true;
      drag.n.width = Math.max(90, Math.round(drag.w + (ev.clientX - drag.sx) / T.z));
      drag.n.height = Math.max(50, Math.round(drag.h + (ev.clientY - drag.sy) / T.z));
      setBox(drag.div, drag.n);
      drawEdges();
      return;
    }
    if (drag.kind === 'link') {
      const p1 = anchor(drag.from, drag.side); const p2 = toWorld(ev.clientX, ev.clientY);
      const n1 = NORMAL[drag.side];
      const off = Math.max(40, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.3);
      drag.line.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x + n1[0] * off} ${p1.y + n1[1] * off}, ${p2.x} ${p2.y}, ${p2.x} ${p2.y}`);
    }
  });
  window.addEventListener('mouseup', (ev) => {
    if (!drag) return;
    const d = drag; drag = null;
    stage.classList.remove('panning');
    if (d.kind === 'move' || d.kind === 'resize') { if (d.moved) commit(); placeTools(); return; }
    if (d.kind === 'pan') { placeTools(); return; }
    if (d.kind === 'link') {
      d.line.remove();
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const nd = under && under.closest && under.closest('.cv-node');
      const wp = toWorld(ev.clientX, ev.clientY);
      if (nd && nd.dataset.node !== d.from.id) {
        const to = nodeById(nd.dataset.node);
        if (to && to.type !== 'group') {
          const e = connect(d.from, to, d.side, nearestSide(to, wp));
          sel = { kind: 'edge', id: e.id };
          commit(); render();
        }
      } else if (!nd && stage.contains(under)) { // soltou no vazio: cria o cartão ali, já ligado (mapa mental)
        const w = 220; const h = 90;
        const opp = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[d.side];
        const dir = NORMAL[d.side];
        const n = addNode({ type: 'text', text: '', width: w, height: h }, { x: wp.x + dir[0] * w / 2, y: wp.y + dir[1] * h / 2 });
        connect(d.from, n, d.side, opp);
        sel = { kind: 'node', id: n.id }; editing = n.id;
        commit(); render();
      }
    }
  });

  stage.addEventListener('dblclick', (ev) => {
    if (RO()) return;
    const t = ev.target;
    if (t.closest('textarea, input, a')) return;
    const nd = t.closest('.cv-node');
    const lb = t.closest('.cv-elabel, .cv-edge');
    if (lb) { const id = lb.dataset.edge || lb.closest('[data-edge]').dataset.edge; select({ kind: 'edge', id }); editEdgeLabel(id); return; }
    if (nd) {
      const n = nodeById(nd.dataset.node);
      if (!n) return;
      if (n.type === 'text' || n.type === 'group') startEdit(n.id);
      else if (n.type === 'file' && !isImagePath(n.file)) startEdit(n.id);
      else if (n.type === 'file') env.openNote(env.toAbs(n.file));
      return;
    }
    addText(toWorld(ev.clientX, ev.clientY));
  });

  let lastWheel = 0;
  stage.addEventListener('wheel', (ev) => {
    if (ev.target.closest('textarea, .cv-flist')) return;
    ev.preventDefault();
    if (ev.ctrlKey) { // Ctrl + roda: tamanho do texto (a roda sozinha dá zoom no quadro)
      const now = Date.now();
      if (now - lastWheel > 70) { lastWheel = now; env.setStyle({ size: clamp(env.getStyle().size + (ev.deltaY < 0 ? 1 : -1), 9, 40) }); }
      return;
    }
    const r = stageRect();
    const mx = ev.clientX - r.left; const my = ev.clientY - r.top;
    const z = clamp(T.z * Math.exp(-ev.deltaY * 0.0015), 0.12, 3);
    T.x = mx - (mx - T.x) * z / T.z; T.y = my - (my - T.y) * z / T.z; T.z = z;
    applyT();
  }, { passive: false });

  stage.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.cv-link');
    if (a) { ev.preventDefault(); env.openUrl?.(a.href); }
  });

  /* ── arrastar notas e imagens (da lateral ou do Explorer) para o quadro ── */
  stage.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
  stage.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation(); // não deixa o app abrir o arquivo como aba
    if (RO()) { env.toast('Clique em Editar para mexer neste canvas'); return false; }
    const paths = [];
    const a = ev.dataTransfer.getData('text/tt-file'); if (a) paths.push(a);
    const b = ev.dataTransfer.getData('text/tt-tab'); if (b && /^([a-z]:[\\/]|\/)/i.test(b)) paths.push(b);
    for (const f of ev.dataTransfer.files) {
      const p = env.pathOf(f);
      if (p) paths.push(p);
      else if (/^image\//.test(f.type)) { const abs = await env.saveImage(f); if (abs) paths.push(abs); } // canvas compartilhado: a imagem sobe para o servidor
    }
    let at = toWorld(ev.clientX, ev.clientY);
    let any = false;
    for (const p of paths) {
      if (!isImagePath(p) && !/\.(md|markdown|txt)$/i.test(p)) { env.toast('No canvas só entram notas (.md, .txt) e imagens'); continue; }
      await addFile(p, at);
      at = { x: at.x + 30, y: at.y + 30 };
      any = true;
    }
    return any;
  });

  /* ── teclado ── */
  host.addEventListener('keydown', (ev) => {
    if (ev.target.closest('textarea, input')) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (RO()) { if (mod && k === 'f') { ev.preventDefault(); ev.stopPropagation(); openFind(); } else if (mod && k === '0') { ev.preventDefault(); fit(); } else if (k === 'escape') select(null); return; }
    if (mod && k === 'z' && !ev.shiftKey) { ev.preventDefault(); env.undo(); return; }
    if (mod && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); env.redo(); return; }
    if (mod && k === 'd') { ev.preventDefault(); duplicateSel(); return; }
    if (mod && k === '0') { ev.preventDefault(); fit(); return; }
    if (mod && k === 'f') { ev.preventDefault(); ev.stopPropagation(); openFind(); return; }
    if (mod || ev.altKey) return;
    if (k === 'delete' || k === 'backspace') { ev.preventDefault(); deleteSel(); }
    else if (k === 'tab') { ev.preventDefault(); addChild(); }
    else if (k === 'enter' && sel && sel.kind === 'node') { ev.preventDefault(); const n = nodeById(sel.id); if (n && (n.type !== 'file' || !isImagePath(n.file))) startEdit(n.id); }
    else if (k === 'enter' && sel && sel.kind === 'edge') { ev.preventDefault(); editEdgeLabel(sel.id); }
    else if (k === 'escape') { select(null); }
  });

  /* ── barra de cima ── */
  const btn = (txt, title, fn) => { const b = el('button', 'cv-btn', txt); b.title = title; b.onmousedown = (e) => e.preventDefault(); b.onclick = fn; bar.append(b); return b; };
  const title = el('span', 'cv-name');
  title.title = 'Clique para renomear o canvas';
  title.onclick = () => env.rename && env.rename();
  bar.append(title);
  function syncTitle() { title.textContent = (env.getName ? env.getName() : 'Canvas') + ' ✎'; }
  const slot = el('span', 'cv-slot'); // faixa de estado do canvas compartilhado (quem edita, botão Editar…)
  bar.append(slot);
  const editBtns = [
    btn('+ Texto', 'Novo cartão de texto (ou dois cliques no fundo)', () => addText()),
    btn('+ Nota', 'Colocar uma nota do projeto no quadro', () => env.pickNote((abs) => addFile(abs))),
    btn('+ Imagem', 'Colocar uma imagem no quadro', () => env.pickImage((abs) => addFile(abs))),
    btn('+ Grupo', 'Área para agrupar cartões', addGroup),
  ];
  const noteBtn = editBtns[1];
  bar.append(el('span', 'cv-sp'));
  btn('Enquadrar', 'Mostrar tudo (Ctrl+0)', fit);
  btn('−', 'Menos zoom', () => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.25); });
  btn('+', 'Mais zoom', () => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, 1.25); });
  const fontSel = el('select', 'cv-sel');
  fontSel.title = 'Fonte do texto do quadro';
  for (const [label, val] of env.fonts) { const o = el('option', null, label); o.value = val; fontSel.append(o); }
  fontSel.onchange = () => { env.setStyle({ font: fontSel.value }); host.focus(); };
  bar.append(fontSel);
  btn('A−', 'Diminuir o texto', () => env.setStyle({ size: Math.max(9, env.getStyle().size - 1) }));
  const sizeLab = el('span', 'cv-size');
  bar.append(sizeLab);
  btn('A+', 'Aumentar o texto', () => env.setStyle({ size: Math.min(40, env.getStyle().size + 1) }));
  const PM = { auto: ['Auto', 'Ao colar texto: detecta sozinho quando precisa preservar espaços (calendário, código, tabela)'], always: ['Sempre', 'Ao colar texto: sempre preserva espaços e quebras exatamente (⌗ ligado por padrão)'], never: ['Nunca', 'Ao colar texto: Markdown normal, sem bloco de código automático (⌗ desligado por padrão)'] };
  const pmBtn = btn('⌗ Auto', 'Como colar texto', () => { const k = Object.keys(PM); const cur = env.getPasteMode ? env.getPasteMode() : 'auto'; env.setPasteMode && env.setPasteMode(k[(k.indexOf(cur) + 1) % k.length]); });
  function syncPaste() { const m = PM[env.getPasteMode ? env.getPasteMode() : 'auto'] || PM.auto; pmBtn.textContent = '⌗ ' + m[0]; pmBtn.title = m[1] + '. Clique para alternar: Auto → Sempre → Nunca.'; }
  function syncStyle() { syncPaste(); const st = env.getStyle(); sizeLab.textContent = st.size; if ([...fontSel.options].some((o) => o.value === st.font)) fontSel.value = st.font; }
  syncStyle();
  btn('🔍', 'Buscar no canvas (Ctrl+F)', openFind);
  btn('☰ Estrutura', 'Árvore com tudo o que tem no quadro (lado direito, dá para fixar)', () => { oPrefs.open = !oPrefs.open; saveO(); renderOutline(); });
  const jsonBtn = btn('Ver JSON', 'Mostrar o texto do arquivo .canvas', () => env.toggleJson());
  function syncRO() { const ro = RO(); for (const b of editBtns) b.hidden = ro; noteBtn.hidden = ro || !!(env.noNotes && env.noNotes()); jsonBtn.hidden = !!(env.noJson && env.noJson()); host.classList.toggle('cv-ro', ro); placeTools(); }
  function zoomAt(mx, my, f) { const z = clamp(T.z * f, 0.12, 3); T.x = mx - (mx - T.x) * z / T.z; T.y = my - (my - T.y) * z / T.z; T.z = z; applyT(); }

  return {
    // abre (ou volta a mostrar) o quadro de uma aba
    open(key, text) {
      tabKey = key;
      sel = null; editing = null; drag = null;
      find.hidden = true; foundIds.clear();
      load(text);
      render();
      syncTitle();
      syncRO();
      const saved = transforms.get(key);
      requestAnimationFrame(() => { if (saved) { T = { ...saved }; applyT(); } else fit(); });
    },
    // o texto do documento mudou por fora (desfazer, refazer, edição no modo JSON…)
    externalChange(text) {
      if (text === lastText) return;
      const keep = sel;
      load(text);
      if (keep && ((keep.kind === 'node' && nodeById(keep.id)) || (keep.kind === 'edge' && data.edges.some((e) => e.id === keep.id)))) sel = keep; else sel = null;
      editing = null;
      render();
    },
    // Ctrl+V: imagem da área de transferência vira cartão; texto vira cartão de texto
    async paste(ev) {
      if (!valid || RO()) return false;
      // Excel/Word copiam texto (várias linhas/tabulação/tabela) e imagem juntos: o texto vale. Uma linha solta junto de uma imagem não impede colar a imagem.
      const cdp = ev.clipboardData;
      const tp = ((cdp && cdp.getData('text/plain')) || '').trim();
      const hasImg = !!cdp && [...(cdp.files || [])].some((f) => /^image\//.test(f.type));
      const hasText = !!tp && (!hasImg || /[\t\r\n]/.test(tp) || /<table/i.test(cdp.getData('text/html') || ''));
      const files = hasText ? [] : [...(ev.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
      if (files.length) {
        ev.preventDefault();
        let at = center();
        for (const f of files) {
          const abs = await env.saveImage(f);
          if (abs) { await addFile(abs, at); at = { x: at.x + 30, y: at.y + 30 }; }
        }
        return true;
      }
      const cd = ev.clipboardData;
      let html = cd ? cd.getData('text/html') : '';
      if (/<table/i.test(html) && /(urn:schemas-microsoft-com:office:excel|ProgId[^>]*Excel|Microsoft Excel)/i.test(html)) html = ''; // células do Excel: usa o texto exatamente como veio (colunas por tabulação), sem converter em tabela
      const plain = ((cd && cd.getData('text/plain')) || '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '');
      if (!plain.trim() && !html.trim()) return false;
      ev.preventDefault();
      // cola "como foi copiado": com formatação (HTML → Markdown) quando houver; senão o texto exato, e código fica em bloco
      const mode = env.getPasteMode ? env.getPasteMode() : 'auto'; // auto = detecta · always = espaços exatos (⌗ ligado) · never = Markdown normal
      let text = '';
      if (mode === 'always' && plain.trim()) text = '```\n' + plain + '\n```';
      else {
        if (html.trim()) { try { text = htmlToMd(html); } catch { text = ''; } }
        if (!text.trim()) text = (mode !== 'never' && looksLikeCode(plain)) ? '```\n' + plain + '\n```' : plain;
      }
      const ls = text.split('\n');
      const code = /^```/.test(text);
      const widest = Math.max(...ls.map((l) => l.length));
      const w = code ? clamp(Math.round(widest * 8.2 + 40), 320, 760) : clamp(Math.round(widest * 7.5 + 40), 280, 520);
      const h = clamp(Math.round(ls.length * (code ? 20 : 24) + 40), 90, 520);
      const n = addNode({ type: 'text', text, width: w, height: h });
      sel = { kind: 'node', id: n.id };
      commit(); render();
      return true;
    },
    refresh() { render(); },
    syncStyle, syncTitle, syncRO,
    setBanner(node) { slot.textContent = ''; if (node) slot.append(node); },
    isEditing() { return !!editing || !!host.querySelector('textarea, .cv-einput, .cv-ginput'); },
    focus() { host.focus({ preventScroll: true }); },
  };
}
