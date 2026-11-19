// Monta os dicionários de idioma (src/lang/en.json, es.json, pt-PT.json) a partir de:
//   tools/i18n/base.json   lista congelada dos textos em português (a posição é o número do texto)
//   tools/i18n/t*.txt      traduções: "t1.txt" tem linhas "número§inglês§espanhol"; os demais, uma linha por texto
//                           em sequência ("inglês§espanhol"; linha só com "§" = não traduzir), começando no número do arquivo
//   tools/i18n/extra.json  textos acrescentados depois: { "português": ["inglês", "espanhol"] }
//   tools/i18n/ptpt.json   ajustes à mão do português de Portugal: { "português do Brasil": "português de Portugal" }
// Uso: node tools/i18n-build.js
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'i18n');
const base = JSON.parse(fs.readFileSync(path.join(dir, 'base.json'), 'utf8'));
const START = { 't2.txt': 400, 't3.txt': 760 };
const en = {}; const es = {}; const warn = [];
const ph = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join('');
const put = (pt, e, s, where) => {
  if (!pt) return;
  if (e) { if (ph(pt) !== ph(e)) warn.push(`${where}: EN diferente em {n}: "${pt.slice(0, 50)}" -> "${e.slice(0, 50)}"`); en[pt] = e; }
  if (s) { if (ph(pt) !== ph(s)) warn.push(`${where}: ES diferente em {n}: "${pt.slice(0, 50)}" -> "${s.slice(0, 50)}"`); es[pt] = s; }
};
for (const f of fs.readdirSync(dir).filter((x) => /^t\d+\.txt$/.test(x)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (f === 't1.txt') {
    for (const l of lines) { const [i, e, s] = l.split('§'); put(base[+i], e, s, `${f}#${i}`); }
  } else {
    const st = START[f]; if (st == null) { console.error('falta START para ' + f); process.exit(1); }
    const end = (START[Object.keys(START).find((k) => START[k] > st)] ?? base.length);
    if (lines.length !== end - st) warn.push(`${f}: ${lines.length} linhas, esperado ${end - st}`);
    lines.forEach((l, k) => { const [e, s] = l.split('§'); put(base[st + k], e, s, `${f}#${st + k}`); });
  }
}
for (const f of fs.readdirSync(dir).filter((x) => /^x\d+\.txt$/.test(x)).sort()) {
  for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; const [pt, e, sp] = l.split('§'); put(pt, e, sp, f); }
}
const extraFile = path.join(dir, 'extra.json');
if (fs.existsSync(extraFile)) for (const [pt, [e, s]] of Object.entries(JSON.parse(fs.readFileSync(extraFile, 'utf8')))) put(pt, e, s, 'extra');

// ---- português de Portugal: regras de vocabulário sobre o português do Brasil + ajustes à mão ----
const WORDS = [
  ['arquivos', 'ficheiros'], ['arquivo', 'ficheiro'], ['guias', 'separadores'], ['guia', 'separador'],
  ['salvando', 'a guardar'], ['salvar', 'guardar'], ['salvo', 'guardado'], ['salvos', 'guardados'], ['salva', 'guardada'], ['salvas', 'guardadas'], ['salvei', 'guardei'],
  ['baixando', 'a transferir'], ['baixar', 'transferir'], ['baixada', 'transferida'], ['baixado', 'transferido'], ['baixa', 'transfere'], ['download', 'transferência'],
  ['usuários', 'utilizadores'], ['usuário', 'utilizador'], ['senha', 'palavra-passe'], ['senhas', 'palavras-passe'],
  ['compartilhado', 'partilhado'], ['compartilhados', 'partilhados'], ['compartilhada', 'partilhada'], ['compartilhar', 'partilhar'], ['compartilhe', 'partilhe'],
  ['excluir', 'eliminar'], ['excluído', 'eliminado'], ['exclui', 'elimina'],
  ['tela', 'ecrã'], ['telas', 'ecrãs'], ['aplicativo', 'aplicação'], ['aplicativos', 'aplicações'], ['celular', 'telemóvel'], ['equipe', 'equipa'], ['equipes', 'equipas'],
  ['mouse', 'rato'], ['contato', 'contacto'], ['contatos', 'contactos'], 
  ['configurações', 'definições'], ['configuração', 'definição'], ['Configurações', 'Definições'], ['Configuração', 'Definição'],
  ['conectar', 'ligar'], ['conectado', 'ligado'], ['conectando', 'a ligar'], ['conexão', 'ligação'], ['conexões', 'ligações'], ['desconectado', 'desligado'], ['reconectar', 'religar'],
  ['rodando', 'em execução'], ['rodar', 'executar'], ['roda', 'executa'], ['rodou', 'executou'],
  ['gravando', 'a gravar'], ['carregando', 'a carregar'], ['enviando', 'a enviar'], ['atualizando', 'a atualizar'], ['procurando', 'a procurar'], ['buscando', 'a procurar'],
  ['verificando', 'a verificar'], ['aguardando', 'a aguardar'], ['abrindo', 'a abrir'], ['copiando', 'a copiar'], ['iniciando', 'a iniciar'], ['gerando', 'a gerar'], ['importando', 'a importar'], ['exportando', 'a exportar'],
  ['reiniciar', 'reiniciar'], ['bate-papo', 'conversa'], ['Exibir', 'Ver'], ['exibir', 'mostrar'], ['exibe', 'mostra'], ['exibido', 'mostrado'],
    ['Digite', 'Escreva'], ['digite', 'escreva'], ['Clique', 'Clique'], ['Escolha', 'Escolha'], ['Informe', 'Indique'], ['informe', 'indique'],
  ['pasta', 'pasta'], ['lixeira', 'reciclagem'], ['Lixeira', 'Reciclagem'], ['bandeja', 'tabuleiro'], ['planilha', 'folha de cálculo'],
  ['enquetes', 'sondagens'], ['enquete', 'sondagem'], ['anônima', 'anónima'], ['anônimo', 'anónimo'], ['anônimas', 'anónimas'], ['anônimos', 'anónimos'], ['registro', 'registo'], ['registros', 'registos'], ['buscar', 'procurar'], ['busca', 'pesquisa'], ['caracteres', 'carateres'], ['caractere', 'caráter'], ['ótimo', 'ótimo'], ['atenção', 'atenção'], ['ação', 'ação'],
];
const cap = (w, r) => (w.length > 2 && w === w.toUpperCase() && w !== w.toLowerCase() ? r.toUpperCase() : w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r[0].toLowerCase() + r.slice(1));
const wordRe = WORDS.map(([a, b]) => [new RegExp(`(?<![\\p{L}\\p{N}_])${a}(?![\\p{L}\\p{N}_])`, 'giu'), b, a]);

const PHRASES = [
  [/(?<![\p{L}])para você(?![\p{L}])/giu, 'para si'], [/(?<![\p{L}])Você está(?![\p{L}])/gu, 'Está'], [/(?<![\p{L}])você está(?![\p{L}])/gu, 'está'], [/(?<![\p{L}])Você já(?![\p{L}])/gu, 'Já'], [/(?<![\p{L}])você já(?![\p{L}])/gu, 'já'], [/(?<![\p{L}])Você pode(?![\p{L}])/gu, 'Pode'], [/(?<![\p{L}])você pode(?![\p{L}])/gu, 'pode'],
  [/(?<![\p{L}])o seu usuário(?![\p{L}])/giu, 'o seu utilizador'], [/(?<![\p{L}])seu usuário(?![\p{L}])/giu, 'o seu utilizador'],
  [/\b(a|A) figurinha\b/g, (m, a) => (a === 'A' ? 'O' : 'o') + ' sticker'], [/\b(as|As) figurinhas\b/g, (m, a) => (a === 'As' ? 'Os' : 'os') + ' stickers'],
  [/\bda figurinha\b/g, 'do sticker'], [/\bdas figurinhas\b/g, 'dos stickers'], [/\buma figurinha\b/g, 'um sticker'], [/\buma figurinha\b/gi, 'um sticker'],
  [/\bFigurinha adicionada\b/g, 'Sticker adicionado'], [/\bFigurinha animada\b/g, 'Sticker animado'], [/\bFigurinha (")/g, 'Sticker $1'],
  [/\bfigurinhas\b/gi, (m) => (m[0] === 'F' ? 'Stickers' : 'stickers')], [/\bfigurinha\b/gi, (m) => (m[0] === 'F' ? 'Sticker' : 'sticker')],
  [/\bsalva(s?) na sua coleção\b/g, 'guardado$1 na sua coleção'], [/\bpara aba\b/g, 'para separador'],
];
const GER = new Set(['tentando', 'mostrando', 'conferindo', 'reconectando', 'reiniciando', 'preparando', 'publicando', 'aguardando', 'excluindo', 'criando', 'removendo', 'movendo', 'abrindo', 'restaurando', 'apagando', 'formatando', 'convertendo', 'comparando', 'ordenando', 'iniciando', 'verificando', 'buscando', 'procurando', 'copiando', 'gerando', 'carregando', 'enviando', 'atualizando', 'gravando', 'importando', 'exportando', 'conectando', 'salvando', 'baixando']);
const gerund = (t) => t.replace(/(^|[^\p{L}])(\p{L}+)(ando|endo|indo)(?![\p{L}])/giu, (m, pre, stem, end) => {
  const w = (stem + end).toLowerCase();
  if (!GER.has(w)) return m;
  const inf = stem + (end.toLowerCase() === 'ando' ? 'ar' : end.toLowerCase() === 'endo' ? 'er' : 'ir');
  const fix = { reconectar: 'religar', conectar: 'ligar', salvar: 'guardar', baixar: 'transferir', buscar: 'procurar', excluir: 'eliminar', mostrar: 'mostrar' }[inf.toLowerCase()] || inf;
  const first = pre === '' || /[.!?…:]\s*$/.test(pre);
  return pre + (first && /^[A-ZÀ-Ý]/.test(stem) ? 'A ' : 'a ') + (first && /^[A-ZÀ-Ý]/.test(stem) ? fix.toLowerCase() : fix.toLowerCase());
});
const ptpt = {};
const manual = fs.existsSync(path.join(dir, 'ptpt.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'ptpt.json'), 'utf8')) : {};
const keys = new Set([...base, ...Object.keys(en), ...Object.keys(es)]);
for (const k of keys) {
  if (manual[k] != null) { ptpt[k] = manual[k]; continue; }
  let t = k;
  for (const [re, b] of PHRASES) t = t.replace(re, b);
  for (const [re, b] of wordRe) t = t.replace(re, (m) => cap(m, b));
  t = gerund(t);
  // "Quebra de linha" etc. ficam; "o utilizador" depois de "para/de" fica "o utilizador": aceitável
  if (t !== k) ptpt[k] = t;
}
fs.mkdirSync(path.join(__dirname, '..', 'src', 'lang'), { recursive: true });
for (const [name, obj] of [['en', en], ['es', es], ['pt-PT', ptpt]]) fs.writeFileSync(path.join(__dirname, '..', 'src', 'lang', name + '.json'), JSON.stringify(obj));
console.log(`en: ${Object.keys(en).length}  es: ${Object.keys(es).length}  pt-PT: ${Object.keys(ptpt).length}  (de ${base.length} textos)`);
if (warn.length) { console.log(warn.length + ' aviso(s):'); console.log(warn.slice(0, 40).join('\n')); }
// conferência de alinhamento: o símbolo do começo e a pontuação do fim devem bater
{
  const sym = (s) => { const c = [...s][0]; return /[\p{L}\p{N}¿¡{(\[“"'‘$%]/u.test(c) ? '' : c; };
  const tail = (s) => (/(…|\.\.\.|:)$/.test(s) ? ':' : '');
  const norm = (s) => (/(…|\.\.\.)$/.test(s) ? '…' : /:$/.test(s) ? ':' : '');
  let n = 0;
  for (const [pt, t] of [...Object.entries(en), ...Object.entries(es)]) {
    if (sym(pt) !== sym(t) || norm(pt) !== norm(t)) { if (n++ < 30) console.log('? alinhamento: "' + pt.slice(0, 45) + '" -> "' + t.slice(0, 45) + '"'); }
  }
  if (n) console.log(n + ' possível(is) desalinhamento(s) (conferir)');
}
const miss = base.filter((k) => !en[k]);
if (process.argv.includes('--missing')) console.log(miss.length + ' sem tradução em inglês:\n' + miss.join('\n'));
else console.log(miss.length + ' textos ainda sem tradução em inglês (use --missing para listar)');
