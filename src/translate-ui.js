// Janelinha "Traduzir": mostra a tradução do texto selecionado (editor, notas compartilhadas, preview) e deixa copiar ou, no editor, substituir a seleção.
import { getLang, t as tr } from './i18n.js';

const NAMES = { pt: 'Português', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano' };
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const baseLang = () => String(getLang() || 'pt-BR').slice(0, 2);

// o: { text, api, ask, allowed, setAllowed, toast, replace?: (novoTexto) => void }
export async function openTranslate(o) {
  const text = String(o.text || '').trim();
  if (!text) return;
  if (!o.allowed) {
    const r = await o.ask('Para traduzir, o texto selecionado será enviado a um serviço online de tradução (Google). Não use com dados sensíveis. Continuar?', ['Traduzir', 'Cancelar']);
    if (r !== 0) return;
    o.setAllowed();
  }
  document.getElementById('trDlg')?.remove();
  const dlg = h('div'); dlg.id = 'trDlg';
  const card = h('div', 'tr-card'); dlg.append(card);
  const head = h('div', 'tr-head');
  const title = h('div', 'tr-title', 'Traduzir');
  const x = h('button', 'tr-x', '×'); x.title = tr('Fechar');
  head.append(title, x);
  const langs = h('div', 'tr-langs');
  const orig = h('textarea', 'tr-box tr-orig'); orig.readOnly = true; orig.value = text; orig.rows = Math.min(5, Math.max(2, text.split('\n').length));
  const out = h('textarea', 'tr-box tr-out'); out.readOnly = true; out.rows = Math.min(9, Math.max(3, text.split('\n').length + 1));
  const note = h('div', 'tr-note');
  const btns = h('div', 'tr-btns');
  const bCopy = h('button', 'tr-btn', 'Copiar tradução');
  const bRep = o.replace ? h('button', 'tr-btn', 'Substituir a seleção') : null;
  const bClose = h('button', 'tr-btn tr-ghost', 'Fechar');
  btns.append(bCopy); if (bRep) btns.append(bRep); btns.append(bClose);
  card.append(head, langs, orig, out, note, btns);
  document.body.append(dlg);

  const close = () => { dlg.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  x.onclick = close; bClose.onclick = close;
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });

  let cur = '';
  const chips = {};
  for (const id of ['pt', 'en', 'es', 'fr', 'de', 'it']) {
    const b = h('button', 'tr-chip', NAMES[id]); b.onclick = () => run(id); chips[id] = b; langs.append(b);
  }
  const run = async (to, auto) => {
    cur = to;
    for (const [id, b] of Object.entries(chips)) b.classList.toggle('on', id === to);
    out.value = tr('Traduzindo…'); out.classList.add('busy'); bCopy.disabled = true; if (bRep) bRep.disabled = true; note.textContent = '';
    const r = await o.api.translate(text, to);
    if (cur !== to) return;
    out.classList.remove('busy');
    if (!r.ok) { out.value = ''; note.textContent = tr(r.error); return; }
    // o texto já está nesse idioma: na abertura, traduz para o inglês (ou para o português, se o texto já for inglês)
    if (auto && r.from && r.from.slice(0, 2) === to) return run(to === 'en' ? 'pt' : 'en');
    out.value = r.text; bCopy.disabled = false; if (bRep) bRep.disabled = false;
    title.textContent = `${tr('Traduzir')}${r.from ? ' · ' + (NAMES[r.from.slice(0, 2)] || r.from) + ' → ' + NAMES[to] : ''}`;
    note.textContent = r.truncated ? tr('O texto era longo: só o começo foi traduzido.') : '';
  };
  bCopy.onclick = async () => { try { await navigator.clipboard.writeText(out.value); } catch { out.select(); document.execCommand('copy'); } bCopy.textContent = tr('✓ Copiado'); setTimeout(() => { bCopy.textContent = tr('Copiar tradução'); }, 1400); };
  if (bRep) bRep.onclick = () => { if (out.value) { o.replace(out.value); close(); } };
  run(baseLang() === 'pt' || baseLang() === 'en' || baseLang() === 'es' ? baseLang() : 'pt', true);
}
