// Linhas fixadas nas guias normais: um 📌 no canto da linha, fica gravado por arquivo (neste PC) e acompanha a linha quando o texto muda.
import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import { gutter, GutterMarker, EditorView, Decoration, ViewPlugin } from '@codemirror/view';

class PinMarker extends GutterMarker {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-pin-mark'; s.textContent = '📌'; s.title = 'Linha fixada — clique para desafixar'; return s; }
}
const marker = new PinMarker();

// { add: [posições], remove: [posições] }  (qualquer posição dentro da linha serve)
export const pinChange = StateEffect.define();
// substitui tudo: [posições]
export const setPins = StateEffect.define();

const norm = (doc, positions) => {
  const seen = new Set(); const out = [];
  for (const p of positions) { const l = doc.lineAt(Math.max(0, Math.min(p, doc.length))); if (!seen.has(l.from)) { seen.add(l.from); out.push({ from: l.from, to: l.to }); } }
  return out.sort((a, b) => a.from - b.from);
};

export const pinField = StateField.define({
  create: () => [],
  update(v, tr) {
    let pins = v;
    if (tr.docChanged && pins.length) {
      const out = [];
      // o texto inteiro foi trocado (ex.: rascunho restaurado, arquivo recarregado): acha as linhas de novo pelo texto
      let all = false; const oldLen = tr.startState.doc.length;
      tr.changes.iterChanges((fa, ta) => { if (fa === 0 && ta >= oldLen) all = true; });
      if (all) {
        for (const p of pins) { const ol = tr.startState.doc.lineAt(p.from); const ln = findLine(tr.state.doc, { line: ol.number, text: ol.text.trim().slice(0, 200) }); if (ln) out.push(tr.state.doc.line(ln).from); }
        return norm(tr.state.doc, out);
      }
      for (const p of pins) {
        const from = tr.changes.mapPos(p.from, 1); const to = tr.changes.mapPos(p.to, -1);
        if (p.to > p.from && to <= from) continue; // a linha inteira foi apagada: a fixação vai junto
        out.push(from);
      }
      pins = norm(tr.state.doc, out);
    }
    for (const e of tr.effects) {
      if (e.is(setPins)) pins = norm(tr.state.doc, e.value);
      else if (e.is(pinChange)) {
        const rm = new Set(norm(tr.state.doc, e.value.remove || []).map((x) => x.from));
        const kept = pins.filter((p) => !rm.has(p.from)).map((p) => p.from);
        pins = norm(tr.state.doc, [...kept, ...(e.value.add || [])]);
      }
    }
    return pins;
  },
});

let listener = null; // fn(view, state): o app grava as fixações quando elas ou o texto mudam
export const onPinsChange = (fn) => { listener = fn; };

const saver = ViewPlugin.fromClass(class {
  constructor(view) { this.view = view; }
  update(u) {
    // avisa na hora (com o estado de agora): quem grava decide quando, sem se confundir se a aba mudar no meio
    if (u.startState.field(pinField) !== u.state.field(pinField) || (u.docChanged && u.state.field(pinField).length)) listener && listener(this.view, u.state);
  }
});

const pinGutter = gutter({
  class: 'cm-pin-gutter',
  markers: (v) => RangeSet.of(v.state.field(pinField).map((p) => marker.range(p.from)), true),
  lineMarkerChange: (u) => u.startState.field(pinField) !== u.state.field(pinField),
  initialSpacer: () => marker,
  domEventHandlers: {
    mousedown(view, line) { if (view.state.field(pinField).some((p) => p.from === line.from)) { view.dispatch({ effects: pinChange.of({ remove: [line.from] }) }); return true; } return false; },
  },
});

export const pinsExt = () => [
  pinField,
  pinGutter,
  EditorView.decorations.compute([pinField], (state) => Decoration.set(state.field(pinField).map((p) => Decoration.line({ class: 'cm-pinned-line' }).range(p.from)))),
  saver,
];

/* ───────────── guardado por arquivo (localStorage) ───────────── */
// Fica num arquivo (pins.json, na pasta de dados do app) e em memória: sobrevive até se o app for fechado à força
let store = {};
let writer = null; let wt = null;
export function initStore(obj, writeFn) { store = obj && typeof obj === 'object' ? obj : {}; writer = writeFn; }
const persist = () => { clearTimeout(wt); wt = setTimeout(() => { if (writer) Promise.resolve(writer(JSON.stringify(store))).catch(() => {}); }, 250); };
// a chave ignora barra/maiúsculas (C:\a\b.md e c:/a/b.md são o mesmo arquivo); guarda o caminho original para reabrir
export const pk = (p) => String(p).replace(/\//g, '\\').toLowerCase();
const loadStore = () => store;
const saveStore = (o) => { store = o; persist(); };
export function savePinsFor(path, list) { const s = loadStore(); if (list.length) s[pk(path)] = { path, pins: list }; else delete s[pk(path)]; saveStore(s); }
export const pinsStored = (path) => (loadStore()[pk(path)] || {}).pins || [];
export const storedEntries = () => Object.values(loadStore()); // [{ path, pins: [{ line, text }] }]
export function dropStored(path) { const s = loadStore(); delete s[pk(path)]; saveStore(s); }
export function removeStored(path, line, text) { const l = pinsStored(path).filter((x) => !(x.line === line && x.text === text)); savePinsFor(path, l); }

// Linhas fixadas de um estado: [{ from, line, text }]
export function listPins(state) {
  return state.field(pinField).map((p) => { const l = state.doc.lineAt(p.from); return { from: p.from, line: l.number, text: l.text.trim().slice(0, 200) }; });
}
// O que gravar: [{ line, text }]
export const toStored = (state) => listPins(state).map((p) => ({ line: p.line, text: p.text }));

// Acha a linha de uma fixação guardada: a mesma linha, se o texto bate; senão a linha mais próxima com o mesmo texto
export function findLine(doc, stored) {
  const n = doc.lines; const want = stored.text;
  const at = (i) => doc.line(i).text.trim().slice(0, 200);
  if (stored.line >= 1 && stored.line <= n && at(stored.line) === want) return stored.line;
  if (!want) return stored.line >= 1 && stored.line <= n ? stored.line : 0;
  let best = 0; let bd = Infinity;
  for (let i = 1; i <= n; i++) if (at(i) === want) { const d = Math.abs(i - stored.line); if (d < bd) { bd = d; best = i; } }
  return best;
}

// Posições (início de linha) das fixações guardadas para este arquivo, já procuradas no texto de agora
export function storedPositions(state, path) {
  const pos = [];
  for (const s of pinsStored(path)) { const ln = findLine(state.doc, s); if (ln) pos.push(state.doc.line(ln).from); }
  return pos;
}
// Estado já com as fixações guardadas para este arquivo
export function withStoredPins(state, path) {
  const pos = storedPositions(state, path);
  return pos.length ? state.update({ effects: setPins.of(pos) }).state : state;
}
