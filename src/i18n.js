// Idiomas do aplicativo: português (Brasil, o original), inglês, espanhol e português de Portugal.
// Os textos do código estão em português do Brasil; este módulo traduz o que aparece na tela:
//  - t("texto em português", ...args): para textos montados no JavaScript;
//  - um tradutor automático de DOM (textos, title, placeholder, aria-label, alt) que troca os textos conhecidos
//    pela tradução e volta ao original ao mudar de idioma (o que o usuário escreve nas notas nunca é traduzido).
// Os dicionários (src/lang/*.json) são gerados por tools/i18n-build.js.
import en from './lang/en.json';
import es from './lang/es.json';
import ptPT from './lang/pt-PT.json';

const flag = (inner) => `<svg class="flag" viewBox="0 0 24 16" width="24" height="16" aria-hidden="true"><clipPath id="fc"><rect width="24" height="16" rx="2"/></clipPath><g clip-path="url(#fc)">${inner}</g><rect width="24" height="16" rx="2" fill="none" stroke="rgba(0,0,0,.25)"/></svg>`;
const usStripes = Array.from({ length: 7 }, (_, i) => `<rect y="${(i * 2 * 16) / 13}" width="24" height="${16 / 13}" fill="#b22234"/>`).join('');
const usStars = Array.from({ length: 9 }, (_, i) => `<circle cx="${1.9 + (i % 3) * 2.6}" cy="${1.8 + Math.floor(i / 3) * 1.9}" r=".55" fill="#fff"/>`).join('');
const FLAGS = {
  'pt-BR': flag('<rect width="24" height="16" fill="#009c3b"/><polygon points="12,1.8 22.2,8 12,14.2 1.8,8" fill="#ffdf00"/><circle cx="12" cy="8" r="3.7" fill="#002776"/><path d="M8.5 7.3q3.6-1.3 7.2 1" stroke="#fff" stroke-width=".75" fill="none"/>'),
  en: flag(`<rect width="24" height="16" fill="#fff"/>${usStripes}<rect width="10.2" height="8.6" fill="#3c3b6e"/>${usStars}`),
  es: flag('<rect width="24" height="16" fill="#c60b1e"/><rect y="4" width="24" height="8" fill="#ffc400"/><rect x="5.6" y="6.2" width="2.6" height="3.6" rx=".7" fill="#ad1519" stroke="#8a6d00" stroke-width=".35"/>'),
  'pt-PT': flag('<rect width="24" height="16" fill="#ff0000"/><rect width="9.6" height="16" fill="#006600"/><circle cx="9.6" cy="8" r="3.2" fill="#ffd400"/><rect x="8.2" y="6.3" width="2.8" height="3.3" rx=".7" fill="#fff" stroke="#c00" stroke-width=".5"/><rect x="9" y="7.2" width="1.2" height="1.3" fill="#003399"/>'),
};
export const LANGS = [
  { id: 'pt-BR', name: 'Português (Brasil)', locale: 'pt-BR' },
  { id: 'en', name: 'English', locale: 'en-US' },
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'pt-PT', name: 'Português (Portugal)', locale: 'pt-PT' },
];
export const flagHtml = (id) => FLAGS[id] || FLAGS['pt-BR'];

const RAW = { en, es, 'pt-PT': ptPT };
let cur = 'pt-BR';
let dict = null; // texto pt-BR -> tradução
let patterns = []; // textos com {0}, {1}… (regex), prefixos e sufixos
const listeners = new Set();

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(d) {
  const pats = [];
  for (const [k, v] of Object.entries(d)) {
    if (/\{\d+\}/.test(k)) {
      const order = []; let re = '';
      for (const part of k.split(/(\{\d+\})/)) { const m = /^\{(\d+)\}$/.exec(part); if (m) { order.push(+m[1]); re += '(.*?)'; } else re += esc(part); }
      pats.push({ kind: 'tpl', re: new RegExp('^' + re + '$', 's'), order, out: v, w: k.length });
    } else if (k.length >= 5 && k.length <= 90) {
      if (/[:(]$/.test(k) && !/[.?!…]$/.test(k)) pats.push({ kind: 'pre', key: k, out: v, w: k.length });
      else if (/^[)—·,.]/.test(k)) pats.push({ kind: 'suf', key: k, out: v, w: k.length });
    }
  }
  pats.sort((a, b) => (a.kind === 'tpl' ? 0 : 1) - (b.kind === 'tpl' ? 0 : 1) || b.w - a.w);
  return pats;
}

export function detectLang() {
  const l = String((navigator.languages && navigator.languages[0]) || navigator.language || 'pt-BR').toLowerCase();
  if (l.startsWith('pt-pt')) return 'pt-PT';
  if (l.startsWith('pt')) return 'pt-BR';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('en')) return 'en';
  return 'pt-BR';
}
export const getLang = () => cur;
export const locale = () => (LANGS.find((l) => l.id === cur) || LANGS[0]).locale;

function tx(key) {
  const r = tx1(key);
  if (r != null) return r;
  // símbolo na frente (✓ marcado no menu, ● ▸ …): traduz o resto e mantém o símbolo
  const m = /^([^\p{L}\p{N}"“(\[{]+)(.+)$/su.exec(key);
  if (m && m[1].trim()) { const r2 = tx1(m[2]); if (r2 != null) return m[1] + r2; }
  return null;
}
function tx1(key) {
  if (!dict) return null;
  const hit = dict[key];
  if (hit != null) return hit;
  for (const p of patterns) {
    if (p.kind === 'tpl') {
      const m = p.re.exec(key);
      if (m) { const a = {}; p.order.forEach((n, i) => { a[n] = m[i + 1]; }); return p.out.replace(/\{(\d+)\}/g, (_, n) => (a[n] != null ? a[n] : '')); }
    } else if (p.kind === 'pre') {
      if (key.length > p.key.length && key.startsWith(p.key)) return p.out + key.slice(p.key.length);
    } else if (key.length > p.key.length && key.endsWith(p.key)) return key.slice(0, key.length - p.key.length) + p.out;
  }
  return null;
}

// t("Texto em português {0}", valor): traduz e preenche {0}, {1}…
export function t(s, ...args) {
  let out = s;
  if (dict) { const k = norm(String(s)); const r = tx(k); if (r != null) out = r; }
  return args.length ? out.replace(/\{(\d+)\}/g, (m, n) => (args[+n] != null ? args[+n] : m)) : out;
}

/* ───────────── tradutor automático do DOM ───────────── */
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
let SKIP = '.cm-editor, #preview, #tree .row, #openFiles .row, #tabs, .sh-md, .sh-name, .sh-uname, .sh-title, .sh-poll-q, .sh-poll-text, .sh-quote, .sh-lc, .sh-seg, .sh-pinrow-t, .sh-mention, .sh-att-cap, textarea, input, pre, code, script, style, [data-notr]';
let SKIP_ATTR = '.cm-editor, #preview, #tree .row, #openFiles .row, #tabs, .sh-md, .sh-name, .sh-uname, .sh-title, .sh-poll-q, .sh-poll-text, .sh-quote, .sh-lc, .sh-seg, .sh-pinrow-t, .sh-mention, .sh-att-cap, pre, code, script, style, [data-notr]'; // nos atributos (placeholder…) só se pulam as áreas de conteúdo do usuário
let observer = null;
export const addSkip = (sel) => { SKIP += ', ' + sel; SKIP_ATTR += ', ' + sel; };
const skipEl = (e) => !e || !!(e.closest && e.closest(SKIP));
const skipAttr = (e) => !e || !!(e.closest && e.closest(SKIP_ATTR));

function doText(n) {
  const e = n.parentElement;
  if (skipEl(e)) return;
  const st = n.__i18n;
  const v = n.nodeValue;
  if (st && v === st.out) { if (st.lang === cur) return; } // já é nosso: só retraduz se o idioma mudou
  const src = st && v === st.out ? st.src : v; // texto original em português
  if (!/[A-Za-zÀ-ÿ]{2}/.test(src)) return;
  const key = norm(src);
  const r = cur === 'pt-BR' ? null : tx(key);
  const lead = /^\s*/.exec(src)[0]; const trail = /\s*$/.exec(src)[0];
  const out = r != null ? lead + r + trail : src;
  n.__i18n = { src, out, lang: cur };
  if (out !== v) n.nodeValue = out;
}
function doAttrs(e) {
  if (skipAttr(e)) return;
  const st = e.__i18na || (e.__i18na = {});
  for (const a of ATTRS) {
    const v = e.getAttribute && e.getAttribute(a);
    if (v == null) { delete st[a]; continue; }
    const s = st[a];
    if (s && v === s.out && s.lang === cur) continue;
    const src = s && v === s.out ? s.src : v;
    if (!/[A-Za-zÀ-ÿ]{2}/.test(src)) continue;
    const r = cur === 'pt-BR' ? null : tx(norm(src));
    const out = r != null ? r : src;
    st[a] = { src, out, lang: cur };
    if (out !== v) e.setAttribute(a, out);
  }
}
function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doAttrs(root);
  if (skipEl(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && skipAttr(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
}

function startObserver() {
  if (observer || !document.body) return;
  observer = new MutationObserver((recs) => {
    if (cur === 'pt-BR' && !hasOriginals) return;
    for (const r of recs) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
      else for (const n of r.addedNodes) walk(n);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
let hasOriginals = false; // depois de traduzir uma vez, voltar ao português precisa restaurar os originais

export function setLang(id, { notify = true } = {}) {
  if (!LANGS.some((l) => l.id === id)) id = 'pt-BR';
  cur = id;
  dict = id === 'pt-BR' ? null : RAW[id];
  patterns = dict ? compile(dict) : [];
  if (id === 'pt-PT') { // o que não tem ajuste próprio em pt-PT continua igual ao do Brasil
    patterns = compile(dict);
  }
  try { document.documentElement.lang = id; localStorage.setItem('tt.lang', id); } catch { /* sem gravar */ }
  if (id !== 'pt-BR') hasOriginals = true;
  if (document.body) { startObserver(); walk(document.body); }
  if (notify) for (const f of listeners) { try { f(id); } catch { /* ouvinte com erro não derruba */ } }
}
if (typeof window !== 'undefined') window.__i18n = { t, getLang: () => cur, tx: (k) => tx(norm(k)) }; // depuração
export const onLang = (f) => { listeners.add(f); return () => listeners.delete(f); };

export function initLang(saved) {
  let id = saved;
  try { if (!id) id = localStorage.getItem('tt.lang'); } catch { /* sem leitura */ }
  if (!id) id = detectLang();
  const go = () => setLang(id);
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true });
  // outras janelas (ex.: nota flutuante) acompanham a mudança
  window.addEventListener('storage', (e) => { if (e.key === 'tt.lang' && e.newValue && e.newValue !== cur) setLang(e.newValue); });
}

/* ───────────── seletor de idioma (menu com bandeiras) ───────────── */
export function openLangPicker(anchor, onPick) {
  document.getElementById('langPop')?.remove();
  const pop = document.createElement('div');
  pop.id = 'langPop'; pop.setAttribute('data-notr', '');
  const head = document.createElement('div'); head.className = 'lp-head'; head.textContent = t('Idioma do aplicativo');
  head.removeAttribute('data-notr');
  pop.append(head);
  for (const l of LANGS) {
    const b = document.createElement('div'); b.className = 'lp-item' + (l.id === cur ? ' on' : '');
    b.innerHTML = flagHtml(l.id) + '<span class="lp-name"></span><span class="lp-ck">' + (l.id === cur ? '✓' : '') + '</span>';
    b.querySelector('.lp-name').textContent = l.name;
    b.onclick = () => { pop.remove(); onPick(l.id); };
    pop.append(b);
  }
  document.body.append(pop);
  const r = anchor ? anchor.getBoundingClientRect() : { right: window.innerWidth - 8, bottom: 28 };
  pop.style.top = Math.round(r.bottom + 2) + 'px';
  pop.style.left = Math.max(6, Math.min(window.innerWidth - pop.offsetWidth - 6, Math.round(r.right - pop.offsetWidth))) + 'px';
  const off = (e) => { if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) { pop.remove(); document.removeEventListener('mousedown', off, true); window.removeEventListener('keydown', esc2, true); } };
  const esc2 = (e) => { if (e.key === 'Escape') { pop.remove(); document.removeEventListener('mousedown', off, true); window.removeEventListener('keydown', esc2, true); } };
  setTimeout(() => { document.addEventListener('mousedown', off, true); window.addEventListener('keydown', esc2, true); }, 0);
}
