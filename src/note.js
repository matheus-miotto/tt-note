// Nota flutuante: janela pequena com editor Markdown (Live Preview), que pode ficar fixada sobre as outras janelas.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { closeBrackets } from '@codemirror/autocomplete';
import { Compartment } from '@codemirror/state';
import { themeById, applyThemeVars, cmTheme, setCustomTheme } from './themes.js';
import { livePreview } from './livepreview.js';
import { initLang } from './i18n.js';
initLang();

const api = window.api;
const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
const COLORS = ['#e5c07b', '#61afef', '#98c379', '#e06c75', '#c678dd', '#d19a66', '#56b6c2', '#abb2bf'];

const themeComp = new Compartment();
const loadCustom = () => { try { setCustomTheme(JSON.parse(localStorage.getItem('tt.customTheme') || 'null')); } catch { /* */ } };
loadCustom();
const curTheme = () => { try { return localStorage.getItem('tt.theme') || 'tt-dark'; } catch { return 'tt-dark'; } };
let note = null;
let view;
let saveTimer;

function applyMeta() {
  document.body.style.setProperty('--nc', note.color);
  $('nPin').classList.toggle('on', !!note.pinned);
  $('nPin').title = note.pinned ? 'Fixada no topo — clique para soltar' : 'Fixar no topo (sempre visível)';
  const first = (note.text || '').split('\n').find((l) => l.trim()) || 'Nota';
  $('nTitle').textContent = first.replace(/^[#>\-*\s[\]x]+/i, '').slice(0, 60) || 'Nota';
  document.title = $('nTitle').textContent;
}

const saveNow = () => { clearTimeout(saveTimer); api.noteSave(id, view.state.doc.toString()); };
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

async function init() {
  note = await api.noteGet(id);
  if (!note) return window.close();
  view = new EditorView({
    parent: $('ned'),
    state: EditorState.create({
      doc: note.text || '',
      extensions: [
        history(), drawSelection(), closeBrackets(), EditorView.lineWrapping, themeComp.of(cmTheme(themeById(curTheme()))),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        livePreview({ imgSrc: (s) => s, wikiImg: () => null }),
        keymap.of([
          { key: 'Escape', run: () => { api.noteHide(id); return true; } },
          indentWithTab, ...searchKeymap, ...historyKeymap, ...defaultKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          note.text = u.state.doc.toString();
          applyMeta();
          scheduleSave();
        }),
      ],
    }),
  });
  applyMeta();
  applyThemeVars(themeById(curTheme()));
  window.addEventListener('storage', (e) => { if (e.key !== 'tt.theme' && e.key !== 'tt.customTheme') return; loadCustom(); const th = themeById(curTheme()); applyThemeVars(th); view.dispatch({ effects: themeComp.reconfigure(cmTheme(th)) }); });
  view.focus();
  const end = view.state.doc.length;
  view.dispatch({ selection: { anchor: end } });

  const box = $('nColors');
  for (const c of COLORS) {
    const d = document.createElement('i');
    d.style.background = c;
    d.onclick = () => { note.color = c; api.noteSet(id, { color: c }); applyMeta(); box.hidden = true; view.focus(); };
    box.append(d);
  }
  $('nColor').onclick = () => {
    box.hidden = !box.hidden;
    for (const d of box.children) d.classList.toggle('cur', d.style.background && getComputedStyle(d).backgroundColor === getComputedStyle($('nColor')).color);
  };
  $('nPin').onclick = () => { note.pinned = !note.pinned; api.noteSet(id, { pinned: note.pinned }); applyMeta(); };
  $('nNew').onclick = () => api.notesNew('');
  $('nMain').onclick = () => api.showMain();
  $('nDel').onclick = () => { saveNow(); api.noteDelete(id); };
  $('nClose').onclick = () => { saveNow(); api.noteHide(id); };
  document.addEventListener('mousedown', (e) => { if (!box.hidden && !e.target.closest('#nColors, #nColor')) box.hidden = true; });
  window.addEventListener('beforeunload', saveNow);
  api.onNoteFocus?.(() => view.focus());
}
init();
