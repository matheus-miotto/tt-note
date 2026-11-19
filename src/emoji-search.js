// Busca de emojis por nome e palavras-chave em português e inglês. Ignora acento e maiúsculas e aceita pedaço do começo da
// palavra: "gat" acha "gato", "gata", "gatinho"; "cat" acha "cat face". Várias palavras: todas precisam combinar ("gato feliz").
import DATA from './emoji-search.json';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let INDEX = null;
function build() {
  INDEX = DATA.map(([emoji, pt, en, tags], i) => ({ emoji, pt, en, i, first: norm(pt), words: [...new Set(norm(`${pt} ${en} ${tags}`).split(/[^a-z0-9]+/).filter(Boolean))] }));
}

// devolve [{ emoji, pt, en }] do mais para o menos parecido
export function searchEmoji(query, limit = 240) {
  const q = norm(query).trim();
  if (!q) return [];
  if (!INDEX) build();
  const qs = q.split(/\s+/);
  const run = (loose) => {
    const hits = [];
    for (const it of INDEX) {
      let score = 0; let ok = true;
      for (const w of qs) {
        let best = 0;
        for (const x of it.words) {
          if (x === w) { best = 3; break; }
          if (x.startsWith(w)) best = Math.max(best, 2);
          else if (loose && best === 0 && w.length >= 3 && x.includes(w)) best = 1; // pedaço no meio da palavra: só se nada começar assim
        }
        if (!best) { ok = false; break; }
        score += best;
      }
      if (!ok) continue;
      if (it.first.startsWith(qs[0])) score += 1.5; // o nome começa pelo que foi digitado
      hits.push([score - it.first.length / 500 - it.i / 1e5, it]); // nomes curtos e a ordem oficial desempatam
    }
    return hits;
  };
  let hits = run(false);
  if (!hits.length) hits = run(true);
  hits.sort((a, b) => b[0] - a[0]);
  return hits.slice(0, limit).map(([, it]) => ({ emoji: it.emoji, pt: it.pt, en: it.en }));
}
