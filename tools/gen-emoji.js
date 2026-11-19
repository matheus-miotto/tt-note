// Gera src/emoji-search.json: todos os emojis com nome e palavras-chave em português e inglês (para a busca do seletor).
// Fonte: pacote emojibase-data (dados do Unicode CLDR). Só precisa rodar de novo se quiser atualizar a lista:  node tools/gen-emoji.js
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..', 'node_modules', 'emojibase-data');
const en = require(path.join(base, 'en', 'data.json'));
const pt = require(path.join(base, 'pt', 'compact.json'));
const ptBy = new Map(pt.map((x) => [x.hexcode, x]));
const MAX_VERSION = 14; // o Windows 11 desenha até o Emoji 14 em todas as versões; os mais novos viram quadradinho
const flagCountry = /[\u{1F1E6}-\u{1F1FF}]{2}/u; // bandeiras de países: o Windows mostra só as letras
const flagTag = /\u{1F3F4}[\u{E0020}-\u{E007F}]+/u; // bandeiras de regiões
// Apelidos do dia a dia (gíria e como a gente realmente fala) que a lista oficial não tem
const ALIAS = {
  '👍': 'joinha curtir curti legal ok positivo beleza top blz', '👎': 'negativo nao curti ruim', '👌': 'perfeito ok certinho', '🙏': 'obrigado obrigada valeu agradecer por favor rezar orar namaste',
  '👏': 'palmas parabens aplauso', '🎉': 'parabens comemorar comemoracao festa', '🥳': 'festa comemorar aniversario', '😂': 'kkk kkkk haha hahaha rindo risada engracado',
  '🤣': 'kkk kkkk rachando rindo muito', '😅': 'nervoso aliviado ufa', '🔥': 'pegando fogo quente incrivel top', '❤️': 'amor love paixao', '💔': 'tristeza desilusao',
  '✅': 'feito pronto certo ok concluido tarefa', '❌': 'errado nao cancelar', '⚠️': 'atencao cuidado alerta aviso', '❓': 'duvida pergunta', '❗': 'importante atencao',
  '🤝': 'acordo fechado combinado parceria aperto de mao', '💪': 'forca forte academia', '👀': 'olha olhando atento vendo', '🤔': 'pensando hmm duvida', '🙄': 'tedio sem paciencia',
  '💩': 'coco cocô merda', '🚀': 'foguete lancamento', '💡': 'ideia lampada', '📌': 'fixar fixado', '😍': 'apaixonado amei', '😭': 'chorando choro triste', '😴': 'sono dormindo zzz',
  '😎': 'otimo tranquilo estiloso', '😡': 'raiva bravo irritado', '🤯': 'mente explodindo chocado', '👋': 'tchau oi ola acenar', '🤷': 'sei la nao sei', '🙌': 'comemorar aleluia',
  '💯': 'cem perfeito nota maxima', '🎂': 'aniversario bolo', '☕': 'cafe', '🍺': 'cerveja chopp', '🐛': 'bug erro defeito', '🔧': 'ajuste conserto', '📎': 'anexo', '📅': 'data agenda calendario',
  '⏰': 'alarme hora despertador', '💻': 'computador notebook', '📱': 'celular telefone', '📧': 'email e-mail', '🔒': 'trancado seguro cadeado', '🔑': 'chave senha',
};
const out = [];
for (const e of en) {
  if (e.group === 2 || e.version > MAX_VERSION) continue; // componentes (tons de pele soltos…) e emojis novos demais
  if (flagCountry.test(e.emoji) || flagTag.test(e.emoji)) continue;
  const p = ptBy.get(e.hexcode);
  const tags = [...new Set([...(p && p.tags || []), ...(e.tags || []), ...String(ALIAS[e.emoji] || ALIAS[e.emoji.replace(/\uFE0F/g, '')] || '').split(' ')].filter(Boolean).map((t) => String(t).toLowerCase()))];
  out.push([e.emoji, p ? p.label : e.label, e.label, tags.join(' ')]);
}
fs.writeFileSync(path.join(__dirname, '..', 'src', 'emoji-search.json'), JSON.stringify(out));
console.log(`${out.length} emojis -> src/emoji-search.json (${(fs.statSync(path.join(__dirname, '..', 'src', 'emoji-search.json')).size / 1024).toFixed(0)} KB)`);
