'use strict';
// Mensagens fixadas no chat compartilhado:  node server/test-fixar.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./index');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttpin-'));
  const srv = startServer({ dir, port: 0, host: '127.0.0.1', admin: ['Matheus', 'senhaforte1'] });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' }, body: b == null ? undefined : JSON.stringify(b) }); const x = await r.text(); let j = x; try { j = JSON.parse(x); } catch { /* */ } return { s: r.status, j }; };
  const A = (await call('POST', '/api/login', { name: 'Matheus', password: 'senhaforte1' })).j;
  const mk = async (name) => { const u = (await call('POST', '/api/users', { name, password: 'senha12345' }, A.token)).j; const t = (await call('POST', '/api/login', { name, password: 'senha12345' })).j.token; return { id: u.id, t }; };
  const ana = await mk('Ana'); const bia = await mk('Bia'); const leo = await mk('Leo'); const out = await mk('Fora');
  const pj = (await call('POST', '/api/projects', { name: 'Loja', members: { [ana.id]: 'write', [bia.id]: 'write', [leo.id]: 'read' } }, A.token)).j;
  const nt = (await call('POST', `/api/projects/${pj.id}/notes`, { title: 'Conversa' }, A.token)).j;
  const add = (text, t = A.token) => call('POST', `/api/notes/${nt.id}/segments`, { text }, t);
  const pin = (sid, pinned, t) => call('POST', `/api/notes/${nt.id}/segments/${sid}/pin`, { pinned }, t);
  const view = async (sid, t = A.token) => (await call('GET', `/api/notes/${nt.id}`, null, t)).j.segments.find((x) => x.id === sid);

  console.log('1) fixar e desafixar');
  const m1 = (await add('regra importante')).j;
  eq(m1.pinned, undefined, 'mensagem nova não vem fixada');
  const p1 = await pin(m1.id, true, ana.t);
  eq([p1.s, p1.j.pinned && p1.j.pinned.by, typeof (p1.j.pinned && p1.j.pinned.ts)], [200, ana.id, 'number'], 'Ana fixa (a resposta traz quem e quando)');
  eq((await view(m1.id, bia.t)).pinned.by, ana.id, 'todos veem que está fixada e por quem');
  eq((await pin(m1.id, true, bia.t)).j.pinned.by, ana.id, 'fixar de novo não troca quem fixou');
  eq((await pin(m1.id, false, bia.t)).j.pinned, undefined, 'qualquer pessoa que escreve desafixa');
  eq((await view(m1.id)).pinned, undefined, 'saiu da lista');

  console.log('2) quem pode');
  eq((await pin(m1.id, true, leo.t)).s, 403, 'quem só lê não fixa');
  ok([403, 404].includes((await pin(m1.id, true, out.t)).s), 'quem não é do projeto não fixa');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${m1.id}/pin`, { pinned: true })).s, 401, 'precisa estar logado');
  await pin(m1.id, true, ana.t);
  eq((await view(m1.id, leo.t)).pinned.by, ana.id, 'quem só lê vê a fixada');

  console.log('3) o que acontece com a mensagem');
  const ed = await call('PATCH', `/api/notes/${nt.id}/segments/${m1.id}`, { text: 'regra importante (editada)' }, A.token);
  eq(ed.j.pinned && ed.j.pinned.by, ana.id, 'editar mantém fixada');
  const rx = await call('POST', `/api/notes/${nt.id}/segments/${m1.id}/react`, { emoji: '👍' }, bia.t);
  eq(rx.j.pinned && rx.j.pinned.by, ana.id, 'reagir devolve o trecho ainda fixado');
  const del = await call('DELETE', `/api/notes/${nt.id}/segments/${m1.id}`, null, A.token);
  eq(del.s, 200, 'apagar a mensagem fixada');
  eq((await pin(m1.id, true, ana.t)).s, 400, 'não dá para fixar uma apagada');
  const rs = await call('POST', `/api/notes/${nt.id}/segments/${m1.id}/restore`, { version: (await view(m1.id)).versions[0].n }, A.token);
  eq([rs.s, rs.j.pinned && rs.j.pinned.by], [200, ana.id], 'restaurar traz a fixação de volta');

  console.log('4) limite de 20 por nota');
  const segs = [];
  for (let i = 0; i < 21; i++) segs.push((await add('msg ' + i)).j.id);
  let okN = 0; for (let i = 0; i < 19; i++) { if ((await pin(segs[i], true, ana.t)).s === 200) okN++; } // já há 1 fixada (m1) → 20
  eq(okN, 19, 'fixa até completar 20');
  eq((await pin(segs[19], true, ana.t)).s, 400, 'a 21ª é recusada');
  eq((await pin(segs[0], true, ana.t)).s, 200, 'fixar uma já fixada continua valendo');
  await pin(segs[1], false, ana.t);
  eq((await pin(segs[19], true, ana.t)).s, 200, 'depois de desafixar, cabe outra');
  const all = (await call('GET', `/api/notes/${nt.id}`, null, A.token)).j.segments;
  eq(all.filter((x) => x.pinned).length, 20, '20 fixadas no total');
  await call('DELETE', `/api/notes/${nt.id}/segments/${segs[2]}`, null, A.token);
  eq((await pin(segs[20], true, ana.t)).s, 200, 'as apagadas não contam no limite');

  console.log('5) aviso em tempo real');
  const ctl = new AbortController(); const got = [];
  const sse = await fetch(`${base}/api/events`, { headers: { Authorization: 'Bearer ' + bia.t }, signal: ctl.signal });
  const rd = sse.body.getReader(); const dec = new TextDecoder();
  (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; got.push(dec.decode(value)); } } catch { /* fim */ } })();
  await new Promise((r) => setTimeout(r, 300));
  await pin(segs[3], false, ana.t); await pin(segs[3], true, ana.t);
  await new Promise((r) => setTimeout(r, 400));
  ok(got.join('').includes('"what":"pin"'), 'os outros recebem um aviso "pin"');
  ctl.abort();

  console.log(`\n${pass} verificações ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
