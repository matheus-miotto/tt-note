import { EditorState, EditorSelection, Compartment, StateField, StateEffect, Transaction, RangeSetBuilder, Prec } from '@codemirror/state';
import { diffLines } from './diff.js';
import { FORMATS, detectKind, sqlDialect } from './formatters.js';
import { EditorView, Decoration, ViewPlugin, MatchDecorator, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import {
  copyLineDown, deleteLine, selectLine, moveLineUp, moveLineDown,
  toggleComment, undo, redo, selectAll,
  insertTab, indentMore, indentLess, toggleBlockComment, selectParentSyntax, cursorMatchingBracket, deleteToLineEnd, deleteLineBoundaryBackward, transposeChars,
} from '@codemirror/commands';
import * as SX from './sublime-cmds.js';
import { snippetsFor, tryExpand, insertSnippet, BUILTIN as BUILTIN_SNIPPETS } from './snippets.js';
import { LanguageDescription, indentUnit, syntaxTree } from '@codemirror/language';
import { languages as baseLanguages } from '@codemirror/language-data';
import { extraLanguages } from './sublime-extra.js';
const languages = [...baseLanguages, ...extraLanguages]; // + Batch, Makefile, Git, DOT, regex, reStructuredText, AppleScript…
import { pollExt } from './pollwidget.js';
import { initStore as initPinsStore, storedPositions, setPins, pinsExt, pinField, pinChange, onPinsChange, listPins, toStored, pk as pinKey, storedEntries, dropStored, removeStored, savePinsFor, withStoredPins } from './pins.js';
import { openPollDialog } from './polldialog.js';
import { buildPoll, toMarkdown as pollToMarkdown } from '../server/poll.js';
import { spellPlugin, spellInit, spellAddWord, spellSuggest, spellIsBad, spellWordAt, spellRefreshAll } from './spell.js';
import { formatLog, hasLog } from './logfmt.js';
import { FILTER_TYPES, FILTER_DEFAULTS, buildFilter } from './sqlfilter.js';
import { THEMES, themeById, applyThemeVars, cmTheme, setCustomTheme, customFromJson, customToJson, CUSTOM_UI, CUSTOM_SYN } from './themes.js';
import { createCanvas } from './canvas.js';
import { createShared } from './shared.js';
import { openSearchPanel, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { marked } from 'marked';
import { buildDocx, prepareImage } from './exporter.js';
import { showMinimap } from '@replit/codemirror-minimap';

import { livePreview, imgCaptionFacet, copyText } from './livepreview.js';
import { autoWrapExt, rulerExt, reflowText, wrapLine } from './autowrap.js';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { openSupport, supportAvailable } from './support.js';
import { openTranslate } from './translate-ui.js';
import { initLang, setLang, onLang, getLang, locale, t as tr, openLangPicker, flagHtml } from './i18n.js';

const minimapComp = new Compartment();
const spellComp = new Compartment(); // corretor ortográfico (F6)
const spellExt = () => [EditorView.contentAttributes.of({ spellcheck: 'false' }), settings.spellcheck ? spellPlugin : []]; // corretor próprio (src/spell.js); o do Chromium fica desligado
// Tab: expande o gatilho de um snippet; senão insere o recuo (ou recua as linhas selecionadas); Shift+Tab desfaz o recuo
const tabKeys = () => Prec.high(keymap.of([{
  key: 'Tab',
  run: (v) => {
    const t = tabOfView(v);
    if (tryExpand(v, snippetsFor(t ? t.lang : '', settings.snippets))) return true;
    return v.state.selection.main.empty ? insertTab(v) : indentMore(v);
  },
  shift: indentLess,
}]));
const wsComp = new Compartment(); // bolinhas nos espaços e setas nas tabulações (como o draw_white_space do Sublime)
// Modo (Exibir → Mostrar espaços): "none" nunca · "selection" só no texto selecionado (padrão do Sublime) · "all" sempre
function wsExt() {
  const mode = settings.drawWhitespace || 'selection';
  if (mode === 'none') return [];
  const sp = Decoration.mark({ class: 'cm-ws-space' });
  const tb = Decoration.mark({ class: 'cm-ws-tab' });
  return ViewPlugin.fromClass(class {
    constructor(v) { this.deco = this.build(v); }
    update(u) { if (u.docChanged || u.viewportChanged || (mode === 'selection' && u.selectionSet)) this.deco = this.build(u.view); }
    build(view) {
      const spans = [];
      if (mode === 'all') for (const r of view.visibleRanges) spans.push([r.from, r.to]);
      else {
        for (const r of view.state.selection.ranges) {
          if (r.empty) continue;
          for (const vr of view.visibleRanges) { const a = Math.max(r.from, vr.from); const z = Math.min(r.to, vr.to); if (a < z) spans.push([a, z]); }
        }
      }
      spans.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const x of spans) { const l = merged[merged.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else merged.push([x[0], x[1]]); }
      const b = new RangeSetBuilder();
      for (const [from, to] of merged) {
        const text = view.state.sliceDoc(from, to);
        for (let i = 0; i < text.length; i++) {
          const c = text.charCodeAt(i);
          if (c === 32 || c === 160) b.add(from + i, from + i + 1, sp);
          else if (c === 9) b.add(from + i, from + i + 1, tb);
        }
      }
      return b.finish();
    }
  }, { decorations: (v) => v.deco });
}
const awComp = new Compartment(); // quebra automática de linha + réguas (por aba)
const themeComp = new Compartment(); // tema do editor
const roComp = new Compartment(); // somente leitura (canvas compartilhado sem a trava de edição)
const capComp = new Compartment(); // legenda (nome do arquivo) embaixo das imagens, por aba
const minimapExt = () => !settings.minimap ? [] : showMinimap.compute([], () => ({
  create: () => ({ dom: document.createElement('div') }),
  displayText: 'characters',
  showOverlay: 'always',
}));

const api = window.api;
// caixas de pergunta do Windows (processo principal): traduz a mensagem e os botões antes de abrir
const askT = (m, b) => api.ask(tr(m), (b || []).map((x) => tr(x)));
spellInit(api, () => (settings && settings.userDict) || [], {
  enabled: () => !!(settings && settings.spellcheck),
  showMenu: (x, y, items) => showMenu(x, y, items),
  addWord: async (w) => { const ud = [...new Set([...((settings && settings.userDict) || []), w])]; await spellAddWord(w); await saveSettingsObj({ userDict: ud }); toast('Adicionada ao dicionário'); },
});
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ───────────── estado ───────────── */
let settings = {};
let settingsPath = '';
let defaults = {};
let root = null; // projeto "atual" (o último em uso): destino de novo arquivo, nota diária etc.
const roots = []; // projetos abertos na barra lateral: { path, name, tree }
const collapsedRoots = new Set();
const rootOf = (p) => roots.find((r) => p === r.path || p.startsWith(r.path + api.sep));
let view = null; // editor do painel que está com o foco (o resto do código trabalha sempre nele)
let active = null; // aba do painel focado
const tabs = [];

/* ───────────── painéis (editores lado a lado) ───────────── */
// Cada painel tem o seu próprio editor. `view` é sempre o editor do painel focado e `active`, a aba dele.
// Uma aba que está aberta em outro painel guarda o estado "ao vivo" no editor desse painel (use stateOf/applyTo).
const panes = []; // { el, host, head, nm, view, tab }
let focusedPane = null;
const paneOf = (tab) => panes.find((p) => p.tab === tab) || null;
const viewOf = (tab) => { const p = paneOf(tab); return p ? p.view : null; };
const stateOf = (t) => { const p = paneOf(t); return p ? p.view.state : t.state; };
const tabOfView = (v) => { const p = panes.find((x) => x.view === v); return p ? p.tab : null; };
function applyTo(t, spec) { // aplica uma transação numa aba, esteja ela visível ou não
  const v = viewOf(t);
  if (v) v.dispatch(spec); else t.state = t.state.update(spec).state;
}
let compareOn = false; // comparando: destaca as diferenças entre os painéis
let syncOn = true; // rolagem sincronizada entre os painéis
const selectedTabs = new Set(); // abas selecionadas na lateral (Ctrl/Shift+clique)
let lastClickedTab = null;

// Destaque de diferenças: linhas só de um lado ficam coloridas (vermelho = só na referência, verde = só no outro)
const setDiff = StateEffect.define();
const diffField = StateField.define({
  create: () => Decoration.none,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setDiff)) return e.value;
    return tr.docChanged ? v.map(tr.changes) : v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const expanded = new Set();
const idx = { files: [], byName: new Map(), links: new Map(), tags: new Map(), aliases: new Map() };

const langComp = new Compartment();
const noteComp = new Compartment();
const tabComp = new Compartment();
const wrapComp = new Compartment();
const phrasesComp = new Compartment();
// textos da busca do editor (Ctrl+F) no idioma do aplicativo
const PHRASES = {
  'pt-BR': { Find: 'Localizar', Replace: 'Substituir', next: 'Próximo ↓', previous: 'Anterior ↑', all: 'Todos', 'match case': 'Maiúsc./minúsc.', regexp: 'Regex', 'by word': 'Palavra inteira', replace: 'Substituir', 'replace all': 'Substituir todos', close: 'Fechar' },
  'pt-PT': { Find: 'Localizar', Replace: 'Substituir', next: 'Seguinte ↓', previous: 'Anterior ↑', all: 'Todos', 'match case': 'Maiúsc./minúsc.', regexp: 'Regex', 'by word': 'Palavra inteira', replace: 'Substituir', 'replace all': 'Substituir tudo', close: 'Fechar' },
  es: { Find: 'Buscar', Replace: 'Reemplazar', next: 'Siguiente ↓', previous: 'Anterior ↑', all: 'Todos', 'match case': 'May./min.', regexp: 'Regex', 'by word': 'Palabra completa', replace: 'Reemplazar', 'replace all': 'Reemplazar todo', close: 'Cerrar' },
  en: {},
};
const phrasesExt = () => EditorState.phrases.of(PHRASES[getLang()] || {});
initLang();

const baseName = (p) => p.split(/[\\/]/).pop();
const stem = (p) => baseName(p).replace(/\.[^.]*$/, '');
const dirName = (p) => p.replace(/[\\/][^\\/]*$/, '');
const isMd = (p) => /\.(md|markdown)$/i.test(p);
const relPath = (p) => { const r = rootOf(p); return (r ? p.slice(r.path.length + 1) : p).replace(/\\/g, '/'); };
const relLabel = (p) => (roots.length > 1 && rootOf(p) ? rootOf(p).name + '/' : '') + relPath(p);
const joinPath = (...parts) => parts.join(api.sep).replace(/[\\/]+/g, api.sep);

let toastTimer;
function pickLanguage() {
  openLangPicker($('langBtn'), (id) => { setLang(id); setSetting('language', id); });
}

function toast(msg) {
  if (settings.debugMode) { try { api.debugLog('aviso', msg); } catch { /* sem debug */ } } // modo debug: guarda também o que o app avisou na barra
  $('stMsg').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('stMsg').textContent = ''), 4000);
}

/* ───────────── editor de tema (JSON, como no Mattermost) ───────────── */
function openThemeEditor() {
  if ($('themeDlg')) return;
  const orig = { theme: settings.theme, customTheme: settings.customTheme };
  let work = settings.customTheme ? { ...settings.customTheme } : customToJson(themeById(settings.theme));
  let mode = settings.theme === 'custom' ? 'custom' : 'premade';
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const dlg = el('div'); dlg.id = 'themeDlg';
  const box = el('div'); box.id = 'themeBox'; dlg.append(box);
  box.append(el('h2', '', 'Configurações de exibição'), el('div', 'th-sub', 'Tema'));
  const radios = el('div', 'th-radios');
  radios.innerHTML = '<label><input type="radio" name="thm" value="premade"> Temas prontos</label><label><input type="radio" name="thm" value="custom"> Tema personalizado</label>';
  box.append(radios);
  const premade = el('div', 'th-premade'); const sel = el('select');
  sel.innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  premade.append(sel); box.append(premade);
  const customBox = el('div', 'th-custom'); box.append(customBox);
  const ta = el('textarea'); ta.spellcheck = false; ta.id = 'themeJson';
  const err = el('div', 'th-err');
  const rows = {};
  const preview = () => {
    if (mode === 'premade') { settings.theme = sel.value; } else { settings.theme = 'custom'; settings.customTheme = work; }
    applySettings();
  };
  const syncJson = () => { ta.value = JSON.stringify(work); err.textContent = ''; };
  const syncRows = () => { for (const [k, r] of Object.entries(rows)) if (work[k]) { r.c.value = work[k]; r.t.value = work[k]; } };
  const section = (title, list) => {
    const head = el('div', 'th-sec', `<span>${title}</span><span class="th-plus">+</span>`);
    const body = el('div', 'th-body'); body.hidden = true;
    head.onclick = () => { body.hidden = !body.hidden; head.querySelector('.th-plus').textContent = body.hidden ? '+' : '−'; };
    for (const [k, label] of list) {
      const row = el('div', 'th-row'); const c = el('input'); c.type = 'color'; const t = el('input'); t.type = 'text'; t.spellcheck = false;
      row.append(el('span', 'th-lab', label), c, t); body.append(row); rows[k] = { c, t };
      const set = (v) => { work = { ...work, [k]: v }; syncRows(); syncJson(); preview(); };
      c.oninput = () => set(c.value);
      t.onchange = () => { if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.value.trim())) { try { set(customFromJson({ bg: t.value.trim() }).vars.bg); } catch { /* */ } } else t.value = work[k] || ''; };
    }
    customBox.append(head, body);
  };
  section('Cores da interface', CUSTOM_UI); section('Cores da sintaxe (editor)', CUSTOM_SYN);
  const dk = el('label', 'th-dk', '<input type="checkbox"> Tema escuro (ajusta o claro/escuro dos controles)');
  dk.querySelector('input').checked = work.dark !== false;
  dk.querySelector('input').onchange = (e) => { work = { ...work, dark: e.target.checked }; syncJson(); preview(); };
  customBox.append(dk);
  customBox.append(el('div', 'th-hint', 'Copie e cole para compartilhar o tema de cores (também aceita o JSON de tema do Mattermost):'), ta, err);
  const btns = el('div', 'th-btns');
  const bCopy = el('button', '', 'Copiar tema de cores'); const bApply = el('button', '', 'Aplicar JSON colado');
  const bOk = el('button', 'primary', 'Salvar'); const bCancel = el('button', '', 'Cancelar');
  btns.append(bCopy, bApply, el('span', 'sp'), bCancel, bOk); box.append(btns);
  const refresh = () => {
    radios.querySelector(`input[value="${mode}"]`).checked = true;
    premade.hidden = mode !== 'premade'; customBox.hidden = mode !== 'custom';
    bCopy.hidden = bApply.hidden = mode !== 'custom';
    sel.value = themeById(settings.theme).id === 'custom' ? 'tt-dark' : themeById(settings.theme).id;
    syncRows(); syncJson();
  };
  radios.onchange = (e) => { mode = e.target.value; if (mode === 'custom' && !settings.customTheme) work = customToJson(themeById(sel.value)); refresh(); preview(); };
  sel.onchange = preview;
  bCopy.onclick = () => { navigator.clipboard.writeText(ta.value).then(() => toast('Tema copiado'), () => { ta.select(); document.execCommand('copy'); }); };
  const applyJson = () => {
    try { const th = customFromJson(JSON.parse(ta.value)); work = customToJson(th); dk.querySelector('input').checked = th.dark; syncRows(); syncJson(); preview(); return true; }
    catch (e) { err.textContent = 'JSON inválido: ' + e.message; return false; }
  };
  bApply.onclick = applyJson;
  const close = () => { dlg.remove(); document.removeEventListener('keydown', onKey, true); };
  const cancel = () => { settings.theme = orig.theme; settings.customTheme = orig.customTheme; applySettings(); close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
  document.addEventListener('keydown', onKey, true);
  bCancel.onclick = cancel;
  bOk.onclick = async () => {
    if (mode === 'custom' && document.activeElement === ta && !applyJson()) return;
    const obj = mode === 'custom' ? { theme: 'custom', customTheme: work } : { theme: sel.value };
    settings.theme = orig.theme; close(); await saveSettingsObj(obj); toast('Tema salvo');
  };
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) cancel(); });
  document.body.append(dlg);
  refresh();
}

/* ───────────── filtros SQL a partir da lista (IN, LIKE…) ───────────── */
const sqlFilterOpts = () => ({ ...FILTER_DEFAULTS, ...(settings.sqlFilter || {}), cols: { ...((settings.sqlFilter || {}).cols || {}) } });
function sqlFilterRange(v) { // a seleção; sem seleção vale o documento inteiro
  const r = v.state.selection.main;
  return r.empty ? { from: 0, to: v.state.doc.length, all: true } : { from: r.from, to: r.to };
}
function sqlFilterApply(v, type, o) {
  const rg = sqlFilterRange(v);
  const res = buildFilter(type, v.state.sliceDoc(rg.from, rg.to), o);
  if (!res.text) { toast(res.warn[0] || 'Nada para filtrar'); return false; }
  v.dispatch({ changes: { from: rg.from, to: rg.to, insert: res.text }, selection: { anchor: rg.from, head: rg.from + res.text.length }, userEvent: 'input' });
  toast(res.warn.length ? '⚠ ' + res.warn[0] : 'Filtro criado' + (rg.all ? ' (documento inteiro)' : ''));
  return true;
}
function sqlFilterQuick(type) { // atalho direto: usa as últimas opções
  if (!active) return;
  sqlFilterApply(view, type, sqlFilterOpts());
  view.focus();
}
function openSqlFilter(startType) {
  if (!active || $('sqlDlg')) return;
  const v = view; const rg = sqlFilterRange(v); const src = v.state.sliceDoc(rg.from, rg.to);
  const o = sqlFilterOpts(); let type = startType || o.type || 'in';
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const dlg = el('div'); dlg.id = 'sqlDlg'; const box = el('div'); box.id = 'sqlBox'; dlg.append(box);
  box.append(el('h2', '', 'Filtro SQL a partir da lista'), el('div', 'sf-sub', rg.all ? 'Sem seleção: usando o documento inteiro.' : 'Usando o texto selecionado.'));
  const row = (label, node, id) => { const r = el('label', 'sf-row'); r.append(el('span', 'sf-lab', label), node); if (id) r.dataset.for = id; box.append(r); return r; };
  const sel = el('select'); sel.innerHTML = FILTER_TYPES.map(([id, nm, ex]) => `<option value="${id}">${nm}   —   ${ex.replace(/</g, '&lt;')}</option>`).join('');
  sel.value = type; row('Tipo', sel);
  const col = el('input'); col.type = 'text'; col.spellcheck = false; col.placeholder = 'opcional no IN; obrigatório no LIKE (padrão: coluna)'; const rCol = row('Coluna', col);
  const wild = el('select'); wild.innerHTML = '<option value="both">%valor%  (contém)</option><option value="start">valor%  (começa com)</option><option value="end">%valor  (termina com)</option><option value="none">valor  (exato)</option>'; wild.value = o.wild; const rWild = row('Curinga do LIKE', wild);
  const quotes = el('select'); quotes.innerHTML = '<option value="auto">Automático (números sem aspas)</option><option value="always">Sempre com aspas</option><option value="never">Nunca</option>'; quotes.value = o.quotes; const rQ = row('Aspas', quotes);
  const layout = el('select'); layout.innerHTML = '<option value="line">Tudo em uma linha</option><option value="lines">Um valor por linha</option>'; layout.value = o.layout; row('Formato', layout);
  const dd = el('input'); dd.type = 'checkbox'; dd.checked = !!o.dedupe; row('Remover repetidos', dd);
  const batch = el('input'); batch.type = 'number'; batch.min = 0; batch.step = 100; batch.value = o.batch || 0; batch.title = '0 = não dividir. Oracle aceita no máximo 1000 itens por IN.'; const rBatch = row('Dividir em lotes de (0 = não)', batch);
  const out = el('textarea'); out.readOnly = true; out.spellcheck = false; out.id = 'sqlOut';
  const warn = el('div', 'sf-warn'); box.append(el('div', 'sf-hint', 'Resultado'), out, warn);
  const btns = el('div', 'sf-btns'); const bOk = el('button', 'primary', 'Aplicar'); const bCancel = el('button', '', 'Cancelar'); btns.append(el('span', 'sp'), bCancel, bOk); box.append(btns);
  const cur = () => ({ ...o, quotes: quotes.value, wild: wild.value, layout: layout.value, dedupe: dd.checked, batch: Math.max(0, Number(batch.value) || 0), type: sel.value, cols: { ...o.cols, [sel.value]: col.value.trim() } });
  const refresh = () => {
    const t = sel.value;
    rWild.hidden = !/like/.test(t); rBatch.hidden = !/in/.test(t) || t === 'between';
    const res = buildFilter(t, src, cur()); out.value = res.text; warn.textContent = res.warn.join(' · ');
  };
  sel.onchange = () => { col.value = (o.cols[sel.value] || ''); refresh(); };
  for (const x of [col, wild, quotes, layout, dd, batch]) { x.oninput = refresh; x.onchange = refresh; }
  col.value = o.cols[type] || ''; refresh();
  const close = () => { dlg.remove(); document.removeEventListener('keydown', onKey, true); view.focus(); };
  const ok = async () => {
    const c = cur();
    if (!sqlFilterApply(v, c.type, c)) return;
    close(); await saveSettingsObj({ sqlFilter: { type: c.type, quotes: c.quotes, wild: c.wild, layout: c.layout, dedupe: c.dedupe, batch: c.batch, cols: c.cols } });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Enter' && !e.isComposing && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); ok(); } };
  document.addEventListener('keydown', onKey, true);
  bCancel.onclick = close; bOk.onclick = ok;
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  (/like|eq|between/.test(type) ? col : sel).focus();
}

/* ───────────── linhas fixadas (📌) ───────────── */
function pinnedHere(v) { const f = v.state.doc.lineAt(v.state.selection.main.head).from; return v.state.field(pinField).some((p) => p.from === f); }
// Fixa a(s) linha(s) da seleção; se todas já estavam fixadas, desafixa
function togglePinLines(v) {
  const doc = v.state.doc; const starts = new Set();
  for (const r of v.state.selection.ranges) for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) starts.add(doc.line(n).from);
  const have = new Set(v.state.field(pinField).map((p) => p.from));
  const all = [...starts].every((f) => have.has(f));
  v.dispatch({ effects: pinChange.of(all ? { remove: [...starts] } : { add: [...starts] }) });
  toast(all ? 'Linha desafixada' : `📌 ${starts.size > 1 ? starts.size + ' linhas fixadas' : 'Linha fixada'} — veja todas no 📌 da barra de baixo`);
}
const pinTimers = new Map();
onPinsChange((v, st) => {
  const tab = tabOfView(v); if (!tab || !tab.path || tab.untitled || tab.srv) return;
  const path = tab.path; clearTimeout(pinTimers.get(path));
  pinTimers.set(path, setTimeout(() => { pinTimers.delete(path); savePinsFor(path, toStored(st)); }, 300)); // o estado e o caminho de AGORA (a aba pode mudar até lá)
});
// todas as fixadas: arquivos abertos (estado vivo) + os guardados de arquivos fechados
function allPins() {
  const out = []; const live = new Set();
  for (const t of tabs) {
    if (t.srv || t.untitled || isCanvas(t)) continue;
    const pv = panes.find((p) => p.tab === t); const st = pv ? pv.view.state : t.state;
    live.add(pinKey(t.path));
    for (const p of listPins(st)) out.push({ path: t.path, line: p.line, text: p.text, from: p.from, tab: t });
  }
  for (const e of storedEntries()) if (!live.has(pinKey(e.path))) for (const s of e.pins) out.push({ path: e.path, line: s.line, text: s.text, tab: null });
  return out;
}
async function pinJump(it) {
  if (!it.tab) { await openFile(it.path); if (!tabs.some((t) => pinKey(t.path) === pinKey(it.path))) { dropStored(it.path); return; } }
  else { await openFile(it.path); }
  if (!active) return;
  const pins = listPins(view.state);
  const hit = pins.find((p) => p.text === it.text && p.line === it.line) || pins.find((p) => p.text === it.text) || pins[0];
  if (hit) { goLine(hit.line); view.focus(); }
}
function pinUnpin(it) {
  if (it.tab) {
    const pv = panes.find((p) => p.tab === it.tab);
    if (pv) pv.view.dispatch({ effects: pinChange.of({ remove: [it.from] }) });
    else { it.tab.state = it.tab.state.update({ effects: pinChange.of({ remove: [it.from] }) }).state; savePinsFor(it.tab.path, toStored(it.tab.state)); }
  } else removeStored(it.path, it.line, it.text);
}
function pinsPanel() {
  if ($('pinsDlg')) return;
  const dlg = document.createElement('div'); dlg.id = 'pinsDlg';
  const box = document.createElement('div'); box.className = 'pn-box'; dlg.append(box);
  const head = document.createElement('div'); head.className = 'pn-head'; head.innerHTML = '<h2>📌 Linhas fixadas</h2>'; box.append(head);
  const q = document.createElement('input'); q.type = 'text'; q.placeholder = 'Filtrar…'; q.className = 'pn-q'; q.spellcheck = false; box.append(q);
  const list = document.createElement('div'); list.className = 'pn-list'; box.append(list);
  const close = () => { dlg.remove(); document.removeEventListener('keydown', onKey, true); if (active) view.focus(); };
  const draw = () => {
    list.textContent = ''; const f = q.value.trim().toLowerCase();
    const all = allPins().filter((it) => !f || it.text.toLowerCase().includes(f) || baseName(it.path).toLowerCase().includes(f));
    if (!all.length) { const e = document.createElement('div'); e.className = 'pn-empty'; e.textContent = f ? 'Nada encontrado.' : 'Nenhuma linha fixada ainda. Ponha o cursor numa linha e use Ctrl+Alt+P (ou o botão direito → Fixar esta linha).'; list.append(e); return; }
    const groups = new Map(); for (const it of all) { if (!groups.has(it.path)) groups.set(it.path, []); groups.get(it.path).push(it); }
    const here = active && active.path;
    for (const [path, items] of [...groups].sort((a, b) => (b[0] === here) - (a[0] === here))) {
      const gh = document.createElement('div'); gh.className = 'pn-file'; gh.textContent = baseName(path) + (path === here ? '  ·  este arquivo' : ''); gh.title = path; list.append(gh);
      for (const it of items) {
        const r = document.createElement('div'); r.className = 'pn-item';
        const ln = document.createElement('span'); ln.className = 'pn-ln'; ln.textContent = it.line; const tx = document.createElement('span'); tx.className = 'pn-tx'; tx.textContent = it.text || '(linha em branco)';
        const x = document.createElement('button'); x.className = 'pn-x'; x.textContent = '✕'; x.title = 'Desafixar';
        x.onclick = (e) => { e.stopPropagation(); pinUnpin(it); draw(); };
        r.append(ln, tx, x); r.onclick = () => { close(); pinJump(it); };
        list.append(r);
      }
    }
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Enter') { const first = list.querySelector('.pn-item'); if (first) { e.preventDefault(); e.stopPropagation(); first.click(); } } };
  document.addEventListener('keydown', onKey, true);
  q.addEventListener('input', draw); dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg); draw(); q.focus();
}
$('stPins').addEventListener('click', () => pinsPanel());
$('stIns').addEventListener('click', () => { toggleOverwrite(); if (active) view.focus(); });

/* ───────────── wikilinks / tags ───────────── */
const stripMd = (s) => s.replace(/\.md$/i, '');
// [[pasta/Nota#Título|apelido]] -> "nota" (nome da nota, minúsculo, sem pasta nem .md)
const normLink = (s) => stripMd(s.split('|')[0].split('#')[0].trim()).split('/').pop().toLowerCase();

// Frontmatter YAML (--- ... ---) no começo da nota: tags e aliases como o Obsidian.
function fmList(fm, key, split) {
  const out = [];
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'mi'));
  if (!m) return out;
  const clean = (x) => x.trim().replace(/^["']|["']$/g, '');
  const inline = m[1].trim();
  if (inline) out.push(...inline.replace(/^\[|\]$/g, '').split(split).map(clean));
  else {
    const after = fm.slice(m.index + m[0].length).split(/\r?\n/).slice(1);
    for (const l of after) {
      const li = l.match(/^\s*-\s*(.+)$/);
      if (!li) break;
      out.push(clean(li[1]));
    }
  }
  return out.filter(Boolean);
}

function parseNote(text) {
  const links = new Set();
  const tags = new Set();
  let aliases = [];
  const fmm = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (fmm) {
    for (const t of fmList(fmm[1], 'tags?', /[,\s]+/)) tags.add(t.replace(/^#/, ''));
    aliases = fmList(fmm[1], 'aliases?', /,/);
  }
  for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    // imagens/PDFs/áudio embutidos (![[foto.png]]) são anexos, não links para notas
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp3|mp4|mov|webm|wav|ogg|m4a)$/i.test(m[1].split('|')[0].split('#')[0].trim())) continue;
    const n = normLink(m[1]);
    if (n) links.add(n);
  }
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}][\p{L}\d_/-]*)/gu)) tags.add(m[1]);
  return { links, tags, aliases };
}

const wikiMatcher = new MatchDecorator({
  regexp: /\[\[([^\]\n]+)\]\]|(?<=^|\s)#[\p{L}][\p{L}\d_/-]*/gu,
  decoration: (m) => Decoration.mark({ class: m[0].startsWith('[[') ? 'cm-wikilink' : 'cm-tag' }),
});
const wikiPlugin = ViewPlugin.fromClass(
  class {
    constructor(v) { this.d = wikiMatcher.createDeco(v); }
    update(u) { this.d = wikiMatcher.updateDeco(u, this.d); }
  },
  { decorations: (v) => v.d },
);

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
function imgSrc(src) {
  if (/^(https?:|file:|data:)/i.test(src)) return src;
  return active ? fileUrl(dirName(active.path) + '/' + decodeURI(src)) : src;
}
function wikiImg(name) {
  const t = name.toLowerCase();
  const f = idx.files.find((x) => x.rel.toLowerCase() === t || x.rel.toLowerCase().endsWith('/' + t));
  return f ? fileUrl(f.path) : null;
}
function noteExt() {
  return settings.livePreview === false ? [wikiPlugin] : [livePreview({ imgSrc, wikiImg }), pollExt({ imgSrc, wikiImg })];
}

// [texto](url) sob a posição
function mdLinkAt(v, pos) {
  const line = v.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    const from = line.from + m.index;
    if (pos >= from && pos <= from + m[0].length) return m[1];
  }
  return null;
}

function openUrl(u) {
  if (/^https?:/i.test(u)) api.openExternal(u);
  else if (active && !u.startsWith('#')) openFile(joinPath(dirName(active.path), decodeURI(u)));
}

function linkAt(v, pos) {
  const line = v.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const from = line.from + m.index;
    if (pos >= from && pos <= from + m[0].length) return m[1];
  }
  return null;
}

// Acha a nota de um [[link]]: aceita pasta ([[pasta/Nota]]), .md, #título, apelido (aliases) e [[#título]] (mesma nota).
function resolveWiki(raw) {
  const target = stripMd(raw.split('|')[0].split('#')[0].trim());
  if (!target) return active && !active.untitled ? { path: active.path } : null;
  if (target.includes('/')) {
    const t = target.toLowerCase();
    const f = idx.files.find((x) => {
      const r = stripMd(x.rel).toLowerCase();
      return isMd(x.path) && (r === t || r.endsWith('/' + t));
    });
    if (f) return f;
  }
  return idx.byName.get(normLink(raw)) || null;
}

// [[Nota#Título]] ou [[Nota#^bloco]]: leva o cursor até o título/bloco
function jumpToFragment(frag) {
  if (!active) return;
  const doc = view.state.doc;
  const want = frag.trim().toLowerCase().replace(/\s+/g, ' ');
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text;
    if (want.startsWith('^') ? t.trim().toLowerCase().endsWith(' ' + want) || t.trim().toLowerCase() === want
      : /^#{1,6}\s/.test(t) && t.replace(/^#{1,6}\s+/, '').trim().toLowerCase().replace(/\s+/g, ' ') === want) {
      return goLine(i);
    }
  }
}

async function openWiki(raw) {
  const f = resolveWiki(raw);
  const frag = raw.split('|')[0].split('#').slice(1).join('#');
  if (f) {
    await openFile(f.path);
    if (frag) jumpToFragment(frag);
    return;
  }
  const target = stripMd(raw.split('|')[0].split('#')[0].trim());
  if (!target) return;
  // nota nova: ao lado do arquivo atual se ele estiver fora de projetos; senão no projeto atual
  const dir = active && !active.untitled && !rootOf(active.path) ? dirName(active.path) : root;
  if (!dir) return toast('Abra uma pasta primeiro');
  const p = joinPath(dir, target + '.md');
  await api.create(p, `# ${target.split('/').pop()}\n\n`);
  if (rootOf(p)) await loadWorkspace(rootOf(p).path);
  openFile(p);
}

function wikiComplete(ctx) {
  if (!active || !isMd(active.path)) return null;
  const m = ctx.matchBefore(/\[\[[^\]\n]*/);
  if (!m) return null;
  const opts = idx.files.filter((f) => isMd(f.path)).map((f) => ({ label: f.name, detail: f.rel, apply: f.name + ']]' }));
  return { from: m.from + 2, options: opts, validFor: /^[^\]\n]*$/ };
}

/* ───────────── editor ───────────── */
function tabExt() {
  const n = settings.tabSize || 4;
  return [EditorState.tabSize.of(n), indentUnit.of(settings.insertSpaces === false ? '\t' : ' '.repeat(n))];
}

// Tecla Insert: alterna entre inserir e sobrescrever (o caractere digitado troca o próximo, cursor em bloco)
let overwrite = false;
const overwriteExt = EditorView.inputHandler.of((view, from, to, text) => {
  if (!overwrite || from !== to || !text || /[\n\r]/.test(text) || view.state.selection.ranges.length > 1) return false;
  const line = view.state.doc.lineAt(from);
  if (from >= line.to) return false; // no fim da linha não há o que trocar
  const end = Math.min(line.to, from + text.length);
  view.dispatch({ changes: { from, to: end, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' });
  return true;
});
function toggleOverwrite() {
  overwrite = !overwrite;
  document.body.classList.toggle('ow-mode', overwrite);
  $('stIns').textContent = overwrite ? 'SOBRESCREVER' : 'INSERIR';
  toast(overwrite ? 'Modo sobrescrever (tecla Insert volta ao normal)' : 'Modo inserir');
}
function makeState(text) {
  return EditorState.create({
    doc: text,
    extensions: [
      pinsExt(),
      overwriteExt,
      basicSetup,
      themeComp.of(cmTheme(themeById(settings.theme))),
      capComp.of(imgCaptionFacet.of(true)),
      roComp.of([]),
      phrasesComp.of(phrasesExt()),
      langComp.of([]),
      noteComp.of([]),
      tabComp.of(tabExt()),
      wrapComp.of(EditorView.lineWrapping), // guias novas nascem com quebra de linha (desligar vale só por guia)
      minimapComp.of(minimapExt()),
      wsComp.of(wsExt()),
      spellComp.of(spellExt()),
      tabKeys(),
      awComp.of([]),
      diffField,
      EditorView.clickAddsSelectionRange.of((e) => e.ctrlKey),
      EditorView.domEventHandlers({
        paste: (e, v) => pasteImage(e, v) || pasteLog(e, v) || pasteJson(e, v),
        contextmenu: (e, v) => editorMenu(e, v),
        mousedown(e, v) {
          if (!e.altKey || e.ctrlKey) return false;
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const t = linkAt(v, pos);
          if (t) { e.preventDefault(); openWiki(t); return true; }
          const u = mdLinkAt(v, pos);
          if (u) { e.preventDefault(); openUrl(u); return true; }
          return false;
        },
      }),
      EditorView.updateListener.of(onUpdate),
      EditorState.languageData.of(() => [{ autocomplete: wikiComplete }]),
    ],
  });
}

let autoSaveTimer;
let previewTimer;
function onUpdate(u) {
  const tab = tabOfView(u.view); // a aba do painel onde aconteceu a edição
  if (u.startState.field(pinField) !== u.state.field(pinField) && tab === active) updateStatus(); // 📌 da barra de baixo
  if (u.docChanged && tab && tab.srv && tab.srv.canvas) { // canvas compartilhado: o servidor guarda; nada de arquivo/rascunho
    if (cvShown && tab === active) cv.externalChange(u.state.doc.toString());
    if (!tab.srv.applying) scSchedule(tab);
    return;
  }
  if (u.docChanged && tab) {
    if (cvShown && tab === active) cv.externalChange(u.state.doc.toString());
    if (!tab.dirty) { tab.dirty = true; renderTabs(); }
    else if (tab.untitled && tabName(tab) !== tab._lbl) renderTabs(); // 1ª linha mudou = nome da aba mudou
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 150);
    scheduleDrafts();
    if (settings.autoSave) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => saveTab(tab), 1500);
    }
    if (compareOn) scheduleDiff(); // comparando: atualiza as diferenças
  }
  if ((u.docChanged || u.selectionSet) && tab === active) updateStatus();
}

function reconf(tab, effects) {
  if (!tabs.includes(tab)) return;
  applyTo(tab, { effects });
}

/* ───────────── quebra automática de linha (Auto Wrap) ───────────── */
// Largura: autoWrapWidth, senão a 1ª régua (autoWrapRulers), senão 80 — a mesma ordem do AutoWrap do Sublime.
const wrapWidth = () => settings.autoWrapWidth || (settings.autoWrapRulers && settings.autoWrapRulers[0]) || 80;
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
const capMap = () => { try { return JSON.parse(localStorage.getItem('tt.imgcap') || '{}'); } catch { return {}; } };
function setImgCaption(tab, on, remember = false) {
  tab.imgCap = on;
  reconf(tab, [capComp.reconfigure(imgCaptionFacet.of(on))]);
  if (remember && !tab.untitled) { const m = capMap(); m[tab.path] = on; try { localStorage.setItem('tt.imgcap', JSON.stringify(m)); } catch { /* sem espaço */ } }
}
function toggleImgCaption() {
  if (!active) return;
  setImgCaption(active, active.imgCap === false, true);
  toast(active.imgCap === false ? 'Nome das imagens escondido nesta aba' : 'Nome das imagens mostrado nesta aba');
}
const awMap = () => { try { return JSON.parse(localStorage.getItem('tt.autowrap') || '{}'); } catch { return {}; } };

// Arquivos como COMMIT_EDITMSG já abrem com a quebra ligada (settings: autoWrapFiles); o que você ligar/desligar é lembrado.
function defaultAutoWrap(tab) {
  if (tab.untitled || settings.gitWrap === false) return false;
  const saved = awMap()[tab.path];
  if (typeof saved === 'boolean') return saved;
  return (settings.autoWrapFiles || []).some((g) => globRe(g).test(baseName(tab.path)));
}

// Quebra de linha: vale só para a guia em que foi ligada (lembrada por arquivo); guias novas nascem sem quebra
const wrapMap = () => { try { return JSON.parse(localStorage.getItem('tt.nowrap') || '{}'); } catch { return {}; } };
const wrapOn = (t) => t.wrap !== false;
function setWrap(tab, on, remember = false) {
  tab.wrap = !!on;
  reconf(tab, [wrapComp.reconfigure(on ? EditorView.lineWrapping : [])]);
  if (remember && !tab.untitled && tab.path && !tab.srv) {
    const m = wrapMap(); if (!on) m[tab.path] = true; else delete m[tab.path];
    try { localStorage.setItem('tt.nowrap', JSON.stringify(m)); } catch { /* sem gravar */ }
  }
}
function setAutoWrap(tab, on, remember = false) {
  tab.autoWrap = on;
  const cols = () => [...new Set([...(settings.autoWrapRulers || []), wrapWidth()])].sort((a, b) => a - b);
  reconf(tab, [awComp.reconfigure(on ? [autoWrapExt(() => ({ width: wrapWidth(), tab: settings.tabSize || 4 })), rulerExt(cols)] : [])]);
  if (remember && !tab.untitled) {
    const m = awMap();
    m[tab.path] = on;
    try { localStorage.setItem('tt.autowrap', JSON.stringify(m)); } catch {}
  }
  if (tab === active) updateStatus();
}

function toggleAutoWrap() {
  if (!active) return;
  setAutoWrap(active, !active.autoWrap, true);
  toast(active.autoWrap ? `Quebra automática ligada: ${wrapWidth()} colunas` : 'Quebra automática desligada');
}

// Alt+Q: reformata a seleção (ou o parágrafo do cursor) na largura configurada
function reflowSelection(v) {
  const { doc, selection } = v.state;
  const r = selection.main;
  let a = doc.lineAt(r.from).number;
  let b = doc.lineAt(r.to).number;
  if (r.empty) {
    while (a > 1 && doc.line(a - 1).text.trim()) a--;
    while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
    if (!doc.line(a).text.trim()) return toast('Coloque o cursor em um parágrafo ou selecione o trecho');
  }
  const from = doc.line(a).from;
  const to = doc.line(b).to;
  const out = reflowText(doc.sliceString(from, to), wrapWidth(), settings.tabSize || 4);
  if (out !== doc.sliceString(from, to)) v.dispatch({ changes: { from, to, insert: out }, userEvent: 'input.reflow' });
  toast(`Reformatado em ${wrapWidth()} colunas`);
}

// Sintaxe escolhida manualmente por arquivo (lembrada entre sessões)
const memSyntax = {}; // arquivos sem título: só vale nesta sessão (o nome "Sem título 1.md" se repete)
const isUntitledPath = (p) => !/[\\/]/.test(p);
function syntaxMap() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('tt.syntax') || '{}'); } catch {}
  return { ...s, ...memSyntax };
}
function saveSyntax(path, name) {
  if (isUntitledPath(path)) { if (name) memSyntax[path] = name; else delete memSyntax[path]; return; }
  let m = {};
  try { m = JSON.parse(localStorage.getItem('tt.syntax') || '{}'); } catch {}
  if (name) m[path] = name; else delete m[path];
  try { localStorage.setItem('tt.syntax', JSON.stringify(m)); } catch {}
}

// want: nome escolhido pelo usuário ('Texto' = texto simples); sem ele, detecta pela extensão.
async function setLanguage(tab) {
  const want = syntaxMap()[tab.path];
  let d = null;
  if (want && want !== 'Texto') d = languages.find((l) => l.name === want) || null;
  else if (!want) d = LanguageDescription.matchFilename(languages, baseName(tab.path));
  const md = d ? d.name === 'Markdown' : !want && isMd(tab.path);
  tab.lang = md ? 'Markdown' : d ? d.name : 'Texto';
  tab.manual = !!want;
  reconf(tab, [noteComp.reconfigure(md ? noteExt() : [])]);
  if (tab === active) updateStatus();
  if (md) {
    reconf(tab, [langComp.reconfigure(markdown({ base: markdownLanguage, codeLanguages: languages }))]);
  } else if (d) {
    try { reconf(tab, [langComp.reconfigure(await d.load())]); } catch (e) { console.error(e); }
  } else {
    reconf(tab, [langComp.reconfigure([])]);
  }
}

function pickSyntax() {
  if (!active) return;
  const items = [
    { label: 'Automático (pela extensão do arquivo)', detail: '', name: null },
    { label: 'Texto simples', detail: '', name: 'Texto' },
    ...languages.map((l) => ({ label: l.name, detail: l.extensions.map((e) => '.' + e).join(' '), name: l.name })),
  ];
  const tab = active;
  showPalette({
    placeholder: 'Definir sintaxe para este arquivo… (ex.: JSON, SQL, Markdown)',
    items: () => items,
    onSelect: (it) => { saveSyntax(tab.path, it.name); setLanguage(tab); if (active) view.focus(); },
  });
}

// Altera uma chave e grava no settings.json, preservando as demais chaves do arquivo.
async function setSetting(key, value) {
  settings[key] = value;
  try {
    const cur = JSON.parse((await api.settingsGet()).text);
    cur[key] = value;
    await api.write(settingsPath, JSON.stringify(cur, null, 2) + '\n');
  } catch { toast('Não consegui gravar no settings.json'); }
  applySettings();
}

// Grava várias chaves de uma vez no settings.json (preserva as demais)
async function saveSettingsObj(obj) {
  Object.assign(settings, obj);
  try {
    const cur = JSON.parse((await api.settingsGet()).text);
    Object.assign(cur, obj);
    await api.write(settingsPath, JSON.stringify(cur, null, 2) + '\n');
  } catch { toast('Não consegui gravar no settings.json'); }
  applySettings();
}

let debugSynced = null;
function applySettings() {
  if (debugSynced !== !!settings.debugMode) { // liga/desliga a gravação dos registros (debug.log) no processo principal
    const first = debugSynced === null; debugSynced = !!settings.debugMode;
    api.debugSet(debugSynced).then((f) => { if (!first) toast(debugSynced ? tr('Modo debug ligado: os registros ficam em {0}').replace('{0}', f) : tr('Modo debug desligado')); }).catch(() => {});
  }
  $('tabs').hidden = !settings.tabBar; // as abas já ficam em "Arquivos abertos" na lateral; a barra do topo é opcional
  $('stMini').textContent = settings.minimap ? 'Minimap: ligado' : 'Minimap: desligado';
  setCustomTheme(settings.customTheme);
  const th = themeById(settings.theme);
  applyThemeVars(th);
  try { localStorage.setItem('tt.customTheme', JSON.stringify(settings.customTheme || null)); localStorage.setItem('tt.theme', th.id); } catch {}
  const r = document.documentElement.style;
  r.setProperty('--font-size', (settings.fontSize || 14) + 'px');
  r.setProperty('--cv-size', (settings.canvasFontSize || 15) + 'px');
  r.setProperty('--cv-font', settings.canvasFont || "'Segoe UI', sans-serif");
  cv?.syncStyle();
  r.setProperty('--font-family', settings.fontFamily || "Consolas, monospace");
  for (const t of tabs) if (t.lang === 'Markdown') reconf(t, [noteComp.reconfigure(noteExt())]);
  for (const t of tabs) if (t.autoWrap) setAutoWrap(t, true); // largura/réguas podem ter mudado
  for (const t of tabs) reconf(t, [themeComp.reconfigure(cmTheme(th)), tabComp.reconfigure(tabExt()), wrapComp.reconfigure(wrapOn(t) ? EditorView.lineWrapping : []), minimapComp.reconfigure(minimapExt()), wsComp.reconfigure(wsExt()), spellComp.reconfigure(spellExt())]);
  rebuildBindings();
  updateStatus();
  try { spellRefreshAll(); } catch { /* sem caixas de texto */ }
}

async function loadSettings() {
  const r = await api.settingsGet();
  settingsPath = r.path;
  defaults = r.defaults;
  try {
    const stored = JSON.parse(r.text);
    settings = { ...defaults, ...stored };
  } catch (e) {
    settings = { ...defaults };
    toast('settings.json inválido: ' + e.message);
  }
  if (settings.language && settings.language !== getLang()) setLang(settings.language); else { try { api.setLang(getLang()); } catch { /* */ } }
  applySettings();
}

/* ───────────── abas / arquivos ───────────── */
async function openFile(path, line) {
  let tab = tabs.find((t) => t.path === path);
  if (!tab) {
    let r;
    try { r = await api.readFile(path); } catch (e) { return toast('Não consegui abrir: ' + path); }
    tab = { path, state: withStoredPins(makeState(r.text), path), dirty: false, lang: '', enc: r.enc, eol: r.eol };
    if (groupAssign[path] && findGroup(groupAssign[path])) tab.groupId = groupAssign[path]; // volta ao grupo de antes
    if (path !== settingsPath) pushRecent(path);
    tabs.push(tab);
    if (wrapMap()[path]) setWrap(tab, false, false); // arquivo em que você desligou a quebra de linha
    setAutoWrap(tab, defaultAutoWrap(tab)); // ex.: COMMIT_EDITMSG já abre com a quebra ligada
    if (capMap()[path] === false) setImgCaption(tab, false); // lembra por arquivo se o nome das imagens fica escondido
    activate(tab);
    setLanguage(tab);
  } else {
    activate(tab);
  }
  if (line) goLine(line);
}

// Posição (no texto) da linha que está no topo da tela: é o que guardamos para voltar à mesma rolagem
const topPos = (v = view) => { try { return v.elementAtHeight(v.scrollDOM.scrollTop).from; } catch { return 0; } };
const tabKey = (t) => (t.untitled ? 'u:' : 'f:') + t.path;

const setFocus = (p) => { focusedPane = p; view = p.view; };

// Mostra a aba: se já está aberta em algum painel, só leva o foco para lá; senão ela entra no painel focado.
function activate(tab) {
  tab.usedAt = Date.now(); // para listar as abas da mais recente para a mais antiga (Ctrl+K)
  const shown = paneOf(tab);
  if (shown) {
    setFocus(shown);
  } else {
    const p = focusedPane;
    if (p.tab && tabs.includes(p.tab)) { p.tab.state = p.view.state; p.tab.topPos = topPos(p.view); }
    p.tab = tab;
    p.view.setState(tab.state);
    if (tab.topPos) p.view.dispatch({ effects: EditorView.scrollIntoView(tab.topPos, { y: 'start' }) }); // volta à rolagem da aba
  }
  active = tab;
  const rr = rootOf(tab.path);
  if (rr) root = rr.path;
  $('welcome').hidden = true;
  $('editor').hidden = false;
  renderPanes();
  renderTabs();
  renderTree();
  updateStatus();
  renderPreview();
  renderRight();
  view.focus();
  if (cvShown) cv.focus();
  persist();
}

function createPane(tab, atIndex = panes.length) {
  const mk = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
  const el = mk('div', 'pane');
  const head = mk('div', 'pane-head');
  const nm = mk('span', 'pn');
  const x = mk('span', 'px', '×');
  x.title = 'Fechar este painel (a aba continua aberta)';
  head.append(nm, x);
  const host = mk('div', 'host');
  el.append(head, host);
  const p = { el, host, head, nm, view: null, tab: tab || null, skip: false };
  p.view = new EditorView({ parent: host, state: tab ? tab.state : EditorState.create({ doc: '', extensions: [cmTheme(themeById(settings.theme))] }) });
  panes.splice(atIndex, 0, p);
  const box = $('editor');
  box.insertBefore(el, box.children[atIndex] || null);
  host.addEventListener('focusin', () => { if (focusedPane !== p && p.tab) activate(p.tab); }); // clicar no painel leva o foco
  head.addEventListener('mousedown', () => { if (p.tab) activate(p.tab); });
  x.onclick = (e) => { e.stopPropagation(); closePane(p); };
  p.view.scrollDOM.addEventListener('scroll', () => onPaneScroll(p));
  return p;
}

// Fecha o painel (a aba continua aberta, só deixa de aparecer lado a lado)
function closePane(p) {
  if (panes.length < 2) return;
  const idx = panes.indexOf(p);
  if (p.tab && tabs.includes(p.tab)) { p.tab.state = p.view.state; p.tab.topPos = topPos(p.view); }
  panes.splice(idx, 1);
  p.view.destroy();
  p.el.remove();
  if (focusedPane === p) setFocus(panes[Math.min(idx, panes.length - 1)]);
  if (panes.length === 1) setCompare(false);
  const t = focusedPane.tab;
  if (t && tabs.includes(t)) activate(t); else renderPanes();
  persist();
}

/* ───────────── reabrir aba fechada (Ctrl+Shift+T) ───────────── */
const closedStack = []; // abas fechadas, a mais recente por último
function rememberClosed(tab) {
  if (tab.srv) return;
  try {
    const st = stateOf(tab);
    const v = viewOf(tab);
    const e = { untitled: !!tab.untitled, path: tab.path, sel: st.selection.main.head, top: v ? topPos(v) : tab.topPos || 0, groupId: tab.groupId || null, eol: tab.eol, enc: tab.enc };
    if (tab.untitled) { // rascunho: guarda o texto (volta mesmo que você tenha dito "não salvar")
      const text = st.doc.toString();
      if (!text.trim() || isBlankCanvas(tab, text)) return;
      e.text = text;
    }
    closedStack.push(e);
    if (closedStack.length > 40) closedStack.shift();
  } catch (err) { console.error(err); }
}

async function reopenClosed() {
  while (closedStack.length) {
    const e = closedStack.pop();
    let tab;
    if (e.untitled) {
      tab = newUntitled(e.text, { eol: e.eol, canvas: /\.canvas$/i.test(e.path || '') });
      if (e.groupId && findGroup(e.groupId)) assignTab(tab, e.groupId);
    } else {
      if (!(await api.exists(e.path))) continue; // o arquivo sumiu: tenta a anterior
      tab = tabs.find((t) => t.path === e.path);
      if (tab) { activate(tab); toast('Essa aba já está aberta'); return; }
      await openFile(e.path);
      tab = tabs.find((t) => t.path === e.path);
    }
    if (tab) {
      const len = view.state.doc.length;
      view.dispatch({ selection: { anchor: Math.min(e.sel || 0, len) }, effects: e.top ? EditorView.scrollIntoView(e.top, { y: 'start' }) : [] });
      toast(`Reaberta: ${tabName(tab)}`);
    }
    return;
  }
  toast('Nenhuma aba fechada para reabrir');
}

/* ───────────── lado a lado e comparação ───────────── */
// Abre a aba em um painel novo, à direita do painel focado (se já estiver visível, só foca).
function openBeside(tab) {
  if (paneOf(tab)) { activate(tab); return; }
  const p = createPane(tab, panes.indexOf(focusedPane) + 1);
  if (tab.topPos) p.view.dispatch({ effects: EditorView.scrollIntoView(tab.topPos, { y: 'start' }) });
  activate(tab);
}

// Deixa só o painel focado
function singlePane() {
  while (panes.length > 1) closePane(panes.find((p) => p !== focusedPane));
}

// Mostra as abas lado a lado, na ordem dada (compare = destacar as diferenças em relação à primeira)
function showSideBySide(list, compare) {
  list = list.filter((t) => tabs.includes(t));
  if (list.length < 2) return toast('Escolha pelo menos duas abas');
  singlePane();
  activate(list[0]);
  for (let i = 1; i < list.length; i++) openBeside(list[i]);
  setCompare(compare);
  activate(list[0]);
}

function compareCmd() {
  const sel = [...selectedTabs].filter((t) => tabs.includes(t));
  if (sel.length >= 2) return showSideBySide(sel, true);
  if (tabs.length < 2) return toast('Abra pelo menos duas abas para comparar');
  const items = [];
  for (const { g } of flatGroups()) {
    const ts = tabsOfGroup(g.id);
    if (ts.length >= 2) items.push({ label: `Grupo: ${groupLabel(g.id)}`, detail: `${ts.length} abas lado a lado`, list: ts });
  }
  for (const t of tabs) if (t !== active) items.push({ label: tabName(t), detail: t.untitled ? 'rascunho' : dirName(t.path), list: [active, t] });
  showPalette({
    placeholder: `Comparar "${tabName(active)}" com…  (ou Ctrl+clique em várias abas na lateral)`,
    items: () => items,
    onSelect: (it) => showSideBySide(it.list, true),
  });
}

// Ctrl+K: busca entre as abas abertas (nome, grupo, projeto ou caminho) e entra nela. A lista vem da aba usada
// mais recentemente para a mais antiga e já começa na anterior (Ctrl+K, Enter alterna entre as duas últimas).
function switchTab() {
  if (!tabs.length) return toast('Nenhuma aba aberta');
  const items = [...tabs].sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0)).map((t) => {
    const g = t.groupId && findGroup(t.groupId) ? groupLabel(t.groupId) : '';
    const pr = rootOf(t.path);
    const where = t.untitled ? 'rascunho' : pr ? `${pr.name} › ${relPath(t.path)}` : dirName(t.path);
    return {
      label: (t.dirty ? '● ' : '') + tabName(t),
      detail: [t === active ? 'atual' : '', g, where].filter(Boolean).join('  ·  '),
      search: `${tabName(t)} ${g} ${where} ${t.path}`,
      tab: t,
    };
  });
  showPalette({
    placeholder: `Ir para aba aberta… (${tabs.length})`,
    chord: 'ctrl+k', // com a busca vazia, Ctrl+K + outro atalho (ex.: Ctrl+B) continua funcionando
    startAt: 1,
    items: () => items,
    onSelect: (it) => activate(it.tab),
  });
}

// Notas flutuantes: janelas pequenas, fixáveis no topo (a edição e o salvamento ficam na própria janela da nota)
async function stickyPicker() {
  const list = await api.notesList();
  const title = (t) => (t || '').split('\n').find((l) => l.trim())?.replace(/^[#>\-*\s[\]x]+/i, '').slice(0, 70) || '(vazia)';
  const items = list.map((n) => ({ label: title(n.text), detail: (n.pinned ? '📌 ' : '') + (n.open ? 'aberta' : 'fechada'), search: n.text || '', act: n.id }));
  items.unshift({ label: '+ Nova nota flutuante', detail: '', act: null });
  showPalette({ placeholder: `Notas flutuantes… (${list.length})`, items: () => items, onSelect: (it) => (it.act ? api.notesOpen(it.act) : api.notesNew('')) });
}

function openBesideCmd() {
  const sel = [...selectedTabs].filter((t) => tabs.includes(t) && t !== active);
  if (sel.length) { showSideBySide([active, ...sel], false); return; }
  const others = tabs.filter((t) => !paneOf(t));
  if (!others.length) return toast('Não há outra aba para abrir ao lado');
  showPalette({
    placeholder: 'Abrir ao lado…',
    items: () => others.map((t) => ({ label: tabName(t), detail: t.untitled ? 'rascunho' : dirName(t.path), t })),
    onSelect: (it) => openBeside(it.t),
  });
}

// Colunas (como o Layout do Sublime): 1, 2 ou 3 abas lado a lado a partir da aba atual
function layoutColumns(n) {
  if (!active) return;
  if (n === 1) return singlePane();
  const i = tabs.indexOf(active);
  const list = [active, ...tabs.slice(i + 1), ...tabs.slice(0, i)].slice(0, n);
  if (list.length < n) toast(`Só há ${list.length} aba(s) aberta(s)`);
  showSideBySide(list, false);
}

function diffDeco(state, lines, cls) {
  const ranges = [...lines].filter((n) => n < state.doc.lines).sort((a, b) => a - b)
    .map((n) => Decoration.line({ class: cls }).range(state.doc.line(n + 1).from));
  return Decoration.set(ranges);
}

// Compara cada painel com o da esquerda (a referência) e colore as linhas diferentes
function refreshDiff() {
  if (!compareOn || panes.length < 2) return;
  const ref = panes[0];
  const refLines = ref.view.state.doc.toString().split('\n');
  const refDel = new Set();
  const jobs = [];
  for (const p of panes.slice(1)) {
    const { delA, addB } = diffLines(refLines, p.view.state.doc.toString().split('\n'));
    delA.forEach((i) => refDel.add(i));
    p.diff = addB;
    jobs.push([p, addB]);
  }
  ref.diff = refDel;
  ref.view.dispatch({ effects: setDiff.of(diffDeco(ref.view.state, refDel, 'cm-diff-del')) });
  for (const [p, set] of jobs) p.view.dispatch({ effects: setDiff.of(diffDeco(p.view.state, set, 'cm-diff-add')) });
  renderCompareBar();
}
let diffTimer;
function scheduleDiff() { clearTimeout(diffTimer); diffTimer = setTimeout(refreshDiff, 250); }

function setCompare(on) {
  compareOn = on && panes.length > 1;
  if (compareOn) refreshDiff();
  else for (const p of panes) { p.diff = null; p.view.dispatch({ effects: setDiff.of(Decoration.none) }); }
  renderCompareBar();
  persist();
}

// F7 / Shift+F7: vai para o início do próximo / anterior bloco de diferenças do painel focado
function gotoDiff(dir) {
  const p = focusedPane;
  if (!compareOn || !p || !p.diff || !p.diff.size) return toast('Nada para comparar (ou sem diferenças)');
  const starts = [...p.diff].filter((i) => !p.diff.has(i - 1)).sort((a, b) => a - b);
  const cur = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const next = dir > 0 ? starts.find((i) => i > cur) ?? starts[0] : [...starts].reverse().find((i) => i < cur) ?? starts[starts.length - 1];
  goLine(next + 1);
}

// Rolagem sincronizada: os outros painéis acompanham, na mesma proporção
// Cada painel que é ajustado por causa de outro guarda a posição pedida (syncTarget). Quando o evento de rolagem
// chega e bate com ela, é só o "eco" do nosso ajuste e é ignorado; qualquer outra rolagem (do usuário) manda.
function onPaneScroll(p) {
  const sd = p.view.scrollDOM;
  if (p.syncTarget != null) {
    const echo = Math.abs(sd.scrollTop - p.syncTarget) <= 2;
    p.syncTarget = null;
    if (echo) return;
  }
  if (!syncOn || panes.length < 2 || !compareOn) return;
  const max = sd.scrollHeight - sd.clientHeight;
  const ratio = max > 0 ? sd.scrollTop / max : 0;
  for (const q of panes) {
    if (q === p) continue;
    const qd = q.view.scrollDOM;
    const target = Math.round(ratio * Math.max(0, qd.scrollHeight - qd.clientHeight));
    if (Math.abs(qd.scrollTop - target) <= 1) continue;
    const before = qd.scrollTop;
    qd.scrollTop = target;
    q.syncTarget = qd.scrollTop === before ? null : qd.scrollTop; // se nada mudou, não virá evento
  }
}

function renderCompareBar() {
  const bar = $('compareBar');
  const show = compareOn && panes.length > 1;
  bar.hidden = !show;
  if (!show) return;
  bar.textContent = '';
  const total = panes.slice(1).reduce((n, p) => n + (p.diff ? p.diff.size : 0), 0);
  bar.append(el('span', 'cb-title', `Comparando ${panes.length} abas · ${total} diferença(s)`));
  bar.append(el('span', 'cb-leg del', `só em ${panes[0].tab ? tabName(panes[0].tab) : 'ref.'}`), el('span', 'cb-leg add', 'só nas outras'));
  const btn = (label, fn, title) => { const b = el('button', null, label); b.onclick = fn; if (title) b.title = title; bar.append(b); };
  btn('↑ Anterior', () => gotoDiff(-1), 'Shift+F7');
  btn('↓ Próxima', () => gotoDiff(1), 'F7');
  const lab = el('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = syncOn;
  cb.onchange = () => { syncOn = cb.checked; };
  lab.append(cb, ' Rolagem sincronizada');
  bar.append(lab);
  btn('Sair da comparação', () => setCompare(false), 'mantém os painéis lado a lado');
}

// Cabeçalhos dos painéis (só aparecem quando há mais de um) e destaque do painel focado
function renderPanes() {
  const multi = panes.length > 1;
  $('editor').classList.toggle('multi', multi);
  for (const p of panes) {
    p.el.classList.toggle('focus', p === focusedPane);
    p.nm.textContent = p.tab ? tabName(p.tab) + (p.tab.dirty ? ' ●' : '') : '';
  }
  renderCompareBar();
}

function goLine(n) {
  const doc = view.state.doc;
  const pos = doc.line(Math.max(1, Math.min(n, doc.lines))).from;
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}

// Pergunta se quer salvar antes de fechar. Retorna true se pode fechar.
async function confirmClose(tab) {
  if (!tab.dirty) return true;
  const r = await askT(`Salvar alterações em "${tabName(tab)}"?`, ['Salvar', 'Não salvar', 'Cancelar']);
  if (r === 0) return saveTab(tab);
  return r === 1;
}

// Menor número livre entre os "Sem título" abertos (fechou o 1? o próximo novo volta a ser o 1).
function nextUntitledName(canvas = false) {
  const [pre, ext] = canvas ? ['Canvas', 'canvas'] : ['Sem título', settings.newTabType === 'txt' ? 'txt' : 'md']; // padrão das novas guias (Configurações → Tipo das novas guias)
  let n = 1;
  while (tabs.some((t) => t.path === `${pre} ${n}.${ext}`)) n++;
  return `${pre} ${n}.${ext}`;
}
const CANVAS_EMPTY = '{\n  "nodes": [],\n  "edges": []\n}\n';
const isBlankCanvas = (t, text) => /\.canvas$/i.test(t.path || '') && text.replace(/\s+/g, '') === '{"nodes":[],"edges":[]}';
function newUntitled(text = '', opts = {}) {
  const tab = { path: nextUntitledName(!!opts.canvas), state: makeState(text), dirty: !!text && !(opts.canvas && text.replace(/\s+/g, '') === '{"nodes":[],"edges":[]}'), lang: '', untitled: true, enc: 'utf8', eol: opts.eol || 'lf' };
  tabs.push(tab);
  activate(tab);
  setLanguage(tab);
  return tab;
}

// Nome mostrado na aba: arquivo sem título usa a 1ª linha (como o Sublime), senão o nome do arquivo.
function tabName(t) {
  if (t.srv) return (t.srv.canvas ? '▦ ' : '☁ ') + (t.srv.title || (t.srv.canvas ? 'Canvas' : 'Nota'));
  if (!t.untitled) return baseName(t.path);
  if (/\.canvas$/i.test(t.path)) return baseName(t.path).replace(/\.canvas$/i, '');
  const st = stateOf(t);
  const first = st.doc.line(1).text.replace(/^#+\s*/, '').trim();
  return first ? first.slice(0, 40) : baseName(t.path);
}

// Fecha abas sem perguntar (arquivo apagado/movido).
function dropTabs(pred, remember = false) {
  const gone = tabs.filter(pred);
  if (!gone.length) return;
  if (remember) gone.forEach(rememberClosed);
  for (const t of gone) {
    tabs.splice(tabs.indexOf(t), 1);
    const p = paneOf(t);
    if (p) { p.tab = null; if (panes.length > 1) closePane(p); }
  }
  if (!active || !tabs.includes(active)) {
    active = null;
    const cand = focusedPane.tab && tabs.includes(focusedPane.tab) ? focusedPane.tab : tabs[tabs.length - 1];
    if (cand) return activate(cand);
    $('editor').hidden = true; $('welcome').hidden = false; $('preview').hidden = true;
    renderTree(); updateStatus(); renderRight();
  }
  renderTabs(); persist();
}

async function closeTab(tab = active) {
  if (!tab) return;
  if (!(await confirmClose(tab))) return;
  if (!tabs.includes(tab)) return;
  if (scOf(tab)) scRelease(tab);
  rememberClosed(tab); // Ctrl+Shift+T reabre
  const i = tabs.indexOf(tab);
  const p = paneOf(tab);
  tabs.splice(i, 1);
  if (p && panes.length > 1) { // estava num painel lado a lado: fecha o painel
    p.tab = null;
    closePane(p);
    renderTabs(); persist();
    return;
  }
  if (tab === active) {
    active = null;
    if (p) p.tab = null;
    const next = tabs[Math.min(i, tabs.length - 1)];
    if (next) return activate(next);
    $('editor').hidden = true;
    $('welcome').hidden = false;
    $('preview').hidden = true;
    renderPanes(); renderTabs(); renderTree(); updateStatus(); renderRight(); persist();
  } else {
    renderTabs(); persist();
  }
}

function renderTabs() {
  const box = $('tabs');
  box.textContent = '';
  for (const t of tabs) {
    const d = el('div', 'tab' + (t === active ? ' active' : ''));
    d.append(el('span', null, tabName(t)));
    t._lbl = tabName(t);
    if (t.dirty) d.append(el('span', 'dot', '●'));
    const x = el('span', 'x', '×');
    x.onclick = (e) => { e.stopPropagation(); closeTab(t); };
    d.append(x);
    d.onclick = () => activate(t);
    d.onauxclick = (e) => { if (e.button === 1) closeTab(t); };
    d.draggable = true; // arrastar para reordenar também na barra de cima
    d.ondragstart = (e) => { e.dataTransfer.setData('text/tt-tab', t.path); e.dataTransfer.effectAllowed = 'move'; };
    d.ondragover = (e) => {
      if (!Array.from(e.dataTransfer.types).includes('text/tt-tab')) return;
      e.preventDefault();
      const r = d.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      d.classList.toggle('drop-before', before); d.classList.toggle('drop-after', !before);
    };
    d.ondragleave = () => d.classList.remove('drop-before', 'drop-after');
    d.ondrop = (e) => {
      if (!Array.from(e.dataTransfer.types).includes('text/tt-tab')) return;
      e.preventDefault(); e.stopPropagation();
      const before = d.classList.contains('drop-before');
      d.classList.remove('drop-before', 'drop-after');
      const src = tabs.find((x) => x.path === e.dataTransfer.getData('text/tt-tab'));
      if (src && src !== t) moveTab(src, t, before);
    };
    d.title = t.path;
    box.append(d);
  }
  syncCanvas();
  renderOpenFiles();
  renderPanes(); // nomes e ● nos cabeçalhos dos painéis
  renderTree(); // atualiza o ● de "não salvo" no projeto
  scheduleDrafts();
}

/* ───────────── rascunhos e alterações não salvas (hot exit) ───────────── */
// Abas sem título com texto e arquivos com alterações pendentes são gravados na pasta de dados do app
// (a cada pausa na digitação) e restaurados ao abrir, como o Sublime faz.
let draftsReady = false; // só grava depois de restaurar, para não apagar os rascunhos antes de lê-los
let draftTimer;
function currentDrafts() {
  const out = [];
  for (const t of tabs) {
    const st = stateOf(t);
    const text = st.doc.toString();
    const base = { text, eol: t.eol, enc: t.enc, sel: st.selection.main.head };
    if (t.untitled) { if (text.trim() && !isBlankCanvas(t, text)) out.push({ kind: 'untitled', name: t.path, groupId: t.groupId || null, ...base }); }
    else if (t.dirty) out.push({ kind: 'file', path: t.path, ...base });
  }
  // "meta": o resto da sessão (ordem das abas, aba ativa, cursor e rolagem de cada uma, painéis, grupos),
  // para reabrir tudo exatamente como estava
  const views = {};
  for (const t of tabs) {
    const st = stateOf(t);
    const v = viewOf(t);
    views[tabKey(t)] = { sel: st.selection.main.head, top: v ? topPos(v) : t.topPos || 0 };
  }
  out.unshift({
    kind: 'meta', tree: groups, assign: groupAssign, order: tabs.map(tabKey), active: active ? tabKey(active) : null, views,
    ui: { sidebar: !$('sidebar').hidden, right: !$('right').hidden, preview: !$('preview').hidden },
    // painéis lado a lado (e se estava comparando), para voltar igual
    panes: panes.map((p) => (p.tab ? tabKey(p.tab) : null)).filter(Boolean), compare: compareOn,
  });
  return out;
}
async function saveDrafts() {
  if (!draftsReady) return;
  try { await api.draftsSave(currentDrafts()); } catch (e) { console.error(e); }
}
function scheduleDrafts() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDrafts, 1200);
}

/* ───────────── grupos de abas (organização virtual, com subgrupos) ───────────── */
// Servem só para organizar as abas abertas, como pastas virtuais. Ao salvar, as pastas são criadas conforme os grupos.
const groups = []; // { id, name, children: [...], collapsed }
let groupAssign = {}; // caminho do arquivo -> id do grupo (lembrado entre sessões)
const newGid = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Grupo';

function findGroup(id, list = groups, parent = null) {
  for (const g of list) {
    if (g.id === id) return { node: g, parent, siblings: list };
    const r = findGroup(id, g.children, g);
    if (r) return r;
  }
  return null;
}
// ["Clientes", "Alinare"] para o grupo "Alinare" dentro de "Clientes"
function groupNames(id) {
  const walk = (list, trail) => {
    for (const g of list) {
      const t = [...trail, g.name];
      if (g.id === id) return t;
      const r = walk(g.children, t);
      if (r) return r;
    }
    return null;
  };
  return walk(groups, []) || [];
}
const groupLabel = (id) => groupNames(id).join(' / ');
function flatGroups(list = groups, depth = 0, out = []) {
  for (const g of list) { out.push({ g, depth }); flatGroups(g.children, depth + 1, out); }
  return out;
}
function descendantIds(id) {
  const out = [];
  (function w(g) { out.push(g.id); g.children.forEach(w); })(findGroup(id).node);
  return out;
}
const tabsOfGroup = (id) => { const ids = descendantIds(id); return tabs.filter((t) => t.groupId && ids.includes(t.groupId)); };

function assignTab(tab, id) {
  if (id) tab.groupId = id; else delete tab.groupId;
  if (!tab.untitled) { if (id) groupAssign[tab.path] = id; else delete groupAssign[tab.path]; }
  persist();
  renderOpenFiles();
}

// "Clientes/Alinare" cria o grupo e o subgrupo de uma vez
function newGroup(parentId = null, tab = null) {
  showPalette({
    placeholder: parentId ? `Novo subgrupo em "${groupLabel(parentId)}"…  (use / para criar vários níveis)` : 'Nome do novo grupo…  (use / para subgrupos: Clientes/Alinare)',
    onFree: (name) => {
      const parts = name.split(/[\\/]/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return;
      let list = parentId ? findGroup(parentId).node.children : groups;
      if (parentId) findGroup(parentId).node.collapsed = false;
      let g;
      for (const part of parts) {
        g = list.find((x) => x.name.toLowerCase() === part.toLowerCase());
        if (!g) { g = { id: newGid(), name: part, children: [], collapsed: false }; list.push(g); }
        g.collapsed = false;
        list = g.children;
      }
      if (tab) assignTab(tab, g.id); else { persist(); renderOpenFiles(); }
    },
  });
}

function renameGroup(id) {
  const f = findGroup(id);
  showPalette({
    placeholder: 'Novo nome do grupo…',
    initial: f.node.name,
    onFree: (name) => {
      name = name.trim();
      if (!name) return;
      f.node.name = name;
      persist();
      renderOpenFiles();
    },
  });
}

async function deleteGroup(id, force = false) {
  const f = findGroup(id);
  const n = tabsOfGroup(id).length;
  const sub = f.node.children.length ? ' e seus subgrupos' : '';
  if (!force) {
    const r = await askT(`Excluir o grupo "${f.node.name}"${sub}?\n\nAs ${n} aba(s) não serão fechadas: voltam para "sem grupo". Nenhum arquivo é apagado.`, ['Excluir grupo', 'Cancelar']);
    if (r !== 0) return;
  }
  const ids = descendantIds(id);
  for (const t of tabs) if (t.groupId && ids.includes(t.groupId)) assignTab(t, null);
  for (const k of Object.keys(groupAssign)) if (ids.includes(groupAssign[k])) delete groupAssign[k];
  f.siblings.splice(f.siblings.indexOf(f.node), 1);
  persist();
  renderOpenFiles();
}

async function closeGroupTabs(id) {
  const mine = tabsOfGroup(id);
  if (!(await confirmUnsaved(mine.filter((t) => t.dirty), `O grupo "${findGroup(id).node.name}"`))) return;
  dropTabs((t) => mine.includes(t));
}

// Escolher o grupo de uma aba (ou criar um novo / tirar do grupo)
function groupTabPalette(tab = active) {
  if (!tab) return toast('Abra uma aba para agrupar');
  const items = [
    { label: '＋ Novo grupo…', act: () => newGroup(null, tab) },
    { label: '＋ Novo subgrupo em…', act: () => pickGroup('Em qual grupo criar o subgrupo?', (id) => newGroup(id, tab)) },
  ];
  if (tab.groupId) items.push({ label: '✕ Tirar do grupo', act: () => assignTab(tab, null) });
  for (const { g } of flatGroups()) items.push({ label: groupLabel(g.id), detail: `${tabsOfGroup(g.id).length} aba(s)`, act: () => assignTab(tab, g.id) });
  showPalette({ placeholder: 'Mover a aba para o grupo…', items: () => items, onSelect: (it) => it.act() });
}
function pickGroup(placeholder, cb) {
  if (!groups.length) return toast('Ainda não há grupos');
  showPalette({
    placeholder,
    items: () => flatGroups().map(({ g }) => ({ label: groupLabel(g.id), detail: `${tabsOfGroup(g.id).length} aba(s)`, id: g.id })),
    onSelect: (it) => cb(it.id),
  });
}

// Base onde as pastas dos grupos serão criadas. Retorna a pasta, '' (usar "Salvar como…") ou null (cancelar).
async function groupSaveBase(label, allowDialog) {
  let base = root || localStorage.getItem('tt.groupBase') || null;
  for (;;) {
    if (!base) { base = await api.pickFolder(); if (!base) return null; }
    const buttons = ['Salvar aqui', 'Outra pasta base…', ...(allowDialog ? ['Salvar como…'] : []), 'Cancelar'];
    const r = await askT(`${label}\n\nPasta base: ${base}\n(as pastas do grupo são criadas dentro dela)`, buttons);
    if (r === 0) { try { localStorage.setItem('tt.groupBase', base); } catch {} return base; }
    if (r === 1) { const p = await api.pickFolder(); if (p) base = p; continue; }
    return allowDialog && r === 2 ? '' : null;
  }
}
// Nome livre na pasta: "Nota.md", "Nota (2).md"…
async function uniquePath(dir, file) {
  const ext = (file.match(/\.[^.]+$/) || [''])[0];
  const name = file.slice(0, file.length - ext.length);
  let p = joinPath(dir, file), n = 2;
  while (await api.exists(p)) p = joinPath(dir, `${name} (${n++})${ext}`);
  return p;
}

// Salva o grupo todo: abas sem título viram arquivos em pastas = hierarquia dos grupos; arquivos já salvos com alterações são gravados no lugar.
async function saveGroup(id, baseDir = null) {
  const f = findGroup(id);
  if (!f) return;
  const mine = tabsOfGroup(id);
  const drafts = mine.filter((t) => t.untitled);
  const dirty = mine.filter((t) => !t.untitled && t.dirty);
  if (!drafts.length && !dirty.length) return toast(`Nada para salvar no grupo "${f.node.name}"`);
  let base = baseDir;
  if (drafts.length && !base) {
    base = await groupSaveBase(`Salvar ${drafts.length} aba(s) do grupo "${groupLabel(id)}"`, false);
    if (!base) return;
  }
  let saved = 0;
  for (const t of drafts) {
    const dir = joinPath(base, ...groupNames(t.groupId).map(safeName));
    const p = await uniquePath(dir, safeName(tabName(t)) + (/\.txt$/i.test(t.path) ? '.txt' : '.md'));
    if (await saveTab(t, false, p)) { saved++; expanded.add(dir); }
  }
  for (const t of dirty) if (await saveTab(t)) saved++;
  if (drafts.length) await loadWorkspace(base); // mostra as pastas criadas (abre como projeto se ainda não for)
  toast(`Grupo "${f.node.name}": ${saved} arquivo(s) salvo(s)` + (drafts.length ? ` em ${base}` : ''));
}

// Seção "Arquivos abertos" da barra lateral (como no Sublime), agora com grupos e subgrupos
// Muda a ordem das abas (e o grupo, se soltar numa aba de outro grupo); a ordem fica lembrada
function moveTab(src, dst, before) {
  const i = tabs.indexOf(src);
  tabs.splice(i, 1);
  let j = tabs.indexOf(dst);
  if (!before) j++;
  tabs.splice(j, 0, src);
  if ((src.groupId || null) !== (dst.groupId || null)) assignTab(src, dst.groupId || null);
  else { persist(); renderOpenFiles(); renderTabs(); }
}

function renderOpenFiles() {
  const box = $('openFiles');
  box.textContent = '';
  for (const t of [...selectedTabs]) if (!tabs.includes(t)) selectedTabs.delete(t);
  const tabRow = (t, depth) => {
    const row = el('div', 'row' + (t === active ? ' active' : ''));
    row.style.paddingLeft = 8 + depth * 14 + 'px';
    const name = el('span', null, tabName(t));
    if (t.dirty) name.prepend(el('span', 'dot', '●'));
    const pr = rootOf(t.path);
    // fora de qualquer projeto: mostra a pasta onde o arquivo está (ex.: "Desktop")
    if (pr ? roots.length > 1 : !t.untitled && !t.srv) name.append(el('span', 'dim', ' · ' + (pr ? pr.name : baseName(dirName(t.path)))));
    const x = el('span', 'x', '×');
    x.onclick = (e) => { e.stopPropagation(); closeTab(t); };
    row.append(name, x);
    if (selectedTabs.has(t)) row.classList.add('sel');
    if (paneOf(t)) row.classList.add('inpane'); // aberta num painel (lado a lado)
    row.onclick = (e) => {
      if (e.ctrlKey || e.metaKey) { // Ctrl+clique: marca/desmarca para comparar ou abrir lado a lado
        if (!selectedTabs.size && active && active !== t) selectedTabs.add(active); // a aba atual já conta como selecionada
        if (selectedTabs.has(t)) selectedTabs.delete(t); else selectedTabs.add(t);
        lastClickedTab = t;
        renderOpenFiles();
        return;
      }
      if (e.shiftKey && lastClickedTab && tabs.includes(lastClickedTab)) { // Shift+clique: seleciona o intervalo
        const order = [...box.querySelectorAll('.row[data-tab]')].map((r) => tabs.find((x2) => x2.path === r.dataset.tab));
        const a = order.indexOf(lastClickedTab);
        const b = order.indexOf(t);
        if (a >= 0 && b >= 0) { for (const t2 of order.slice(Math.min(a, b), Math.max(a, b) + 1)) if (t2) selectedTabs.add(t2); renderOpenFiles(); return; }
      }
      selectedTabs.clear();
      lastClickedTab = t;
      activate(t);
    };
    row.onmousedown = (e) => { if (e.button === 1) e.preventDefault(); }; // evita o "rolar" do botão do meio
    row.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } }; // botão do meio fecha a aba
    row.title = t.groupId ? `${groupLabel(t.groupId)}\n${t.path}` : t.path;
    row.dataset.tab = t.path;
    row.draggable = true;
    row.ondragstart = (e) => { e.dataTransfer.setData('text/tt-tab', t.path); e.dataTransfer.effectAllowed = 'move'; };
    // soltar em cima de outra aba: entra antes (metade de cima) ou depois (metade de baixo) dela, no grupo dela
    row.ondragover = (e) => {
      if (!Array.from(e.dataTransfer.types).includes('text/tt-tab')) return;
      e.preventDefault(); e.stopPropagation();
      const r = row.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      row.classList.toggle('drop-before', before); row.classList.toggle('drop-after', !before);
    };
    row.ondragleave = () => row.classList.remove('drop-before', 'drop-after');
    row.ondrop = (e) => {
      if (!Array.from(e.dataTransfer.types).includes('text/tt-tab')) return;
      e.preventDefault(); e.stopPropagation();
      const before = row.classList.contains('drop-before');
      row.classList.remove('drop-before', 'drop-after');
      const src = tabs.find((x) => x.path === e.dataTransfer.getData('text/tt-tab'));
      if (src && src !== t) moveTab(src, t, before);
    };
    return row;
  };
  const hasTab = (e) => Array.from(e.dataTransfer.types).includes('text/tt-tab');
  const renderGroup = (g, depth) => {
    const mine = tabsOfGroup(g.id);
    const head = el('div', 'row grp');
    head.style.paddingLeft = 8 + depth * 14 + 'px';
    head.dataset.gid = g.id;
    head.title = groupLabel(g.id);
    head.append(el('span', 'tw', g.collapsed ? '▸' : '▾'), el('span', 'rn', g.name), el('span', 'dim cnt', String(mine.length)));
    if (mine.some((t) => t.dirty)) head.append(el('span', 'dot', '●'));
    head.onclick = () => { g.collapsed = !g.collapsed; persist(); renderOpenFiles(); };
    head.ondragover = (e) => { if (hasTab(e)) { e.preventDefault(); head.classList.add('drop'); } };
    head.ondragleave = () => head.classList.remove('drop');
    head.ondrop = (e) => {
      if (!hasTab(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const t = tabs.find((x) => x.path === e.dataTransfer.getData('text/tt-tab'));
      g.collapsed = false;
      if (t) assignTab(t, g.id); else renderOpenFiles();
    };
    box.append(head);
    if (g.collapsed) return;
    for (const c of g.children) renderGroup(c, depth + 1);
    for (const t of tabs.filter((x) => x.groupId === g.id && !x.srv)) box.append(tabRow(t, depth + 1));
  };
  for (const g of groups) renderGroup(g, 0);
  const loose = tabs.filter((t) => !t.srv && (!t.groupId || !findGroup(t.groupId)));
  if (groups.length && loose.length) box.append(el('div', 'empty-s', 'Sem grupo'));
  for (const t of loose) box.append(tabRow(t, 0));
  const shown = tabs.filter((t) => !t.srv);
  if (!shown.length && !groups.length) box.append(el('div', 'empty-s', 'Nenhum arquivo aberto'));
  $('openCount').textContent = shown.length ? `(${shown.length})` : '';
}

// Retorna true se salvou. Arquivo sem título abre "Salvar como…" (começa na pasta do projeto).
async function saveTab(tab = active, forceAs = false, toPath = null) {
  if (!tab || !tabs.includes(tab)) return false;
  if (tab.srv) return true; // nota compartilhada: o servidor guarda tudo na hora
  const text = stateOf(tab).doc.toString();
  // preserva a codificação e a quebra de linha originais do arquivo
  const out = tab.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  const write = async (p) => {
    const want = tab.enc || 'utf8';
    const used = await api.write(p, out, want);
    if (used !== want) { tab.enc = used; toast('Há caracteres que não existem em Windows-1252: salvei em UTF-8'); }
  };
  if (tab.untitled || forceAs) {
    // arquivo sem título: sugere o nome pela 1ª linha (ex.: "Bling - Dados.md")
    const suggested = tab.untitled && /\.canvas$/i.test(tab.path) ? baseName(tab.path) : tab.untitled ? (tabName(tab).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Sem título') + (/\.txt$/i.test(tab.path) ? '.txt' : '.md') : tab.path;
    let p = toPath;
    let groupBase = null;
    // aba dentro de um grupo: oferece salvar nas pastas do grupo (criadas se não existirem)
    if (!p && tab.untitled && tab.groupId && findGroup(tab.groupId)) {
      const b = await groupSaveBase(`Salvar "${tabName(tab)}" do grupo "${groupLabel(tab.groupId)}"`, true);
      if (b === null) return false;
      if (b) { groupBase = b; p = await uniquePath(joinPath(b, ...groupNames(tab.groupId).map(safeName)), suggested); }
    }
    if (!p) p = await api.saveAs(tab.untitled && root ? joinPath(root, suggested) : suggested);
    if (!p) return false;
    await write(p);
    if (tab.groupId) groupAssign[p] = tab.groupId; // continua no mesmo grupo depois de salvo
    const existing = tabs.find((t) => t !== tab && t.path === p);
    if (existing) dropTabs((t) => t === existing);
    tab.path = p;
    tab.untitled = false;
    tab.dirty = false;
    setLanguage(tab);
    if (toPath) { /* salvando o grupo todo: quem chamou atualiza a lista uma vez só */ }
    else if (groupBase && !rootOf(p)) { expanded.add(dirName(p)); await loadWorkspace(groupBase); } // abre a pasta base para mostrar os grupos criados
    else if (rootOf(p)) { expanded.add(dirName(p)); await loadWorkspace(rootOf(p).path); }
    else toast('Salvo fora da pasta do projeto: ' + p);
    renderTabs();
    persist();
    return true;
  }
  await write(tab.path);
  tab.dirty = false;
  renderTabs();
  updateStatus();
  if (tab.path === settingsPath) await loadSettings();
  else if (isMd(tab.path)) { updateIndexFor(tab.path, text); renderRight(); }
  toast('Salvo: ' + baseName(tab.path));
  return true;
}

function cycleTab(d) {
  if (tabs.length < 2) return;
  activate(tabs[(tabs.indexOf(active) + d + tabs.length) % tabs.length]);
}

function persist() {
  try {
    localStorage.setItem('tt.session', JSON.stringify({ roots: roots.map((r) => r.path), root, collapsed: [...collapsedRoots], files: tabs.filter((t) => !t.untitled && !t.srv).map((t) => t.path), active: active && !active.srv ? active.path : undefined }));
    localStorage.setItem('tt.groups', JSON.stringify({ tree: groups, assign: groupAssign }));
  } catch {}
  scheduleDrafts();
}

/* ───────────── workspace / índice ───────────── */
function flatten(node, out) {
  for (const c of node.children || []) {
    if (c.dir) flatten(c, out);
    else out.push({ path: c.path, rel: relPath(c.path), name: stem(c.path) });
  }
  return out;
}

function updateIndexFor(path, text) {
  const p = parseNote(text);
  idx.links.set(path, p.links);
  idx.tags.set(path, p.tags);
  idx.aliases.set(path, p.aliases);
  const f = idx.files.find((x) => x.path === path);
  if (f) for (const a of p.aliases) if (!idx.byName.has(a.toLowerCase())) idx.byName.set(a.toLowerCase(), f);
}

async function loadRoot(path) {
  let r = roots.find((x) => x.path === path);
  if (!r) { r = { path, name: baseName(path), tree: null }; roots.push(r); }
  r.tree = await api.tree(path);
}

// Com uma pasta: abre como projeto (ou recarrega, se já estiver aberta/dentro de um projeto aberto) e a torna a atual.
// Sem argumento: recarrega todos os projetos abertos.
async function loadWorkspace(p) {
  if (p) {
    const target = rootOf(p)?.path ?? p;
    await loadRoot(target);
    root = target;
    pushRecentFolder(target);
  } else {
    await Promise.all(roots.map((r) => loadRoot(r.path)));
  }
  await rebuildIndex();
}

async function rebuildIndex() {
  idx.files = roots.flatMap((r) => flatten(r.tree, []));
  for (const f of idx.files) f.label = relLabel(f.path);
  idx.byName.clear();
  for (const f of idx.files) if (isMd(f.path) && !idx.byName.has(f.name.toLowerCase())) idx.byName.set(f.name.toLowerCase(), f);
  idx.links.clear();
  idx.tags.clear();
  idx.aliases.clear();
  for (const r of roots) for (const n of await api.mdAll(r.path)) updateIndexFor(n.path, n.text); // inclui apelidos (aliases)
  renderTree();
  renderRight();
  renderTabs();
  persist();
}

/* ───────────── arquivos soltos (fora de projetos) ───────────── */
const ENC_NAMES = { utf8: 'UTF-8', utf8bom: 'UTF-8 com BOM', win1252: 'Windows-1252', utf16le: 'UTF-16 LE' };

function pushRecent(p) {
  try {
    const list = JSON.parse(localStorage.getItem('tt.recent') || '[]').filter((x) => x !== p);
    list.unshift(p);
    localStorage.setItem('tt.recent', JSON.stringify(list.slice(0, 40)));
  } catch {}
}

// Abre um arquivo (em aba) ou uma pasta (como projeto).
async function openPath(p) {
  if (await api.isDir(p)) await loadWorkspace(p); else await openFile(p);
}

async function openFilesDialog() {
  for (const p of await api.openFilesDialog()) await openPath(p);
}

function openRecent() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('tt.recent') || '[]'); } catch {}
  if (!list.length) return toast('Nenhum arquivo recente ainda');
  showPalette({
    placeholder: 'Abrir arquivo recente…',
    items: () => list.map((p) => ({ label: baseName(p), detail: dirName(p), path: p })),
    onSelect: (it) => openFile(it.path),
  });
}

// Codificação e quebra de linha do arquivo atual
function pickEncoding() {
  if (!active) return;
  const tab = active;
  const items = [];
  if (!tab.untitled) {
    for (const e of ['utf8', 'win1252', 'utf16le']) items.push({ label: `Reabrir com ${ENC_NAMES[e]}`, detail: 'se os acentos estiverem errados', act: () => reopenWith(tab, e) });
  }
  for (const e of ['utf8', 'utf8bom', 'win1252', 'utf16le']) items.push({ label: `Gravar em ${ENC_NAMES[e]}`, detail: tab.enc === e ? 'atual' : '', act: () => { tab.enc = e; tab.dirty = true; renderTabs(); updateStatus(); } });
  items.push({ label: 'Quebra de linha: CRLF (Windows)', detail: tab.eol === 'crlf' ? 'atual' : '', act: () => { tab.eol = 'crlf'; tab.dirty = true; renderTabs(); updateStatus(); } });
  items.push({ label: 'Quebra de linha: LF', detail: tab.eol !== 'crlf' ? 'atual' : '', act: () => { tab.eol = 'lf'; tab.dirty = true; renderTabs(); updateStatus(); } });
  showPalette({ placeholder: 'Codificação / quebra de linha…', items: () => items, onSelect: (it) => it.act() });
}

async function reopenWith(tab, enc) {
  if (tab.dirty && (await askT('Reabrir descarta as alterações não salvas deste arquivo. Continuar?', ['Reabrir', 'Cancelar'])) !== 0) return;
  const r = await api.readFile(tab.path, enc);
  applyTo(tab, { changes: { from: 0, to: stateOf(tab).doc.length, insert: r.text } });
  tab.enc = r.enc;
  tab.eol = r.eol;
  tab.dirty = false;
  renderTabs();
  updateStatus();
}

// Adiciona uma pasta como projeto (não fecha os outros).
async function pickFolder() {
  const r = await api.pickFolder();
  if (r) await loadWorkspace(r);
}

// Se houver arquivos com alterações, pergunta uma vez: Salvar tudo / Fechar sem salvar / Cancelar.
async function confirmUnsaved(list, subject) {
  if (!list.length) return true;
  const names = list.slice(0, 8).map((t) => '• ' + tabName(t)).join('\n') + (list.length > 8 ? `\n… e mais ${list.length - 8}` : '');
  const r = await askT(`${subject} tem ${list.length} arquivo(s) com alterações não salvas:\n\n${names}\n\nO que deseja fazer?`, ['Salvar tudo', 'Fechar sem salvar', 'Cancelar']);
  if (r === 0) {
    for (const t of list) if (!(await saveTab(t))) return false;
    return true;
  }
  return r === 1;
}

async function closeProject(path) {
  const r = roots.find((x) => x.path === path);
  if (!r) return;
  const mine = tabs.filter((t) => !t.untitled && t.path.startsWith(r.path + api.sep));
  if (!(await confirmUnsaved(mine.filter((t) => t.dirty), `O projeto "${r.name}"`))) return;
  dropTabs((t) => mine.includes(t));
  roots.splice(roots.indexOf(r), 1);
  collapsedRoots.delete(path);
  if (root === path) root = roots.length ? roots[roots.length - 1].path : null;
  await rebuildIndex();
}

function renderTree() {
  const box = $('tree');
  box.textContent = '';
  $('projCount').textContent = roots.length ? `(${roots.length})` : '';
  if (!roots.length) {
    box.append(el('div', 'empty', 'Nenhum projeto aberto.\nUse o menu Arquivo → "Novo projeto…" para criar ou "Adicionar pasta como projeto…" para abrir uma pasta.'));
    return;
  }
  const node = (n, depth, r) => {
    const wrap = el('div');
    const row = el('div', 'row' + (n.path === active?.path ? ' active' : ''));
    row.style.paddingLeft = 8 + depth * 14 + 'px';
    row.textContent = (n.dir ? (expanded.has(n.path) ? '▾ ' : '▸ ') : '   ') + n.name;
    row.dataset.path = n.path;
    if (n.dir) row.dataset.dir = '1';
    else { row.draggable = true; row.ondragstart = (e) => { e.dataTransfer.setData('text/tt-file', n.path); e.dataTransfer.effectAllowed = 'copy'; }; } // vira cartão no canvas
    row.onclick = () => {
      root = r.path;
      if (!n.dir) return openFile(n.path);
      if (expanded.has(n.path)) expanded.delete(n.path); else expanded.add(n.path);
      renderTree();
    };
    wrap.append(row);
    if (n.dir && expanded.has(n.path)) for (const c of n.children) wrap.append(node(c, depth + 1, r));
    return wrap;
  };
  for (const r of roots) {
    const open = !collapsedRoots.has(r.path);
    const head = el('div', 'row root' + (r.path === root ? ' cur' : ''));
    head.dataset.path = r.path;
    head.dataset.dir = '1';
    head.dataset.root = '1';
    head.title = r.path;
    head.append(el('span', 'tw', open ? '▾' : '▸'), el('span', 'rn', r.name));
    if (tabs.some((t) => !t.untitled && t.dirty && t.path.startsWith(r.path + api.sep))) head.append(el('span', 'dot', '●'));
    const x = el('span', 'x', '×');
    x.title = 'Fechar projeto';
    x.onclick = (e) => { e.stopPropagation(); closeProject(r.path); };
    head.append(x);
    head.onclick = () => {
      root = r.path;
      if (open) collapsedRoots.add(r.path); else collapsedRoots.delete(r.path);
      renderTree();
      persist();
    };
    box.append(head);
    if (open) for (const c of r.tree.children) box.append(node(c, 1, r));
  }
}
function renderSharedTree() {
  const box = $('sharedTree');
  box.textContent = '';
  shared.renderTree(box);
  const n = shared.totalUnread(); const mm = shared.totalMine();
  $('sharedCount').textContent = shared.count() ? (n ? `(${n} não lido${n > 1 ? 's' : ''}${mm ? ` · ${mm} para você` : ''})` : `(${shared.count()})`) : '';
}

/* ───────────── painel direito (backlinks) ───────────── */
function renderRight() {
  const box = $('right');
  if (box.hidden) return;
  box.textContent = '';
  if (!active || !isMd(active.path)) { box.append(el('h4', null, 'Sem nota ativa')); return; }
  const name = stem(active.path).toLowerCase();
  const section = (title, items) => {
    box.append(el('h4', null, `${title} (${items.length})`));
    for (const it of items) {
      const r = el('div', 'row' + (it.dim ? ' dim' : ''), it.label);
      r.onclick = it.click;
      box.append(r);
    }
  };
  const back = idx.files.filter((f) => f.path !== active.path && idx.links.get(f.path)?.has(name));
  section('Backlinks', back.map((f) => ({ label: f.rel, click: () => openFile(f.path) })));
  const out = [...(idx.links.get(active.path) || [])];
  section('Links de saída', out.map((l) => {
    const f = idx.byName.get(l);
    return { label: f ? f.name : l + ' (nova)', dim: !f, click: () => openWiki(l) };
  }));
  section('Tags', [...(idx.tags.get(active.path) || [])].map((t) => ({ label: '#' + t, click: () => findInFiles('#' + t) })));
}


/* ───────────── exportar a guia (PDF / Word) ───────────── */
const EXPORT_CSS = `
body{font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f2328;margin:0}
@page{size:A4;margin:18mm 16mm}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.2em 0 .4em;page-break-after:avoid;color:#1f3864}
h1{font-size:22pt;border-bottom:1px solid #d0d7de;padding-bottom:.2em}h2{font-size:17pt;border-bottom:1px solid #e5e8ec;padding-bottom:.15em}h3{font-size:14pt}h4{font-size:12pt}h5,h6{font-size:11pt}
p{margin:.5em 0}a{color:#0563c1;text-decoration:underline}
img{max-width:100%;height:auto;page-break-inside:avoid;display:block;margin:.6em 0}
code{font-family:Consolas,'Courier New',monospace;font-size:.92em;background:#eef0f3;border-radius:3px;padding:.05em .3em}
pre{background:#f3f4f6;border:1px solid #e0e3e8;border-radius:5px;padding:.6em .8em;white-space:pre-wrap;word-break:break-word;page-break-inside:avoid}
pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:.1em 1em;border-left:4px solid #b9c0c8;color:#555}
table{border-collapse:collapse;margin:.6em 0;max-width:100%;page-break-inside:avoid}th,td{border:1px solid #b8bec6;padding:.3em .6em;vertical-align:top}th{background:#e9eef7}
hr{border:0;border-top:1px solid #ccd1d7;margin:1em 0}ul,ol{padding-left:1.6em}li{margin:.15em 0}li input[type=checkbox]{margin-right:.4em}ul li:has(> input[type=checkbox]){list-style:none;margin-left:-1.3em}
`;
// Texto da guia pronto para exportar: sem o cabeçalho (front matter), [[links]] viram texto e ![[imagem]] vira imagem de verdade
function guideText() {
  let text = view.state.doc.toString().replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  text = text.replace(/!\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g, (_m, n) => { const u = wikiImg(n.trim()); return `![${n.trim()}](<${u || n.trim()}>)`; }); // ![[foto.png]]: acha no projeto; senão, ao lado da guia
  text = text.replace(/(!\[[^\]\n]*\]\()([^)<>\n"']*\s[^)<>\n"']*)(\))/g, (_m, a, u, z) => `${a}<${u.trim()}>${z}`); // caminho com espaço: ![x](Minha pasta/a.png)
  text = text.replace(/\[\[([^\]\n]+)\]\]/g, (_m, x) => { const [a, alias] = x.split('|'); return alias || a.split('#')[0]; });
  return text;
}
const exportFileUrl = (abs) => 'file:///' + abs.replace(/\\/g, '/').split('/').map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/');
function guideHtml(text, title, dir) {
  const doc = new DOMParser().parseFromString(marked.parse(text), 'text/html'); // inerte: não carrega nada aqui
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|data:)/i.test(src)) continue;
    if (/^file:/i.test(src)) continue;
    if (dir) img.setAttribute('src', exportFileUrl(dir + '/' + decodeURI(src)));
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data: http: https:; style-src 'unsafe-inline'"><title>${esc(title)}</title><style>${EXPORT_CSS}</style></head><body>${doc.body.innerHTML}</body></html>`;
}
async function exportGuide(kind) {
  if (!active || active.srv) return toast('Abra uma guia de texto ou Markdown para exportar.');
  if (isCanvas(active)) return toast('Exportar vale para guias de texto/Markdown, não para o canvas.');
  const text = pollToMarkdown(guideText());
  if (!text.trim()) return toast('A guia está vazia.');
  const name = baseName(active.path).replace(/\.[^.]+$/, '') || 'guia';
  const dir = active.untitled ? '' : dirName(active.path);
  const out = await api.exportPick(name, kind);
  if (!out) return;
  toast(`Gerando ${kind === 'pdf' ? 'o PDF' : 'o documento Word'}… (as imagens podem levar um instante)`);
  try {
    if (kind === 'pdf') {
      const r = await api.exportPdf(guideHtml(text, name, dir), out);
      if (!r.ok) throw new Error(r.error || 'não consegui gerar o PDF');
    } else {
      const bytes = await buildDocx(text, async (href) => {
        const r = await api.exportImage(href, dir);
        return r && r.ok ? prepareImage(new Uint8Array(r.data)) : null;
      });
      await api.exportWrite(out, bytes);
    }
    toast(`Salvo: ${out}`);
  } catch (e) { toast(`Não consegui exportar: ${e.message}`); }
}

/* ───────────── preview ───────────── */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderPreview() {
  const box = $('preview');
  if (box.hidden) return;
  if (!active || !isMd(active.path)) { box.textContent = 'Preview disponível apenas para Markdown.'; return; }
  let text = view.state.doc.toString().replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  text = text.replace(/\[\[([^\]\n]+)\]\]/g, (_m, x) => {
    const [t, alias] = x.split('|');
    return `<a href="#" data-wikilink="${esc(t.split('#')[0].trim())}">${esc(alias || t)}</a>`;
  });
  box.innerHTML = marked.parse(text);
  for (const pre of box.querySelectorAll('pre')) { const b = document.createElement('button'); b.className = 'pv-copy'; b.textContent = 'Copiar'; b.onclick = () => copyText(pre.querySelector('code')?.textContent ?? pre.textContent).then(() => { b.textContent = '✓ Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1300); }); pre.append(b); }
  const dir = dirName(active.path);
  for (const img of box.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!/^(https?:|file:|data:)/i.test(src)) img.src = 'file:///' + (dir + '/' + decodeURI(src)).replace(/\\/g, '/');
  }
}

$('preview').addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.wikilink) openWiki(a.dataset.wikilink);
  else if (a.href) api.openExternal(a.href);
});

/* ───────────── Canvas (quadro de cartões: texto, notas, imagens, grupos e setas) ───────────── */
const CANVAS_FONTS = [['Padrão (Segoe UI)', ''], ['Calibri', 'Calibri, sans-serif'], ['Arial', 'Arial, sans-serif'], ['Verdana', 'Verdana, sans-serif'], ['Georgia (com serifa)', 'Georgia, serif'], ['Times New Roman', '"Times New Roman", serif'], ['Consolas (código)', "Consolas, 'Courier New', monospace"], ['Mesma fonte do editor', 'var(--font-family)'], ['Comic Sans MS', '"Comic Sans MS", cursive']];
const isCanvas = (t) => !!t && (/\.canvas$/i.test(t.path || '') || !!(t.srv && t.srv.canvas)); // inclui o canvas compartilhado (aba ☁ do servidor)
let cv = null;
let cvTab = null;
let cvShown = false;
const cvFileUrl = (p) => 'file:///' + p.replace(/\\/g, '/').split('/').map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/');
const toStoredPath = (abs) => { const r = rootOf(abs); return (r ? abs.slice(r.path.length + 1) : abs).replace(/\\/g, '/'); };
const toAbsPath = (stored) => {
  if (/^([a-z]:[\\/]|\/)/i.test(stored)) return stored.replace(/[\\/]/g, api.sep);
  const rr = cvTab && !cvTab.untitled && rootOf(cvTab.path);
  const base = rr ? rr.path : (cvTab && !cvTab.untitled ? dirName(cvTab.path) : (root || '')); // canvas ainda sem nome: relativo ao projeto atual
  return joinPath(base, ...stored.split('/'));
};
function renderMdCard(text, dir, breaks) {
  const box = document.createElement('div');
  let t = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  t = t.replace(/\[\[([^\]\n]+)\]\]/g, (_m, x) => { const [a, alias] = x.split('|'); return esc(alias || a.split('#')[0]); });
  box.innerHTML = marked.parse(t, { breaks: !!breaks }); // nos cartões de texto, Enter vira quebra de linha
  if (dir) for (const img of box.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!/^(https?:|file:|data:)/i.test(src)) img.src = cvFileUrl(dir + '/' + decodeURI(src));
  }
  return box;
}
function pickProjectFile(re, placeholder, cb, image) {
  const items = idx.files.filter((f) => re.test(f.path)).map((f) => ({ label: f.name, detail: f.rel, act: () => cb(f.path) }));
  items.push({ label: 'Escolher outro arquivo…', detail: image ? 'imagem de qualquer pasta' : 'nota de qualquer pasta', act: async () => { const r = await api.openFilesDialog(image ? 'image' : 'note'); if (r && r[0]) cb(r[0]); } });
  showPalette({ placeholder, items: () => items, onSelect: async (it) => { await it.act(); cv?.focus(); } });
}
function cvEnv() {
  const v = () => (cvTab ? viewOf(cvTab) : null);
  return {
    whoIs: (id) => (scOf(cvTab) ? scApi(cvTab).who(id) : null),
    readOnly: () => !!scOf(cvTab) && !cvTab.srv.mine,
    noNotes: () => !!scOf(cvTab),
    undo: () => { const x = v(); if (x && !(scOf(cvTab) && !cvTab.srv.mine)) undo(x); },
    redo: () => { const x = v(); if (x && !(scOf(cvTab) && !cvTab.srv.mine)) redo(x); },
    setText: (json) => { const x = v(); if (x) x.dispatch({ changes: { from: 0, to: x.state.doc.length, insert: json }, userEvent: 'input.canvas' }); },
    toggleJson: () => toggleCanvasJson(),
    getName: () => (cvTab ? tabName(cvTab) : 'Canvas'),
    rename: () => renameCanvas(),
    toast,
    readText: async (abs) => {
      const open = tabs.find((t) => t.path === abs);
      if (open) return stateOf(open).doc.toString();
      try { return (await api.readFile(abs)).text; } catch { return null; }
    },
    fileUrl: (p) => { const m = /^srv-file:([\w-]+)/.exec(p || ''); return m && scOf(cvTab) ? scApi(cvTab).fileUrl(m[1]) : cvFileUrl(p); },
    toAbs: (st) => (scOf(cvTab) ? st : toAbsPath(st)),
    toStored: (abs) => (scOf(cvTab) ? abs : toStoredPath(abs)),
    renderMd: renderMdCard,
    pickNote: (cb) => pickProjectFile(/\.(md|markdown|txt)$/i, 'Qual nota colocar no quadro?', cb, false),
    pickImage: (cb) => (scOf(cvTab) ? scPickImage(cvTab, cb) : pickProjectFile(/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i, 'Qual imagem colocar no quadro?', cb, true)),
    openNote: (abs) => { if (!scOf(cvTab)) openFile(abs); },
    saveNote: async (abs, text) => {
      const open = tabs.find((t) => t.path === abs);
      if (open) { applyTo(open, { changes: { from: 0, to: stateOf(open).doc.length, insert: text } }); await saveTab(open); return; }
      try {
        const r = await api.readFile(abs);
        await api.write(abs, r.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text, r.enc);
      } catch { toast('Não consegui gravar a nota'); }
    },
    fonts: CANVAS_FONTS,
    getPasteMode: () => settings.canvasPasteMode || 'auto',
    setPasteMode: (m) => setSetting('canvasPasteMode', m),
    getStyle: () => ({ font: settings.canvasFont || '', size: settings.canvasFontSize || 15 }),
    setStyle: (o) => { if ('font' in o) setSetting('canvasFont', o.font); if ('size' in o) setSetting('canvasFontSize', o.size); },
    saveImage: async (file) => { if (scOf(cvTab)) return scUpload(cvTab, file); try { return (await storeImage(file, cvTab && !cvTab.untitled ? cvTab.path : null)).abs; } catch { toast('Não consegui salvar a imagem colada'); return null; } },
    pathOf: (f) => (scOf(cvTab) ? '' : api.pathForFile(f)),
    openUrl: (u) => api.openExternal(u),
  };
}
// Mostra o quadro no lugar do editor quando a aba ativa é um .canvas (e só há um painel); "Ver JSON" volta ao texto
let shShown = false;
let shTab = null;
function openSharedTab(srv) {
  const p = `srv:${srv.conn}/${srv.pid}/${srv.nid}`;
  let tab = tabs.find((t) => t.path === p);
  if (!tab) { tab = { path: p, srv: { ...srv }, state: makeState(''), dirty: false, lang: '', enc: 'utf8', eol: 'lf' }; tabs.push(tab); }
  activate(tab);
}
function setSharedTabTitle(conn, nid, title) {
  const t = tabs.find((x) => x.srv && x.srv.nid === nid && x.srv.conn === conn);
  if (t && t.srv.title !== title) { t.srv.title = title; renderTabs(); }
}
function closeSharedTab(conn, nid) { const t = tabs.find((x) => x.srv && x.srv.nid === nid && x.srv.conn === conn); if (t) closeTab(t); }
const isOpenShared = (conn, nid) => tabs.some((x) => x.srv && x.srv.nid === nid && x.srv.conn === conn);
const shared = createShared({
  toast, showPalette, showMenu, confirm: (m, b) => askT(m, b), rerenderTree: () => renderSharedTree(), isOpenSrv: isOpenShared,
  openTab: openSharedTab, activeSrv: () => (active && active.srv) || null, setTabTitle: setSharedTabTitle, closeSrvTab: closeSharedTab,
  canvasEvent: (conn, ev) => onCanvasEvent(conn, ev),
  nudged: (conn, ev) => onNudged(conn, ev),
  notifyMine: () => !!settings.notifyMentions,
});

/* ───────────── canvas compartilhado: um editor por vez, os outros veem ao vivo ───────────── */
const scOf = (t) => (t && t.srv && t.srv.canvas ? t : null);
const scApi = (t) => shared.canvasApi(t.srv.conn);
const scFmt = (ts) => new Date(ts).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const scSleep = (ms) => new Promise((r) => setTimeout(r, ms));
function scStatus(tab, text) {
  const s = tab.srv;
  s.status = text;
  if (s.statusEl && s.statusEl.isConnected) s.statusEl.textContent = text;
}
function scInfo(tab) { // "Criado por X · editado por Y em dd/mm hh:mm"
  const s = tab.srv; const a = scApi(tab);
  if (!s.infoEl || !s.infoEl.isConnected || !a) return;
  const parts = [];
  if (s.createdBy) parts.push(`criado por ${a.who(s.createdBy).name}`);
  if (s.editedBy) parts.push(`${s.editedBy === s.createdBy && s.version === 1 ? 'sem edições' : 'última edição de ' + a.who(s.editedBy).name}${s.editedTs ? ' · ' + scFmt(s.editedTs) : ''}`);
  s.infoEl.textContent = parts.join(' · ');
}
function scBanner(tab) {
  applyTo(tab, { effects: roComp.reconfigure(EditorState.readOnly.of(!tab.srv.mine)) }); // o JSON só edita quem está editando
  if (!cv || cvTab !== tab) return;
  const s = tab.srv; const a = scApi(tab);
  const box = document.createElement('span');
  box.className = 'cv-srvbar';
  const chip = (text, cls) => { const e = document.createElement('span'); e.className = 'cv-chip ' + (cls || ''); e.textContent = text; box.append(e); return e; };
  const button = (text, title, fn, cls) => { const b = document.createElement('button'); b.className = 'cv-btn ' + (cls || ''); b.textContent = text; b.title = title; b.onmousedown = (e) => e.preventDefault(); b.onclick = fn; box.append(b); return b; };
  const me = a && a.me();
  if (!s.loaded) chip('Carregando…', 'dim');
  else if (s.mine) {
    chip('✏️ Você está editando', 'edit');
    s.statusEl = chip(s.status || '', 'dim');
    button('Terminar edição', 'Salva e libera para os outros editarem', () => scDone(tab), 'primary');
  } else if (s.lock) {
    const mineElsewhere = me && s.lock.by === me.id;
    chip(mineElsewhere ? '🔒 Você está editando em outra janela' : `🔒 ${a.who(s.lock.by).name} está editando`, 'lock');
    if (mineElsewhere) button('Editar aqui', 'Continua a edição nesta janela', () => scEdit(tab, false), 'primary');
    else if (me && me.role === 'admin') button('Assumir', 'Tira a edição dessa pessoa (o que ela não salvou se perde)', () => scEdit(tab, true));
  } else {
    chip('👁 Somente leitura', 'dim');
    if (s.role && s.role !== 'read') button('✏️ Editar', 'Trava o quadro para você editar; os outros veem ao vivo', () => scEdit(tab, false), 'primary');
    else chip('sem permissão para editar', 'dim');
  }
  button('🕘 Versões', 'Histórico do canvas', () => scHistory(tab));
  s.infoEl = chip('', 'dim');
  scInfo(tab);
  cv.setBanner(box);
  cv.syncRO();
}
async function scLoad(tab, textToo = true) {
  const s = tab.srv; const a = scApi(tab);
  if (!a) return false;
  let n;
  try { n = await a.load(s.nid); } catch (e) { toast(e.message); return false; }
  s.version = n.canvas.version; s.lock = n.lock; s.role = n.role; s.loaded = true;
  s.createdBy = n.by || null; s.editedBy = n.canvas.by; s.editedTs = n.canvas.ts;
  if (textToo) {
    const cur = stateOf(tab).doc.toString();
    if (cur !== n.canvas.text) {
      s.applying = true;
      try { applyTo(tab, { changes: { from: 0, to: cur.length, insert: n.canvas.text }, annotations: Transaction.addToHistory.of(false) }); } finally { s.applying = false; }
    }
  }
  tab.dirty = false;
  a.markRead(s.nid);
  scBanner(tab);
  return true;
}
async function scOpen(tab) {
  const s = tab.srv;
  cv.open(tab, stateOf(tab).doc.toString()); // mostra o que já tem (vazio na 1ª vez) enquanto busca no servidor
  scBanner(tab);
  if (s.mine) return;
  const first = !s.fitted;
  await scLoad(tab);
  if (first && cvTab === tab) { s.fitted = true; cv.open(tab, stateOf(tab).doc.toString()); scBanner(tab); }
}
async function scEdit(tab, force) {
  const s = tab.srv; const a = scApi(tab);
  const r = await a.lock(s.nid, force);
  if (!(r.s >= 200 && r.s < 300)) { toast((r.j && r.j.error) || 'Não consegui pegar a edição'); await scLoad(tab, false); return; }
  if (r.j.version !== s.version) await scLoad(tab); // alguém salvou antes de eu pegar a trava: parte da versão mais nova
  s.mine = true; s.lock = r.j.lock; scStatus(tab, '');
  scHeartbeat(tab);
  scBanner(tab);
}
function scHeartbeat(tab) {
  const s = tab.srv;
  clearInterval(s.hb);
  s.hb = setInterval(async () => {
    const r = await scApi(tab).lock(s.nid, false);
    if (r.s === 409) scLost(tab, (r.j && r.j.error) || 'Você perdeu a edição deste canvas.');
    else if (r.s >= 200 && r.s < 300) s.lock = r.j.lock;
  }, 30000);
}
function scSchedule(tab) {
  const s = tab.srv;
  if (!s.mine) return;
  scStatus(tab, 'Salvando…');
  clearTimeout(s.saveT);
  s.saveT = setTimeout(() => scFlush(tab), 700);
}
async function scFlush(tab) {
  const s = tab.srv;
  clearTimeout(s.saveT);
  if (!s.mine) return;
  if (s.saving) { s.again = true; return; }
  s.saving = true;
  try {
    const text = stateOf(tab).doc.toString();
    try { JSON.parse(text); } catch { scStatus(tab, 'JSON inválido: ainda não salvo'); return; } // digitando no modo JSON
    const r = await scApi(tab).save(s.nid, text, s.version);
    if (r.s >= 200 && r.s < 300) {
      s.version = r.j.version; s.editedBy = scApi(tab).me().id; s.editedTs = r.j.ts; scStatus(tab, 'Salvo ✓');
      // o servidor carimba cada cartão (quem fez/editou): traz o texto carimbado de volta, se nada mudou nem está sendo digitado
      if (r.j.text && stateOf(tab).doc.toString() === text && !s.again && !(cv && cvTab === tab && cv.isEditing()) && !tab.cvJson) {
        s.applying = true;
        try { applyTo(tab, { changes: { from: 0, to: text.length, insert: r.j.text }, annotations: Transaction.addToHistory.of(false) }); } finally { s.applying = false; }
      }
      scInfo(tab);
    }
    else if (r.s === 409) { s.saving = false; scLost(tab, (r.j && r.j.error) || 'Você perdeu a edição deste canvas.'); return; }
    else if (r.s === 0) { scStatus(tab, 'Sem conexão: tentando de novo…'); s.saveT = setTimeout(() => scFlush(tab), 5000); }
    else { toast((r.j && r.j.error) || 'Não consegui salvar o canvas'); scStatus(tab, 'Erro ao salvar'); }
  } finally { s.saving = false; if (s.again) { s.again = false; scFlush(tab); } }
}
async function scLost(tab, msg) {
  const s = tab.srv;
  s.mine = false; clearInterval(s.hb); clearTimeout(s.saveT);
  toast(`${msg} O que você mudou depois disso não foi salvo.`);
  await scLoad(tab);
}
async function scDone(tab) {
  const s = tab.srv;
  await scFlush(tab);
  while (s.saving) await scSleep(100);
  clearInterval(s.hb);
  s.mine = false;
  await scApi(tab).unlock(s.nid);
  s.lock = null;
  scBanner(tab);
}
function scRelease(tab) { // ao fechar a aba: salva o que falta e solta a trava
  const s = tab.srv;
  clearInterval(s.hb);
  if (!s.mine) return;
  const a = scApi(tab);
  (async () => { await scFlush(tab); while (s.saving) await scSleep(100); s.mine = false; if (a) await a.unlock(s.nid); })();
}
async function scHistory(tab) {
  const s = tab.srv; const a = scApi(tab);
  let list;
  try { list = await a.history(s.nid); } catch (e) { return toast(e.message); }
  const items = list.map((v) => ({ label: `${v.current ? 'Versão atual' : 'Versão ' + v.version} · ${scFmt(v.ts)}`, detail: a.who(v.by).name + (v.current ? '' : s.mine ? ' — clique para restaurar' : ''), v }));
  showPalette({
    placeholder: s.mine ? 'Escolha a versão do canvas para restaurar' : 'Histórico do canvas (para restaurar, clique em Editar antes)',
    items: () => items,
    onSelect: async (it) => {
      if (it.v.current) return;
      if (!s.mine) return toast('Clique em Editar para poder restaurar uma versão.');
      if ((await askT(`Restaurar a versão de ${scFmt(it.v.ts)}? O estado atual continua no histórico.`, ['Restaurar', 'Cancelar'])) !== 0) return;
      await scFlush(tab);
      const r = await a.restore(s.nid, it.v.version);
      if (r.s >= 200 && r.s < 300) { await scLoad(tab); toast('Versão restaurada'); } else toast((r.j && r.j.error) || 'Não consegui restaurar');
    },
  });
}
function scRename(tab) {
  showPalette({
    placeholder: 'Novo nome do canvas…',
    initial: tab.srv.title || '',
    onFree: async (name) => {
      name = name.trim();
      if (!name || name === tab.srv.title) return;
      if (await scApi(tab).rename(tab.srv.nid, name)) { setSharedTabTitle(tab.srv.conn, tab.srv.nid, name); cv?.syncTitle(); }
    },
  });
}
function onCanvasEvent(conn, ev) {
  const tab = tabs.find((t) => scOf(t) && t.srv.conn === conn && t.srv.nid === ev.nid);
  if (!tab) return;
  const a = scApi(tab); const me = a && a.me();
  if (!me || ev.by === me.id) return; // as minhas próprias mudanças
  if (ev.what === 'canvas') { if (tab.srv.mine) scLost(tab, 'Outra pessoa assumiu a edição e salvou.'); else scLoad(tab); }
  else if (ev.what === 'lock') {
    scLoad(tab, false).then(() => { if (tab.srv.mine && tab.srv.lock && tab.srv.lock.by !== me.id) scLost(tab, 'Um administrador assumiu a edição deste canvas.'); });
  }
}
const SC_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
async function scUpload(tab, file) { // devolve o "caminho" do cartão: srv-file:<id>/<nome com extensão>
  const u = await scApi(tab).upload(tab.srv.pid, file);
  return u ? `srv-file:${u.id}/${u.name.replace(/[\\/]/g, '_')}` : null;
}
async function scPickImage(tab, cb) {
  const r = await api.openFilesDialog('image');
  for (const p of r || []) {
    const x = await api.exportImage(p, '');
    if (!x || !x.ok) { toast('Não consegui ler ' + baseName(p)); continue; }
    const ext = (p.split('.').pop() || '').toLowerCase();
    const abs = await scUpload(tab, new File([new Uint8Array(x.data)], baseName(p), { type: SC_MIME[ext] || 'image/png' }));
    if (abs) cb(abs);
  }
}

function syncCanvas() {
  const host = $('canvasHost');
  const sh = $('sharedHost');
  if (!active) { $('cvBack').hidden = true; host.hidden = true; sh.hidden = true; cvShown = false; shShown = false; cvTab = null; shTab = null; return; }
  if (active.srv && !active.srv.canvas) { // nota compartilhada: no lugar do editor
    if (cvShown) { host.hidden = true; cvShown = false; cvTab = null; }
    sh.hidden = false;
    $('editor').hidden = true;
    if (!shShown || shTab !== active) { shShown = true; shTab = active; shared.show(sh, active.srv); }
    return;
  }
  if (shShown) { shared.hide(); sh.hidden = true; shShown = false; shTab = null; $('editor').hidden = false; }
  $('cvBack').hidden = !(isCanvas(active) && active.cvJson && panes.length === 1); // no modo JSON, mostra o botão de voltar
  const want = isCanvas(active) && panes.length === 1 && !active.cvJson;
  if (want) {
    if (!cv) cv = createCanvas(host, cvEnv());
    const first = !cvShown || cvTab !== active;
    cvTab = active;
    host.hidden = false;
    $('editor').hidden = true;
    cvShown = true;
    if (first) { if (scOf(active)) scOpen(active); else cv.open(active, stateOf(active).doc.toString()); }
  } else if (cvShown) {
    host.hidden = true;
    $('editor').hidden = false;
    cvShown = false;
    cvTab = null;
    viewOf(active)?.requestMeasure();
  }
}
function renameCanvas() {
  const t = cvTab || (active && isCanvas(active) ? active : null);
  if (!t) return;
  if (scOf(t)) return scRename(t);
  showPalette({
    placeholder: 'Novo nome do canvas…',
    initial: tabName(t),
    onFree: async (name) => {
      const safe = name.replace(/\.canvas$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim();
      if (!safe || safe === tabName(t)) return;
      if (t.untitled) {
        const np = `${safe}.canvas`;
        if (tabs.some((x) => x !== t && x.path === np)) return toast('Já existe uma aba com esse nome');
        t.path = np;
      } else {
        const np = joinPath(dirName(t.path), `${safe}.canvas`);
        if (!(await api.rename(t.path, np))) return toast('Já existe um arquivo com esse nome');
        if (groupAssign[t.path]) { groupAssign[np] = groupAssign[t.path]; delete groupAssign[t.path]; }
        t.path = np;
        if (rootOf(np)) await loadWorkspace(rootOf(np).path);
      }
      renderTabs(); persist();
      cv?.syncTitle();
    },
  });
}
function toggleCanvasJson() {
  if (!active || !isCanvas(active)) return;
  active.cvJson = !active.cvJson;
  if (active.cvJson && scOf(active) && !active.srv.mine) toast('JSON só para ler: clique em ✏️ Editar no canvas para poder alterar.');
  syncCanvas();
  if (active.cvJson) view.focus(); else cv?.focus();
}
// Abre um quadro novo sem criar arquivo: só vira .canvas quando você salvar (Ctrl+S), como um "Sem título".
function newCanvas() {
  newUntitled(CANVAS_EMPTY, { canvas: true });
}

/* ───────────── colar imagem (Ctrl+V), como no Obsidian ───────────── */
// O Excel (e o Word, o PowerPoint…) copia a seleção como texto E como imagem ao mesmo tempo. Se tem texto, o texto vale (igual ao Sublime):
// a imagem só é colada quando não há texto nenhum (print de tela, "copiar imagem" do navegador, etc.).
// Texto "de verdade" (várias linhas, tabulação ou tabela HTML = Excel/Word) vence a imagem. Uma linha solta (nome do arquivo, link) que vem junto
// de uma imagem (WhatsApp, Teams, navegador, ferramentas de print) não impede colar a imagem.
const clipHasText = (e) => {
  const d = e.clipboardData; if (!d) return false;
  const t = (d.getData('text/plain') || '').trim();
  if (!t) return false;
  if (/[\t\r\n]/.test(t) || /<table/i.test(d.getData('text/html') || '')) return true;
  return ![...(d.files || [])].some((f) => /^image\//.test(f.type));
};
const clipImages = (e) => (clipHasText(e) ? [] : [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type)));
const p2 = (n) => String(n).padStart(2, '0');
function pastedName(type) {
  const d = new Date();
  const ext = { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }[type] || 'png';
  return `Pasted image ${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${ext}`;
}
const isAbsPath = (p) => !!p && /^([a-z]:[\\/]|\/)/i.test(p);
// Onde guardar o anexo: respeita a configuração do Obsidian (.obsidian/app.json → attachmentFolderPath), senão "anexos" do settings.json, senão a raiz do projeto
async function attachmentTarget(ctxPath) {
  const real = isAbsPath(ctxPath) ? ctxPath : null;
  let rr = real ? rootOf(real) : roots.find((r) => r.path === root);
  if (rr && /\.asar([\\/]|$)/i.test(rr.path)) rr = null; // sem projeto aberto a "raiz" pode cair na pasta do próprio app (app.asar é um arquivo): não serve de destino
  if (!rr) return { dir: real ? dirName(real) : null, rr: null, md: true, noteDir: real ? dirName(real) : null };
  let cfg = {};
  try { cfg = JSON.parse((await api.readFile(joinPath(rr.path, '.obsidian', 'app.json'))).text); } catch { /* sem config do Obsidian */ }
  const a = cfg.attachmentFolderPath || settings.attachmentFolder || '/';
  const noteDir = real ? dirName(real) : rr.path;
  let dir;
  if (a === '/') dir = rr.path;
  else if (a === './') dir = noteDir;
  else if (a.startsWith('./')) dir = joinPath(noteDir, ...a.slice(2).split('/').filter(Boolean));
  else dir = joinPath(rr.path, ...a.split('/').filter(Boolean));
  return { dir, rr, md: cfg.useMarkdownLinks === true, noteDir };
}
async function storeImage(file, ctxPath) {
  const t = await attachmentTarget(ctxPath);
  const named = file.name && file.name.toLowerCase() !== 'image.png' && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
  const buf = await file.arrayBuffer();
  const nm = named ? file.name : pastedName(file.type);
  let abs;
  try { abs = await api.saveImage(t.dir, nm, buf); } catch (err) { // pasta de destino inválida ou sem permissão: guarda na pasta de imagens do app, em vez de perder o print
    if (!t.dir) throw err;
    try { api.debugLog('aviso', 'imagem: destino ' + t.dir + ' falhou, usando a pasta do app'); } catch { /* sem debug */ }
    abs = await api.saveImage(null, nm, buf);
    return { abs, t: { dir: null, rr: null, md: true, noteDir: null } };
  }
  if (t.rr) { expanded.add(dirName(abs)); await loadWorkspace(t.rr.path); } // a lista de arquivos passa a conhecer a imagem
  return { abs, t };
}
function imageLink(abs, t, ctxPath) {
  const name = baseName(abs);
  if (t.rr && !t.md) return `![[${name}]]`; // padrão do Obsidian
  const dir = isAbsPath(ctxPath) ? dirName(ctxPath) : t.noteDir;
  if (dir && abs.startsWith(dir + api.sep)) return `![](${abs.slice(dir.length + 1).split(/[\\/]/).map(encodeURIComponent).join('/')})`;
  return `![](${cvFileUrl(abs)})`;
}
function pasteImage(e, v) {
  const tab = tabOfView(v);
  if (!tab || !(isMd(tab.path) || tab.lang === 'Markdown')) return false;
  const files = clipImages(e);
  if (!files.length) return false;
  e.preventDefault();
  (async () => {
    try {
      const links = [];
      let last = '';
      for (const f of files) {
        const { abs, t } = await storeImage(f, tab.untitled ? null : tab.path);
        links.push(imageLink(abs, t, tab.untitled ? null : tab.path));
        last = abs;
      }
      const sel = v.state.selection.main;
      const text = links.join('\n');
      v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, userEvent: 'input.paste', scrollIntoView: true });
      toast('Imagem colada: ' + baseName(last));
    } catch (err) { console.error('paste-image', err); toast('Não consegui salvar a imagem colada' + (err && err.message ? ' (' + String(err.message).replace(/^Error invoking remote method [^:]*: /, '').slice(0, 120) + ')' : '')); }
  })();
  return true;
}
document.addEventListener('paste', (e) => { // Ctrl+V no quadro (canvas): imagem vira cartão; texto vira cartão de texto
  if (cvShown && cv && !e.target.closest?.('textarea, input')) cv.paste(e);
});

/* ───────────── servidor colaborativo neste computador (roda em segundo plano, sobrevive a atualizações) ───────────── */
let localSrv = null;
async function refreshLocalSrv() { try { localSrv = await api.serverStatus(); } catch { /* sem status */ } return localSrv; }
async function serverStartFlow(restart) {
  const st = await refreshLocalSrv();
  if (st && st.running && !restart) return toast(`O servidor já está rodando (porta ${st.port}).`);
  const o = {};
  if (st && !st.hasData) { // primeira vez: cria o administrador
    const name = await new Promise((res) => showPalette({ placeholder: 'Primeira vez: nome do administrador do servidor (você)', onFree: (t) => res(t.trim()), items: () => [] }));
    if (!name) return;
    const pass = await new Promise((res) => showPalette({ placeholder: `Senha de ${name} (mínimo 8 caracteres)`, password: true, onFree: (t) => res(t), items: () => [] }));
    if (!pass || pass.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres');
    o.adminName = name; o.adminPass = pass;
  }
  toast(st && st.prepared ? (restart ? 'Reiniciando o servidor…' : 'Iniciando o servidor…') : 'Preparando o servidor (primeira vez: copia ~265 MB, leva alguns segundos)…');
  const r = await (restart ? api.serverRestart(o) : api.serverStart(o));
  await refreshLocalSrv();
  if (r.error) return toast(r.error);
  toast(`Servidor rodando na porta ${r.port}. Veja o endereço em Arquivo → Servidor neste computador → Mostrar o endereço.`);
}
// Mostra os endereços do servidor (para você e para os colegas digitarem em ☁ Compartilhado), com botão de copiar
async function serverAddressFlow() {
  const st = await refreshLocalSrv();
  if (!st || !st.running) return toast('O servidor não está rodando. Use ▶ Iniciar servidor primeiro.');
  const list = await api.serverAddresses();
  const ov = document.createElement('div');
  ov.className = 'sh-lightbox sh-modal';
  const panel = document.createElement('div');
  panel.className = 'sh-panel';
  panel.onclick = (e) => e.stopPropagation();
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const hd = mk('div', 'sh-phead'); hd.append(mk('b', null, 'Endereços do servidor'), mk('span', 'sh-sp'));
  const x = mk('button', 'sh-ic', '×'); x.onclick = () => ov.remove(); hd.append(x);
  panel.append(hd, mk('div', 'sh-hint', 'Em ☁ Compartilhado, digite o endereço, o usuário e a senha. O servidor está rodando.'));
  for (const a of list) {
    const row = mk('div', 'sh-urow');
    const col = mk('div'); col.style.flex = '1';
    col.append(mk('div', 'sh-hint', a.label), mk('b', null, a.address));
    col.firstChild.style.margin = '0';
    const b = mk('button', 'sh-btn', 'Copiar');
    b.onclick = () => { const t = document.createElement('textarea'); t.value = a.address; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); b.textContent = 'Copiado ✓'; };
    row.append(col, b);
    panel.append(row);
  }
  if (!list.some((a) => a.kind === 'vpn')) panel.append(mk('div', 'sh-hint', 'Não encontrei o Tailscale neste computador. Para os colegas entrarem de fora de casa, instale o Tailscale aqui e neles: o endereço aparece nesta lista (100.x.x.x). Se estiver usando um túnel do Cloudflare, o endereço é o https://….trycloudflare.com que o cloudflared mostra.'));
  ov.append(panel);
  ov.onclick = () => ov.remove();
  document.body.append(ov);
}
async function serverStopFlow() {
  const r = await api.serverStop();
  await refreshLocalSrv();
  toast(r.error || (r.already ? 'O servidor já estava parado.' : 'Servidor parado.'));
}
async function serverAutostartFlow() {
  const st = await refreshLocalSrv();
  const r = await api.serverAutostart(!(st && st.autostart));
  await refreshLocalSrv();
  toast(r.error || (r.autostart ? 'O servidor vai iniciar junto com o Windows.' : 'O servidor não inicia mais com o Windows.'));
}

/* ───────────── atualização do app pelo servidor ───────────── */
let updPrompted = '';
// Botão discreto no canto da barra de menus: aparece só depois de "Verificar atualização" e baixa/instala ao clicar
// Alguém (que você permitiu) chamou a sua atenção: pisca, treme a janela, toca um som e avisa quem foi
function nudgeSound() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const tone = (f, t0, d) => { const o = ac.createOscillator(); const g = ac.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, ac.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + d); o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + d + 0.02); };
    tone(660, 0, 0.12); tone(880, 0.14, 0.12); tone(660, 0.28, 0.12); tone(880, 0.42, 0.18);
    setTimeout(() => ac.close(), 1200);
  } catch { /* sem som */ }
}
function cssShake() { // janela maximizada não se move: treme o conteúdo
  document.body.classList.remove('nudge-shake');
  void document.body.offsetWidth;
  document.body.classList.add('nudge-shake');
  setTimeout(() => document.body.classList.remove('nudge-shake'), 900);
}
function nudgeBanner(conn, ev) { // aviso grande no meio do topo (a barra de status some em 4 s e passaria batido)
  document.querySelector('.nudge-banner')?.remove();
  const d = document.createElement('div');
  d.className = 'nudge-banner';
  const t = document.createElement('span');
  t.textContent = `📳 ${ev.fromName || 'Alguém'} chamou a sua atenção`;
  d.append(t);
  if (ev.nid && ev.pid) {
    const b = document.createElement('button');
    b.textContent = 'Abrir a conversa';
    b.onclick = () => { openSharedTab({ conn, pid: ev.pid, nid: ev.nid, title: '' }); d.remove(); };
    d.append(b);
  }
  const x = document.createElement('button');
  x.textContent = '×'; x.title = 'Fechar';
  x.onclick = () => d.remove();
  d.append(x);
  document.body.append(d);
  setTimeout(() => d.remove(), 12000);
}
async function onNudged(conn, ev) {
  toast(`📳 ${ev.fromName || 'Alguém'} chamou a sua atenção`);
  nudgeBanner(conn, ev);
  nudgeSound();
  let mode = 'css';
  try { mode = await api.shakeWindow(); } catch { /* sem tremer a janela */ }
  if (mode !== 'window') cssShake();
}
// Duas etapas, quem decide é o usuário: 1) "⬇ Baixar" (o app continua aberto) → 2) "✔ Instalar e reiniciar" (só então o app fecha)
let updReady = null; // instalador já baixado, esperando você decidir instalar: { file, version }
function showUpdateButton(info) {
  const b = $('updBtn');
  delete b.dataset.busy;
  if (updReady && updReady.version === info.version) return showInstallButton(updReady, info);
  const mb = info.size ? ` (${Math.round(info.size / 1048576)} MB)` : '';
  b.classList.remove('ready');
  b.textContent = tr('⬇ Baixar {0}', info.version) + mb;
  b.title = tr('Nova versão {0} no servidor (você está na {1}). Clique para BAIXAR: o app continua aberto. Depois aparece o botão para instalar, quando você quiser. Botão direito esconde.', info.version, info.current);
  b.dataset.label = b.textContent;
  b.dataset.mode = 'download';
  b.hidden = false;
}
function showInstallButton(r, info) {
  const b = $('updBtn');
  delete b.dataset.busy;
  b.classList.add('ready');
  b.textContent = r.fast ? tr('⚡ Reiniciar e atualizar para {0}', r.version) : tr('✔ Instalar {0} e reiniciar', r.version);
  b.title = r.fast ? tr('A atualização {0} já está pronta. Ao clicar: o app fecha e abre de novo em poucos segundos (suas abas e rascunhos são guardados). Reinicie quando for bom para você. Botão direito esconde.', r.version) : tr('A atualização {0} já está baixada. Ao clicar: o app fecha, instala e abre de novo sozinho (suas abas e rascunhos são guardados). Instale quando for bom para você. Botão direito esconde.', r.version);
  b.dataset.label = b.textContent;
  b.dataset.mode = 'install';
  b.hidden = false;
}
async function updateFlow() {
  const b = $('updBtn');
  if (b.dataset.busy) return;
  if (b.dataset.mode === 'install' && updReady) return updateInstallNow();
  b.dataset.busy = '1';
  b.textContent = tr('Baixando… {0}%', 0);
  const r = await api.updateDownload();
  if (!r.ok) { b.textContent = b.dataset.label; delete b.dataset.busy; return toast(r.error); }
  updReady = { file: r.file, version: r.version, fast: !!r.fast };
  showInstallButton(updReady);
  toast(r.fast ? tr('Atualização {0} pronta. Clique em "Reiniciar e atualizar" quando quiser (o app só fecha quando você clicar).', r.version) : tr('Atualização {0} baixada. Clique em "Instalar e reiniciar" quando quiser (o app só fecha quando você clicar).', r.version));
}
async function updateInstallNow() {
  const b = $('updBtn');
  b.dataset.busy = '1';
  b.textContent = updReady.fast ? tr('Reiniciando para {0}…', updReady.version) : tr('Instalando {0}…', updReady.version);
  const i = await api.updateInstall(updReady.file);
  if (!i.ok) { // arquivo sumiu ou não abriu: volta a oferecer o download
    updReady = null;
    delete b.dataset.busy;
    b.classList.remove('ready'); b.dataset.mode = 'download';
    b.textContent = tr('Baixar de novo');
    toast(t(i.error) + ' ' + tr('Clique em Baixar para obter de novo.'));
  }
}
// Atualização automática: verifica sozinho (ao abrir, ao conectar num servidor, a cada 30 min e ao voltar para a janela) e BAIXA em
// segundo plano, sem perguntar. Instalar continua sendo decisão sua: o botão verde "Instalar e reiniciar" aparece quando está pronta.
let updAuto = { busy: false, last: 0 };
async function autoUpdateTick(force) {
  if (!settings.autoUpdate || updAuto.busy || updReady) return;
  const b = $('updBtn');
  if (b.dataset.busy) return;
  if (!force && Date.now() - updAuto.last < 10 * 60 * 1000) return;
  updAuto.last = Date.now(); updAuto.busy = true;
  try {
    const i = await api.updateCheck();
    if (!i.ok || !i.available) return;
    b.dataset.busy = '1'; b.hidden = false; b.classList.remove('ready'); b.dataset.mode = 'download';
    b.dataset.label = tr('⬇ Baixar {0}', i.version); b.textContent = tr('Baixando {0}… 0%', i.version);
    b.title = tr('Baixando a versão {0} em segundo plano. Quando terminar, aparece o botão para instalar — só instala quando você clicar.', i.version);
    const r = await api.updateDownload({ background: true });
    if (!r.ok) { delete b.dataset.busy; showUpdateButton(i); return; } // não deu: deixa o botão manual "Baixar"
    updReady = { file: r.file, version: r.version, fast: !!r.fast };
    showInstallButton(updReady);
    toast(r.fast ? tr('Atualização {0} pronta. Clique em "Reiniciar e atualizar" quando quiser (o app só fecha quando você clicar).', r.version) : tr('Atualização {0} pronta. Clique em "Instalar e reiniciar" quando quiser (o app só fecha quando você clicar).', r.version));
  } catch { /* tenta de novo no próximo ciclo */ } finally { updAuto.busy = false; if (b.dataset.busy && !updAuto.busy && b.dataset.mode !== 'install' && !updReady) delete b.dataset.busy; }
}
async function updateCheckFlow() {
  const i = await api.updateCheck();
  if (!i.ok) return toast(t(i.error));
  if (i.none) return toast('O servidor ainda não tem nenhuma atualização publicada.');
  if (!i.available) { $('updBtn').hidden = true; return toast(tr('Você já está na versão mais nova ({0}).', i.current)); }
  showUpdateButton(i);
  toast(updReady && updReady.version === i.version ? tr('A versão {0} já está baixada: use o botão verde "Instalar e reiniciar" quando quiser.', i.version) : tr('Versão {0} disponível: use o botão ⬇ Baixar no canto superior direito.', i.version));
}

// Barra de progresso da publicação (canto superior direito, antes do botão de atualização). Fica até terminar:
// verde "publicada" some sozinha depois de uns segundos; erro fica até você clicar.
let pubBusy = false; let pubTimer = null;
function pubEls() { return { b: $('pubBar'), fill: $('pubBar').querySelector('.pub-fill'), txt: $('pubBar').querySelector('.pub-txt') }; }
function pubStart(version) {
  const { b, fill, txt } = pubEls();
  clearTimeout(pubTimer);
  pubBusy = true;
  b.hidden = false;
  b.className = 'pub-bar ind';
  fill.style.width = '';
  txt.textContent = `Publicando ${version}… preparando`;
  b.title = `Enviando a versão ${version} para o servidor. Pode levar alguns minutos; se a conexão cair, a próxima tentativa continua de onde parou.`;
  b.dataset.version = version;
}
function pubProgress(ev) {
  if (!pubBusy) return;
  const { b, fill, txt } = pubEls();
  b.classList.remove('ind');
  fill.style.width = ev.pct + '%';
  const mbs = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
  txt.textContent = ev.phase === 'finishing' ? `Publicando ${ev.version} · conferindo no servidor…` : `Publicando ${ev.version} · ${ev.pct}%${ev.total ? ` (${mbs(ev.sent)} de ${mbs(ev.total)} MB)` : ''}`;
  if (ev.phase === 'finishing') b.classList.add('ind');
}
function pubDone(r, version) {
  const { b, fill, txt } = pubEls();
  pubBusy = false;
  clearTimeout(pubTimer);
  b.classList.remove('ind');
  if (r && r.ok) {
    b.className = 'pub-bar ok';
    fill.style.width = '100%';
    txt.textContent = `✔ Versão ${r.version} publicada${r.mode === 'local' ? ' (neste computador)' : ''}`;
    b.title = 'Os apps conectados vão poder baixar. Clique para fechar esta barra.';
    pubTimer = setTimeout(() => { b.hidden = true; }, 9000);
  } else {
    b.className = 'pub-bar err';
    fill.style.width = '100%';
    const msg = (r && r.error) || 'erro desconhecido';
    txt.textContent = `✕ Falhou: ${msg.length > 48 ? msg.slice(0, 48) + '…' : msg}`;
    b.title = `${msg}\n\nClique para fechar. Ao tentar de novo, o envio continua de onde parou.`;
  }
}
async function updatePublishFlow() {
  const files = await api.openFilesDialog('installer');
  if (!files || !files[0]) return;
  const guess = (files[0].split(/[\\/]/).pop().match(/(\d+\.\d+\.\d+)/) || [])[1] || '';
  const version = await new Promise((res) => showPalette({ placeholder: 'Versão que está sendo publicada (ex.: 1.20.2) — Enter confirma', initial: guess, onFree: (t) => res(t.trim()), items: () => [] }));
  if (!version) return;
  if (!/^\d+\.\d+\.\d+$/.test(version)) return toast('Use o formato 1.20.2 (três números separados por ponto)');
  let connId;
  const srvs = shared.list();
  if (srvs.length > 1) {
    const it = await new Promise((res) => showPalette({ placeholder: 'Publicar em qual servidor?', items: () => srvs.map((x) => ({ label: x.label, detail: x.admin ? 'administrador' : '', conn: x.id })), onSelect: res }));
    connId = it.conn;
  } else if (srvs.length === 1) connId = srvs[0].id;
  if (pubBusy) return toast('Já há uma publicação em andamento.');
  pubStart(version);
  let r;
  try { r = await api.updatePublish(files[0], version, connId); } catch (e) { r = { ok: false, error: e.message }; }
  pubDone(r, version);
  toast(r.ok ? `Versão ${r.version} publicada (${r.mode === 'local' ? 'no servidor deste computador' : 'enviada ao servidor'}). Os apps conectados vão avisar.` : r.error);
}
api.onSrvEvent((ev) => {
  if (ev.type === 'conn' && ev.ok) setTimeout(() => autoUpdateTick(false), 4000);
  if (ev.type === 'publish-progress') pubProgress(ev);
  if (ev.type === 'update-progress') { const b = $('updBtn'); if (b.dataset.busy && b.dataset.mode !== 'install') b.textContent = ev.prep ? tr('Preparando {0}…', ev.version) : tr('Baixando… {0}%', ev.pct) + (ev.bps ? ' · ' + (ev.bps / 1048576).toFixed(1) + ' MB/s' : '') + (ev.bps && ev.total ? ' · ' + tr('faltam ~{0} s', Math.max(1, Math.round((ev.total - ev.got) / ev.bps))) : ''); }
});

/* ───────────── status ───────────── */
function updateStatus() {
  if (!active) {
    $('stPos').textContent = $('stSel').textContent = $('stLang').textContent = $('stEnc').textContent = $('stWrap').textContent = '';
    $('stPins').hidden = true;
    return;
  }
  const s = view.state;
  const m = s.selection.main;
  const ln = s.doc.lineAt(m.head);
  $('stPos').textContent = `Linha ${ln.number}, Coluna ${m.head - ln.from + 1}`;
  const n = s.selection.ranges.length;
  $('stSel').textContent = n > 1 ? `${n} seleções` : m.empty ? '' : `${Math.abs(m.to - m.from)} caracteres`;
  $('stWrap').textContent = active.autoWrap ? `Auto Wrap ${wrapWidth()}` : '';
  { const n = s.field(pinField).length; $('stPins').textContent = n ? `📌 ${n}` : '📌'; $('stPins').hidden = false; }
  $('stEnc').textContent = `${ENC_NAMES[active.enc || 'utf8']} · ${active.eol === 'crlf' ? 'CRLF' : 'LF'}`;
  $('stLang').textContent = `${settings.insertSpaces === false ? 'Tabs' : 'Espaços'}: ${settings.tabSize}   ${active.lang || ''}${active.manual ? ' (manual)' : ''}`;
}

/* ───────────── paleta ───────────── */
let pal = null;

function fuzzy(q, s) {
  q = q.toLowerCase();
  const l = s.toLowerCase();
  const pos = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    const i = l.indexOf(ch, from);
    if (i < 0) return null;
    score += 1;
    if (pos.length && i === pos[pos.length - 1] + 1) score += 5;
    if (i === 0 || /[\s/\\_.-]/.test(l[i - 1])) score += 8;
    score -= (i - from) * 0.05;
    pos.push(i);
    from = i + 1;
  }
  if (pos[0] > l.lastIndexOf('/')) score += 10;
  return { pos, score };
}

function showPalette(o) {
  pal = { ...o, sel: 0, list: [] };
  $('overlay').hidden = false;
  $('pIn').value = o.initial || '';
  $('pIn').placeholder = o.placeholder || '';
  $('pIn').type = o.password ? 'password' : 'text';
  palRefresh();
  $('pIn').focus();
  $('pIn').select();
}

function closePalette() {
  $('overlay').hidden = true;
  $('pIn').type = 'text';
  pal = null;
  if (active) view.focus();
}

function palRefresh() {
  const raw = $('pIn').value;
  const q = pal.strip ? pal.strip(raw) : raw;
  const src = pal.items ? pal.items() : [];
  let out;
  if (!q || pal.noFilter) out = src.map((it) => ({ it, pos: [] }));
  else {
    out = [];
    for (const it of src) {
      let r = fuzzy(q, it.label);
      if (!r && it.search) { // não achou no nome: tenta no texto extra (grupo, projeto, caminho)
        const r2 = fuzzy(q, it.search);
        if (r2) r = { pos: [], score: r2.score - 20 };
      }
      if (r) out.push({ it, pos: r.pos, score: r.score });
    }
    out.sort((a, b) => b.score - a.score);
  }
  pal.list = out.slice(0, 100);
  pal.sel = !q && pal.startAt ? Math.min(pal.startAt, Math.max(0, pal.list.length - 1)) : 0;
  palRender();
}

function palRender() {
  const box = $('pList');
  box.textContent = '';
  pal.list.forEach(({ it, pos }, i) => {
    const row = el('div', 'pi' + (i === pal.sel ? ' sel' : ''));
    const label = el('span');
    const set = new Set(pos);
    [...it.label].forEach((ch, k) => {
      if (set.has(k)) label.append(el('b', null, ch)); else label.append(document.createTextNode(ch));
    });
    row.append(label, el('span', 'd', it.detail || ''));
    row.onmousedown = (e) => { e.preventDefault(); pal.sel = i; palPick(); };
    box.append(row);
  });
  box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function palPick() {
  const p = pal;
  const raw = $('pIn').value;
  const cur = p.list[p.sel];
  closePalette();
  if (cur) p.onSelect?.(cur.it, raw);
  else p.onFree?.(raw);
}

$('pIn').addEventListener('input', () => pal && palRefresh());
$('pIn').addEventListener('keydown', (e) => {
  if (!pal) return;
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); palPick(); }
  else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); pal.sel = Math.min(pal.sel + 1, pal.list.length - 1); palRender(); }
  else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); pal.sel = Math.max(pal.sel - 1, 0); palRender(); }
});
$('overlay').addEventListener('mousedown', (e) => { if (e.target === $('overlay')) closePalette(); });

/* ───────────── comandos de paleta ───────────── */
function gotoAnything() {
  showPalette({
    placeholder: 'Ir para arquivo…  (arquivo:linha)',
    strip: (q) => q.replace(/:\d*$/, ''),
    items: () => idx.files.map((f) => ({ label: f.label || f.rel, path: f.path })),
    onSelect: (it, raw) => {
      const m = raw.match(/:(\d+)$/);
      openFile(it.path, m ? +m[1] : 0);
    },
  });
}

function gotoSymbol() {
  if (!active) return;
  const doc = view.state.doc;
  const md = isMd(active.path);
  const re = md ? /^#{1,6}\s+\S/ : /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|def|fn|func|interface|struct|enum|type)\b/;
  const items = [];
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text;
    if (re.test(t)) items.push({ label: t.trim(), detail: 'L' + i, line: i });
  }
  showPalette({ placeholder: md ? 'Ir para título…' : 'Ir para símbolo…', items: () => items, onSelect: (it) => goLine(it.line) });
}

function gotoLinePrompt() {
  if (!active) return;
  showPalette({ placeholder: 'Ir para linha…', onFree: (raw) => { const n = parseInt(raw, 10); if (n) goLine(n); } });
}

function findInFiles(initial = '') {
  if (!roots.length) return toast('Abra uma pasta primeiro');
  showPalette({
    placeholder: roots.length > 1 ? 'Buscar em todos os projetos (Enter para buscar)…' : 'Buscar em arquivos (Enter para buscar)…',
    initial,
    onFree: async (q) => {
      if (!q) return;
      toast('Buscando…');
      const res = (await Promise.all(roots.map((r) => api.search(r.path, q, false)))).flat();
      toast(`${res.length} resultado(s)`);
      showPalette({
        placeholder: `Resultados para "${q}"`,
        noFilter: true,
        items: () => res.map((r) => ({ label: r.text || '(linha vazia)', detail: `${relLabel(r.path)}:${r.line}`, path: r.path, line: r.line })),
        onSelect: (it) => openFile(it.path, it.line),
      });
    },
  });
}

/* ───────────── projeto / arquivos / pastas ───────────── */
function newFileIn(dir) {
  if (!root) return toast('Abra ou crie um projeto primeiro');
  showPalette({
    placeholder: `Novo arquivo em ${relPath(dir) || baseName(root)}/  (ex.: nota.md, pasta/outra.md)`,
    onFree: async (name) => {
      name = name.trim();
      if (!name) return;
      if (!/\.[A-Za-z0-9]+$/.test(name)) name += '.md';
      const p = joinPath(dir, name);
      const created = await api.create(p, isMd(p) ? `# ${stem(p)}\n\n` : '');
      if (!created) toast('Esse arquivo já existe; abrindo');
      expanded.add(dir); expanded.add(dirName(p));
      await loadWorkspace(root);
      openFile(p);
    },
  });
}

function newFolderIn(dir) {
  if (!root) return toast('Abra ou crie um projeto primeiro');
  showPalette({
    placeholder: `Nova pasta em ${relPath(dir) || baseName(root)}/`,
    onFree: async (name) => {
      name = name.trim();
      if (!name) return;
      const p = joinPath(dir, name);
      await api.mkdir(p);
      expanded.add(dir); expanded.add(p);
      await loadWorkspace(root);
    },
  });
}

// Projeto = uma pasta. Pergunta o nome, escolhe onde criar e abre como projeto.
function newProject() {
  showPalette({
    placeholder: 'Nome do novo projeto (será criada uma pasta)…',
    onFree: async (name) => {
      name = name.trim();
      if (!name) return;
      toast('Escolha onde criar a pasta do projeto…');
      const parent = await api.pickFolder();
      if (!parent) return;
      const p = joinPath(parent, name);
      await api.mkdir(p);
      await loadWorkspace(p);
      toast('Projeto criado: ' + p);
    },
  });
}

async function deletePath(p, isDir) {
  const what = isDir ? 'a pasta e tudo dentro dela' : 'o arquivo';
  const r = await askT(`Mover ${what} "${baseName(p)}" para a Lixeira?`, ['Mover para a Lixeira', 'Cancelar']);
  if (r !== 0) return;
  try { await api.trash(p); } catch (e) { return toast('Não consegui excluir: ' + e.message); }
  dropTabs((t) => t.path === p || t.path.startsWith(p + api.sep));
  await loadWorkspace(root);
  toast('Movido para a Lixeira: ' + baseName(p));
}

function showCtx(x, y, target) {
  const dir = target.dir ? target.path : dirName(target.path);
  const items = [
    ['Novo arquivo…', () => newFileIn(dir)],
    ['Nova pasta…', () => newFolderIn(dir)],
  ];
  if (!target.isRoot) {
    items.push(null,
      ['Renomear…', () => renamePath(target.path, target.dir)],
      ['Mostrar no Explorer', () => api.reveal(target.path)],
      ['Excluir (Lixeira)…', () => deletePath(target.path, target.dir), 'danger']);
  } else {
    items.push(null,
      ['Recarregar projeto', () => loadWorkspace(target.path)],
      ['Mostrar no Explorer', () => api.reveal(target.path)],
      ['Fechar projeto', () => closeProject(target.path), 'danger']);
  }
  showMenu(x, y, items);
}

// Menu flutuante genérico: items = [[texto, ação, classe?] | null (separador)]
function showMenu(x, y, items) {
  const box = $('ctx');
  box.textContent = '';
  for (const it of items) {
    if (!it) { box.append(document.createElement('hr')); continue; }
    const d = el('div', 'ci' + (it[2] ? ' ' + it[2] : ''), it[0]);
    d.onclick = () => { box.hidden = true; it[1](); };
    box.append(d);
  }
  box.hidden = false;
  box.style.left = Math.min(x, innerWidth - box.offsetWidth - 4) + 'px';
  box.style.top = Math.min(y, innerHeight - box.offsetHeight - 4) + 'px';
}

function renameNote() {
  if (active && !active.untitled) renamePath(active.path, false);
  else if (active) saveTab(active);
}

function renamePath(oldPath, isDir) {
  if (!root) return;
  const oldStem = isDir ? baseName(oldPath) : stem(oldPath);
  showPalette({
    placeholder: isDir ? 'Novo nome da pasta…' : 'Novo nome (links [[...]] serão atualizados)…',
    initial: oldStem,
    onFree: async (name) => {
      name = name.trim();
      if (!name || name === oldStem) return;
      if (!isDir) {
        const ext = (oldPath.match(/\.[^.\\/]+$/) || [''])[0];
        if (!/\.[A-Za-z0-9]+$/.test(name)) name += ext;
      }
      const newPath = joinPath(dirName(oldPath), name);
      if (!(await api.rename(oldPath, newPath))) return toast('Já existe um item com esse nome');
      const newStem = stem(newPath);
      const fix = (text) => text.replace(/\[\[([^\]\n]+)\]\]/g, (m, inner) => {
        const [target, ...alias] = inner.split('|');
        const h = target.indexOf('#');
        const base = (h < 0 ? target : target.slice(0, h)).trim();
        const segs = base.split('/');
        const last = stripMd(segs.pop());
        if (last.toLowerCase() !== oldStem.toLowerCase()) return m;
        const keepMd = /\.md$/i.test(base) ? '.md' : '';
        const newBase = [...segs, newStem + keepMd].join('/'); // mantém a pasta de [[pasta/nota]]
        return '[[' + newBase + (h < 0 ? '' : target.slice(h)) + (alias.length ? '|' + alias.join('|') : '') + ']]';
      });
      for (const t of tabs) {
        if (t.path === oldPath) {
          t.path = newPath;
          if (t.groupId) { delete groupAssign[oldPath]; groupAssign[newPath] = t.groupId; }
        }
        else if (isDir && t.path.startsWith(oldPath + api.sep)) t.path = newPath + t.path.slice(oldPath.length);
      }
      if (isDir) { expanded.delete(oldPath); expanded.add(newPath); }
      const mdFiles = isDir || !isMd(oldPath) ? [] : idx.files.filter((f) => isMd(f.path)).map((f) => f.path === oldPath ? newPath : f.path);
      let changed = 0;
      for (const p of mdFiles) {
        const tab = tabs.find((t) => t.path === p);
        if (tab) {
          const text = stateOf(tab).doc.toString();
          const out = fix(text);
          if (out === text) continue;
          const wasDirty = tab.dirty;
          applyTo(tab, { changes: { from: 0, to: text.length, insert: out } });
          if (wasDirty) tab.dirty = true; else await saveTab(tab);
          changed++;
        } else {
          let r;
          try { r = await api.readFile(p); } catch { continue; }
          const out = fix(r.text);
          if (out !== r.text) { await api.write(p, out, r.enc); changed++; }
        }
      }
      expanded.add(dirName(newPath));
      await loadWorkspace(root);
      renderTabs();
      toast(`Renomeado para ${name}; ${changed} arquivo(s) com links atualizados`);
    },
  });
}

// Formato de data do Obsidian (moment): YYYY, YY, MM, M, DD, D, HH, mm, ss e [texto literal]
function fmtDate(d, fmt) {
  const p = (n) => String(n).padStart(2, '0');
  const map = { YYYY: d.getFullYear(), YY: p(d.getFullYear() % 100), MM: p(d.getMonth() + 1), M: d.getMonth() + 1, DD: p(d.getDate()), D: d.getDate(), HH: p(d.getHours()), mm: p(d.getMinutes()), ss: p(d.getSeconds()) };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|mm|ss/g, (m, lit) => (lit !== undefined ? lit : map[m]));
}

// Se a pasta é um cofre do Obsidian (.obsidian), usa a configuração dele para notas diárias.
async function vaultDaily(r) {
  if (!(await api.isDir(joinPath(r, '.obsidian')))) return null;
  let cfg = {};
  try { cfg = JSON.parse((await api.readFile(joinPath(r, '.obsidian', 'daily-notes.json'))).text); } catch {}
  return { folder: (cfg.folder || '').replace(/^\/+|\/+$/g, ''), format: cfg.format || 'YYYY-MM-DD', template: cfg.template || '' };
}

async function dailyNote() {
  if (!root) return toast('Abra uma pasta primeiro');
  const d = new Date();
  const v = await vaultDaily(root);
  const name = fmtDate(d, v ? v.format : 'YYYY-MM-DD');
  const p = joinPath(root, v ? v.folder : settings.dailyFolder || 'Daily', name + '.md');
  let body = `# ${name}\n\n`;
  if (v && v.template) {
    try {
      const tp = joinPath(root, /\.md$/i.test(v.template) ? v.template : v.template + '.md');
      body = (await api.readFile(tp)).text
        .replace(/\{\{date(?::([^}]*))?\}\}/gi, (m, f) => fmtDate(d, f || 'YYYY-MM-DD'))
        .replace(/\{\{time(?::([^}]*))?\}\}/gi, (m, f) => fmtDate(d, f || 'HH:mm'))
        .replace(/\{\{title\}\}/gi, name);
    } catch {}
  }
  if (await api.create(p, body)) await loadWorkspace(root);
  openFile(p);
}

/* ───────────── importar do Sublime Text / Obsidian ───────────── */
const hashText = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return `${s.length}:${h}`; };
const loadList = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const saveList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function pushRecentFolder(p) {
  saveList('tt.recentFolders', [p, ...loadList('tt.recentFolders').filter((x) => x !== p)].slice(0, 30));
}
function openRecentFolder() {
  const list = loadList('tt.recentFolders');
  if (!list.length) return toast('Nenhum projeto recente ainda');
  showPalette({
    placeholder: 'Abrir projeto recente…',
    items: () => list.map((p) => ({ label: baseName(p), detail: dirName(p), path: p })),
    onSelect: (it) => loadWorkspace(it.path),
  });
}

const normNL = (s) => s.replace(/\r\n/g, '\n');
// Conteúdo das abas abertas agora: só isso evita duplicar. (Antes a importação lembrava para sempre o que já tinha
// importado, então abas fechadas ou rascunhos perdidos ao reabrir o app nunca voltavam.)
function openContentHashes() {
  const s = new Set();
  for (const t of tabs) {
    const text = normNL(stateOf(t).doc.toString());
    s.add(hashText(t.untitled ? text : t.path + text));
  }
  return s;
}

async function importSublime(auto = false) {
  const d = await api.importSublime();
  if (!d.found) return auto ? null : askT('Não encontrei o Sublime Text neste computador.', ['OK']);
  const done = openContentHashes();
  const files = d.tabs.filter((t) => t.file && !t.missing);
  const drafts = d.tabs.filter((t) => !t.file || t.missing);
  const fresh = drafts.filter((t) => !done.has(hashText(normNL(t.contents || ''))) && (t.contents || '').trim());
  const kb = Math.round(fresh.reduce((n, t) => n + (t.contents || '').length, 0) / 1024);
  const prefs = Object.keys(d.prefs);
  const lines = [
    `• ${files.length} arquivo(s) que estavam abertos`,
    `• ${fresh.length} aba(s) sem título / não salvas (${kb} KB de texto)` + (drafts.length > fresh.length ? ` — ${drafts.length - fresh.length} já aberta(s) ou vazia(s)` : ''),
    `• ${prefs.length ? 'preferências: ' + prefs.join(', ') : 'nenhuma preferência'}`,
    `• ${d.projects.length} projeto(s) .sublime-project, ${d.recentFiles.length} arquivo(s) e ${d.recentFolders.length} pasta(s) recentes`,
  ];
  if (!auto) {
    const r = await askT(`Importar do Sublime Text?\n\n${lines.join('\n')}\n\nO Sublime não é alterado (só leitura).`, ['Importar tudo', 'Cancelar']);
    if (r !== 0) return;
  }
  let opened = 0, drafted = 0;
  for (const t of d.tabs) {
    let tab;
    if (t.file && !t.missing) {
      await openFile(t.file);
      tab = tabs.find((x) => x.path === t.file);
      if (tab && typeof t.contents === 'string') {
        const h = hashText(t.file + normNL(t.contents));
        if (!done.has(h)) {
          // havia alterações não salvas no Sublime: mantém como alteração pendente
          applyTo(tab, { changes: { from: 0, to: stateOf(tab).doc.length, insert: t.contents } });
          tab.dirty = true;
          done.add(h);
        }
      }
      opened++;
    } else {
      const text = t.contents || '';
      if (!text.trim() || done.has(hashText(normNL(text)))) continue;
      tab = newUntitled(text, { eol: t.eol });
      done.add(hashText(normNL(text)));
      drafted++;
    }
    if (tab && tab === active && t.selection) {
      const pos = Math.min(t.selection, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  }
  if (prefs.length) { settings = { ...settings, ...d.prefs }; await saveSettingsObj(d.prefs); }
  for (const p of d.projects) for (const f of p.folders) await loadWorkspace(f);
  for (const f of d.recentFolders) pushRecentFolder(f);
  saveList('tt.recent', [...loadList('tt.recent'), ...d.recentFiles.filter((f) => !loadList('tt.recent').includes(f))].slice(0, 60));
  renderTabs();
  toast(`Importado do Sublime: ${opened} arquivo(s), ${drafted} aba(s) sem título`);
}

// Obsidian: abre um cofre como projeto e reabre as abas que ele tinha abertas.
async function importObsidian() {
  const d = await api.importObsidian();
  if (!d.vaults.length) return askT('Não encontrei cofres do Obsidian neste computador.', ['OK']);
  const open = async (v) => {
    await loadWorkspace(v.path);
    pushRecentFolder(v.path);
    for (const f of v.openFiles) await openFile(f);
    toast(`Cofre "${v.name}" aberto` + (v.openFiles.length ? ` com ${v.openFiles.length} nota(s) que estavam abertas` : ''));
  };
  if (d.vaults.length === 1) return open(d.vaults[0]);
  showPalette({
    placeholder: 'Escolha o cofre do Obsidian…',
    items: () => d.vaults.map((v) => ({ label: v.name, detail: v.path, v })),
    onSelect: (it) => open(it.v),
  });
}

/* ───────────── comandos de edição ───────────── */
// Alt+F3 (Sublime): seleciona todas as ocorrências da palavra (ou do trecho) selecionada; com o cursor numa palavra, começa por ela
function selectAllMatchesCmd(v) {
  const st = v.state;
  if (st.selection.main.empty) {
    const w = st.wordAt(st.selection.main.head);
    if (!w) return toast('Coloque o cursor numa palavra ou selecione um trecho');
    v.dispatch({ selection: { anchor: w.from, head: w.to } });
  }
  selectSelectionMatches(v);
}
// Linhas selecionadas viram tarefas "- [ ] texto" (se todas já forem tarefas, volta ao texto/lista normal)
function tasksFromLines(v) {
  const st = v.state; const doc = st.doc;
  const nums = new Set();
  for (const r of st.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    let b = doc.lineAt(r.to).number;
    if (!r.empty && b > a && r.to === doc.line(b).from) b--; // seleção que termina no começo da linha seguinte não conta essa linha
    for (let n = a; n <= b; n++) nums.add(n);
  }
  const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]\s?/;
  const BUL = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
  const lines = [...nums].sort((x, y) => x - y).map((n) => doc.line(n)).filter((l) => l.text.trim());
  if (!lines.length) return toast('Selecione as linhas que viram tarefas');
  const off = lines.every((l) => TASK.test(l.text));
  const changes = lines.map((l) => {
    const t = l.text;
    const nt = off ? t.replace(TASK, '$1') : TASK.test(t) ? t : BUL.test(t) ? t.replace(BUL, '$1[ ] ') : t.replace(/^(\s*)/, '$1- [ ] ');
    return nt === t ? null : { from: l.from, to: l.to, insert: nt };
  }).filter(Boolean);
  if (changes.length) v.dispatch({ changes, userEvent: 'input.tasks' });
  toast(off ? `${lines.length} tarefa(s) voltaram a texto` : `${lines.length} linha(s) viraram tarefas`);
}

const ed = (fn) => () => { if (active) { fn(view); view.focus(); } };

function mapSelections(fn) {
  view.dispatch(view.state.changeByRange((r) => {
    if (r.empty) return { range: r };
    const out = fn(view.state.sliceDoc(r.from, r.to));
    return { changes: { from: r.from, to: r.to, insert: out }, range: EditorSelection.range(r.from, r.from + out.length) };
  }));
}

function splitSelectionByLine(v) {
  const { doc } = v.state;
  const ranges = [];
  for (const r of v.state.selection.ranges) {
    if (r.empty) { ranges.push(r); continue; }
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) {
      const l = doc.line(n);
      if (n > a && n === b && r.to === l.from) continue;
      ranges.push(EditorSelection.cursor(Math.min(l.to, r.to)));
    }
  }
  v.dispatch({ selection: EditorSelection.create(ranges) });
}

function joinLines(v) {
  const { doc } = v.state;
  const seen = new Set();
  const changes = [];
  for (const r of v.state.selection.ranges) {
    const first = doc.lineAt(r.from).number;
    const last = r.empty ? first + 1 : doc.lineAt(r.to).number;
    for (let n = first; n < last && n < doc.lines; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const a = doc.line(n);
      const b = doc.line(n + 1);
      changes.push({ from: a.to, to: b.from + b.text.match(/^\s*/)[0].length, insert: ' ' });
    }
  }
  changes.sort((x, y) => x.from - y.from);
  if (changes.length) v.dispatch({ changes });
}

function sortLines(v) {
  const { doc, selection } = v.state;
  const r = selection.main;
  const a = r.empty ? 1 : doc.lineAt(r.from).number;
  const b = r.empty ? doc.lines : doc.lineAt(r.to).number;
  const from = doc.line(a).from;
  const to = doc.line(b).to;
  const lines = doc.sliceString(from, to).split('\n').sort((x, y) => x.localeCompare(y));
  v.dispatch({ changes: { from, to, insert: lines.join('\n') } });
}

function wrapSel(mark) {
  view.dispatch(view.state.changeByRange((r) => ({
    changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }],
    range: EditorSelection.range(r.from + mark.length, r.to + mark.length),
  })));
}

// Formata JSON em qualquer tipo de arquivo (inclusive .md):
// 1) a seleção, se houver; 2) o arquivo todo, se ele inteiro for JSON; 3) o JSON que começa na linha do cursor.
function jsonRange(v) {
  const { state } = v;
  const r = state.selection.main;
  if (!r.empty) return { from: r.from, to: r.to };
  const whole = state.doc.toString();
  try { JSON.parse(whole); return { from: 0, to: whole.length }; } catch {}
  // Sobe a partir da linha do cursor (até uma linha em branco) e guarda o JSON válido mais externo
  // que contém o cursor; assim funciona tanto com o JSON numa linha só quanto já formatado.
  const cur = state.doc.lineAt(r.head);
  let best = null;
  for (let n = cur.number; n >= 1; n--) {
    const ln = state.doc.line(n);
    if (!ln.text.trim()) break;
    const i = ln.text.search(/[{[]/);
    if (i < 0) continue;
    const end = jsonEnd(whole, ln.from + i);
    if (end < 0 || end < cur.from) continue;
    try { JSON.parse(whole.slice(ln.from + i, end)); best = { from: ln.from + i, to: end }; } catch {}
  }
  return best;
}

// Posição logo após o fechamento do { ou [ em `start` (respeita strings), ou -1.
function jsonEnd(text, start) {
  let depth = 0, inStr = false;
  for (let p = start; p < text.length; p++) {
    const c = text[p];
    if (inStr) { if (c === '\\') p++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { if (--depth === 0) return p + 1; }
  }
  return -1;
}

function reformatJson(v, indent) {
  const rg = jsonRange(v);
  if (!rg) return toast('Nenhum JSON sob o cursor (ou selecione o trecho)');
  let out;
  try {
    out = JSON.stringify(JSON.parse(v.state.sliceDoc(rg.from, rg.to).trim()), null, indent);
  } catch (e) { return toast('JSON inválido: ' + e.message); }
  // Em Markdown, JSON solto é lido como links/listas e fica sem cor: coloca num bloco ```json
  // Se o .md estiver com sintaxe forçada (ex.: JSON/Texto), o bloco não ganha cor: volta para o automático.
  let reset = false;
  if (active && active.lang !== 'Markdown' && isMd(active.path) && active.manual) {
    saveSyntax(active.path, null);
    setLanguage(active);
    reset = true;
    toast('Sintaxe deste .md voltou para Markdown (automático)');
  }
  // dentro de um bloco ``` já existente? (conta as cercas acima; independe da linguagem ativa)
  let fences = 0;
  for (let n = v.state.doc.lineAt(rg.from).number - 1; n >= 1; n--) if (/^\s*(```|~~~)/.test(v.state.doc.line(n).text)) fences++;
  const inFence = fences % 2 === 1;
  if (active?.lang === 'Markdown' && !inFence) {
    out = jsonBlock(v, rg.from, rg.to, out);
  }
  v.dispatch({ changes: { from: rg.from, to: rg.to, insert: out } });
}

// Envolve o JSON num bloco ```json, garantindo que as cercas fiquem em linhas próprias.
function jsonBlock(v, from, to, json, lang = 'json') {
  const { doc } = v.state;
  const pre = from > doc.lineAt(from).from ? '\n' : '';
  const post = to < doc.lineAt(to).to ? '\n' : '';
  return `${pre}\`\`\`${lang}\n${json}\n\`\`\`${post}`;
}

/* ───────────── formatar XML, SQL, JavaScript, CSS e HTML ───────────── */
const formatOpts = () => ({
  indent: settings.formatIndent ?? settings.jsonIndent ?? 2,
  sqlLanguage: sqlDialect(active?.lang, settings.sqlDialect),
  sqlCase: settings.sqlKeywordCase || 'preserve',
  sqlIndent: settings.sqlIndent || 4,
});

// Bloco ``` ... ``` que contém a posição: { from, to } do conteúdo (sem as cercas) e a linguagem da cerca
function fenceAround(state, pos) {
  const { doc } = state;
  let open = 0;
  for (let n = 1; n <= doc.lines; n++) {
    if (!/^\s*(```|~~~)/.test(doc.line(n).text)) continue;
    if (!open) { open = n; continue; }
    if (pos >= doc.line(open).from && pos <= doc.line(n).to && n - open >= 2) {
      return { from: doc.line(open + 1).from, to: doc.line(n - 1).to, info: (doc.line(open).text.match(/^\s*(?:```|~~~)\s*([\w+-]+)/) || [])[1] || '' };
    }
    open = 0;
  }
  return null;
}

// O que formatar: a seleção; senão o arquivo todo; em Markdown, o bloco ``` do cursor ou o parágrafo do cursor
function codeRegion(v) {
  const { state } = v;
  const r = state.selection.main;
  if (!r.empty) { const f = fenceAround(state, r.from); return { from: r.from, to: r.to, inFence: !!f, info: f ? f.info : '' }; }
  if (active?.lang !== 'Markdown') return { from: 0, to: state.doc.length, inFence: false, info: '' };
  const f = fenceAround(state, r.head);
  if (f) return { from: f.from, to: f.to, inFence: true, info: f.info };
  const { doc } = state;
  let a = doc.lineAt(r.head).number;
  let b = a;
  while (a > 1 && doc.line(a - 1).text.trim()) a--;
  while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
  return { from: doc.line(a).from, to: doc.line(b).to, inFence: false, info: '' };
}

function reformatCode(v, kind, compact = false) {
  const f = FORMATS[kind];
  if (compact && !f.compact) return toast(`${f.label}: não tem versão em uma linha`);
  const rg = codeRegion(v);
  const text = v.state.sliceDoc(rg.from, rg.to);
  if (!text.trim()) return toast('Nada para formatar aqui (selecione o trecho)');
  let out;
  try { out = compact ? f.compact(text) : f.format(text, formatOpts()); } catch (e) { return toast(`${f.label} inválido: ${String(e.message || e).split('\n')[0].slice(0, 90)}`); }
  if (out === text) return toast(compact ? 'Já está em uma linha' : 'Já está formatado');
  // em Markdown, o trecho solto vai para um bloco com a cerca da linguagem (fica colorido e o Markdown não o estraga)
  if (active?.lang === 'Markdown' && !rg.inFence) out = jsonBlock(v, rg.from, rg.to, out, f.fence);
  v.dispatch({ changes: { from: rg.from, to: rg.to, insert: out } });
  toast(`${f.label} ${compact ? 'em uma linha' : 'formatado'}`);
}

const FENCE_KIND = { json: 'json', xml: 'xml', svg: 'xml', sql: 'sql', js: 'js', javascript: 'js', jsx: 'js', ts: 'js', css: 'css', scss: 'css', html: 'html' };
// Formata detectando o tipo: pela linguagem da cerca (```sql), pela sintaxe do arquivo ou olhando o texto
function formatAuto(v, compact = false) {
  const rg = codeRegion(v);
  const text = v.state.sliceDoc(rg.from, rg.to);
  const kind = FENCE_KIND[rg.info.toLowerCase()] || detectKind(text, active?.lang === 'Markdown' ? '' : active?.lang);
  if (!kind) return toast('Não reconheci o formato. Selecione o trecho ou use Editar → Formatar como…');
  if (kind === 'json') return reformatJson(v, compact ? 0 : formatOpts().indent);
  reformatCode(v, kind, compact);
}

// Log de integração colado num .md: JSON e SQL já entram formatados, cada um no seu bloco (desligue com "autoLogOnPaste": false)
function logOpts() { const o = formatOpts(); return { indent: settings.jsonIndent ?? 2, sqlIndent: o.sqlIndent, caseKw: o.sqlCase }; }
function pasteLog(e, v) {
  if (settings.autoLogOnPaste === false || active?.lang !== 'Markdown') return false;
  const t = e.clipboardData?.getData('text/plain');
  if (!t || !hasLog(t)) return false;
  const r = formatLog(t, logOpts());
  if (!r.blocks.sql && !r.blocks.json) return false;
  e.preventDefault();
  const sel = v.state.selection.main;
  v.dispatch({ changes: { from: sel.from, to: sel.to, insert: r.text }, selection: { anchor: sel.from + r.text.length }, userEvent: 'input.paste', scrollIntoView: true });
  toast(`Log formatado: ${r.blocks.sql} SQL e ${r.blocks.json} JSON em blocos (Ctrl+Z desfaz)`);
  return true;
}
// Formata um log que já está no documento (a seleção, ou o documento todo)
function formatLogCmd(v) {
  const sel = v.state.selection.main; const whole = sel.empty;
  const from = whole ? 0 : sel.from; const to = whole ? v.state.doc.length : sel.to;
  const text = v.state.sliceDoc(from, to);
  if (!hasLog(text) && /^(\[[^\]\n]+\]\([^)\n]*\):|SQL \([^)\n]*\):)[ \t]*$/m.test(text)) return toast('Já está formatado');
  if (!hasLog(text)) return toast('Não achei trechos de log ([consulta](…): select…, SQL (…): update…, [requisicao](…): {…}) para formatar');
  const r = formatLog(text, logOpts());
  if (r.text === text) return toast('Já está formatado');
  v.dispatch({ changes: { from, to, insert: r.text } });
  toast(`Log formatado: ${r.blocks.sql} SQL e ${r.blocks.json} JSON`);
}

// Colar JSON num .md já cria o bloco formatado (desligue com "autoJsonOnPaste": false).
function pasteJson(e, v) {
  if (settings.autoJsonOnPaste === false || active?.lang !== 'Markdown') return false;
  const t = e.clipboardData?.getData('text/plain')?.trim();
  if (!t || !(t[0] === '{' || (t[0] === '[' && /[{,]/.test(t)))) return false;
  let out;
  try { out = JSON.stringify(JSON.parse(t), null, settings.jsonIndent ?? 2); } catch { return false; }
  const r = v.state.selection.main;
  if (/Code/.test(syntaxTree(v.state).resolveInner(r.from, 1).name)) return false;
  e.preventDefault();
  v.dispatch({ changes: { from: r.from, to: r.to, insert: jsonBlock(v, r.from, r.to, out) }, userEvent: 'input.paste' });
  toast('JSON colado e formatado em bloco');
  return true;
}

// Corretor ortográfico: o menu do botão direito mostra as sugestões e "adicionar ao dicionário"
async function editorMenu(e, v) {
  e.preventDefault();
  const x = e.clientX; const y = e.clientY;
  let sp = null;
  if (settings.spellcheck) {
    const pos = v.posAtCoords({ x, y }); const w = pos != null ? spellWordAt(v, pos) : null;
    if (w && w.text.length >= 3 && await spellIsBad(w.text)) {
      const list = spellSuggest(w.text);
      const first = await Promise.race([list, new Promise((r) => setTimeout(() => r(null), 180))]);
      sp = { w, list: first || [] };
      if (!first) list.then((l) => { if (!$('ctx').hidden && sp) { sp.list = l; editorMenuShow(x, y, v, sp); } }); // sugestões lentas: atualiza o menu aberto
    }
  }
  editorMenuShow(x, y, v, sp);
  return true;
}
// Traduzir o texto selecionado (editor, preview, notas compartilhadas). replace: troca a seleção pelo texto traduzido (só no editor)
function translateText(text, replace) {
  if (settings.translateEnabled === false) return toast('A tradução está desligada nas configurações.');
  return openTranslate({ text, api, ask: askT, toast, replace, allowed: settings.translateAllowed === true, setAllowed: () => saveSettingsObj({ translateAllowed: true }) });
}
function translateEditorSel(v) {
  const r = v.state.selection.main;
  if (r.empty) return toast('Selecione um texto para traduzir.');
  const from = r.from; const to = r.to;
  translateText(v.state.sliceDoc(from, to), (nt) => { v.dispatch({ changes: { from, to, insert: nt }, selection: { anchor: from + nt.length }, userEvent: 'input.complete' }); v.focus(); });
}
// seleção em áreas só de leitura (preview e mensagens do chat): botão direito → Traduzir
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented || settings.translateEnabled === false) return;
  const sel = String(window.getSelection() || '').trim();
  if (!sel || !e.target.closest || !e.target.closest('#preview, .sh-md')) return;
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [['Traduzir a seleção…', () => translateText(sel)], ['Copiar', () => document.execCommand('copy')]]);
});
function editorMenuShow(x, y, v, sp) {
  const spell = [];
  if (sp) {
    const { w, list } = sp;
    if (list.length) for (const s of list) spell.push([s, () => { v.dispatch({ changes: { from: w.from, to: w.to, insert: s }, selection: { anchor: w.from + s.length }, userEvent: 'input.complete' }); v.focus(); }, 'spell-sugg']);
    else spell.push(['(sem sugestões)', () => {}, 'spell-none']);
    spell.push([`Adicionar “${w.text}” ao dicionário`, async () => { const ud = [...new Set([...(settings.userDict || []), w.text])]; await spellAddWord(w.text); await saveSettingsObj({ userDict: ud }); toast('Adicionada ao dicionário'); v.focus(); }], null);
  }
  const clip = (cmd) => () => { v.focus(); document.execCommand(cmd); };
  const hasSel = !v.state.selection.main.empty;
  showMenu(x, y, [
    ...spell,
    ...(hasSel && settings.translateEnabled !== false ? [['Traduzir a seleção…', () => translateEditorSel(v)], null] : []),
    ['Formatar log (SQL e JSON)', () => { formatLogCmd(v); v.focus(); }],
    [pinnedHere(v) ? '📌 Desafixar esta linha' : '📌 Fixar esta linha', () => { togglePinLines(v); v.focus(); }],
    ['📌 Linhas fixadas…', () => pinsPanel()],
    null,
    ...(hasSel ? [['Filtro SQL: lista → IN', () => { sqlFilterQuick('in'); }], ['Filtro SQL: lista → NOT IN', () => { sqlFilterQuick('notin'); }], ['Filtro SQL: LIKE e outros…', () => openSqlFilter()], null] : []),
    ...(hasSel && v.state.doc.lineAt(v.state.selection.main.from).number !== v.state.doc.lineAt(v.state.selection.main.to).number ? [['Transformar linhas selecionadas em tarefas ☑', () => { tasksFromLines(v); v.focus(); }]] : []),
    [hasSel ? 'Formatar a seleção (detecta o tipo)' : 'Formatar (detecta o tipo)', () => { formatAuto(v); v.focus(); }],
    ['Formatar como JSON', () => { formatJson(v); v.focus(); }],
    ['Formatar como XML', () => { reformatCode(v, 'xml'); v.focus(); }],
    ['Formatar como SQL', () => { reformatCode(v, 'sql'); v.focus(); }],
    ['Compactar em uma linha', () => { formatAuto(v, true); v.focus(); }],
    null,
    ['Copiar', clip('copy')],
    ['Recortar', clip('cut')],
    ['Colar', clip('paste')],
    ['Selecionar tudo', () => { v.focus(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); }],
    null,
    ['Definir sintaxe…', pickSyntax],
  ]);
  return true;
}
const formatJson = (v) => reformatJson(v, settings.jsonIndent ?? 2);
const minifyJson = (v) => reformatJson(v, 0);

function followLink() {
  if (!active) return;
  const t = linkAt(view, view.state.selection.main.head);
  if (t) openWiki(t); else toast('Nenhum [[link]] sob o cursor');
}

function toggleEl(id, after) {
  const e = $(id);
  e.hidden = !e.hidden;
  after?.();
}

/* ───────────── grafo ───────────── */
let graphOn = false;
function showGraph() {
  const cv = $('graph');
  cv.hidden = false;
  graphOn = true;
  cv.width = innerWidth;
  cv.height = innerHeight;
  const g = cv.getContext('2d');
  const notes = idx.files.filter((f) => isMd(f.path));
  const pos = new Map(notes.map((f, i) => [f.path, i]));
  const nodes = notes.map((f) => ({ f, x: cv.width / 2 + (Math.random() - 0.5) * 400, y: cv.height / 2 + (Math.random() - 0.5) * 400, vx: 0, vy: 0, deg: 0 }));
  const edges = [];
  for (const f of notes) {
    for (const l of idx.links.get(f.path) || []) {
      const t = idx.byName.get(l);
      if (t && t.path !== f.path && pos.has(t.path)) {
        edges.push([pos.get(f.path), pos.get(t.path)]);
        nodes[pos.get(f.path)].deg++; nodes[pos.get(t.path)].deg++;
      }
    }
  }
  let hover = -1;
  let step = 0;
  const frame = () => {
    if (!graphOn) return;
    if (step++ < 400) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        a.vx += (cv.width / 2 - a.x) * 0.002;
        a.vy += (cv.height / 2 - a.y) * 0.002;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          const d2 = Math.max(dx * dx + dy * dy, 25);
          const f = 2500 / d2, d = Math.sqrt(d2);
          dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      for (const [i, j] of edges) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const f = (d - 80) * 0.02;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const n of nodes) { n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy; }
    }
    g.clearRect(0, 0, cv.width, cv.height);
    const cs = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    g.strokeStyle = cs('--border2');
    g.beginPath();
    for (const [i, j] of edges) { g.moveTo(nodes[i].x, nodes[i].y); g.lineTo(nodes[j].x, nodes[j].y); }
    g.stroke();
    g.font = '11px Segoe UI';
    nodes.forEach((n, i) => {
      g.fillStyle = i === hover || n.f.path === active?.path ? cs('--accent') : cs('--fg');
      g.beginPath(); g.arc(n.x, n.y, 3 + Math.min(n.deg, 8), 0, 7); g.fill();
      g.fillStyle = i === hover ? cs('--strong') : cs('--dim');
      g.fillText(n.f.name, n.x + 8, n.y + 3);
    });
    g.fillStyle = cs('--dim');
    g.fillText(`${nodes.length} notas · ${edges.length} links · clique para abrir · Esc para fechar`, 12, 20);
    requestAnimationFrame(frame);
  };
  const near = (e) => nodes.findIndex((n) => Math.hypot(n.x - e.clientX, n.y - e.clientY) < 10 + Math.min(n.deg, 8));
  cv.onmousemove = (e) => { hover = near(e); cv.style.cursor = hover >= 0 ? 'pointer' : 'default'; };
  cv.onclick = (e) => { const i = near(e); if (i >= 0) { closeGraph(); openFile(nodes[i].f.path); } };
  frame();
}
function closeGraph() { graphOn = false; $('graph').hidden = true; if (active) view.focus(); }

/* ───────────── tabela de comandos + atalhos ───────────── */
// id: [título, atalho padrão, ação]
const COMMANDS = {
  language: ['Idioma do aplicativo…', '', () => pickLanguage()],
  palette: ['Paleta de comandos', 'ctrl+shift+p', () => commandPalette()],
  goto: ['Ir para arquivo (Goto Anything)', 'ctrl+p', gotoAnything],
  gotoSymbol: ['Ir para título/símbolo', 'ctrl+r', gotoSymbol],
  gotoLine: ['Ir para linha', 'ctrl+g', gotoLinePrompt],
  findInFiles: ['Buscar em arquivos', 'ctrl+shift+f', () => findInFiles()],
  find: ['Buscar / substituir no arquivo', 'ctrl+h', ed(openSearchPanel)],
  openFolder: ['Adicionar pasta como projeto', 'ctrl+shift+o', pickFolder],
  openFile: ['Abrir arquivo(s)…', 'ctrl+o', openFilesDialog],
  openRecent: ['Abrir arquivo recente…', 'ctrl+k ctrl+o', openRecent],
  openRecentFolder: ['Abrir projeto recente…', '', openRecentFolder],
  newGroup: ['Novo grupo de abas…', '', () => newGroup()],
  groupTab: ['Agrupar aba atual…', '', () => groupTabPalette()],
  ungroupTab: ['Tirar aba atual do grupo', '', () => { if (active && active.groupId) assignTab(active, null); }],
  saveGroup: ['Salvar grupo em pastas…', '', () => pickGroup('Qual grupo salvar em pastas?', (id) => saveGroup(id))],
  importSublime: ['Importar do Sublime Text…', '', importSublime],
  importObsidian: ['Importar do Obsidian (abrir cofre)…', '', importObsidian],
  encoding: ['Codificação / quebra de linha…', '', pickEncoding],
  reloadFolder: ['Recarregar projetos', '', () => loadWorkspace()],
  closeProject: ['Fechar projeto atual', '', () => root && closeProject(root)],
  newNote: ['Nova nota na pasta do projeto', 'ctrl+k ctrl+n', () => newFileIn(root)],
  renameNote: ['Renomear nota (atualiza links)', 'f2', renameNote],
  livePreview: ['Alternar Live Preview (Markdown renderizado) · fora do Markdown: usar a seleção na busca', 'ctrl+e', () => {
    if (active && view && !isMdTab(active)) { const t = SX.useSelectionForFind(view); if (t) return toast(`Busca: “${t.length > 40 ? t.slice(0, 40) + '…' : t}” (F3 acha o próximo, Shift+F3 o anterior)`); }
    setSetting('livePreview', settings.livePreview === false);
  }],
  toggleMinimap: ['Alternar minimap', '', () => setSetting('minimap', !settings.minimap)],
  dailyNote: ['Nota diária', 'ctrl+k ctrl+d', dailyNote],
  save: ['Salvar', 'ctrl+s', () => saveTab()],
  switchTab: ['Ir para aba aberta…', 'ctrl+k', switchTab],
  reopenClosed: ['Reabrir aba fechada', 'ctrl+shift+t', reopenClosed],
  compareTabs: ['Comparar abas lado a lado…', '', compareCmd],
  openBeside: ['Abrir aba ao lado…', 'ctrl+k ctrl+right', openBesideCmd],
  singlePane: ['Uma coluna (fechar os painéis lado a lado)', '', singlePane],
  columns2: ['Layout: 2 colunas', '', () => layoutColumns(2)],
  columns3: ['Layout: 3 colunas', '', () => layoutColumns(3)],
  nextDiff: ['Próxima diferença', 'f7', () => gotoDiff(1)],
  prevDiff: ['Diferença anterior', 'shift+f7', () => gotoDiff(-1)],
  stopCompare: ['Sair da comparação (manter lado a lado)', '', () => setCompare(false)],
  saveAs: ['Salvar como…', 'ctrl+shift+s', () => saveTab(active, true)],
  titleCase: ['Maiúscula Inicial Em Cada Palavra (Title Case)', 'ctrl+k ctrl+t', ed(SX.titleCase)],
  swapCase: ['Inverter maiúsculas e minúsculas', '', ed(SX.swapCase)],
  transpose: ['Trocar as duas letras ao redor do cursor (Transpose)', 'ctrl+t', ed(transposeChars)],
  deleteToEol: ['Apagar até o fim da linha', 'ctrl+k ctrl+k', ed(deleteToLineEnd)],
  deleteToBol: ['Apagar até o começo da linha', 'ctrl+k ctrl+backspace', ed(deleteLineBoundaryBackward)],
  insertLineBefore: ['Inserir linha acima', 'ctrl+shift+enter', ed(SX.insertLineBefore)],
  insertLineAfter: ['Inserir linha abaixo', 'ctrl+enter', ed(SX.insertLineAfter)],
  reverseLines: ['Linhas: inverter a ordem', '', ed(SX.reverseLines)],
  uniqueLines: ['Linhas: remover repetidas', '', ed(SX.uniqueLines)],
  shuffleLines: ['Linhas: embaralhar', '', ed(SX.shuffleLines)],
  sortLinesNoCase: ['Ordenar linhas (ignora maiúsculas e minúsculas)', '', ed(SX.sortLinesNoCase)],
  sortLinesCase: ['Ordenar linhas (diferencia maiúsculas e minúsculas)', 'ctrl+f9', ed(SX.sortLinesCase)],
  selectBrackets: ['Selecionar o conteúdo dos colchetes / parênteses / chaves (repetir expande)', 'ctrl+shift+m', ed(SX.selectBrackets)],
  expandScope: ['Expandir a seleção para o bloco (escopo)', 'ctrl+shift+space', ed(selectParentSyntax)],
  gotoBracket: ['Ir para o colchete correspondente', 'ctrl+m', ed(cursorMatchingBracket)],
  blockComment: ['Comentário de bloco', 'ctrl+shift+/', ed((v) => {
    const r = v.state.selection.main;
    if (r.empty) { const l = v.state.doc.lineAt(r.head); const a = l.from + (/^\s*/.exec(l.text)[0].length); const z = l.to - (/\s*$/.exec(l.text)[0].length); if (z > a) v.dispatch({ selection: { anchor: a, head: z } }); }
    toggleBlockComment(v);
  })],
  unfoldAllCmd: ['Desdobrar tudo', 'ctrl+k ctrl+0', ed(SX.unfoldEverything)],
  unfoldAllCmd2: ['Desdobrar tudo (Ctrl+K Ctrl+J)', 'ctrl+k ctrl+j', ed(SX.unfoldEverything)],
  toSpaces: ['Converter a indentação para espaços', '', ed((v) => { if (!SX.convertIndent(v, false)) toast('Nada para converter: já está em espaços'); })],
  toTabs: ['Converter a indentação para tabs', '', ed((v) => { if (!SX.convertIndent(v, true)) toast('Nada para converter: já está em tabs'); })],
  toggleSpell: ['Corretor ortográfico: ligar / desligar', 'f6', () => { setSetting('spellcheck', !settings.spellcheck); toast(settings.spellcheck ? 'Corretor ortográfico desligado' : 'Corretor ortográfico ligado (português e inglês)'); }],
  distraction: ['Modo sem distração (tela cheia, só o texto)', 'shift+f11', () => toggleDistraction()],
  devtools: ['Console do desenvolvedor (erros e mensagens do app)', 'ctrl+`', () => api.toggleDevTools()],
  snippetInsert: ['Snippets: inserir…', '', () => pickSnippet()],
  snippetNew: ['Snippets: criar um snippet com o texto selecionado…', '', () => newSnippetFromSelection()],
  macroRec: ['Macro: gravar / parar de gravar', 'ctrl+q', () => macroToggle()],
  macroPlayCmd: ['Macro: repetir a última gravada', 'ctrl+shift+q', () => macroPlay(macro.last)],
  macroSaveCmd: ['Macro: salvar a última com um nome…', '', () => macroSave()],
  macroRunCmd: ['Macro: executar uma salva…', '', () => macroPick(false)],
  macroDeleteCmd: ['Macro: apagar uma salva…', '', () => macroPick(true)],
  buildRun: ['Build: rodar este arquivo (fora do Markdown)', '', () => runBuild()],
  buildPickCmd: ['Build com… (escolher ou digitar o comando)', 'ctrl+shift+b', () => buildPick()],
  buildStopCmd: ['Build: parar', 'ctrl+pause', () => { if (build.running) { api.buildStop(build.id); toast('Build interrompido'); } }],
  buildNextErr: ['Build: ir para o próximo erro', 'f4', () => buildStep(1)],
  buildPrevErr: ['Build: ir para o erro anterior', 'shift+f4', () => buildStep(-1)],
  whitespace: ['Mostrar espaços e tabs: alternar (nunca → só na seleção → sempre)', '', () => { const order = ['none', 'selection', 'all']; const cur = settings.drawWhitespace || 'selection'; const nx = order[(order.indexOf(cur) + 1) % 3]; setSetting('drawWhitespace', nx); toast({ none: 'Espaços: não mostrar', selection: 'Espaços: só no texto selecionado', all: 'Espaços: sempre (● espaço, → tab)' }[nx]); }],
  exportPdf: ['Exportar a guia como PDF…', '', () => exportGuide('pdf')],
  exportDocx: ['Exportar a guia como Word (.docx)…', '', () => exportGuide('docx')],
  saveAll: ['Salvar tudo', '', async () => { for (const t of [...tabs]) if (t.dirty) await saveTab(t); }],
  themeEditor: ['Tema: editar cores / colar JSON do tema…', '', () => openThemeEditor()],
  themeNext: ['Tema: alternar para o próximo', '', () => { const i = THEMES.findIndex((x) => x.id === themeById(settings.theme).id); setSetting('theme', THEMES[(i + 1) % THEMES.length].id); }],
  toggleImgCap: ['Nome (legenda) embaixo das imagens: mostrar/esconder nesta aba', '', toggleImgCaption],
  translate: ['Traduzir o texto selecionado', '', () => { if (active && view && !active.srv && !isCanvas(active)) translateEditorSel(view); else toast('Selecione um texto no editor para traduzir.'); }],
  updateCheck: ['Atualização do app: verificar no servidor', '', updateCheckFlow],
  updatePublish: ['Atualização do app: publicar um instalador no servidor (administrador)', '', updatePublishFlow],
  updateLog: ['Atualização do app: abrir o registro (log) de envio e download', '', () => api.updateOpenLog()],
  serverAddress: ['Servidor neste computador: mostrar o endereço para entrar', '', serverAddressFlow],
  serverStart: ['Servidor neste computador: iniciar', '', () => serverStartFlow(false)],
  serverRestart: ['Servidor neste computador: reiniciar (aplica a versão nova do app)', '', () => serverStartFlow(true)],
  serverStop: ['Servidor neste computador: parar', '', serverStopFlow],
  serverAutostart: ['Servidor neste computador: iniciar junto com o Windows (liga/desliga)', '', serverAutostartFlow],
  sharedLogin: ['Compartilhado: entrar no servidor…', '', () => shared.login()],
  newCanvas: ['Novo canvas (quadro de cartões)', '', newCanvas],
  canvasToggleJson: ['Canvas: alternar entre quadro e JSON', '', toggleCanvasJson],
  newSticky: ['Nota flutuante: nova (atalho global Ctrl+Alt+N)', '', () => api.notesNew('')],
  stickyFromSel: ['Nota flutuante: enviar a seleção (ou a aba) para uma nota', '', () => {
    if (!active) return api.notesNew('');
    const r = view.state.selection.main;
    api.notesNew(r.empty ? view.state.doc.toString() : view.state.sliceDoc(r.from, r.to));
  }],
  stickyList: ['Nota flutuante: abrir…', '', stickyPicker],
  stickyToggle: ['Nota flutuante: mostrar / ocultar todas', '', () => api.notesToggle()],
  quit: ['Sair (mantém tudo para a próxima vez)', '', () => api.quit()],
  quitDiscard: ['Sair e descartar alterações não salvas…', '', async () => {
    const r = await askT('Sair e DESCARTAR rascunhos e alterações não salvas?\n\nOs arquivos já salvos não são afetados. O que não foi salvo será perdido.', ['Descartar e sair', 'Cancelar']);
    if (r === 0) { await api.draftsSave([]); api.forceClose(); }
  }],
  undo: ['Desfazer', '', ed(undo)],
  redo: ['Refazer', '', ed(redo)],
  cut: ['Recortar', '', () => { if (active) { view.focus(); document.execCommand('cut'); } }],
  copy: ['Copiar', '', () => { if (active) { view.focus(); document.execCommand('copy'); } }],
  paste: ['Colar', '', () => { if (active) { view.focus(); document.execCommand('paste'); } }],
  selectAll: ['Selecionar tudo', '', ed(selectAll)],
  selectNext: ['Selecionar próxima ocorrência', '', ed(selectNextOccurrence)],
  fontBigger: ['Aumentar fonte', 'ctrl+=', () => setSetting('fontSize', Math.min(40, (settings.fontSize || 14) + 1))],
  fontSmaller: ['Diminuir fonte', 'ctrl+-', () => setSetting('fontSize', Math.max(8, (settings.fontSize || 14) - 1))],
  fontReset: ['Restaurar tamanho da fonte', 'ctrl+0', () => setSetting('fontSize', 14)],
  news: ['Novidades (o que mudou em cada versão)', '', showNews],
  about: ['Sobre o TT Note', '', () => api.about()],
  support: ['Apoiar o projeto… (um Monster)', '', () => showSupport()],
  closeTab: ['Fechar aba', 'ctrl+w', () => closeTab()],
  nextTab: ['Próxima aba', 'ctrl+pagedown', () => cycleTab(1)],
  prevTab: ['Aba anterior', 'ctrl+pageup', () => cycleTab(-1)],
  nextTab2: ['Próxima aba (Ctrl+Tab)', 'ctrl+tab', () => cycleTab(1)],
  prevTab2: ['Aba anterior (Ctrl+Shift+Tab)', 'ctrl+shift+tab', () => cycleTab(-1)],
  sidebar: ['Mostrar/ocultar barra lateral', 'ctrl+k ctrl+b', () => { toggleEl('sidebar'); $('resizer').hidden = $('sidebar').hidden; }],
  backlinks: ['Mostrar/ocultar backlinks', 'ctrl+k ctrl+r', () => toggleEl('right', renderRight)],
  preview: ['Mostrar/ocultar preview Markdown', 'ctrl+shift+v', () => toggleEl('preview', renderPreview)],
  graph: ['Visão de grafo', 'ctrl+shift+g', showGraph],
  followLink: ['Abrir [[link]] sob o cursor', 'alt+enter', followLink],
  settings: ['Preferências: abrir settings.json', 'ctrl+,', () => openFile(settingsPath)],
  toggleWrap: ['Wrap: alternar quebra de linha (só nesta guia)', 'alt+z', () => { if (!active) return; setWrap(active, !wrapOn(active), true); toast(wrapOn(active) ? 'Quebra de linha ligada nesta guia' : 'Quebra de linha desligada nesta guia'); }],
  tasksFromLines: ['Linhas selecionadas → tarefas (checkbox)', 'ctrl+k ctrl+x', ed(tasksFromLines)],
  selectAllMatches: ['Selecionar todas as ocorrências da palavra (Sublime)', 'alt+f3', ed(selectAllMatchesCmd)],
  duplicateLine: ['Duplicar linha', 'ctrl+shift+d', ed(copyLineDown)],
  deleteLine: ['Apagar linha', 'ctrl+shift+k', ed(deleteLine)],
  selectLine: ['Selecionar linha', 'ctrl+l', ed(selectLine)],
  moveLineUp: ['Mover linha para cima', 'ctrl+shift+up', ed(moveLineUp)],
  moveLineDown: ['Mover linha para baixo', 'ctrl+shift+down', ed(moveLineDown)],
  splitLines: ['Dividir seleção em linhas', 'ctrl+shift+l', ed(splitSelectionByLine)],
  pinLine: ['Fixar / desafixar a linha (📌)', 'ctrl+alt+p', () => { if (active) { togglePinLines(view); view.focus(); } }],
  pinsPanel: ['Linhas fixadas: ver todas…', 'ctrl+alt+shift+p', () => pinsPanel()],
  overwrite: ['Alternar INSERIR / SOBRESCREVER (tecla Insert)', 'insert', () => toggleOverwrite()],
  formatLog: ['Formatar log (SQL e JSON em blocos) — seleção ou documento', 'ctrl+alt+l', ed(formatLogCmd)],
  pollInsert: ['Inserir enquete… (uma ou várias escolhas)', '', async () => {
    if (!active) return;
    const v = view; const tab = active;
    // imagens das opções: ficam junto da nota, como as imagens coladas
    const saveImage = async (file) => {
      const ctx = tab.untitled ? null : tab.path;
      const { abs, t } = await storeImage(file, ctx);
      const link = imageLink(abs, t, ctx);
      const w = /^!\[\[(.+)\]\]$/.exec(link); if (w) return { src: w[1], alt: '', wiki: true };
      const m = /^!\[\]\((.+)\)$/.exec(link); return { src: (m ? m[1] : link).replace(/\(/g, '%28').replace(/\)/g, '%29'), alt: '', wiki: false };
    };
    const r = await openPollDialog({ shared: false, okLabel: 'Inserir', saveImage: isMd(tab.path) || tab.lang === 'Markdown' ? saveImage : undefined });
    if (!r) { v.focus(); return; }
    const block = buildPoll(r); const line = v.state.doc.lineAt(v.state.selection.main.head);
    const empty = !line.text.trim(); const at = empty ? line.from : line.to;
    const NL = String.fromCharCode(10);
    const ins = (empty ? '' : NL + NL) + block + NL;
    v.dispatch({ changes: { from: at, to: empty ? line.to : at, insert: ins }, selection: { anchor: at + ins.length } });
    v.focus();
  }],
  sqlFilter: ['Filtro SQL a partir da lista… (IN, LIKE, NOT LIKE…)', 'ctrl+k ctrl+i', () => openSqlFilter()],
  sqlIn: ['Filtro SQL: transformar a lista em IN (direto)', 'ctrl+alt+i', () => sqlFilterQuick('in')],
  sqlNotIn: ['Filtro SQL: transformar a lista em NOT IN (direto)', 'ctrl+alt+shift+i', () => sqlFilterQuick('notin')],
  sqlLike: ['Filtro SQL: transformar a lista em LIKE (direto)', '', () => sqlFilterQuick('like')],
  joinLines: ['Juntar linhas', 'ctrl+j', ed(joinLines)],
  sortLines: ['Ordenar linhas', 'f9', ed(sortLines)],
  toggleAutoWrap: ['Quebra por colunas estilo Git (liga/desliga)', 'alt+shift+w', toggleAutoWrap],
  reflow: ['Reformatar parágrafo estilo Git (na largura das colunas)', 'alt+q', ed(reflowSelection)],
  toggleComment: ['Comentar/descomentar', 'ctrl+/', ed(toggleComment)],
  upper: ['Maiúsculas', 'ctrl+k ctrl+u', ed(() => mapSelections((s) => s.toUpperCase()))],
  lower: ['Minúsculas', 'ctrl+k ctrl+l', ed(() => mapSelections((s) => s.toLowerCase()))],
  bold: ['Markdown: negrito · fora do Markdown: build (rodar o arquivo)', 'ctrl+b', () => { if (active && view && !isMdTab(active) && !active.srv && !isCanvas(active)) { runBuild(); return; } ed(() => wrapSel('**'))(); }],
  italic: ['Markdown: itálico · fora do Markdown: busca incremental', 'ctrl+i', () => { if (active && view && !isMdTab(active)) { openSearchPanel(view); return; } ed(() => wrapSel('*'))(); }],
  setSyntax: ['Definir sintaxe (linguagem) do arquivo', 'ctrl+k ctrl+s', pickSyntax],
  formatJson: ['Formatar JSON (seleção, linha ou arquivo)', 'ctrl+k ctrl+j', ed(formatJson)],
  minifyJson: ['Minificar JSON', '', ed(minifyJson)],
  formatAuto: ['Formatar (detecta o tipo)', 'ctrl+k ctrl+f', ed((v) => formatAuto(v))],
  compactAuto: ['Compactar em uma linha (JSON, XML ou SQL)', '', ed((v) => formatAuto(v, true))],
  formatXml: ['Formatar XML', '', ed((v) => reformatCode(v, 'xml'))],
  linearXml: ['Linearizar XML (uma linha)', '', ed((v) => reformatCode(v, 'xml', true))],
  formatSql: ['Formatar SQL', '', ed((v) => reformatCode(v, 'sql'))],
  compactSql: ['Compactar SQL (uma linha)', '', ed((v) => reformatCode(v, 'sql', true))],
  formatJs: ['Formatar JavaScript', '', ed((v) => reformatCode(v, 'js'))],
  formatCss: ['Formatar CSS', '', ed((v) => reformatCode(v, 'css'))],
  formatHtml: ['Formatar HTML', '', ed((v) => reformatCode(v, 'html'))],
  newUntitled: ['Novo arquivo (sem título)', 'ctrl+n', newUntitled],
  newProject: ['Novo projeto (criar pasta)', '', newProject],
  newFolder: ['Nova pasta', '', () => root && newFolderIn(root)],
  deleteFile: ['Excluir arquivo atual (Lixeira)', '', () => active && !active.untitled && deletePath(active.path, false)],
};

let bindings = new Map();
let prefixes = new Set();
// Dobrar por nível (Ctrl+K Ctrl+1…9), ir para a aba N (Alt+1…9) e para o painel N (Ctrl+1…4), como no Sublime
for (let i = 1; i <= 9; i++) {
  COMMANDS['fold' + i] = [`Dobrar o nível ${i} do código`, `ctrl+k ctrl+${i}`, ed((v) => { if (!SX.foldLevel(v, i)) toast(`Não há blocos dobráveis no nível ${i}`); })];
  COMMANDS['gotoTab' + i] = [`Ir para a aba ${i}`, `alt+${i}`, () => { const t = tabs.filter((x) => !x.srv)[i - 1]; if (t) activate(t); }];
}
for (let i = 1; i <= 4; i++) COMMANDS['focusPane' + i] = [`Focar o painel ${i}`, `ctrl+${i}`, () => { const p = panes[i - 1]; if (p && p.view) { p.view.focus(); } }];
const isMdTab = (t) => !!t && (isMd(t.path) || t.lang === 'Markdown');

// Modo sem distração: tela cheia, só o texto no centro (Shift+F11 volta)
let distraction = false;
function toggleDistraction() {
  distraction = !distraction;
  document.body.classList.toggle('distraction', distraction);
  api.setFullScreen(distraction);
  if (distraction) toast('Modo sem distração: Shift+F11 volta ao normal');
  if (view) view.requestMeasure();
}

// Snippets
function pickSnippet() {
  if (!active || !view) return toast('Abra um arquivo para inserir um snippet');
  const list = snippetsFor(active.lang || '', settings.snippets);
  showPalette({
    placeholder: 'Snippet… (digite o gatilho e aperte Tab no texto para usar direto)',
    items: () => list.map((sn) => ({ label: sn.trigger, detail: sn.description || sn.content.replace(/\s+/g, ' ').slice(0, 70), sn })),
    onSelect: (it) => { insertSnippet(view, it.sn); view.focus(); },
  });
}
async function newSnippetFromSelection() {
  if (!active || !view) return;
  const r = view.state.selection.main;
  if (r.empty) return toast('Selecione o texto que vai virar o snippet');
  const content = view.state.sliceDoc(r.from, r.to);
  const trigger = await new Promise((res) => showPalette({ placeholder: 'Gatilho do snippet (você digita isso e aperta Tab). Enter confirma', onFree: (t) => res(t.trim()), items: () => [] }));
  if (!trigger) return;
  if (!/^[\w:.\-]+$/.test(trigger)) return toast('O gatilho só pode ter letras, números, : . - e _');
  const only = await askT(`Valer só para "${active.lang || 'Texto'}" ou para todas as linguagens?`, [`Só ${active.lang || 'Texto'}`, 'Todas', 'Cancelar']);
  if (only === 2) return;
  const mine = (Array.isArray(settings.snippets) ? settings.snippets : []).filter((s) => !(s.trigger === trigger && JSON.stringify(s.scope || null) === JSON.stringify(only === 0 ? [active.lang] : null)));
  mine.push({ trigger, content, ...(only === 0 ? { scope: [active.lang || 'Texto'] } : {}), description: 'Meu snippet' });
  await setSetting('snippets', mine);
  toast(`Snippet "${trigger}" salvo. Digite ${trigger} e Tab. (No texto use $1, $2 e ${'${1:padrão}'} para as paradas do Tab.)`);
}


/* ───────────── macros (Ctrl+Q grava, Ctrl+Shift+Q repete) ───────────── */
// Grava o que você digita e as teclas (setas, Home, Ctrl+D, Enter…) e repete no cursor de agora.
const macro = { rec: false, steps: [], last: null };
const savedMacros = () => { try { return JSON.parse(localStorage.getItem('tt.macros') || '{}'); } catch { return {}; } };
const storeMacros = (m) => { try { localStorage.setItem('tt.macros', JSON.stringify(m)); } catch { /* sem gravar */ } };
function macroToggle() {
  const st = $('stRec');
  if (!macro.rec) {
    macro.rec = true; macro.steps = [];
    st.hidden = false; st.textContent = '⏺ Gravando macro — Ctrl+Q para parar';
    return;
  }
  macro.rec = false; st.hidden = true;
  macro.last = macro.steps.length ? macro.steps.slice() : macro.last;
  toast(macro.steps.length ? `Macro gravada (${macro.steps.length} passo${macro.steps.length > 1 ? 's' : ''}). Ctrl+Shift+Q repete; “Macro: salvar…” guarda com um nome.` : 'Macro vazia: nada foi gravado');
}
function macroKey(e) {
  if (!macro.rec || !e.target.closest || !e.target.closest('.cm-content')) return;
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(e.key)) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'q') return; // o próprio gravar/repetir não entra na macro
  const last = macro.steps[macro.steps.length - 1];
  const altGr = !!(e.getModifierState && e.getModifierState('AltGraph')); // AltGr digita caracteres (@, €, {…): é texto, não atalho
  if (e.key.length === 1 && !e.metaKey && (!e.ctrlKey || altGr) && (!e.altKey || altGr)) {
    if (last && last.t !== undefined) last.t += e.key; else macro.steps.push({ t: e.key });
  } else macro.steps.push({ k: e.key, c: e.ctrlKey, a: e.altKey, s: e.shiftKey });
}
window.addEventListener('keydown', macroKey, true);
window.addEventListener('paste', (e) => { if (macro.rec && e.target.closest && e.target.closest('.cm-content')) { const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (t) macro.steps.push({ t }); } }, true);
async function macroPlay(steps) {
  if (!steps || !steps.length) return toast('Nenhuma macro gravada: Ctrl+Q para gravar');
  if (!active || !view) return;
  if (macro.rec) return toast('Pare a gravação (Ctrl+Q) antes de repetir');
  view.focus();
  for (const st of steps) {
    if (st.t !== undefined) view.dispatch(view.state.replaceSelection(st.t), { userEvent: 'input.type', scrollIntoView: true });
    else view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: st.k, ctrlKey: !!st.c, altKey: !!st.a, shiftKey: !!st.s, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 4));
  }
}
async function macroSave() {
  if (!macro.last) return toast('Grave uma macro primeiro (Ctrl+Q)');
  const name = await new Promise((res) => showPalette({ placeholder: 'Nome da macro. Enter confirma', onFree: (t) => res(t.trim()), items: () => [] }));
  if (!name) return;
  const m = savedMacros(); m[name] = macro.last; storeMacros(m);
  toast(`Macro "${name}" salva`);
}
function macroPick(remove) {
  const m = savedMacros(); const names = Object.keys(m);
  const items = [...(!remove && macro.last ? [{ label: '(última gravada)', detail: `${macro.last.length} passos`, steps: macro.last }] : []), ...names.map((n) => ({ label: n, detail: `${m[n].length} passos`, steps: m[n], name: n }))];
  if (!items.length) return toast('Nenhuma macro salva ainda');
  showPalette({
    placeholder: remove ? 'Apagar qual macro?' : 'Executar qual macro?',
    items: () => items,
    onSelect: (it) => { if (remove) { const all = savedMacros(); delete all[it.name]; storeMacros(all); toast(`Macro "${it.name}" apagada`); } else macroPlay(it.steps); },
  });
}

/* ───────────── build (Ctrl+B), como no Sublime ───────────── */
const DEFAULT_BUILDS = {
  py: 'python -u "$file"', pyw: 'pythonw "$file"', js: 'node "$file"', mjs: 'node "$file"', cjs: 'node "$file"', ts: 'npx --yes tsx "$file"',
  bat: 'call "$file"', cmd: 'call "$file"', ps1: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$file"', sh: 'bash "$file"',
  go: 'go run "$file"', rb: 'ruby "$file"', php: 'php "$file"', pl: 'perl "$file"', lua: 'lua "$file"', r: 'Rscript "$file"', dart: 'dart run "$file"',
  java: 'javac "$file" && java -cp "$file_path" $file_base_name',
  c: 'gcc "$file" -o "%TEMP%\\ttbuild_$file_base_name.exe" && "%TEMP%\\ttbuild_$file_base_name.exe"',
  cpp: 'g++ "$file" -o "%TEMP%\\ttbuild_$file_base_name.exe" && "%TEMP%\\ttbuild_$file_base_name.exe"',
  rs: 'rustc "$file" -o "%TEMP%\\ttbuild_$file_base_name.exe" && "%TEMP%\\ttbuild_$file_base_name.exe"',
  html: 'start "" "$file"', htm: 'start "" "$file"', mk: 'make', Makefile: 'make',
};
const build = { id: 0, running: false, text: '', errors: [], at: -1, t0: 0, cwd: '' };
function buildVars(cmd, tab) {
  const p = tab.path; const dir = dirName(p); const name = baseName(p); const dot = name.lastIndexOf('.');
  const rr = rootOf(p);
  return cmd.replace(/\$file_base_name/g, dot > 0 ? name.slice(0, dot) : name).replace(/\$file_extension/g, dot > 0 ? name.slice(dot + 1) : '').replace(/\$file_name/g, name).replace(/\$file_path/g, dir).replace(/\$file/g, p).replace(/\$project_path/g, rr ? rr.path : dir);
}
function buildCmdFor(tab) {
  const name = baseName(tab.path); const ext = (name.split('.').pop() || '').toLowerCase();
  const mine = settings.builds || {};
  return mine[name] || mine[ext] || DEFAULT_BUILDS[name] || DEFAULT_BUILDS[ext] || null;
}
async function runBuild(customCmd) {
  if (!active || active.srv || isCanvas(active)) return toast('Abra um arquivo de código para rodar (Ctrl+B)');
  if (build.running) return toast('Já há um build rodando (Ctrl+Pause para parar)');
  if (active.untitled) return toast('Salve o arquivo antes (Ctrl+S) para poder rodar');
  if (active.dirty) await saveTab(active);
  const raw = customCmd || buildCmdFor(active);
  if (!raw) return toast(`Não sei rodar arquivos .${baseName(active.path).split('.').pop()}. Defina em settings.json: "builds": { "ext": "comando com $file" } (Ctrl+Shift+B também aceita um comando digitado)`);
  const cmd = buildVars(raw, active);
  build.id = Date.now(); build.running = true; build.text = ''; build.errors = []; build.at = -1; build.t0 = Date.now(); build.cwd = dirName(active.path);
  $('buildPanel').hidden = false; $('buildTitle').textContent = `▶ ${cmd}`; $('buildOut').textContent = ''; $('buildStop').disabled = false;
  if (view) view.requestMeasure();
  try { await api.buildRun({ id: build.id, cmd, cwd: build.cwd }); } catch (e) { build.running = false; buildAppend(`Não consegui iniciar: ${e.message}\n`, 'err'); }
}
const esc2 = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function parseBuildErrors(text) {
  const out = [];
  text.split('\n').forEach((ln, i) => {
    let m = /File "([^"]+)", line (\d+)/.exec(ln);
    if (!m) m = /\(([A-Za-z]:[\\/][^()]+?):(\d+)(?::(\d+))?\)/.exec(ln);
    if (!m) m = /^\s*([A-Za-z]:[\\/][^:]+?|\.{0,2}[\\/]?[\w .\-\\/]+\.\w+)[:(](\d+)(?:[:,](\d+))?\)?/.exec(ln);
    if (m) out.push({ line: i, file: m[1], n: Number(m[2]), col: Number(m[3] || 1) });
  });
  return out;
}
function buildRender() {
  const out = $('buildOut');
  const lines = build.text.split('\n');
  const errs = new Map(build.errors.map((e, i) => [e.line, i]));
  out.innerHTML = lines.map((ln, i) => (errs.has(i) ? `<a class="berr${errs.get(i) === build.at ? ' on' : ''}" data-i="${errs.get(i)}">${esc2(ln)}</a>` : esc2(ln))).join('\n');
  out.scrollTop = out.scrollHeight;
}
let buildTimer = null;
function buildAppend(text, kind) {
  build.text += text;
  if (build.text.length > 400000) build.text = '…(saída antiga cortada)…\n' + build.text.slice(-300000);
  build.errors = parseBuildErrors(build.text);
  if (!buildTimer) buildTimer = setTimeout(() => { buildTimer = null; buildRender(); }, 60);
}
api.onBuildData((d) => { if (d.id === build.id) buildAppend(d.text, d.kind); });
api.onBuildEnd((d) => {
  if (d.id !== build.id) return;
  build.running = false;
  buildAppend(`\n[${d.code === 0 ? 'terminou' : d.sig ? 'interrompido' : 'terminou com erro (código ' + d.code + ')'} em ${((Date.now() - build.t0) / 1000).toFixed(1)} s]\n`);
  $('buildStop').disabled = true;
  clearTimeout(buildTimer); buildTimer = null; buildRender();
  if (build.errors.length) toast(`${build.errors.length} ponto(s) com arquivo:linha na saída: F4 vai para o próximo (clique na linha também abre)`);
});
function buildGoto(i) {
  const e = build.errors[i]; if (!e) return;
  build.at = i; buildRender();
  const path = /^([A-Za-z]:[\\/]|\/)/.test(e.file) ? e.file : joinPath(build.cwd, ...e.file.split(/[\\/]/));
  openFile(path, e.n).then(() => { if (view) { try { const ln = view.state.doc.line(Math.min(e.n, view.state.doc.lines)); view.dispatch({ selection: { anchor: ln.from + Math.min(e.col - 1, ln.length) }, scrollIntoView: true }); } catch { /* linha fora */ } view.focus(); } }).catch(() => toast('Não consegui abrir ' + e.file));
}
function buildStep(dir) {
  if (!build.errors.length) return toast('Nenhum erro com arquivo:linha na saída do build');
  buildGoto(build.at < 0 ? (dir > 0 ? 0 : build.errors.length - 1) : (build.at + dir + build.errors.length) % build.errors.length);
}
$('buildOut').addEventListener('click', (e) => { const a = e.target.closest('a.berr'); if (a) buildGoto(Number(a.dataset.i)); });
$('buildStop').onclick = () => { if (build.running) api.buildStop(build.id); };
$('buildClose').onclick = () => { if (build.running) api.buildStop(build.id); $('buildPanel').hidden = true; if (view) view.requestMeasure(); };
function buildPick() {
  if (!active || active.srv || active.untitled) return toast('Salve um arquivo de código primeiro');
  const items = [];
  const mine = buildCmdFor(active);
  if (mine) items.push({ label: 'Rodar este arquivo', detail: buildVars(mine, active), cmd: mine });
  for (const [k, v] of Object.entries({ ...DEFAULT_BUILDS, ...(settings.builds || {}) })) { if (v !== mine) items.push({ label: `Como .${k}`, detail: v, cmd: v }); }
  showPalette({ placeholder: 'Build… (ou digite um comando; use $file, $file_path, $file_base_name…)', items: () => items, onFree: (t) => { if (t.trim()) runBuild(t.trim()); }, onSelect: (it) => runBuild(it.cmd) });
}

function rebuildBindings() {
  bindings = new Map();
  for (const [id, [, key]] of Object.entries(COMMANDS)) if (key) bindings.set(key, id);
  for (const [key, id] of Object.entries(settings.keybindings || {})) {
    if (id && COMMANDS[id]) bindings.set(key.toLowerCase(), id); else bindings.delete(key.toLowerCase());
  }
  prefixes = new Set();
  for (const k of bindings.keys()) {
    const parts = k.split(' ');
    for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join(' '));
  }
}

function commandPalette() {
  const keyOf = (id) => [...bindings].find(([, v]) => v === id)?.[0] || '';
  showPalette({
    placeholder: 'Comando…',
    items: () => [
      ...Object.entries(COMMANDS).map(([id, [title]]) => ({ label: title, detail: keyOf(id), id })),
      // como no Sublime: "Definir sintaxe: SQL" etc. direto na paleta (vale para a guia atual e fica lembrado por arquivo)
      ...(active ? [
        { label: 'Definir sintaxe: Automático (pela extensão)', detail: active.lang || '', syn: null },
        { label: 'Definir sintaxe: Texto simples', detail: '', syn: 'Texto' },
        ...languages.map((l) => ({ label: 'Definir sintaxe: ' + l.name, detail: l.extensions.map((e) => '.' + e).join(' '), syn: l.name })),
      ] : []),
    ],
    onSelect: (it) => {
      if (it.id) return COMMANDS[it.id][2]();
      const tab = active; if (!tab) return;
      saveSyntax(tab.path, it.syn); setLanguage(tab); toast('Sintaxe: ' + (it.syn || 'automática')); view.focus();
    },
  });
}

const KEYNAMES = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', ' ': 'space' };
function keyString(e) {
  const k = e.key.toLowerCase();
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(KEYNAMES[k] || k);
  return parts.join('+');
}

let pending = null;
window.addEventListener('keydown', (e) => {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  if (e.key === 'Escape' && graphOn) { closeGraph(); return; }
  if (e.key === 'Escape' && !$('ctx').hidden) { $('ctx').hidden = true; return; }
  if (e.key === 'Escape' && menuName) { closeMenus(); return; }
  if (e.key === 'Escape' && !$('news').hidden) { closeNews(); return; }
  if (pal && pal.chord && !$('pIn').value) {
    // Ctrl+K abriu a busca de abas; se vier o 2º atalho da sequência (ex.: Ctrl+B), executa-o como antes
    const k2 = keyString(e);
    const id2 = bindings.get(pal.chord + ' ' + k2);
    if (!id2 && k2 === pal.chord) { e.preventDefault(); e.stopPropagation(); closePalette(); return; } // Ctrl+K de novo fecha
    if (id2) {
      e.preventDefault(); e.stopPropagation();
      closePalette();
      COMMANDS[id2][2]();
      return;
    }
  }
  if (pal) return;
  const k = keyString(e);
  const seq = pending ? pending + ' ' + k : k;
  const id = bindings.get(seq);
  if (id) {
    pending = null;
    e.preventDefault(); e.stopPropagation();
    COMMANDS[id][2]();
  } else if (prefixes.has(seq)) {
    pending = seq;
    e.preventDefault(); e.stopPropagation();
    toast(seq + ' …');
    setTimeout(() => { if (pending === seq) pending = null; }, 1500);
  } else {
    pending = null;
  }
}, true);

/* ───────────── barra de menus (estilo Sublime) ───────────── */
const FMT = { up: '↑', down: '↓', left: '←', right: '→', pageup: 'PgUp', pagedown: 'PgDn', enter: 'Enter', tab: 'Tab', space: 'Space' };
const fmtKey = (k) => !k ? '' : k.split(' ').map((ch) => ch.split('+').map((s) => FMT[s] || (s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1))).join('+')).join(', ');
const keyOf = (id) => [...bindings].find(([, v]) => v === id)?.[0] || '';
const isOn = (key, def) => !!(settings[key] ?? def);

function menuDefs() {
  const c = (id, label, extra) => ({ id, label: label || COMMANDS[id][0], ...extra });
  const e = (id, label, hint) => c(id, label, { needs: true, hint }); // precisa de um arquivo aberto
  const opt = (label, key, value) => ({ label, checked: settings[key] === value, run: () => setSetting(key, value) });
  const tog = (label, key, def) => ({ label, checked: isOn(key, def), run: () => setSetting(key, !isOn(key, def)) });
  const S = '-';
  return {
    Arquivo: [
      c('newUntitled', 'Novo arquivo'), c('newCanvas', 'Novo canvas'), c('newNote', 'Nova nota na pasta do projeto…'), c('openFile', 'Abrir arquivo…'), c('openRecent', 'Abrir recente…'), S,
      c('newProject', 'Novo projeto…'), c('openFolder', 'Adicionar pasta como projeto…'), c('openRecentFolder', 'Abrir projeto recente…'), c('closeProject', 'Fechar projeto atual'), S,
      { label: 'Grupos de abas', sub: [c('newGroup', 'Novo grupo…'), e('groupTab', 'Agrupar aba atual…'), e('ungroupTab', 'Tirar aba do grupo'), c('saveGroup', 'Salvar grupo em pastas…')] },
      c('sharedLogin', 'Compartilhado: entrar no servidor…'),
      { label: 'Servidor neste computador', sub: [
        c('serverStart', localSrv && localSrv.running ? '▶ Servidor rodando — iniciar (já está)' : '▶ Iniciar servidor'),
        c('serverRestart', '⟳ Reiniciar (aplica a versão nova do app)'),
        c('serverStop', '■ Parar servidor'),
        c('serverAddress', '🌐 Mostrar o endereço para entrar'),
        c('serverAutostart', 'Iniciar junto com o Windows', { checked: !!(localSrv && localSrv.autostart) }), S,
        { label: 'Abrir a pasta de dados', run: () => api.serverOpenData() }, { label: 'Ver o registro (server.log)', run: () => api.serverOpenLog() },
      ] },
      { label: 'Notas flutuantes', sub: [c('newSticky', 'Nova nota (Ctrl+Alt+N)'), c('stickyFromSel', 'Enviar seleção / aba para uma nota'), c('stickyList', 'Abrir nota…'), c('stickyToggle', 'Mostrar / ocultar todas')] },
      { label: 'Importar', sub: [c('importSublime', 'Do Sublime Text…'), c('importObsidian', 'Do Obsidian (abrir cofre)…')] }, S,
      e('save', 'Salvar'), e('saveAs', 'Salvar como…'), c('saveAll', 'Salvar tudo'), S,
      { label: 'Exportar a guia', sub: [e('exportPdf', 'PDF (.pdf)…'), e('exportDocx', 'Word (.docx)…')] }, S,
      e('closeTab', 'Fechar aba'), c('reopenClosed', 'Reabrir aba fechada'), S, c('quit', 'Sair', { hint: 'Alt+F4' }), c('quitDiscard', 'Sair e descartar não salvos…'),
    ],
    Editar: [
      e('undo', 'Desfazer', 'Ctrl+Z'), e('redo', 'Refazer', 'Ctrl+Y'), S,
      e('cut', 'Recortar', 'Ctrl+X'), e('copy', 'Copiar', 'Ctrl+C'), e('paste', 'Colar', 'Ctrl+V'), S,
      { label: 'Linha', sub: [e('duplicateLine', 'Duplicar linha'), e('deleteLine', 'Apagar linha'), e('moveLineUp', 'Mover para cima'), e('moveLineDown', 'Mover para baixo'), e('joinLines', 'Juntar linhas'), S, e('insertLineBefore', 'Inserir linha acima'), e('insertLineAfter', 'Inserir linha abaixo'), e('deleteToEol', 'Apagar até o fim da linha'), e('deleteToBol', 'Apagar até o começo da linha'), S, e('sortLines', 'Ordenar linhas'), e('sortLinesNoCase', 'Ordenar (ignora maiúsculas)'), e('sortLinesCase', 'Ordenar (diferencia maiúsculas)'), e('reverseLines', 'Inverter a ordem'), e('uniqueLines', 'Remover repetidas'), e('shuffleLines', 'Embaralhar')] },
      e('toggleComment', 'Comentar / descomentar'), e('blockComment', 'Comentário de bloco'),
      e('transpose', 'Trocar as duas letras ao redor do cursor'),
      { label: 'Indentação', sub: [e('toSpaces', 'Converter para espaços'), e('toTabs', 'Converter para tabs')] },
      e('tasksFromLines', 'Linhas selecionadas → tarefas (checkbox)', 'Ctrl+K Ctrl+X'),
      e('pollInsert', 'Inserir enquete… (uma ou várias escolhas)'),
      e('pinLine', 'Fixar / desafixar a linha (📌)', 'Ctrl+Alt+P'),
      e('formatLog', 'Formatar log (SQL e JSON em blocos)', 'Ctrl+Alt+L'),
      { label: 'Maiúsculas / minúsculas', sub: [e('upper', 'Maiúsculas'), e('lower', 'Minúsculas'), e('titleCase', 'Maiúscula Em Cada Palavra'), e('swapCase', 'Inverter')] },
      { label: 'Snippets', sub: [c('snippetInsert', 'Inserir snippet…'), e('snippetNew', 'Criar snippet com a seleção…')] },
      { label: 'Markdown', sub: [e('bold', 'Negrito'), e('italic', 'Itálico')] }, S,
      e('formatAuto', 'Formatar (detecta o tipo)'),
      { label: 'Formatar como…', sub: [e('formatJson', 'JSON'), e('formatXml', 'XML'), e('formatSql', 'SQL'), e('formatJs', 'JavaScript'), e('formatCss', 'CSS'), e('formatHtml', 'HTML')] },
      { label: 'Compactar em uma linha', sub: [e('minifyJson', 'JSON'), e('linearXml', 'XML'), e('compactSql', 'SQL')] },
    ],
    Seleção: [
      e('selectLine', 'Selecionar linha'), e('selectNext', 'Selecionar próxima ocorrência', 'Ctrl+D'), e('selectAllMatches', 'Selecionar todas as ocorrências', 'Alt+F3'), e('splitLines', 'Dividir seleção em linhas'), e('selectAll', 'Selecionar tudo', 'Ctrl+A'), S,
      e('selectBrackets', 'Conteúdo dos colchetes / parênteses'), e('expandScope', 'Expandir para o bloco'), e('gotoBracket', 'Ir para o colchete correspondente'),
    ],
    Localizar: [
      e('find', 'Localizar / substituir…', 'Ctrl+F'), c('findInFiles', 'Buscar em arquivos…'),
    ],
    Exibir: [
      c('sidebar', 'Barra lateral', { checked: !$('sidebar').hidden }),
      { label: 'Bloco "Arquivos abertos"', checked: secState().open !== false, run: () => { saveSec({ open: secState().open === false }); applySections(); } },
      { label: 'Bloco "Compartilhado"', checked: secState().sharedOff !== true, run: () => { saveSec({ sharedOff: secState().sharedOff !== true }); applySections(); } },
      { label: 'Bloco "Projetos"', checked: secState().proj !== false, run: () => { saveSec({ proj: secState().proj === false }); applySections(); } },
      { label: 'Barra de abas no topo', checked: isOn('tabBar', false), run: () => setSetting('tabBar', !isOn('tabBar', false)) }, c('backlinks', 'Backlinks e links', { checked: !$('right').hidden }),
      c('preview', 'Preview Markdown lateral', { checked: !$('preview').hidden }), c('graph', 'Visão de grafo'), c('language', 'Idioma do aplicativo…'), S,
      { label: 'Mostrar espaços (●) e tabs (→)', sub: [opt('Nunca', 'drawWhitespace', 'none'), opt('Só no texto selecionado (padrão do Sublime)', 'drawWhitespace', 'selection'), opt('Sempre', 'drawWhitespace', 'all')] },
      { label: 'Lado a lado / comparar', sub: [
        c('compareTabs', 'Comparar abas…'), c('openBeside', 'Abrir aba ao lado…'), S,
        { label: 'Uma coluna', run: () => singlePane() }, c('columns2', 'Duas colunas'), c('columns3', 'Três colunas'), S,
        c('nextDiff', 'Próxima diferença'), c('prevDiff', 'Diferença anterior'),
        { label: 'Rolagem sincronizada', checked: syncOn, run: () => { syncOn = !syncOn; renderCompareBar(); } },
        c('stopCompare', 'Sair da comparação'),
      ] }, S,
      { label: 'Dobrar código', sub: [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => e('fold' + i, `Dobrar nível ${i}`)), S, e('unfoldAllCmd', 'Desdobrar tudo')] },
      c('toggleSpell', 'Corretor ortográfico', { checked: !!settings.spellcheck }), c('distraction', 'Modo sem distração'), S,
      c('toggleWrap', 'Quebra de linha (só nesta guia)', { checked: !!(active && wrapOn(active)) }), c('toggleMinimap', 'Minimap', { checked: isOn('minimap', false) }),
      c('livePreview', 'Live Preview (Markdown renderizado)', { checked: isOn('livePreview', true) }),
      c('toggleImgCap', 'Nome embaixo das imagens (nesta aba)', { needs: true, checked: !!(active && active.imgCap !== false) }), S,
      e('setSyntax', 'Sintaxe…'), e('encoding', 'Codificação / quebra de linha…'), S,
      c('fontBigger', 'Aumentar fonte'), c('fontSmaller', 'Diminuir fonte'), c('fontReset', 'Restaurar fonte'),
    ],
    'Ir para': [
      c('pinsPanel', 'Linhas fixadas: ver todas… (Ctrl+Alt+Shift+P)'), c('switchTab', 'Ir para aba aberta…'), c('goto', 'Ir para arquivo…'), e('gotoSymbol', 'Ir para título / símbolo…'), e('gotoLine', 'Ir para linha…'), e('followLink', 'Abrir [[link]] sob o cursor'), S,
      c('dailyNote', 'Nota diária'), S, c('nextTab', 'Próxima aba'), c('prevTab', 'Aba anterior'), { label: 'Ir para a aba número', sub: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => c('gotoTab' + i, `Aba ${i}`)) },
    ],
    Projeto: [
      c('newProject', 'Novo projeto…'), c('openFolder', 'Adicionar pasta como projeto…'), c('closeProject', 'Fechar projeto atual'), c('reloadFolder', 'Recarregar projetos'), S,
      c('newNote', 'Novo arquivo no projeto…'), c('newFolder', 'Nova pasta…'), e('renameNote', 'Renomear arquivo atual…'), e('deleteFile', 'Excluir arquivo atual (Lixeira)'),
    ],
    Ferramentas: [
      c('palette', 'Paleta de comandos'), S,
      c('bold', 'Build: rodar este arquivo (Ctrl+B)', { needs: true }), c('buildPickCmd', 'Build com…'), c('buildStopCmd', 'Parar o build'), c('buildNextErr', 'Próximo erro (F4)'), c('buildPrevErr', 'Erro anterior (Shift+F4)'), S,
      { label: 'Macros', sub: [c('macroRec', 'Gravar / parar (Ctrl+Q)'), c('macroPlayCmd', 'Repetir a última (Ctrl+Shift+Q)'), c('macroSaveCmd', 'Salvar com um nome…'), c('macroRunCmd', 'Executar uma salva…'), c('macroDeleteCmd', 'Apagar uma salva…')] },
      { label: 'Snippets', sub: [c('snippetInsert', 'Inserir snippet…'), e('snippetNew', 'Criar snippet com a seleção…')] },
      { label: 'Filtro SQL (lista → IN / LIKE…)', sub: [c('sqlFilter', 'Escolher o tipo…'), c('sqlIn', 'IN (direto)'), c('sqlNotIn', 'NOT IN (direto)'), c('sqlLike', 'LIKE (direto)')] }, S,
      c('devtools', 'Console do desenvolvedor (Ctrl+`)'),
    ],
    Preferências: [
      c('settings', 'Abrir settings.json'), S,
      { label: 'Tamanho da fonte', sub: [11, 12, 13, 14, 15, 16, 18, 20, 24].map((n) => opt(String(n), 'fontSize', n)) },
      { label: 'Tamanho da tabulação', sub: [2, 3, 4, 8].map((n) => opt(String(n), 'tabSize', n)) },
      { label: 'Quebra estilo Git (colunas)', sub: [tog('Ligar sozinha em arquivos de commit', 'gitWrap', true), S, ...[['Automática (1ª régua)', 0], ...[60, 70, 72, 80, 100, 120].map((n) => [String(n), n])].map(([l, n]) => opt(l, 'autoWrapWidth', n))] },
      tog('Manter na bandeja ao fechar (notas e Ctrl+Alt+N seguem ativos)', 'keepInTray', false),
      tog('Compartilhado: avisar no Windows quando me mencionarem ou responderem', 'notifyMentions', false),
      tog('Atualização do app: baixar sozinha (só instala quando eu clicar)', 'autoUpdate', true),
      { label: 'Aceleração de vídeo (desligar economiza ~50 MB de memória; vale ao reabrir o app)', checked: isOn('hardwareAcceleration', true), run: () => { const on = !isOn('hardwareAcceleration', true); setSetting('hardwareAcceleration', on); toast(on ? 'Aceleração de vídeo ligada: vale quando você abrir o app de novo' : 'Aceleração de vídeo desligada: economiza memória; vale quando você abrir o app de novo'); } },
      { label: 'Recuo ao formatar (XML, SQL, JSON…)', sub: [2, 4].map((n) => opt(String(n), 'formatIndent', n)) },
      { label: 'SQL: palavras-chave', sub: [opt('MAIÚSCULAS', 'sqlKeywordCase', 'upper'), opt('minúsculas', 'sqlKeywordCase', 'lower'), opt('Como estão', 'sqlKeywordCase', 'preserve')] },
      tog('Indentar com espaços', 'insertSpaces', true),
      tog('Traduzir texto selecionado (botão direito; envia o texto a um serviço online)', 'translateEnabled', true),
      tog('Modo debug (grava os registros de erros em arquivo até você desligar)', 'debugMode', false),
      { label: 'Abrir a pasta dos registros de debug', run: () => api.debugOpen('dir') },
      { label: 'Abrir o registro de debug (debug.log)', run: () => api.debugOpen('file') },
      { label: 'Tipo das novas guias', sub: [opt('Markdown (.md)', 'newTabType', 'md'), opt('Texto (.txt)', 'newTabType', 'txt')] },
      { label: 'Canvas: fonte', sub: CANVAS_FONTS.map(([l, f]) => opt(l, 'canvasFont', f)) },
      { label: 'Canvas: colar texto (⌗)', sub: [opt('Automático (detecta quando precisa preservar espaços)', 'canvasPasteMode', 'auto'), opt('Sempre preservar espaços e quebras (⌗ ligado)', 'canvasPasteMode', 'always'), opt('Nunca (Markdown normal, ⌗ desligado)', 'canvasPasteMode', 'never')] },
      { label: 'Canvas: tamanho do texto', sub: [11, 12, 13, 14, 15, 16, 18, 20, 24].map((n) => opt(String(n), 'canvasFontSize', n)) },
      { label: 'Tema', sub: THEMES.map((th) => ({ label: th.name, checked: themeById(settings.theme).id === th.id, run: () => setSetting('theme', th.id) })).concat([S, { label: 'Personalizado (cores e JSON)…', checked: settings.theme === 'custom', run: openThemeEditor }]) }, S,
      c('toggleWrap', 'Quebra de linha (só nesta guia)', { checked: !!(active && wrapOn(active)) }), tog('Minimap', 'minimap', false), tog('Live Preview', 'livePreview', true),
      tog('Salvar automaticamente', 'autoSave', false), tog('Fechar sem perguntar (guarda a sessão)', 'hotExit', true), tog('Formatar JSON ao colar em .md', 'autoJsonOnPaste', true), S,
      { label: 'Atalhos de teclado (lista)', run: () => commandPalette() },
    ],
    Ajuda: [c('news', 'Novidades…'), c('updateCheck', 'Verificar atualização do app (pelo servidor)'), c('updatePublish', 'Publicar instalador no servidor… (administrador)'), c('updateLog', 'Registro de envio/download de atualização (log)'), S, c('palette', 'Paleta de comandos'), c('support', 'Apoiar o projeto… (um Monster)', { icon: 'assets/monster-icon.png' }), c('about', 'Sobre o TT Note')],
  };
}

let menuName = null;
const closeMenus = () => {
  $('menu').hidden = true;
  $('submenu').hidden = true;
  document.querySelectorAll('#menubar .mb.open').forEach((x) => x.classList.remove('open'));
  menuName = null;
};

function fillMenu(box, items, x, y) {
  box.textContent = '';
  for (const it of items) {
    if (it === '-') { box.append(document.createElement('hr')); continue; }
    const off = it.needs && !active;
    const row = el('div', 'ci' + (off ? ' off' : ''));
    const label = (it.checked === undefined ? '' : it.checked ? '✓ ' : '  ') + it.label;
    const ml = el('span', 'ml', label);
    if (it.icon) { const ic = document.createElement('img'); ic.className = 'mi-ico'; ic.src = it.icon; ic.alt = ''; ml.prepend(ic); }
    row.append(ml, el('span', 'mk', it.sub ? '▸' : it.hint ?? (it.id ? fmtKey(keyOf(it.id)) : '')));
    if (it.sub) {
      row.onmouseenter = () => fillMenu($('submenu'), it.sub, row.getBoundingClientRect().right - 2, row.getBoundingClientRect().top);
      row.onclick = (ev) => { ev.stopPropagation(); row.onmouseenter(); };
    } else {
      if (box.id === 'menu') row.onmouseenter = () => { $('submenu').hidden = true; };
      row.onclick = () => {
        if (off) return;
        closeMenus();
        (it.run || COMMANDS[it.id][2])();
      };
    }
    box.append(row);
  }
  box.hidden = false;
  box.style.left = Math.max(0, Math.min(x, innerWidth - box.offsetWidth - 4)) + 'px';
  box.style.top = Math.max(0, Math.min(y, innerHeight - box.offsetHeight - 4)) + 'px';
}

function openMenu(name, anchor) {
  closeMenus();
  menuName = name;
  anchor.classList.add('open');
  const r = anchor.getBoundingClientRect();
  fillMenu($('menu'), menuDefs()[name], r.left, r.bottom);
}

function renderMenubar() {
  const bar = $('menubar');
  for (const name of Object.keys(menuDefs())) {
    const b = el('div', 'mb', name);
    b.onclick = () => (menuName === name ? closeMenus() : openMenu(name, b));
    b.onmouseenter = () => { if (menuName && menuName !== name) openMenu(name, b); };
    bar.append(b);
  }
  // botão "Novidades" no canto direito da barra de menus (com um pontinho enquanto há versão não vista)
  const nb = el('div', 'mb news-btn');
  nb.id = 'btnNews';
  nb.title = 'O que mudou em cada versão';
  const dot = el('span');
  dot.id = 'newsDot';
  dot.hidden = true;
  nb.append(document.createTextNode('✨ Novidades'), dot);
  const lb = el('div', 'mb lang-btn'); // botão do idioma (bandeira) no canto direito
  lb.id = 'langBtn'; lb.title = 'Idioma do aplicativo'; lb.innerHTML = flagHtml(getLang());
  lb.onclick = () => pickLanguage();
  onLang((id) => { try { api.setLang(id); } catch { /* sem processo principal */ } lb.innerHTML = flagHtml(id); for (const t of tabs) reconf(t, [phrasesComp.reconfigure(phrasesExt())]); updateStatus(); });
  nb.onclick = () => showNews();
  const ub = el('div', 'mb upd-btn');
  ub.id = 'updBtn';
  ub.hidden = true;
  ub.onclick = () => updateFlow();
  ub.oncontextmenu = (e) => { e.preventDefault(); if (!ub.dataset.busy) ub.hidden = true; };
  const pb = el('div', 'pub-bar'); // barra de progresso do envio da versão
  pb.id = 'pubBar';
  pb.hidden = true;
  pb.append(el('div', 'pub-fill'), el('span', 'pub-txt'));
  pb.onclick = () => { if (!pubBusy) { pb.hidden = true; clearTimeout(pubTimer); } };
  const spc = el('div'); spc.style.flex = '1 1 auto'; // empurra tudo para a direita: atualizar/progresso, bandeira e Novidades ficam juntos e fixos
  bar.append(spc, pb, ub, lb, nb);
  // clicar nos menus não tira o foco do editor (copiar/colar etc. continuam funcionando)
  for (const id of ['menubar', 'menu', 'submenu']) $(id).addEventListener('mousedown', (e) => e.preventDefault());
  document.addEventListener('mousedown', (e) => { if (!e.target.closest?.('#menubar, #menu, #submenu')) closeMenus(); });
  window.addEventListener('blur', closeMenus);
}

/* ───────────── Novidades (o que mudou em cada versão) ───────────── */
let curVersion = '';
const verCmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const NEWS_TIPOS = { novo: ['novo', 'Novo'], melhoria: ['melhoria', 'Melhoria'], 'correção': ['correcao', 'Correção'] };
const seenVersion = () => { try { return localStorage.getItem('tt.newsSeen') || ''; } catch { return ''; } };

async function showNews() {
  const data = await api.news();
  if (!curVersion) curVersion = await api.version();
  const seen = seenVersion();
  $('newsSub').textContent = `Você está na versão ${curVersion}` + (seen && seen !== curVersion ? ` · última que você viu: ${seen}` : '');
  const body = $('newsBody');
  body.textContent = '';
  data.forEach((e, i) => {
    const isNew = !seen ? i === 0 : verCmp(e.version, seen) > 0; // mais nova que a última versão vista
    const det = document.createElement('details');
    det.className = 'ver';
    det.open = isNew || i === 0;
    const sum = document.createElement('summary');
    sum.append(el('span', 'vn', 'v' + e.version), el('span', 'vd', e.date.split('-').reverse().join('/')));
    if (e.version === curVersion) sum.append(el('span', 'chip atual', 'Atual'));
    if (isNew) sum.append(el('span', 'chip nova', 'Novo'));
    det.append(sum);
    const ul = document.createElement('ul');
    for (const it of e.items) {
      const [cls, rot] = NEWS_TIPOS[it.tipo] || ['novo', it.tipo];
      const li = document.createElement('li');
      li.append(el('span', 'tag ' + cls, rot), document.createTextNode(' ' + it.texto));
      ul.append(li);
    }
    det.append(ul);
    body.append(det);
  });
  $('news').hidden = false;
  body.scrollTop = 0;
}
function closeNews() {
  if ($('news').hidden) return;
  $('news').hidden = true;
  try { localStorage.setItem('tt.newsSeen', curVersion); } catch {}
  $('newsDot').hidden = true;
  if (active) view.focus();
}
$('newsX').onclick = closeNews;
$('newsOk').onclick = closeNews;
$('news').addEventListener('mousedown', (e) => { if (e.target === $('news')) closeNews(); });
$('stVer').onclick = showNews;

/* ───────────── Apoie o projeto (mensagem, Pix, sugestões) ───────────── */
function showSupport() { openSupport({ api }); }
// aparece sozinha uma vez a cada 10 vezes que o app foi fechado (o contador fica no processo principal)
async function supportAuto(tries = 0) {
  if (!supportAvailable()) return;
  if (!$('news').hidden || document.getElementById('themeDlg')) { if (tries < 12) setTimeout(() => supportAuto(tries + 1), 5000); return; }
  try { if (await api.supportDue()) showSupport(); } catch { /* sem contador */ }
}

/* ───────────── init ───────────── */
renderMenubar();
$('stMini').onclick = () => COMMANDS.toggleMinimap[2]();
$('stLang').onclick = pickSyntax;
$('stEnc').onclick = pickEncoding;
$('stWrap').onclick = toggleAutoWrap;
$('sharedAdd').onclick = (e) => { e.stopPropagation(); shared.login(); };
$('cvBack').onclick = () => toggleCanvasJson();
let lastWheelZoom = 0;
$('editor').addEventListener('wheel', (e) => { // Ctrl + roda do mouse: tamanho da letra
  if (!e.ctrlKey) return;
  e.preventDefault();
  const now = Date.now();
  if (now - lastWheelZoom < 70) return;
  lastWheelZoom = now;
  setSetting('fontSize', Math.max(8, Math.min(40, (settings.fontSize || 14) + (e.deltaY < 0 ? 1 : -1))));
}, { passive: false });
// arrastar uma aba para fora de qualquer grupo (área vazia) = tirar do grupo
$('openFiles').addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('text/tt-tab')) e.preventDefault(); });
$('openFiles').addEventListener('drop', (e) => {
  if (!Array.from(e.dataTransfer.types).includes('text/tt-tab') || e.defaultPrevented) return;
  e.preventDefault();
  const t = tabs.find((x) => x.path === e.dataTransfer.getData('text/tt-tab'));
  if (t && t.groupId) assignTab(t, null);
});
// menu de contexto de "Arquivos abertos": grupos e abas
$('openFiles').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const row = e.target.closest('.row');
  const items = [];
  if (row && row.dataset.gid) {
    const id = row.dataset.gid;
    const newIn = (canvas) => { const g = findGroup(id); if (g) g.node.collapsed = false; const t = newUntitled(canvas ? CANVAS_EMPTY : '', { canvas }); assignTab(t, id); };
    items.push(['Nova guia neste grupo', () => newIn(false)], ['Novo canvas neste grupo', () => newIn(true)], null,
      ['Novo subgrupo…', () => newGroup(id)], ['Renomear grupo…', () => renameGroup(id)], null,
      ['Salvar grupo em pastas…', () => saveGroup(id)], ['Fechar abas do grupo', () => closeGroupTabs(id)], null,
      ['Excluir grupo (as abas ficam sem grupo)', () => deleteGroup(id), 'danger']);
  } else if (row && row.dataset.tab) {
    const t = tabs.find((x) => x.path === row.dataset.tab);
    if (!t) return;
    const sel = [...selectedTabs].filter((x) => tabs.includes(x));
    if (sel.length >= 2 && selectedTabs.has(t)) { // várias abas selecionadas
      items.push([`Comparar ${sel.length} abas lado a lado`, () => showSideBySide(sel, true)],
        [`Abrir ${sel.length} abas lado a lado (sem comparar)`, () => showSideBySide(sel, false)], null,
        ['Novo grupo com estas abas…', () => { const first = sel[0]; newGroup(null, first); }], null,
        [`Fechar as ${sel.length} abas`, async () => { for (const x of sel) await closeTab(x); }]);
    } else {
      if (t !== active) items.push(['Abrir ao lado', () => openBeside(t)], ['Comparar com a aba atual', () => showSideBySide([active, t], true)], null);
      items.push(['Mover para grupo…', () => groupTabPalette(t)], ['Novo grupo com esta aba…', () => newGroup(null, t)]);
      if (t.groupId) items.push(['Tirar do grupo', () => assignTab(t, null)]);
      items.push(null, ['Fechar aba', () => closeTab(t)]);
    }
  } else {
    items.push(['Novo grupo…', () => newGroup()]);
    if (groups.length) items.push(['Salvar um grupo em pastas…', () => pickGroup('Qual grupo salvar em pastas?', (id) => saveGroup(id))]);
  }
  showMenu(e.clientX, e.clientY, items);
});
// arrastar arquivos/pastas do Explorer para a janela
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) {
    const p = api.pathForFile(f);
    if (p) await openPath(p);
  }
});
api.onOpenFiles(async (files) => { for (const p of files) await openPath(p); });
// Fechar o app com arquivos não salvos: salvar, manter para depois (voltam ao reabrir, como o Sublime) ou descartar.
api.onClosing(async () => {
  const dirty = tabs.filter((t) => t.dirty);
  // Como o Sublime/Obsidian: fecha sem perguntar e guarda tudo (rascunhos, alterações pendentes e a sessão inteira)
  if (!dirty.length || settings.hotExit !== false) { await saveDrafts(); return api.forceClose(); }
  const names = dirty.slice(0, 8).map((t) => '• ' + tabName(t)).join('\n') + (dirty.length > 8 ? `\n… e mais ${dirty.length - 8}` : '');
  const r = await askT(`${dirty.length} arquivo(s) com alterações não salvas:\n\n${names}\n\nO que deseja fazer?`, ['Salvar tudo', 'Fechar e manter para depois', 'Descartar e fechar', 'Cancelar']);
  if (r === 0) {
    for (const t of dirty) if (!(await saveTab(t))) return;
    await saveDrafts();
    api.forceClose();
  } else if (r === 1) { // mantém rascunhos e alterações: voltam como estavam quando você abrir o app de novo
    await saveDrafts();
    api.forceClose();
  } else if (r === 2) {
    await api.draftsSave([]);
    api.forceClose();
  }
});
$('tree').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const row = e.target.closest('.row');
  if (!row && !root) return;
  const target = row
    ? { path: row.dataset.path, dir: !!row.dataset.dir, isRoot: !!row.dataset.root }
    : { path: root, dir: true, isRoot: false, blank: true };
  const rr = rootOf(target.path);
  if (rr) root = rr.path;
  // área vazia: só "Novo arquivo/Nova pasta" no projeto atual
  if (target.blank) target.isRoot = true, target.noClose = true;
  showCtx(e.clientX, e.clientY, target);
});

// Largura da barra lateral (arrastar a borda)
(() => {
  const sb = $('sidebar');
  try { const w = +localStorage.getItem('tt.sbw'); if (w >= 160 && w <= 700) sb.style.width = w + 'px'; } catch {}
  $('resizer').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const move = (ev) => { sb.style.width = Math.max(160, Math.min(700, ev.clientX)) + 'px'; };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try { localStorage.setItem('tt.sbw', parseInt(sb.style.width, 10)); } catch {}
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
})();
// Blocos da lateral ("Arquivos abertos" e "Projetos"): setinha recolhe/expande; a divisória arrasta para
// aumentar/diminuir a lista de abas (duplo clique volta ao automático). Tudo fica lembrado.
function secState() { try { return JSON.parse(localStorage.getItem('tt.sections') || '{}'); } catch { return {}; } }
function saveSec(patch) { try { localStorage.setItem('tt.sections', JSON.stringify({ ...secState(), ...patch })); } catch {} }
function applySections() {
  const s = secState();
  $('openSec').classList.toggle('collapsed', s.open === false);
  $('projSec').classList.toggle('collapsed', s.proj === false);
  $('sharedSec').classList.toggle('collapsed', s.shared === false);
  $('sharedSec').hidden = s.sharedOff === true;
  $('secSplit2').hidden = s.sharedOff === true || s.shared === false || s.proj === false;
  const st2 = $('sharedTree'); // altura escolhida arrastando a divisória (0 = automático)
  if (s.sharedH) { st2.style.height = ''; st2.style.flex = '0 1 ' + s.sharedH + 'px'; $('sharedSec').style.maxHeight = 'none'; } // flex-basis (e não height fixa): encolhe com a janela e a barra de rolagem aparece
  else { st2.style.height = ''; st2.style.flex = ''; $('sharedSec').style.maxHeight = ''; }
  $('secSplit').hidden = s.open === false || s.proj === false;
  const of = $('openFiles');
  if (s.openH) { of.style.maxHeight = 'none'; of.style.height = s.openH + 'px'; } else { of.style.maxHeight = ''; of.style.height = ''; }
  for (const h of document.querySelectorAll('.sec-toggle')) {
    const closed = (h.dataset.sec === 'open' ? s.open : h.dataset.sec === 'shared' ? s.shared : s.proj) === false;
    h.querySelector('.arrow').textContent = closed ? '▸' : '▾';
  }
}
(() => {
  for (const h of document.querySelectorAll('.sec-toggle')) {
    h.addEventListener('click', () => {
      const k = h.dataset.sec;
      saveSec({ [k]: secState()[k] === false }); // inverte (padrão = aberto)
      applySections();
    });
  }
  const split = $('secSplit');
  split.addEventListener('mousedown', (e) => {
    e.preventDefault();
    split.classList.add('drag');
    const of = $('openFiles');
    const top = of.getBoundingClientRect().top;
    const move = (ev) => {
      const max = $('sidebar').getBoundingClientRect().height - 150; // sempre sobra espaço para "Projetos"
      const h = Math.max(40, Math.min(max, ev.clientY - top));
      of.style.maxHeight = 'none';
      of.style.height = h + 'px';
    };
    const up = () => {
      split.classList.remove('drag');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveSec({ openH: parseInt($('openFiles').style.height, 10) || 0 });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  split.addEventListener('dblclick', () => { saveSec({ openH: 0 }); applySections(); }); // volta ao automático
  const split2 = $('secSplit2'); // divisória do bloco Compartilhado (arrastar para cima aumenta, para baixo diminui)
  split2.addEventListener('mousedown', (e) => {
    e.preventDefault();
    split2.classList.add('drag');
    const tree = $('sharedTree');
    const sec = $('sharedSec');
    const head = sec.querySelector('.side-head').getBoundingClientRect().height;
    const move = (ev) => {
      const bottom = $('sidebar').getBoundingClientRect().bottom;
      const max = $('sidebar').getBoundingClientRect().height - 190; // sempre sobra espaço para "Projetos"
      const h = Math.max(40, Math.min(max, bottom - ev.clientY - head));
      sec.style.maxHeight = 'none';
      tree.style.height = '';
      tree.style.flex = '0 1 ' + h + 'px';
      tree.dataset.h = Math.round(h);
    };
    const up = () => {
      split2.classList.remove('drag');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      saveSec({ sharedH: parseInt(tree.dataset.h, 10) || 0 });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  split2.addEventListener('dblclick', () => { saveSec({ sharedH: 0 }); applySections(); });
  applySections();
})();
document.addEventListener('mousedown', (e) => { if (!e.target.closest?.('#ctx')) $('ctx').hidden = true; });
// Windows: o CodeMirror copia com quebra "\n"; o cmd e vários programas só entendem CRLF e juntam as linhas. Roda depois do
// tratamento do CodeMirror (o evento sobe até o document) e troca a quebra no texto que vai para a área de transferência.
for (const ev of ['copy', 'cut']) {
  document.addEventListener(ev, (e) => {
    if (!e.target.closest?.('.cm-editor') || !e.clipboardData) return;
    const t = e.clipboardData.getData('text/plain');
    if (t && t.includes('\n') && !t.includes('\r\n')) e.clipboardData.setData('text/plain', t.replace(/\n/g, '\r\n'));
  });
}
window.addEventListener('blur', () => { $('ctx').hidden = true; });
let focusTimer;
window.addEventListener('focus', () => {
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => roots.length && loadWorkspace(), 300);
});

(async function init() {
  try { // grupos de abas: restaurar ANTES de qualquer persist()
    const g = JSON.parse(localStorage.getItem('tt.groups') || '{}');
    groups.push(...(g.tree || []));
    groupAssign = g.assign || {};
  } catch {}
  focusedPane = createPane(null);
  view = focusedPane.view;
  await loadSettings();
  { // linhas fixadas: pins.json na pasta de dados do app (grava na hora; não se perde se o app for fechado à força)
    const pinsFile = joinPath(dirName(settingsPath), 'pins.json');
    let saved = {}; try { saved = JSON.parse((await api.readFile(pinsFile)).text); } catch { /* ainda não há */ }
    initPinsStore(saved, (txt) => api.write(pinsFile, txt));
    for (const t of tabs) { // arquivos que já tinham sido abertos antes de a lista chegar (ex.: os dos argumentos do programa)
      if (t.srv || t.untitled || !t.path) continue;
      const pv = panes.find((x) => x.tab === t); const st0 = pv ? pv.view.state : t.state;
      if (st0.field(pinField).length) continue;
      const pos = storedPositions(st0, t.path);
      if (pos.length) { if (pv) pv.view.dispatch({ effects: setPins.of(pos) }); else t.state = t.state.update({ effects: setPins.of(pos) }).state; }
    }
  }
  setTimeout(() => autoUpdateTick(true), settings.autoUpdateDelayMs ?? 20000); // atualização automática: primeira verificação pouco depois de abrir
  setInterval(() => autoUpdateTick(true), 30 * 60 * 1000);
  window.addEventListener('focus', () => autoUpdateTick(false));
  let session = {};
  try { session = JSON.parse(localStorage.getItem('tt.session') || '{}'); } catch {}
  const saved = session.roots || (session.root ? [session.root] : []);
  for (const p of saved) { try { await loadRoot(p); } catch {} }
  (session.collapsed || []).forEach((p) => collapsedRoots.add(p));
  if (roots.length) {
    root = roots.some((r) => r.path === session.root) ? session.root : roots[roots.length - 1].path;
    await rebuildIndex();
  }
  for (const p of session.files || []) await openFile(p);
  const a = tabs.find((t) => t.path === session.active);
  if (a) activate(a);
  // sessão da última vez: rascunhos, alterações pendentes, ordem das abas, aba ativa, cursor, rolagem e painéis
  let meta = null;
  try {
    const list = await api.draftsLoad();
    meta = list.find((d) => d.kind === 'meta' || d.kind === 'groups') || null;
    if (meta) { // a cópia gravada ao fechar é a mais fresca
      groups.length = 0;
      groups.push(...(meta.tree || []));
      groupAssign = meta.assign || {};
      for (const k of meta.order || []) { // arquivos que estavam abertos (mesmo que o registro simples esteja velho)
        if (k.startsWith('f:') && !tabs.some((t) => t.path === k.slice(2))) await openFile(k.slice(2));
      }
    }
    for (const d of list) {
      if (d.kind === 'meta' || d.kind === 'groups') continue;
      if (d.kind === 'untitled') {
        const tab = newUntitled(d.text, { eol: d.eol, canvas: /\.canvas$/i.test(d.name || '') });
        if (d.name && !tabs.some((x) => x !== tab && x.path === d.name)) tab.path = d.name; // mantém o nome "Sem título N"
        tab.enc = d.enc || 'utf8';
        if (d.groupId && findGroup(d.groupId)) assignTab(tab, d.groupId);
        if (d.sel) view.dispatch({ selection: { anchor: Math.min(d.sel, view.state.doc.length) } });
      } else if (d.kind === 'file') {
        let tab = tabs.find((t) => t.path === d.path);
        if (!tab) { await openFile(d.path); tab = tabs.find((t) => t.path === d.path); }
        if (tab) {
          const cur = stateOf(tab).doc.toString();
          if (normNL(cur) !== normNL(d.text)) {
            applyTo(tab, { changes: { from: 0, to: cur.length, insert: d.text } });
            tab.dirty = true;
          }
        }
      }
    }
  } catch (e) { console.error(e); }
  if (meta) {
    if (meta.order) { // mesma ordem das abas
      const rank = (t) => { const i = meta.order.indexOf(tabKey(t)); return i < 0 ? 1e9 : i; };
      tabs.sort((x, y) => rank(x) - rank(y));
    }
    for (const t of tabs) { // cursor e rolagem de cada aba
      const v = meta.views && meta.views[tabKey(t)];
      if (!v) continue;
      applyTo(t, { selection: { anchor: Math.min(v.sel || 0, stateOf(t).doc.length) } });
      t.topPos = v.top || 0;
    }
    if (meta.ui) { // painéis
      $('sidebar').hidden = !meta.ui.sidebar;
      $('resizer').hidden = $('sidebar').hidden;
      $('right').hidden = !meta.ui.right;
      $('preview').hidden = !meta.ui.preview;
    }
  }
  const back = (meta && meta.active && tabs.find((t) => tabKey(t) === meta.active)) || (a && tabs.includes(a) ? a : null);
  if (back) activate(back);
  if (meta && meta.panes && meta.panes.length > 1) { // painéis lado a lado (e comparação) como estavam
    const list = meta.panes.map((k) => tabs.find((t) => tabKey(t) === k)).filter(Boolean);
    if (list.length > 1) { showSideBySide(list, !!meta.compare); if (back && tabs.includes(back)) activate(back); }
  }
  renderOpenFiles();
  draftsReady = true;
  scheduleDrafts();
  shared.init().then(() => renderSharedTree()).catch(() => {});
  renderSharedTree();
  refreshLocalSrv(); // projetos compartilhados (só conecta se já houver login salvo)
  // Novidades: mostra a janela sozinha quando a versão mudou desde a última vez; o botão sempre abre
  try {
    curVersion = await api.version();
    $('stVer').textContent = 'v' + curVersion;
    const unseen = seenVersion() !== curVersion;
    $('newsDot').hidden = !unseen;
    const noNews = !!(await api.flags()).noNews;
    if (unseen && !noNews) setTimeout(showNews, 700);
    if (!noNews) setTimeout(() => supportAuto(), 9000);
  } catch (e) { console.error(e); }
  for (const p of await api.launchFiles()) await openPath(p); // arquivos passados pelo Windows ("Abrir com…")
  window.__tt = { shared, allPins, pinsDebug: () => ({ stored: storedEntries().map((e) => [e.path, e.pins]) }), get view() { return view; }, setSetting, showNews, tabs, panes, selectedTabs, showSideBySide, openBeside, singlePane, reopenClosed, closedStack, setCompare, refreshDiff, gotoDiff, paneOf, stateOf, idx, roots, groups, wrapLine, reflowText, setAutoWrap, wrapWidth, assignTab, findGroup, groupNames, saveGroup, deleteGroup, renderOpenFiles, tabsOfGroup, saveTab, newUntitled, COMMANDS, loadWorkspace, openFile, setLanguage, importSublime, resolveWiki, jumpToFragment, tabName, openWiki, dailyNote, fmtDate, get root() { return root; }, get active() { return active; } };
})();
