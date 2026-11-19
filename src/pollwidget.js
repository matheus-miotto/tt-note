// Enquete nas notas normais (Live Preview): o bloco ```enquete``` vira um cartão clicável; a escolha fica gravada no próprio texto.
// Com o cursor dentro do bloco, aparece o texto puro para editar. Opções e pergunta podem ter imagem.
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { findPolls, parsePoll, toggleChoice } from '../server/poll.js';

let res = { imgSrc: (s) => s, wikiImg: () => null }; // como achar a imagem de uma nota (definido pelo app)

const srcOf = (im) => (im.wiki ? res.wikiImg(im.src) : res.imgSrc(im.src)) || '';
function zoom(src) {
  const z = document.createElement('div'); z.className = 'cm-poll-zoom';
  const i = document.createElement('img'); i.src = src; z.append(i); z.onclick = () => z.remove();
  document.body.append(z);
}
function imgEl(im, cls) {
  const i = document.createElement('img'); i.className = cls; i.src = srcOf(im); i.alt = im.alt || ''; i.loading = 'lazy';
  i.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); zoom(i.src); };
  i.onerror = () => { i.replaceWith(Object.assign(document.createElement('span'), { className: 'cm-poll-noimg', textContent: '🖼' })); };
  return i;
}

class PollWidget extends WidgetType {
  constructor(text, info) { super(); this.text = text; this.info = info; }
  eq(o) { return o.text === this.text; }
  toDOM(view) {
    const lines = this.text.split('\n');
    const p = parsePoll(this.info, lines.slice(1, -1).join('\n'));
    const card = document.createElement('div');
    card.className = 'cm-poll' + (p.options.every((o) => o.image) ? ' grid' : '');
    const head = document.createElement('div'); head.className = 'cm-poll-head';
    const q = document.createElement('span'); q.className = 'cm-poll-q'; q.textContent = '📊 ' + p.question;
    const kind = document.createElement('span'); kind.className = 'cm-poll-kind'; kind.textContent = p.multi ? 'várias escolhas' : 'uma escolha';
    const edit = document.createElement('button'); edit.className = 'cm-poll-edit'; edit.textContent = '✎'; edit.title = 'Editar o texto da enquete';
    edit.onmousedown = (e) => { e.preventDefault(); const pos = view.posAtDOM(card); view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, pos + 12) } }); view.focus(); };
    head.append(q, kind, edit);
    card.append(head);
    if (p.image) card.append(imgEl(p.image, 'cm-poll-qimg'));
    const opts = document.createElement('div'); opts.className = 'cm-poll-opts'; card.append(opts);
    p.options.forEach((o, i) => {
      const row = document.createElement('div'); row.className = 'cm-poll-opt' + (o.checked ? ' on' : '');
      const mark = document.createElement('span'); mark.className = 'cm-poll-mark ' + (p.multi ? 'box' : 'dot'); mark.textContent = p.multi ? (o.checked ? '☑' : '☐') : (o.checked ? '◉' : '○');
      const t = document.createElement('span'); t.className = 'cm-poll-text'; t.textContent = o.text;
      if (o.image) row.append(imgEl(o.image, 'cm-poll-img'));
      row.append(mark, t);
      row.onmousedown = (e) => {
        e.preventDefault();
        const pos = view.posAtDOM(card);
        const blk = findPolls(view.state.doc.toString()).find((b) => b.from === pos);
        if (!blk) return;
        const next = toggleChoice(view.state.doc.sliceString(blk.from, blk.to), i);
        if (next) view.dispatch({ changes: { from: blk.from, to: blk.to, insert: next } });
      };
      opts.append(row);
    });
    return card;
  }
  ignoreEvent() { return true; }
}

function buildDecos(blocks, state) {
  const decos = [];
  for (const b of blocks) {
    if (state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)) continue; // cursor dentro: mostra o texto
    const p = parsePoll(b.info, b.body);
    if (!p.ok) continue;
    decos.push(Decoration.replace({ widget: new PollWidget(state.doc.sliceString(b.from, b.to), b.info), block: true }).range(b.from, b.to));
  }
  return Decoration.set(decos);
}

const field = StateField.define({
  create(state) { const blocks = state.doc.length > 12 ? findPolls(state.doc.toString()) : []; return { blocks, decos: buildDecos(blocks, state) }; },
  update(v, tr) {
    let blocks = v.blocks;
    if (tr.docChanged) blocks = tr.state.doc.length > 12 ? findPolls(tr.state.doc.toString()) : [];
    if (!tr.docChanged && !tr.selection) return v;
    return { blocks, decos: buildDecos(blocks, tr.state) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
});

// resolvers: { imgSrc(src), wikiImg(nome) } — como o app acha a imagem de uma nota
export function pollExt(resolvers) { if (resolvers) res = resolvers; return field; }
