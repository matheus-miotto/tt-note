// Comandos de edição que o Sublime tem e o CodeMirror não: capitalizar, inverter maiúsculas, trocar letras, apagar até o fim/começo
// da linha, inserir linha acima, permutar linhas (inverter, únicas, embaralhar), ordenar sem diferenciar, expandir a seleção até os
// colchetes, dobrar por nível, converter indentação e usar a seleção na busca.
import { EditorSelection } from '@codemirror/state';
import { foldable, foldEffect, unfoldAll, indentUnit } from '@codemirror/language';
import { matchBrackets } from '@codemirror/language';
import { SearchQuery, setSearchQuery } from '@codemirror/search';

// Aplica uma função ao texto de cada seleção (sem seleção: à palavra sob o cursor)
function mapSelections(v, fn) {
  const st = v.state;
  v.dispatch(st.changeByRange((r) => {
    let { from, to } = r;
    if (r.empty) { const w = st.wordAt(r.head); if (!w) return { range: r }; from = w.from; to = w.to; }
    const txt = st.sliceDoc(from, to);
    const out = fn(txt);
    return { changes: { from, to, insert: out }, range: EditorSelection.range(from, from + out.length) };
  }), { userEvent: 'input.edit', scrollIntoView: true });
  return true;
}

export const titleCase = (v) => mapSelections(v, (t) => t.toLowerCase().replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1)));
export const swapCase = (v) => mapSelections(v, (t) => [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''));

// Linhas cobertas pela seleção principal (sem seleção: o arquivo todo, como no Sublime)
function lineRange(v) {
  const { doc, selection } = v.state;
  const r = selection.main;
  if (r.empty) return { from: 0, to: doc.length };
  const a = doc.lineAt(r.from); let b = doc.lineAt(r.to);
  if (b.number > a.number && r.to === b.from) b = doc.line(b.number - 1);
  return { from: a.from, to: b.to };
}
function mapLines(v, fn) {
  const { from, to } = lineRange(v);
  const lines = v.state.doc.sliceString(from, to).split('\n');
  const out = fn(lines).join('\n');
  v.dispatch({ changes: { from, to, insert: out }, selection: { anchor: from, head: from + out.length }, userEvent: 'input.edit', scrollIntoView: true });
  return true;
}
export const reverseLines = (v) => mapLines(v, (l) => l.reverse());
export const uniqueLines = (v) => mapLines(v, (l) => { const seen = new Set(); return l.filter((x) => (seen.has(x) ? false : (seen.add(x), true))); });
export const shuffleLines = (v) => mapLines(v, (l) => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; });
export const sortLinesNoCase = (v) => mapLines(v, (l) => l.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true })));
export const sortLinesCase = (v) => mapLines(v, (l) => l.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

// Ctrl+Shift+Enter: linha nova ACIMA da atual, já com a mesma indentação
export function insertLineBefore(v) {
  const st = v.state;
  v.dispatch(st.changeByRange((r) => {
    const line = st.doc.lineAt(r.from);
    const ind = /^\s*/.exec(line.text)[0];
    return { changes: { from: line.from, insert: ind + '\n' }, range: EditorSelection.cursor(line.from + ind.length) };
  }), { userEvent: 'input', scrollIntoView: true });
  return true;
}
// Ctrl+Enter: linha nova ABAIXO da atual, com a mesma indentação (o Sublime faz isso sem precisar estar no fim da linha)
export function insertLineAfter(v) {
  const st = v.state;
  v.dispatch(st.changeByRange((r) => {
    const line = st.doc.lineAt(r.to);
    const ind = /^\s*/.exec(line.text)[0];
    return { changes: { from: line.to, insert: '\n' + ind }, range: EditorSelection.cursor(line.to + 1 + ind.length) };
  }), { userEvent: 'input', scrollIntoView: true });
  return true;
}

// Ctrl+Shift+M: seleciona o que está dentro dos colchetes/parênteses/chaves mais próximos; repetir expande para o próximo nível
const OPEN = '([{'; const CLOSE = ')]}';
export function selectBrackets(v) {
  const st = v.state; const doc = st.doc;
  const r = st.selection.main;
  for (let i = Math.min(r.from, doc.length) - 1; i >= 0; i--) {
    const c = doc.sliceString(i, i + 1);
    if (!OPEN.includes(c)) continue;
    const m = matchBrackets(st, i, 1);
    if (!m || !m.matched || !m.end) continue;
    const innerFrom = i + 1; const innerTo = m.end.from;
    if (innerTo < r.to) continue; // esse par não envolve a seleção
    if (r.from === innerFrom && r.to === innerTo) { // já está dentro: sobe incluindo os próprios colchetes
      if (r.from - 1 === i && r.to === innerTo) { v.dispatch({ selection: { anchor: i, head: m.end.to }, scrollIntoView: true }); return true; }
      continue;
    }
    v.dispatch({ selection: { anchor: innerFrom, head: innerTo }, scrollIntoView: true });
    return true;
  }
  return false;
}

// Dobrar por nível (Ctrl+K Ctrl+1…9): dobra todas as regiões do nível n
export function foldLevel(v, n) {
  const st = v.state; const doc = st.doc;
  const ranges = [];
  for (let i = 1; i <= doc.lines && ranges.length < 6000; i++) { const l = doc.line(i); const r = foldable(st, l.from, l.to); if (r) ranges.push(r); }
  const effects = [];
  for (const r of ranges) {
    const level = 1 + ranges.filter((o) => o !== r && o.from <= r.from && o.to >= r.to).length;
    if (level === n) effects.push(foldEffect.of(r));
  }
  if (effects.length) v.dispatch({ effects });
  return effects.length;
}
export const unfoldEverything = (v) => unfoldAll(v);

// Converter a indentação das linhas (só o recuo do começo de cada linha) entre espaços e tabs
export function convertIndent(v, toTabs) {
  const st = v.state;
  const unit = st.facet(indentUnit);
  const n = st.tabSize || 4;
  void unit;
  const { from, to } = lineRange(v);
  const lines = st.doc.sliceString(from, to).split('\n').map((ln) => {
    const m = /^[ \t]+/.exec(ln);
    if (!m) return ln;
    let col = 0;
    for (const ch of m[0]) col += ch === '\t' ? n - (col % n) : 1;
    const ind = toTabs ? '\t'.repeat(Math.floor(col / n)) + ' '.repeat(col % n) : ' '.repeat(col);
    return ind + ln.slice(m[0].length);
  });
  const out = lines.join('\n');
  if (out === st.doc.sliceString(from, to)) return false;
  v.dispatch({ changes: { from, to, insert: out }, userEvent: 'input.edit' });
  return true;
}

// Ctrl+E: usa a seleção como texto da próxima busca (F3 / Shift+F3 acham os próximos)
export function useSelectionForFind(v) {
  const r = v.state.selection.main;
  const text = r.empty ? (v.state.wordAt(r.head) ? v.state.sliceDoc(v.state.wordAt(r.head).from, v.state.wordAt(r.head).to) : '') : v.state.sliceDoc(r.from, r.to);
  if (!text || /\n/.test(text)) return '';
  v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: text })) });
  return text;
}
