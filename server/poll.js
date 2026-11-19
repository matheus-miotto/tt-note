'use strict';
// Enquete: sintaxe, leitura e escrita. Módulo puro (sem DOM, sem servidor): usado pelo app, pelo servidor e pelos testes.
//
// No texto (funciona como texto puro em qualquer lugar):
//
//   ```enquete            (ou "```enquete anonima")
//   Onde vamos almoçar?
//   ![foto](srv-file:abc)  (opcional: imagem da pergunta, sozinha numa linha, antes das opções)
//   - ( ) Pizza           ( ) = escolha única        [ ] = várias escolhas
//   - ( ) ![A](srv-file:x) Layout A     (opção com imagem: ![alt](endereço) ou ![[arquivo.png]])
//   - (x) Sushi           (x) / [x] = marcado (só em nota normal; na compartilhada os votos ficam no servidor)
//   ```
const MAX_OPTIONS = 12;
const MAX_QUESTION = 200;
const MAX_OPTION = 120;
const MAX_SRC = 400;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const IMG_MD = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/; // aceita um nível de parênteses no endereço: foto%20(2).png
const IMG_WIKI = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;
const OPT = /^\s*[-*+]\s+(?:\(([ xX•*])\)|\[([ xX])\])?\s*(.*)$/;

// Tira a primeira imagem de um trecho: { image: { src, alt, wiki } | null, rest }
function takeImage(str) {
  const s = String(str);
  let m = IMG_MD.exec(s);
  if (m) return { image: { src: m[2].slice(0, MAX_SRC), alt: m[1].trim().slice(0, 80), wiki: false }, rest: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
  m = IMG_WIKI.exec(s);
  if (m) return { image: { src: m[1].trim().slice(0, MAX_SRC), alt: '', wiki: true }, rest: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
  return { image: null, rest: s.trim() };
}
const baseName = (src) => decodeURIComponent(String(src).split(/[\\/]/).pop().split('?')[0]).replace(/\.[A-Za-z0-9]+$/, '');
const imageMd = (im) => (im.wiki ? `![[${im.src}]]` : `![${String(im.alt || '').replace(/[\[\]\n]/g, ' ').trim()}](${im.src})`);

// Acha os blocos ```enquete``` do texto: [{ from, to, info, body, startLine, endLine }] (from/to em caracteres; to = fim da linha de fechamento)
function findPolls(text) {
  const out = []; const lines = String(text).split('\n');
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^```enquete(?:[ \t]+(.*))?[ \t]*$/.exec(lines[i].replace(/\r$/, ''));
    if (m) {
      let j = i + 1; let end = pos + lines[i].length + 1;
      const body = [];
      while (j < lines.length && !/^```[ \t]*$/.test(lines[j].replace(/\r$/, ''))) { body.push(lines[j]); end += lines[j].length + 1; j++; }
      if (j < lines.length) { // fechado
        const to = end + lines[j].length;
        out.push({ from: pos, to, info: m[1] || '', body: body.join('\n'), startLine: i, endLine: j });
        pos = to + 1; i = j; continue;
      }
    }
    pos += lines[i].length + 1;
  }
  return out;
}

// Lê o corpo de um bloco: { question, image, multi, anonymous, options: [{ text, image, checked }], ok }
function parsePoll(info, body) {
  const anonymous = /\banonim[ao]\b/.test(norm(info));
  let question = ''; let image = null; const options = []; let multi = null;
  for (const raw of String(body).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = OPT.exec(line);
    if (m && (question || options.length)) {
      const ti = takeImage(m[3]);
      let text = ti.rest.slice(0, MAX_OPTION);
      if (!text && ti.image) text = (ti.image.alt || baseName(ti.image.src) || 'imagem').slice(0, MAX_OPTION);
      if (!text) continue;
      if (multi === null) multi = m[2] !== undefined; // [ ] = várias; ( ) ou sem marcador = única
      const mark = m[1] !== undefined ? m[1] : m[2];
      options.push({ text, image: ti.image, checked: mark !== undefined && mark !== ' ' });
    } else if (!question && !options.length) question = line.trim().replace(/^#+\s*/, '').slice(0, MAX_QUESTION);
    else if (question && !options.length && !image) { const ti = takeImage(line); if (ti.image && !ti.rest) image = ti.image; } // imagem da pergunta
  }
  return { question, image, multi: !!multi, anonymous, options: options.slice(0, MAX_OPTIONS), ok: !!question && options.length >= 2 };
}

// Primeira enquete válida do texto (ou null)
function firstPoll(text) {
  for (const b of findPolls(text)) { const p = parsePoll(b.info, b.body); if (p.ok) return { ...p, block: b }; }
  return null;
}

// Monta o bloco de texto. options: [texto | { text, image: { src, alt, wiki } }]; questionImage: { src, alt, wiki }
function buildPoll({ question, questionImage, multi, anonymous, options, checked }) {
  const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
  const opts = (options || []).map((o) => {
    const text = String(typeof o === 'string' ? o : o.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_OPTION);
    const image = typeof o === 'string' ? null : (o.image || null);
    return { text: text || (image ? (image.alt || baseName(image.src) || 'imagem').slice(0, MAX_OPTION) : ''), image };
  }).filter((o) => o.text).slice(0, MAX_OPTIONS);
  const set = new Set(checked || []);
  const lines = opts.map((o, i) => `- ${multi ? `[${set.has(i) ? 'x' : ' '}]` : `(${set.has(i) ? 'x' : ' '})`} ${o.image ? imageMd(o.image) + ' ' : ''}${o.text}`);
  return '```enquete' + (anonymous ? ' anonima' : '') + '\n' + q + '\n' + (questionImage ? imageMd(questionImage) + '\n' : '') + lines.join('\n') + '\n```';
}

// Nota normal: clicar numa opção. Única: marca esta e desmarca as outras (clicar na marcada desmarca). Várias: liga/desliga esta.
// Devolve o texto novo do bloco (from..to) ou null.
function toggleChoice(blockText, optionIndex) {
  const lines = blockText.split('\n');
  const p = parsePoll(lines[0].replace(/^```enquete[ \t]*/, ''), lines.slice(1, -1).join('\n'));
  if (!p.ok || optionIndex < 0 || optionIndex >= p.options.length) return null;
  const want = !p.options[optionIndex].checked;
  let seenQ = false; let k = -1;
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) continue;
    if (!seenQ) { seenQ = true; continue; } // a primeira linha é a pergunta
    const m = OPT.exec(line);
    if (!m) continue;
    const ti = takeImage(m[3]);
    if (!ti.rest && !ti.image) continue;
    k++;
    const on = k === optionIndex ? want : (p.multi ? p.options[k].checked : false);
    lines[i] = /^(\s*[-*+]\s+)/.exec(line)[1] + (p.multi ? `[${on ? 'x' : ' '}]` : `(${on ? 'x' : ' '})`) + ' ' + m[3];
  }
  return lines.join('\n');
}

// Comparação usada pelo servidor: as opções (texto e imagem) e o tipo não podem mudar depois que há votos
function sameStructure(a, b) {
  const im = (o) => (o.image ? o.image.src : '');
  return a.multi === b.multi && a.anonymous === b.anonymous && a.options.length === b.options.length && a.options.every((o, i) => o.text === b.options[i].text && im(o) === im(b.options[i]));
}

// Para exportar (PDF/Word): a enquete vira uma pergunta em negrito e a lista de opções (marcadas aparecem preenchidas)
function toMarkdown(text) {
  const blocks = findPolls(text);
  if (!blocks.length) return text;
  let out = ''; let at = 0;
  for (const b of blocks) {
    const p = parsePoll(b.info, b.body);
    out += text.slice(at, b.from);
    if (p.ok) {
      const mark = (o) => (p.multi ? (o.checked ? '☑' : '☐') : (o.checked ? '◉' : '○'));
      out += `**📊 ${p.question}** _(${p.multi ? 'várias escolhas' : 'uma escolha'}${p.anonymous ? ', anônima' : ''})_\n\n` + (p.image ? imageMd(p.image) + '\n\n' : '') + p.options.map((o) => `- ${mark(o)} ${o.image ? imageMd(o.image) + ' ' : ''}${o.text}`).join('\n') + '\n';
    } else out += text.slice(b.from, b.to);
    at = b.to;
  }
  return out + text.slice(at);
}

module.exports = { toMarkdown, takeImage, imageMd, MAX_OPTIONS, MAX_QUESTION, MAX_OPTION, findPolls, parsePoll, firstPoll, buildPoll, toggleChoice, sameStructure };
