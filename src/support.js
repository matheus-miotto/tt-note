// Janela "Apoie o projeto": mensagem do autor, botões (sugestões, Monster via Pix, elogio) e a chave Pix com "copia e cola".
// Os dados ficam em support.config.json (raiz do projeto): repo = endereço do GitHub; pix = chave Pix (aleatória, e-mail, CPF…);
// pixName / pixCity = nome e cidade que aparecem no app do banco. Sem repo, somem os botões do GitHub; sem pix, some o do Monster.
import cfg from '../support.config.json';
import { t } from './i18n.js';
import { copyText } from './livepreview.js';

const GITHUB = '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const CAN = '<svg viewBox="0 0 120 170" width="100%" height="100%" aria-hidden="true"><defs><linearGradient id="spBody" x1="0" x2="1"><stop offset="0" stop-color="#0d0f12"/><stop offset=".45" stop-color="#2a2f36"/><stop offset="1" stop-color="#0d0f12"/></linearGradient><linearGradient id="spTop" x1="0" x2="1"><stop offset="0" stop-color="#8a9099"/><stop offset=".5" stop-color="#e6e9ee"/><stop offset="1" stop-color="#8a9099"/></linearGradient></defs>'
  + '<ellipse cx="60" cy="164" rx="44" ry="6" fill="rgba(0,0,0,.35)"/>'
  + '<path d="M14 36 Q14 26 28 24 H92 Q106 26 106 36 V148 Q106 160 92 162 H28 Q14 160 14 148 Z" fill="url(#spBody)"/>'
  + '<ellipse cx="60" cy="26" rx="46" ry="10" fill="url(#spTop)"/><ellipse cx="60" cy="25" rx="34" ry="6.5" fill="#cfd3da"/><rect x="50" y="22" width="20" height="6" rx="3" fill="#7b818b"/>'
  + '<path d="M14 52 H106 V64 H14 Z" fill="#7dff2e" opacity=".95"/><path d="M14 138 H106 V148 H14 Z" fill="#7dff2e" opacity=".95"/>'
  + '<path d="M68 72 L40 108 H57 L50 134 L82 94 H64 Z" fill="#7dff2e"/>'
  + '<path d="M25 40 Q24 100 26 154" stroke="rgba(255,255,255,.18)" stroke-width="6" fill="none" stroke-linecap="round"/></svg>';
const canEl = () => {
  const box = h('div', 'sp-can');
  const img = new Image(); img.alt = 'Monster'; img.src = 'assets/monster.png';
  img.onerror = () => { box.innerHTML = CAN; }; // sem a imagem, fica a ilustração desenhada
  box.append(img);
  return box;
};
const HEART = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1z"/></svg>';

// ---- Pix "copia e cola" (BR Code estático) ----
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const ascii = (s, n) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, n);
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
export function pixPayload(key, name, city) {
  const p = tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', key)) + tlv('52', '0000') + tlv('53', '986') + tlv('58', 'BR')
    + tlv('59', ascii(name, 25) || 'TT NOTE') + tlv('60', ascii(city, 15) || 'BRASIL') + tlv('62', tlv('05', '***')) + '6304';
  return p + crc16(p);
}

export const supportAvailable = () => !!(cfg.pix || cfg.repo);

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function openSupport({ api }) {
  document.getElementById('supportDlg')?.remove();
  const dlg = h('div'); dlg.id = 'supportDlg';
  const card = h('div', 'sp-card'); dlg.append(card);
  const close = () => { dlg.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });
  const open = (url) => { try { api.openExternal(url); } catch { /* sem navegador */ } };

  const x = h('button', 'sp-x', '×'); x.title = 'Fechar'; x.onclick = close;
  const home = () => {
    card.textContent = '';
    const hero = h('div', 'sp-hero');
    hero.append(canEl(), h('span', 'sp-spark sp-s1', '✦'), h('span', 'sp-spark sp-s2', '✦'), h('span', 'sp-spark sp-s3', '✧'));
    card.append(x, hero, h('div', 'sp-hi', 'E aí! 👋'));
    card.append(h('div', 'sp-msg', 'Espero que ache este APP útil! Se quiser apoiar meu trabalho, pode me pagar um Monster ou me dar um elogio. Obrigado!'));
    card.append(h('div', 'sp-sign', '— Matheus'));
    if (cfg.pix) { const b = h('button', 'sp-main', HEART + '<span>Me pague um Monster</span>'); b.onclick = pix; card.append(b); }
    const row = h('div', 'sp-btns');
    if (cfg.repo) { const g = h('button', 'sp-ghost', GITHUB + '<span>Me dê sugestões</span>'); g.onclick = () => open(cfg.repo.replace(/\/+$/, '') + '/issues/new'); row.append(g); }
    if (cfg.repo) { const g = h('button', 'sp-ghost', STAR + '<span>Me dê um elogio</span>'); g.onclick = () => open(cfg.repo); row.append(g); }
    if (row.childNodes.length) card.append(row);
    const bye = h('button', 'sp-bye', 'Agora não, valeu!'); bye.onclick = close;
    card.append(bye);
  };
  const pix = () => {
    card.textContent = '';
    const hero = h('div', 'sp-hero sp-small'); hero.append(canEl());
    card.append(x, hero, h('div', 'sp-hi', 'Obrigado pelo Monster!'));
    card.append(h('div', 'sp-msg', 'Pague por Pix com a chave abaixo (cole no app do seu banco). O valor você escolhe.'));
    const key = h('div', 'sp-key'); key.textContent = cfg.pix; key.setAttribute('data-notr', '');
    const row = h('div', 'sp-btns');
    const c1 = h('button', 'sp-main sp-compact', 'Copiar a chave'); c1.onclick = () => { copyText(cfg.pix); c1.textContent = t('✓ Copiado'); setTimeout(() => (c1.textContent = t('Copiar a chave')), 1600); };
    const c2 = h('button', 'sp-ghost', 'Copiar Pix copia e cola'); c2.onclick = () => { copyText(pixPayload(cfg.pix, cfg.pixName, cfg.pixCity)); c2.textContent = t('✓ Copiado'); setTimeout(() => (c2.textContent = t('Copiar Pix copia e cola')), 1600); };
    row.append(c1, c2);
    const back = h('button', 'sp-bye', 'Voltar'); back.onclick = home;
    card.append(key, row, back);
  };
  home();
  document.body.append(dlg);
  return { close };
}
