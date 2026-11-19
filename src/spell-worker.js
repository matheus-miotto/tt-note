// Worker do corretor: carrega os dicionários e responde "está certa?" e "sugestões" sem travar o editor.
import { Hunspell, Spell } from './spell-engine.js';

let sp = null;
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    sp = new Spell();
    for (const d of m.dicts) sp.add(new Hunspell(d.aff, d.dic));
    for (const w of m.user || []) sp.addWord(w);
    postMessage({ type: 'ready' });
  } else if (!sp) {
    return;
  } else if (m.type === 'check') {
    postMessage({ type: 'checked', id: m.id, bad: m.words.filter((w) => !sp.check(w)) });
  } else if (m.type === 'suggest') {
    postMessage({ type: 'suggested', id: m.id, list: sp.suggest(m.word) });
  } else if (m.type === 'add') {
    sp.addWord(m.word);
  }
};
