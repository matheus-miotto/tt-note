// Live Preview estilo Obsidian: renderiza o Markdown no próprio editor.
// A sintaxe (#, **, [[ ]], etc.) só aparece quando o cursor está tocando o elemento.
import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';
import { StateField, Facet } from '@codemirror/state';

// Legenda (nome do arquivo) embaixo das imagens: ligada/desligada por aba (a escolha entra no estado do editor)
export const imgCaptionFacet = Facet.define({ combine: (v) => (v.length ? v[v.length - 1] : true) });
const WIDTH = /^\d+(x\d+)?$/;

let cfg = { imgSrc: (s) => s, wikiImg: () => null };

const touches = (state, from, to) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
const hide = Decoration.replace({});
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

class TextWidget extends WidgetType {
  constructor(t, cls) { super(); this.t = t; this.cls = cls; }
  eq(o) { return o.t === this.t && o.cls === this.cls; }
  toDOM() { const s = document.createElement('span'); s.className = this.cls; s.textContent = this.t; return s; }
}

// Botão "Copiar" no canto do bloco de código (copia só o código, sem as cercas)
export function copyText(t) {
  window.__ttCopied = t; // gancho de teste
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
  return Promise.resolve(legacyCopy(t));
}
function legacyCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* sem copiar */ } ta.remove();
}
function fenceContent(state, pos) {
  const doc = state.doc; const a = doc.lineAt(pos).number;
  const m = /^\s*(`{3,}|~{3,})/.exec(doc.line(a).text);
  if (!m) return null;
  const ch = m[1][0]; const n = m[1].length; const lines = [];
  for (let l = a + 1; l <= doc.lines; l++) { const t = doc.line(l).text; if (new RegExp('^\\s*\\' + ch + '{' + n + ',}\\s*$').test(t)) break; lines.push(t); }
  return lines.join('\n');
}
class CopyWidget extends WidgetType {
  eq() { return true; }
  toDOM(view) {
    const b = document.createElement('button'); b.className = 'cm-copybtn'; b.textContent = 'Copiar'; b.title = 'Copiar o código deste bloco';
    b.onmousedown = (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = fenceContent(view.state, view.posAtDOM(b));
      if (t == null) return;
      copyText(t).then(() => { b.textContent = '✓ Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1300); });
    };
    return b;
  }
  ignoreEvent() { return true; }
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-hr'; return s; }
}

class CheckWidget extends WidgetType {
  constructor(checked) { super(); this.checked = checked; }
  eq(o) { return o.checked === this.checked; }
  toDOM(view) {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = this.checked;
    i.className = 'cm-task';
    i.onmousedown = (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(i);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
    };
    return i;
  }
  ignoreEvent() { return true; }
}

class ImgWidget extends WidgetType {
  // cap: { text, custom, kind: 'wiki'|'md', name?, wpart?, url?, raw } — null quando a legenda está desligada
  constructor(src, alt, width, cap) { super(); this.src = src; this.alt = alt; this.width = width; this.cap = cap; }
  eq(o) { return o.src === this.src && o.width === this.width && JSON.stringify(o.cap) === JSON.stringify(this.cap); }
  toDOM(view) {
    const fig = document.createElement('span');
    fig.className = 'cm-figure';
    const img = document.createElement('img');
    img.className = 'cm-img';
    img.src = this.src;
    img.alt = this.alt;
    if (this.width) img.style.width = this.width + 'px'; // ![[img.png|300]]
    img.onerror = () => { fig.replaceChildren(Object.assign(document.createElement('span'), { className: 'cm-img-missing', textContent: `🖼 ${this.alt || this.src}` })); };
    fig.append(img);
    if (this.cap) {
      const c = document.createElement('span');
      c.className = 'cm-figcap' + (this.cap.custom ? '' : ' def');
      c.textContent = this.cap.text;
      c.title = 'Clique para editar o nome mostrado (o arquivo não é renomeado)';
      c.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); this.edit(view, fig, c); };
      fig.append(c);
    }
    return fig;
  }
  edit(view, fig, c) {
    const cap = this.cap;
    const inp = document.createElement('input');
    inp.className = 'cm-figinput';
    inp.value = cap.text;
    c.replaceWith(inp);
    inp.focus(); inp.select();
    const pos = view.posAtDOM(fig);
    let done = false;
    const fin = (save) => {
      if (done) return;
      done = true;
      const t = inp.value.replace(/[\[\]|]/g, ' ').trim();
      const def = cap.defText;
      if (!save || t === cap.text || (!cap.custom && t === def)) { inp.replaceWith(c); view.focus(); return; }
      const alias = !t || t === def ? '' : t; // vazio (ou igual ao nome do arquivo) volta ao padrão
      const raw = cap.kind === 'wiki'
        ? `![[${cap.name}${cap.wpart ? '|' + cap.wpart : ''}${alias ? '|' + alias : ''}]]`
        : `![${alias}](${cap.url})`;
      view.dispatch({ changes: { from: pos, to: pos + cap.raw.length, insert: raw } });
      view.focus();
    };
    inp.addEventListener('blur', () => fin(true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') { e.preventDefault(); fin(false); }
      e.stopPropagation();
    });
  }
  ignoreEvent() { return true; }
}

// Formatação dentro de células de tabela: `código`, **negrito**, *itálico*, ~~riscado~~, [[link]] (sem innerHTML)
function inlineInto(el, text) {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|~~([^~]+)~~|\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) el.append(document.createTextNode(text.slice(last, m.index)));
    const make = (tag, cls, t) => { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = t; el.append(n); };
    if (m[1] !== undefined) make('code', 'cm-icode', m[1]);
    else if (m[2] !== undefined || m[3] !== undefined) make('strong', '', m[2] ?? m[3]);
    else if (m[4] !== undefined) make('em', '', m[4]);
    else if (m[5] !== undefined) make('s', '', m[5]);
    else make('span', 'cm-wikilink', m[6].split('|').pop());
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(document.createTextNode(text.slice(last)));
}

class TableWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM(view) {
    const rows = this.text.split('\n').map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const align = (rows[1] || []).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : 'left'));
    const t = document.createElement('table');
    t.className = 'cm-table';
    rows.forEach((cells, ri) => {
      if (ri === 1) return;
      const tr = document.createElement('tr');
      cells.forEach((c, ci) => {
        const td = document.createElement(ri === 0 ? 'th' : 'td');
        inlineInto(td, c);
        td.style.textAlign = align[ci] || 'left';
        tr.append(td);
      });
      t.append(tr);
    });
    // o espaçamento vai num invólucro com padding (margin de widget em bloco não entra na altura medida e deixa o mapa de alturas errado)
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    wrap.append(t);
    wrap.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } });
      view.focus();
    };
    return wrap;
  }
  // altura estimada (CodeMirror usa antes de medir; sem isso, o mapa de alturas fica errado e as setas pulam linhas)
  get estimatedHeight() { return Math.max(1, this.text.split('\n').length - 1) * 33 + 14; }
  ignoreEvent() { return true; }
}

function build(view) {
  const { state } = view;
  const decos = [];
  const capOn = state.facet(imgCaptionFacet);
  const tree = syntaxTree(state);
  const inCode = (pos) => /Code/.test(tree.resolveInner(pos, 1).name);

  // Frontmatter YAML (--- ... ---) no começo: texto apagado e em fonte menor (como "propriedades")
  let fmEnd = 0; // número da última linha do frontmatter (0 = não tem)
  if (state.doc.line(1).text.trim() === '---') {
    for (let l = 2; l <= Math.min(state.doc.lines, 80); l++) {
      if (state.doc.line(l).text.trim() === '---') { fmEnd = l; break; }
    }
    for (let l = 1; l <= fmEnd; l++) decos.push(Decoration.line({ class: 'cm-fm' }).range(state.doc.line(l).from));
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from, to,
      enter: (n) => {
        const name = n.name;
        if (/^ATXHeading[1-6]$/.test(name)) {
          decos.push(Decoration.line({ class: 'cm-hl cm-h' + name.slice(-1) }).range(state.doc.lineAt(n.from).from));
        } else if (name === 'HeaderMark') {
          const p = n.node.parent;
          if (p && /^ATXHeading/.test(p.name) && !touches(state, p.from, p.to)) {
            decos.push(hide.range(n.from, Math.min(n.to + 1, state.doc.lineAt(n.from).to)));
          }
        } else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          const p = n.node.parent;
          if (p && !touches(state, p.from, p.to)) decos.push(hide.range(n.from, n.to));
        } else if (name === 'Strikethrough') {
          decos.push(Decoration.mark({ class: 'cm-strike' }).range(n.from, n.to));
        } else if (name === 'InlineCode') {
          decos.push(Decoration.mark({ class: 'cm-icode' }).range(n.from, n.to));
        } else if (name === 'CodeMark') {
          const p = n.node.parent;
          if (p && p.name === 'InlineCode' && !touches(state, p.from, p.to)) decos.push(hide.range(n.from, n.to));
        } else if (name === 'Link') {
          decos.push(Decoration.mark({ class: 'cm-link' }).range(n.from, n.to));
        } else if (name === 'LinkMark' || name === 'URL') {
          const p = n.node.parent;
          if (p && p.name === 'Link' && !touches(state, p.from, p.to)) decos.push(hide.range(n.from, n.to));
        } else if (name === 'Image') {
          if (!touches(state, n.from, n.to)) {
            const u = n.node.getChild('URL');
            if (u) {
              const raw = state.sliceDoc(n.from, n.to);
              const alt = raw.match(/^!\[([^\]]*)\]/)?.[1] || '';
              const url = state.sliceDoc(u.from, u.to);
              let defText = url.split(/[\\/]/).pop();
              try { defText = decodeURIComponent(defText); } catch { /* mantém */ }
              const cap = capOn ? { kind: 'md', url, raw, custom: !!alt, text: alt || defText, defText } : null;
              decos.push(Decoration.replace({ widget: new ImgWidget(cfg.imgSrc(url), alt, 0, cap) }).range(n.from, n.to));
            }
          }
          return false;
        } else if (name === 'Blockquote') {
          // callout do Obsidian: > [!tipo] Título
          const first = state.doc.lineAt(n.from);
          const co = first.text.match(/^\s*>\s*\[!([\w-]+)\][+-]?/);
          const cls = co ? `cm-quote cm-callout cm-co-${co[1].toLowerCase()}` : 'cm-quote';
          for (let l = first.number; l <= state.doc.lineAt(n.to).number; l++) {
            decos.push(Decoration.line({ class: cls }).range(state.doc.line(l).from));
          }
          if (co && !touches(state, first.from, first.to)) {
            const at = first.from + first.text.indexOf('[!');
            decos.push(Decoration.replace({ widget: new TextWidget(co[1].toUpperCase(), 'cm-callout-label') }).range(at, at + co[0].length - first.text.slice(0, first.text.indexOf('[!')).length));
          }
        } else if (name === 'QuoteMark') {
          const line = state.doc.lineAt(n.from);
          if (!touches(state, line.from, line.to)) decos.push(hide.range(n.from, Math.min(n.to + 1, line.to)));
        } else if (name === 'ListMark') {
          const item = n.node.parent;
          const line = state.doc.lineAt(n.from);
          if (item && item.parent && item.parent.name === 'BulletList' && !touches(state, line.from, line.to)) {
            if (item.getChild('Task')) decos.push(hide.range(n.from, Math.min(n.to + 1, line.to)));
            else decos.push(Decoration.replace({ widget: new TextWidget('•', 'cm-bullet') }).range(n.from, n.to));
          }
        } else if (name === 'TaskMarker') {
          const t = state.sliceDoc(n.from, n.to);
          decos.push(Decoration.replace({ widget: new CheckWidget(/x/i.test(t)) }).range(n.from, n.to));
        } else if (name === 'HorizontalRule') {
          const line = state.doc.lineAt(n.from);
          if (line.number > fmEnd && !touches(state, line.from, line.to)) decos.push(Decoration.replace({ widget: new HrWidget() }).range(n.from, n.to));
        } else if (name === 'FencedCode') {
          const a = state.doc.lineAt(n.from).number;
          const b = state.doc.lineAt(n.to).number;
          for (let l = a; l <= b; l++) {
            const cls = 'cm-codeblock' + (l === a || l === b ? ' cm-fence' : '');
            decos.push(Decoration.line({ class: cls }).range(state.doc.line(l).from));
          }
          if (b > a) decos.push(Decoration.widget({ widget: new CopyWidget(), side: 1 }).range(state.doc.line(a).to));
        }
      },
    });

    // [[wikilinks]], ![[imagens]] e #tags (fora de código)
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= fmEnd) continue; // dentro do frontmatter não decora nada
      if (!line.text.includes('[[') && !line.text.includes('#') && !line.text.includes('==') && !line.text.includes('^')) continue;
      // ==destaque==
      for (const m of line.text.matchAll(/==([^=\n]+)==/g)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (inCode(start)) continue;
        if (touches(state, start, end)) decos.push(Decoration.mark({ class: 'cm-mark' }).range(start, end));
        else {
          decos.push(hide.range(start, start + 2));
          decos.push(Decoration.mark({ class: 'cm-mark' }).range(start + 2, end - 2));
          decos.push(hide.range(end - 2, end));
        }
      }
      // id de bloco no fim da linha:  texto ^abc123
      const bid = line.text.match(/ (\^[\w-]+)$/);
      if (bid && !inCode(line.from)) decos.push(Decoration.mark({ class: 'cm-blockid' }).range(line.to - bid[1].length, line.to));
      for (const m of line.text.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (inCode(start)) continue;
        const inner = m[2];
        const open = m[1] ? 3 : 2;
        if (m[1] && IMG_EXT.test(inner.split('|')[0].trim())) {
          const src = cfg.wikiImg(inner.split('|')[0].trim());
          if (src && !touches(state, start, end)) {
            const parts = inner.split('|');
            const w = (parts[1] || '').match(/^(\d+)/); // ![[img.png|300]] define a largura
            const wpart = parts.slice(1).find((p) => WIDTH.test(p.trim())) || '';
            const alias = parts.slice(1).filter((p) => !WIDTH.test(p.trim())).join('|').trim();
            const name = parts[0].trim();
            const defText = name.split('/').pop();
            const cap = capOn ? { kind: 'wiki', name, wpart: wpart.trim(), raw: m[0], custom: !!alias, text: alias || defText, defText } : null;
            decos.push(Decoration.replace({ widget: new ImgWidget(src, inner, w ? +w[1] : 0, cap) }).range(start, end));
            continue;
          }
        }
        if (touches(state, start, end)) {
          decos.push(Decoration.mark({ class: 'cm-wikilink' }).range(start, end));
        } else {
          const aliasAt = inner.includes('|') ? inner.indexOf('|') + 1 : 0;
          decos.push(hide.range(start, start + open + aliasAt));
          decos.push(Decoration.mark({ class: 'cm-wikilink' }).range(start + open + aliasAt, end - 2));
          decos.push(hide.range(end - 2, end));
        }
      }
      for (const m of line.text.matchAll(/(?:^|\s)(#[\p{L}][\p{L}\d_/-]*)/gu)) {
        const start = line.from + m.index + m[0].length - m[1].length;
        if (!inCode(start)) decos.push(Decoration.mark({ class: 'cm-tag' }).range(start, start + m[1].length));
      }
    }
  }
  return Decoration.set(decos, true);
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    constructor(v) { this.d = build(v); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) || u.startState.facet(imgCaptionFacet) !== u.state.facet(imgCaptionFacet)) this.d = build(u.view);
    }
  },
  { decorations: (v) => v.d },
);

function tables(state) {
  const decos = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name !== 'Table') return;
      if (!touches(state, n.from, n.to)) {
        decos.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(n.from, n.to)), block: true }).range(n.from, n.to));
      }
      return false;
    },
  });
  return Decoration.set(decos, true);
}

const tableField = StateField.define({
  create: (state) => tables(state),
  update(v, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return tables(tr.state);
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function livePreview(opts) {
  cfg = { ...cfg, ...opts };
  return [inlinePlugin, tableField];
}
