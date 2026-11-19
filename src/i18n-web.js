// Idiomas da página web do servidor (celular/navegador): mesmo motor do app, empacotado em server/web/i18n.js.
import { initLang, setLang, onLang, getLang, locale, t, addSkip, openLangPicker, flagHtml } from './i18n.js';

// conteúdo das pessoas (mensagens, nomes, títulos de nota, enquetes) nunca é traduzido
addSkip('.md, .n, .nm, .t, .tt, .q, .pq, .pt, .hit, .cap, .ed');
const css = document.createElement('style');
css.textContent = '#langPop{position:fixed;z-index:99999;min-width:230px;background:var(--panel,#fff);color:var(--fg,#222);border:1px solid var(--line,#ccc);border-radius:10px;box-shadow:0 8px 26px rgba(0,0,0,.35);padding:6px;font-size:15px}'
  + '#langPop .lp-head{padding:4px 8px 6px;color:var(--dim,#777);font-size:11px;text-transform:uppercase;letter-spacing:.05em}'
  + '#langPop .lp-item{display:flex;align-items:center;gap:10px;padding:10px 8px;border-radius:8px;cursor:pointer}#langPop .lp-item:hover,#langPop .lp-item.on{background:var(--hover,#eee)}'
  + '#langPop .lp-name{flex:1}#langPop .lp-ck{color:var(--accent,#2f7de1);width:14px;text-align:right}.flag{display:block}.langb .flag{width:22px;height:15px}';
document.head.append(css);
initLang();
const paint = () => document.querySelectorAll('[data-lang-btn]').forEach((b) => { b.innerHTML = flagHtml(getLang()); b.classList.add('langb'); });
paint();
onLang(paint);
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-lang-btn]');
  // recarrega ao trocar: datas e textos montados pelo JavaScript saem já no idioma novo
  if (b) { e.preventDefault(); openLangPicker(b, (id) => { setLang(id); setTimeout(() => location.reload(), 60); }); }
});
window.TT = { t, locale };
