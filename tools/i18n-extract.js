// Extrai os textos da interface (em português) dos fontes e mostra o que ainda não está nos dicionários de idioma.
//   node tools/i18n-extract.js            -> resumo e lista dos textos sem tradução
//   node tools/i18n-extract.js --json     -> grava tools/i18n-strings.json (todos os textos encontrados)
// Lê literais de texto ('..', "..", `..` com ${} trocado por {0}, {1}…) e o texto de index.html / note.html / página web.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const JS_FILES = [...fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js') && !/^(spell-worker|sqlfmt).js$/.test(f)).map((f) => 'src/' + f), 'main.js', 'shared-client.js', 'server-manager.js', 'preload.js'];
const HTML_FILES = ['index.html', 'note.html', 'server/web/index.html'];

// ---- leitor de literais de texto em JavaScript ----
function scanJs(src) {
  const out = []; let i = 0; const n = src.length;
  const regexPrev = /[(,=:[!&|?{};+\-*%<>~^]$/;
  let last = '';
  function code(end) { // lê código até o fechamento "}" (quando end='}') ou o fim
    let depth = 0;
    while (i < n) {
      const c = src[i]; const d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1; let s = '';
        while (j < n && src[j] !== c) { if (src[j] === '\\') { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'u' ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : e; j += e === 'u' ? 6 : 2; } else s += src[j++]; }
        out.push(s); i = j + 1; last = 'x'; continue;
      }
      if (c === '`') { i++; tmpl(); last = 'x'; continue; }
      if (c === '/' && regexPrev.test(last.trim().slice(-1) || ';')) { // regex literal
        let j = i + 1; let cls = false;
        while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; else if (src[j] === '\n') break; j++; }
        i = j + 1; last = 'x'; continue;
      }
      if (c === '{') depth++;
      if (c === '}') { if (end === '}' && depth === 0) { i++; return; } depth--; }
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  function tmpl() { // dentro de `...`
    let s = ''; let k = 0;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { const e = src[i + 1]; s += e === 'n' ? '\n' : e; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { s += '{' + k++ + '}'; i += 2; code('}'); continue; }
      s += src[i++];
    }
    i++; out.push(s);
  }
  code('');
  return out;
}

// ---- textos de HTML: conteúdo entre tags e atributos title/placeholder/aria-label/alt ----
function scanHtml(src) {
  const out = [];
  const noScript = src.replace(/<script[\s\S]*?<\/script>/gi, (m) => { for (const s of scanJs(m.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''))) out.push(s); return ''; }).replace(/<style[\s\S]*?<\/style>/gi, '');
  for (const m of noScript.matchAll(/(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) out.push(m[1]);
  for (const m of noScript.matchAll(/>([^<>]+)</g)) out.push(m[1]);
  return out;
}

// ---- o que parece texto de interface em português ----
const ACC = /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/;
const PT_WORDS = /\b(de|do|da|dos|das|para|com|em|um|uma|não|nao|nova|novo|abrir|salvar|arquivo|arquivos|guia|guias|pasta|erro|sem|todos|todas|mais|menos|ou|ao|na|no|nas|nos|por|se|que|já|este|esta|neste|nesta|ver|fechar|copiar|colar|recortar|desfazer|refazer|buscar|procurar|substituir|usuário|senha|servidor|nota|notas|mensagem|mensagens|enviar|enviado|salvo|salvando|ligado|desligado|aqui|clique|digite|escolha|nenhum|nenhuma|cor|tema|texto|linha|linhas|projeto|projetos|renomear|excluir|apagar|criar|editar|limpar|fixar|fixadas|voltar|ok|cancelar|sim|ainda|agora|hoje|ontem|semana|mês|ano|dia|dias|hora|horas|minutos|segundos)\b/i;
const opts = { loose: process.argv.includes('--loose') };
const looksUi = (s) => {
  const t = s.trim();
  if (t.length < 2 || t.length > 400) return false;
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) return false;
  if (/^(https?:|file:|data:|[./\\#@]|[a-z]+[-_.][a-z0-9_.-]+$|[A-Z_]+$|\d)/.test(t)) return false; // urls, caminhos, ids, constantes
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(t)) return false; // camelCase
  if (/^[a-z][a-z0-9]*$/.test(t) && !PT_WORDS.test(t)) return false; // palavra solta em minúsculas que não é português
  if (/[{};=<>]/.test(t.replace(/\{\d+\}/g, '')) && !ACC.test(t)) return false; // código
  if (ACC.test(t)) return true;
  if (opts.loose && /^[A-ZÀ-Ý][a-zà-ÿ]{2,23}( [A-Za-zà-ÿ]{2,23}){0,3}$/.test(t) && !/^(Escape|Enter|Control|Shift|Alt|Tab|Backspace|Delete|Home|End|Markdown|Consolas|Georgia|Arial|Windows|Sublime|Obsidian|Tailscale|Cloudflare|Mattermost|Segoe|Roboto|Monokai|Dracula|Nord|Gruvbox|Solarized|Oracle|Postgres|Python|Java|Javascript|JSON|HTML|CSS|Lorem|Alt|Ctrl|Insert|Esc|Space|Backspace|PageUp|PageDown|ArrowUp|ArrowDown|Latin|Unicode)$/i.test(t)) return true;
  return PT_WORDS.test(t) && /[A-Za-zÀ-ÿ]{3,}/.test(t) && !/^[a-z]+(\.[a-z]+)+$/.test(t);
};

function collect() {
  const set = new Map();
  const add1 = (s, f) => { const t = s.replace(/\s+/g, ' ').trim(); if (looksUi(t)) { const e = set.get(t) || { files: new Set() }; e.files.add(f); set.set(t, e); } };
  const add = (s, f) => { // texto com HTML: o que aparece na tela são os pedaços entre as tags (e title/placeholder/aria-label)
    if (/<[a-z!/][^>]*>/i.test(s)) {
      for (const m of s.matchAll(/(?:title|placeholder|aria-label|alt)=["']([^"']+)["']/g)) add1(m[1], f);
      for (const p of s.replace(/<[^>]*>/g, '\u0001').split('\u0001')) add1(p, f);
    } else add1(s, f);
  };
  for (const f of JS_FILES) { const p = path.join(root, f); if (fs.existsSync(p)) for (const s of scanJs(fs.readFileSync(p, 'utf8'))) add(s, f); }
  for (const f of HTML_FILES) { const p = path.join(root, f); if (fs.existsSync(p)) for (const s of scanHtml(fs.readFileSync(p, 'utf8'))) add(s, f); }
  return set;
}

if (require.main === module) {
  const set = collect();
  const all = [...set.keys()].sort((a, b) => a.localeCompare(b, 'pt'));
  if (process.argv.includes('--json')) { fs.writeFileSync(path.join(__dirname, 'i18n-strings.json'), JSON.stringify(Object.fromEntries(all.map((k) => [k, [...set.get(k).files]])), null, 1)); console.log('gravado tools/i18n-strings.json'); }
  console.log(`${all.length} textos encontrados`);
  if (process.argv.includes('--list')) console.log(all.join('\n'));
}
module.exports = { collect, scanJs, scanHtml, looksUi };
