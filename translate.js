'use strict';
// Tradução do texto selecionado. Usa o serviço público de tradução do Google (sem chave). ATENÇÃO: o texto selecionado sai do
// computador para esse serviço; por isso o app pede a sua confirmação na primeira vez e dá para desligar nas configurações.
const LANGS = new Set(['pt', 'en', 'es', 'fr', 'de', 'it']);
const MAX = 4500;

async function translate(text, to) {
  const q = String(text || '').slice(0, MAX);
  if (!q.trim()) return { ok: false, error: 'Nada para traduzir' };
  if (!LANGS.has(to)) return { ok: false, error: 'Idioma inválido' };
  try {
    const body = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: to, dt: 't', q });
    const r = await fetch('https://translate.googleapis.com/translate_a/single', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { ok: false, error: 'O serviço de tradução respondeu ' + r.status };
    const j = await r.json();
    const out = Array.isArray(j[0]) ? j[0].map((s) => (s && s[0]) || '').join('') : '';
    if (!out) return { ok: false, error: 'O serviço não devolveu tradução' };
    return { ok: true, text: out, from: typeof j[2] === 'string' ? j[2] : '', truncated: String(text).length > MAX };
  } catch (e) {
    return { ok: false, error: 'Sem conexão com o serviço de tradução' + (e && e.name === 'TimeoutError' ? ' (demorou demais)' : '') };
  }
}

module.exports = { translate, LANGS };
