// Corretor ortográfico do editor: sublinha as palavras erradas e dá as sugestões (menu do botão direito).
import { ViewPlugin, Decoration } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { language, syntaxTree } from '@codemirror/language';
import { Hunspell, Spell } from './spell-engine.js';

const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;
const cache = new Map(); // palavra -> true (certa) | false (errada)
let api = null; let getUser = () => []; let boot = null; let call = null;

// Worker (ou, se o navegador não deixar, o próprio editor) com os dicionários de português e inglês
function engine() {
  if (boot) return boot;
  boot = (async () => {
    const d = await api.spellDict();
    const dicts = [d.pt, d.en];
    try {
      const w = new Worker('dist/spell-worker.js');
      const own = dicts.map((x) => (x.dic.byteOffset === 0 && x.dic.buffer.byteLength === x.dic.byteLength ? x.dic : x.dic.slice())); // buffer próprio, para passar ao worker sem copiar
      for (let i = 0; i < dicts.length; i++) dicts[i] = { aff: dicts[i].aff, dic: own[i] };
      let seq = 0; const pend = new Map();
      await new Promise((res, rej) => {
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready') res();
          else if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
        };
        w.onerror = (e) => rej(e);
        w.postMessage({ type: 'init', dicts, user: getUser() }, dicts.map((x) => x.dic.buffer)); // transfere (não duplica) os bytes do dicionário
      });
      call = (msg) => new Promise((r) => { const id = ++seq; pend.set(id, r); w.postMessage({ ...msg, id }); });
      call.add = (word) => w.postMessage({ type: 'add', word });
    } catch {
      const sp = new Spell(); for (const x of dicts) sp.add(new Hunspell(x.aff, x.dic)); for (const u of getUser()) sp.addWord(u);
      call = async (msg) => (msg.type === 'check' ? { bad: msg.words.filter((x) => !sp.check(x)) } : { list: sp.suggest(msg.word) });
      call.add = (word) => sp.addWord(word);
    }
    return true;
  })();
  return boot;
}

let hooks = { showMenu: null, addWord: null, enabled: () => true };
export function spellInit(a, userWords, h) { api = a; getUser = userWords || (() => []); if (h) hooks = { ...hooks, ...h }; }
const plugins = new Set();
export async function spellAddWord(word) { await engine(); call.add(word); cache.set(word, true); cache.set(word.toLowerCase(), true); for (const p of plugins) p.build(); }
export async function spellSuggest(word) { await engine(); return (await call({ type: 'suggest', word })).list; }
export async function spellIsBad(word) {
  if (cache.has(word)) return !cache.get(word);
  await engine(); const r = await call({ type: 'check', words: [word] }); cache.set(word, !r.bad.length); return !!r.bad.length;
}

// Palavra sob a posição (ou null)
export function spellWordAt(view, pos) {
  const line = view.state.doc.lineAt(pos); const off = pos - line.from;
  for (const m of line.text.matchAll(WORD)) if (off >= m.index && off <= m.index + m[0].length) return { from: line.from + m.index, to: line.from + m.index + m[0].length, text: m[0] };
  return null;
}

const refresh = StateEffect.define();
const CODE_NODE = /Code|URL|HTMLTag|Wiki/;
const TEXT_NODE = /comment|string|text|content/i;

function candidates(view) { // palavras do trecho visível que vale a pena conferir
  const { state } = view; const out = [];
  const lang = state.facet(language);
  const prose = !lang || /markdown/i.test(lang.name || '');
  const tree = syntaxTree(state);
  // sobe pela árvore do Markdown (sem entrar na linguagem do bloco): se algum ancestral é código/URL/tag, não confere
  const inCodeNode = (pos) => { for (let n = tree.resolve(pos, 1); n; n = n.parent) if (CODE_NODE.test(n.name)) return true; return false; };
  for (const r of view.visibleRanges) {
    const text = state.sliceDoc(r.from, r.to);
    for (const m of text.matchAll(WORD)) {
      const w = m[0]; const a = m.index; const b = a + w.length;
      if (w.length < 3 || w === w.toUpperCase() || /[a-zà-ú][A-ZÀ-Ú]/.test(w)) continue; // siglas, camelCase
      const prev = text[a - 1] || ''; const next = text[b] || '';
      if (/[/@\\:#$_%]/.test(prev) || /[/@_\\]/.test(next) || (next === ':' && text.slice(b, b + 3) === '://')) continue; // URLs, e-mails, caminhos
      if ((prev === '.' && /[\p{L}\p{N}]/u.test(text[a - 2] || '')) || (next === '.' && /\p{L}/u.test(text[b + 1] || ''))) continue; // arquivo.ext, dominio.com
      const from = r.from + a;
      if (prose) { if (inCodeNode(from)) continue; } // em Markdown: nada dentro de código (inline ou bloco cercado, de qualquer linguagem), links, tags e wikilinks
      else if (!TEXT_NODE.test(tree.resolveInner(from, 1).name || '')) continue; // em código só comentários e textos
      out.push({ from, to: r.from + b, text: w });
    }
  }
  return out;
}

export const spellPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; this.decos = Decoration.none; this.timer = null; this.dead = false; plugins.add(this); this.build(); }
  update(u) {
    if (u.docChanged) this.decos = this.decos.map(u.changes);
    // também reconfere quando a linguagem/árvore sintática muda (o Markdown carrega depois de abrir o arquivo: sem isso, as marcas da 1ª checagem ficavam, inclusive em blocos de código)
    const lang = u.startState.facet(language) !== u.state.facet(language) || syntaxTree(u.startState) !== syntaxTree(u.state);
    if (lang) { this.decos = Decoration.none; }
    if (u.docChanged || u.viewportChanged || lang) { clearTimeout(this.timer); this.timer = setTimeout(() => this.build(), 350); }
  }
  destroy() { this.dead = true; plugins.delete(this); clearTimeout(this.timer); }
  async build() {
    const view = this.view; const doc = view.state.doc; const words = candidates(view);
    const unknown = [...new Set(words.map((w) => w.text).filter((w) => !cache.has(w)))];
    if (unknown.length) {
      await engine();
      for (let i = 0; i < unknown.length; i += 400) {
        const part = unknown.slice(i, i + 400); const r = await call({ type: 'check', words: part });
        for (const w of part) cache.set(w, !r.bad.includes(w));
      }
    }
    if (this.dead || view.state.doc !== doc) return; // o texto mudou no meio: a próxima checagem já está agendada
    const marks = words.filter((w) => cache.get(w.text) === false).map((w) => Decoration.mark({ class: 'cm-misspell' }).range(w.from, w.to));
    this.decos = Decoration.set(marks, true);
    try { view.dispatch({ effects: refresh.of(null) }); } catch { /* o editor foi fechado */ }
  }
}, { decorations: (v) => v.decos });

/* ───────────── corretor nas caixas de texto (chat compartilhado) ─────────────
   Um espelho do texto fica atrás da caixa e sublinha as palavras erradas; o botão direito numa palavra errada mostra as
   sugestões e "Adicionar ao dicionário". Só confere prosa: código (`..`, ```..```), links, e-mails, @menções e :emoji: ficam de fora. */
const SKIP_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`|https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|@[\p{L}\p{N}_.-]+|:[\w+-]+:/gu;
function proseWords(text) {
  const skip = []; for (const m of text.matchAll(SKIP_RE)) skip.push([m.index, m.index + m[0].length]);
  const out = [];
  for (const m of text.matchAll(WORD)) {
    const w = m[0]; const a = m.index; const b = a + w.length;
    if (w.length < 3 || w === w.toUpperCase() || /[a-zà-ú][A-ZÀ-Ú]/.test(w) || /\d/.test(w)) continue;
    if (skip.some(([x, y]) => a >= x && a < y)) continue;
    const prev = text[a - 1] || ''; const next = text[b] || '';
    if (/[/@\\:#$_%]/.test(prev) || /[/@_\\]/.test(next)) continue;
    if ((prev === '.' && /[\p{L}\p{N}]/u.test(text[a - 2] || '')) || (next === '.' && /\p{L}/u.test(text[b + 1] || ''))) continue;
    out.push({ from: a, to: b, text: w });
  }
  return out;
}
export function spellRefreshAll() { for (const p of plugins) p.build(); }

export function spellBox(ta) {
  const wrap = document.createElement('div'); wrap.className = 'sp-wrap';
  const mirror = document.createElement('div'); mirror.className = 'sp-mirror'; mirror.setAttribute('aria-hidden', 'true'); mirror.setAttribute('data-notr', '');
  wrap.append(mirror, ta);
  ta.spellcheck = false; // o corretor nativo do Chromium não tem os dicionários offline; este é o do app
  let bad = []; let timer = null; let ver = 0; let dead = false;
  const STYLE = ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'textAlign'];
  const syncStyle = () => { const cs = getComputedStyle(ta); for (const p of STYLE) mirror.style[p] = cs[p]; mirror.style.borderStyle = 'solid'; mirror.style.borderColor = 'transparent'; wrap.style.borderRadius = cs.borderRadius; };
  const paint = () => {
    const text = ta.value; mirror.textContent = '';
    let at = 0;
    for (const w of bad) {
      if (w.from < at || w.to > text.length) continue;
      if (w.from > at) mirror.append(text.slice(at, w.from));
      const s = document.createElement('span'); s.className = 'sp-bad'; s.textContent = text.slice(w.from, w.to); mirror.append(s); at = w.to;
    }
    mirror.append(text.slice(at) + (text.endsWith('\n') ? '\u200b' : ''));
    mirror.scrollTop = ta.scrollTop;
  };
  const build = async () => {
    if (dead) return;
    const my = ++ver; const text = ta.value;
    if (!hooks.enabled() || !text.trim()) { bad = []; paint(); return; }
    const words = proseWords(text);
    const unknown = [...new Set(words.map((w) => w.text).filter((w) => !cache.has(w)))];
    if (unknown.length) {
      await engine();
      for (let i = 0; i < unknown.length; i += 400) { const part = unknown.slice(i, i + 400); const r = await call({ type: 'check', words: part }); for (const w of part) cache.set(w, !r.bad.includes(w)); }
    }
    if (dead || my !== ver || ta.value !== text) return; // o texto mudou no meio: já há outra checagem agendada
    bad = words.filter((w) => cache.get(w.text) === false);
    syncStyle(); paint();
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(build, 250); paint(); };
  // o app também troca o texto por código (limpar depois de enviar, restaurar rascunho): captura essas trocas
  const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(ta, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); bad = []; soon(); } });
  ta.addEventListener('input', () => { bad = bad.filter(() => false); soon(); });
  ta.addEventListener('scroll', () => { mirror.scrollTop = ta.scrollTop; });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { syncStyle(); mirror.scrollTop = ta.scrollTop; }).observe(ta);
  const self = { build: () => { if (!wrap.isConnected) { dead = true; plugins.delete(self); return; } build(); } };
  plugins.add(self);
  ta.addEventListener('contextmenu', async (e) => {
    if (!hooks.enabled() || !hooks.showMenu) return;
    const spans = [...mirror.querySelectorAll('.sp-bad')]; const x = e.clientX; const y = e.clientY;
    const hit = spans.find((s) => [...s.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom));
    if (!hit) return;
    const i = spans.indexOf(hit); const w = bad.filter((b) => b.from >= 0)[i]; if (!w) return;
    e.preventDefault(); e.stopPropagation();
    const list = spellSuggest(w.text);
    const first = await Promise.race([list, new Promise((r) => setTimeout(() => r(null), 200))]);
    const put = (s) => () => { ta.setRangeText(s, w.from, w.to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); };
    const items = (l) => [...(l.length ? l.map((s) => [s, put(s), 'spell-sugg']) : [['(sem sugestões)', () => {}, 'spell-none']]), [`Adicionar “${w.text}” ao dicionário`, async () => { if (hooks.addWord) await hooks.addWord(w.text); ta.focus(); }]];
    hooks.showMenu(x, y, items(first || []));
    if (!first) list.then((l) => { if (l.length) hooks.showMenu(x, y, items(l)); });
  });
  soon();
  return wrap;
}
