// Quebra de linha automática (hard wrap) ao digitar, como o pacote AutoWrap do Sublime,
// mais réguas verticais e reformatação de parágrafos.
import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

const BREAK_BEFORE = '([{'; // o AutoWrap também quebra antes de ( [ {

// largura visual de um texto (tabulação ocupa até a próxima parada)
function visWidth(s, tab) {
  let col = 0;
  for (const ch of s) col += ch === '\t' ? tab - (col % tab) : 1;
  return col;
}
const trimEnd = (s) => s.replace(/\s+$/, ''); // espaços no fim da linha não contam para a largura

// Quebra uma linha lógica em linhas de no máximo `width` colunas, no último ponto de quebra possível
// (espaço, ou antes de ( [ {). Mantém a indentação. Palavra maior que a largura não é cortada.
// Retorna o novo texto, onde o cursor passa a ficar e as edições mínimas (em coordenadas do texto original).
export function wrapLine(text, cursor, width, tab) {
  const indent = text.match(/^\s*/)[0];
  const edits = [];
  let delta = 0; // quanto o texto atual já cresceu/encolheu em relação ao original
  let segStart = 0;
  for (let guard = 0; guard < 1000; guard++) {
    if (visWidth(trimEnd(text.slice(segStart)), tab) <= width) break;
    let best = -1;
    for (let i = segStart + indent.length + 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ' || BREAK_BEFORE.includes(ch)) {
        if (visWidth(trimEnd(text.slice(segStart, i)), tab) <= width) best = i;
        else break;
      }
    }
    if (best < 0) break;
    const left = trimEnd(text.slice(segStart, best));
    const leftEnd = segStart + left.length;
    let rs = best;
    if (text[best] === ' ') while (text[rs] === ' ') rs++; // os espaços da quebra somem
    const removed = rs - leftEnd;
    edits.push({ from: leftEnd - delta, to: rs - delta, insert: '\n' + indent });
    delta += 1 + indent.length - removed;
    text = text.slice(0, leftEnd) + '\n' + indent + text.slice(rs);
    if (cursor >= rs) cursor += 1 + indent.length - removed;
    else if (cursor > leftEnd) cursor = leftEnd + 1 + indent.length;
    segStart = leftEnd + 1;
  }
  return { text, cursor, edits };
}

const STARTER = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|~~~)/; // item de lista, título, citação, cerca de código

// Reformata um trecho: junta as linhas de cada parágrafo e quebra de novo na largura.
// Linhas em branco, itens de lista, títulos, citações e blocos de código iniciam um novo bloco.
export function reflowText(text, width, tab) {
  const out = [];
  let block = [];
  let fence = false;
  const flush = () => {
    if (!block.length) return;
    const indent = block[0].match(/^\s*/)[0];
    out.push(wrapLine(indent + block.map((l) => l.trim()).join(' '), 0, width, tab).text);
    block = [];
  };
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); fence = !fence; out.push(line); continue; }
    if (fence || !line.trim()) { flush(); out.push(line); continue; }
    if (STARTER.test(line)) flush();
    block.push(line);
  }
  flush();
  return out.join('\n');
}

// Depois de cada digitação, se a linha passou da largura, quebra no último espaço (ou antes de ( [ {).
// As quebras entram como edições mínimas na mesma transação: o fechamento automático de parênteses,
// o desfazer etc. continuam funcionando. Se a linha de baixo continua o mesmo parágrafo, o excesso
// desce para ela (reflow) em vez de criar uma linha nova. getCfg() -> { width, tab }.
export function autoWrapExt(getCfg) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent('input.type')) return tr; // só digitação (não cola, não apaga)
    const { width, tab } = getCfg();
    if (!width) return tr;
    const sel = tr.newSelection;
    if (sel.ranges.length !== 1 || !sel.main.empty) return tr;
    let small = true, n = 0;
    tr.changes.iterChanges((fa, ta, fb, tb, ins) => { n += ins.length; if (ins.lines > 1) small = false; });
    if (!small || n > 8) return tr;

    const doc = tr.newDoc;
    const line = doc.lineAt(sel.main.head);
    if (visWidth(trimEnd(line.text), tab) <= width) return tr; // cabe

    const ind = (s) => s.match(/^\s*/)[0];
    let full = line.text;
    let join = null;
    if (line.number < doc.lines && full.trim()) {
      const next = doc.line(line.number + 1);
      if (next.text.trim() && !STARTER.test(next.text) && ind(next.text) === ind(line.text)) {
        join = { from: line.to, to: next.from + ind(next.text).length, insert: ' ' };
        full += ' ' + next.text.slice(ind(next.text).length);
      }
    }
    const r = wrapLine(full, sel.main.head - line.from, width, tab);
    if (!r.edits.length) return tr; // sem ponto de quebra (palavra longa)

    const specs = [tr];
    if (join) specs.push({ changes: join, sequential: true });
    specs.push({
      changes: r.edits.map((e) => ({ from: line.from + e.from, to: line.from + e.to, insert: e.insert })),
      selection: { anchor: line.from + r.cursor },
      sequential: true,
      scrollIntoView: true,
    });
    return specs;
  });
}

// Réguas verticais nas colunas indicadas (ex.: 72 e 80)
export function rulerExt(getCols) {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; this.els = []; this.draw(); }
    update(u) { if (u.geometryChanged || u.viewportChanged || u.docChanged) this.draw(); }
    draw() {
      this.view.requestMeasure({
        key: this,
        read: (v) => {
          const sr = v.scrollDOM.getBoundingClientRect();
          const cr = v.contentDOM.getBoundingClientRect();
          const line = v.contentDOM.querySelector('.cm-line');
          const pad = line ? parseFloat(getComputedStyle(line).paddingLeft) || 0 : 0;
          return { cw: v.defaultCharacterWidth, x0: cr.left - sr.left + v.scrollDOM.scrollLeft + pad, h: v.contentHeight };
        },
        write: (m, v) => {
          const cols = getCols();
          while (this.els.length > cols.length) this.els.pop().remove();
          while (this.els.length < cols.length) {
            const e = document.createElement('div');
            e.className = 'cm-ruler';
            v.scrollDOM.append(e);
            this.els.push(e);
          }
          cols.forEach((c, i) => {
            this.els[i].style.left = m.x0 + c * m.cw + 'px';
            this.els[i].style.height = Math.max(m.h, v.scrollDOM.clientHeight) + 'px';
          });
        },
      });
    }
    destroy() { this.els.forEach((e) => e.remove()); }
  });
}
