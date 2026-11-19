'use strict';
// Permissões de edição (por papel e por nota), remover usuário, reações e stickers:  node server/test-permissoes.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./index');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttperm-'));
  const srv = startServer({ dir, port: 0, host: '127.0.0.1', admin: ['Matheus', 'senhaforte1'] });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body, token, raw) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(raw ? raw.headers : { 'Content-Type': 'application/json' }) }, body: raw ? raw.body : body == null ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* sem json */ }
    return { s: r.status, j };
  };
  const T = (await call('POST', '/api/login', { name: 'Matheus', password: 'senhaforte1' })).j.token;
  const meId0 = (await call('GET', '/api/me', null, T)).j.id;
  const w = (await call('POST', '/api/users', { name: 'Escritor', password: 'escritor123' }, T)).j;
  const ed = (await call('POST', '/api/users', { name: 'Editor', password: 'editor1234' }, T)).j;
  const W = (await call('POST', '/api/login', { name: 'Escritor', password: 'escritor123' })).j.token;
  const E = (await call('POST', '/api/login', { name: 'Editor', password: 'editor1234' })).j.token;
  const pj = (await call('POST', '/api/projects', { name: 'Equipe', members: { [w.id]: 'write', [ed.id]: 'edit' } }, T)).j;
  const nt = (await call('POST', `/api/projects/${pj.id}/notes`, { title: 'Combinados' }, T)).j;
  const sg = (await call('POST', `/api/notes/${nt.id}/segments`, { text: 'texto do admin' }, T)).j;
  const mine = (await call('POST', `/api/notes/${nt.id}/segments`, { text: 'texto do escritor' }, W)).j;

  console.log('1) quem pode editar a mensagem de outro');
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${sg.id}`, { text: 'x' }, W)).s, 403, '"escreve" não edita mensagem de outro');
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${mine.id}`, { text: 'texto do escritor, revisto' }, W)).s, 200, '"escreve" edita a própria');
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${mine.id}`, { text: 'revisado pelo editor' }, E)).s, 200, '"editar" edita a de outro');
  eq((await call('DELETE', `/api/notes/${nt.id}/segments/${sg.id}`, null, W)).s, 403, '"escreve" não apaga a de outro');
  let g = (await call('GET', `/api/notes/${nt.id}`, null, W)).j;
  eq(g.segments.map((x) => x.canEdit), [false, true], 'o servidor informa o que cada um pode editar');

  console.log('2) regra por nota (por guia)');
  eq((await call('PATCH', `/api/notes/${nt.id}`, { editPolicy: 'all' }, E)).s, 403, 'só quem administra muda a regra da nota');
  eq((await call('PATCH', `/api/notes/${nt.id}`, { editPolicy: 'all' }, T)).s, 200, 'admin libera a nota para todos que escrevem');
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${sg.id}`, { text: 'agora o escritor pode' }, W)).s, 200, 'regra "todos": "escreve" edita a de outro');
  await call('PATCH', `/api/notes/${nt.id}`, { editPolicy: 'author' }, T);
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${sg.id}`, { text: 'o editor tenta' }, E)).s, 403, 'regra "só o autor": nem o "editar" edita a de outro');
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${sg.id}`, { text: 'o admin pode sempre' }, T)).s, 200, 'administrador edita sempre');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/restore`, { version: 1 }, E)).s, 403, 'restaurar segue a mesma regra');
  eq((await call('PATCH', `/api/notes/${nt.id}`, { editPolicy: 'xyz' }, T)).s, 400, 'regra inválida');
  g = (await call('GET', `/api/notes/${nt.id}`, null, E)).j;
  eq(g.editPolicy, 'author', 'a nota informa a regra atual');

  console.log('3) reações');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: '👍' }, W)).s, 200, 'reagir');
  await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: '👍' }, E);
  await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: '🎉' }, E);
  g = (await call('GET', `/api/notes/${nt.id}`, null, T)).j;
  eq(g.segments[0].reactions['👍'].length, 2, 'duas pessoas com 👍');
  await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: '👍' }, W);
  g = (await call('GET', `/api/notes/${nt.id}`, null, T)).j;
  eq(g.segments[0].reactions['👍'], [ed.id], 'reagir de novo tira a reação');
  ok(g.segments[0].versions.length >= 1 && g.segments[0].versions.every((v) => v.kind !== 'react'), 'reação não cria versão do texto');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: '<b>' }, W)).s, 400, 'emoji inválido');

  console.log('4) stickers');
  const png = Buffer.alloc(2000, 5);
  const stk = await call('POST', '/api/stickers?name=feliz.png', null, W, { headers: { 'Content-Type': 'image/png' }, body: png });
  eq(stk.s, 200, 'enviar sticker de imagem');
  eq((await call('POST', '/api/stickers?name=x.txt', null, W, { headers: { 'Content-Type': 'text/plain' }, body: png })).s, 400, 'só imagem');
  eq((await call('GET', '/api/stickers', null, E)).j.map((x) => x.name), ['feliz.png'], 'a equipe toda vê a figurinha');
  const ss = await call('POST', `/api/notes/${nt.id}/segments`, { sticker: { file: stk.j.id } }, E);
  eq([ss.s, ss.j.type], [200, 'sticker'], 'enviar sticker de imagem na nota');
  const se = await call('POST', `/api/notes/${nt.id}/segments`, { sticker: { emoji: '🎉' } }, W);
  eq([se.s, se.j.sticker.emoji], [200, '🎉'], 'sticker de emoji grande');
  eq((await call('POST', `/api/notes/${nt.id}/segments`, { sticker: { file: 'naoexiste' } }, W)).s, 400, 'sticker inexistente');
  eq((await call('PATCH', `/api/notes/${nt.id}/segments/${se.j.id}`, { text: 'oi' }, T)).s, 400, 'sticker não se edita');
  eq((await fetch(base + `/api/files/${stk.j.id}`, { headers: { Authorization: 'Bearer ' + E } })).status, 200, 'imagem do sticker abre para quem está logado');
  eq((await call('DELETE', `/api/stickers/${stk.j.id}`, null, E)).s, 403, 'só quem enviou ou o admin remove');
  eq((await call('DELETE', `/api/stickers/${stk.j.id}`, null, W)).s, 200, 'quem enviou remove');
  eq((await call('GET', '/api/stickers', null, E)).j.length, 0, 'sai da lista');
  eq((await fetch(base + `/api/files/${stk.j.id}`, { headers: { Authorization: 'Bearer ' + E } })).status, 200, 'mas o histórico continua mostrando a imagem');

  console.log('4b) reagir com figurinha e presença (online)');
  const stk2 = await call('POST', '/api/stickers?name=reage.png', null, W, { headers: { 'Content-Type': 'image/png' }, body: png });
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: 'sticker:' + stk2.j.id }, E)).s, 200, 'reagir com figurinha');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sg.id}/react`, { emoji: 'sticker:naoexiste' }, E)).s, 400, 'figurinha inexistente como reação');
  g = (await call('GET', `/api/notes/${nt.id}`, null, T)).j;
  eq(g.segments[0].reactions['sticker:' + stk2.j.id], [ed.id], 'a reação com figurinha fica registrada');
  const http = require('http');
  const listen = (tok, key, bag) => new Promise((resolve) => { const r = http.get(base + '/api/events', { headers: { Authorization: 'Bearer ' + tok } }, (res) => { res.on('data', (d) => { for (const l of d.toString().split('\n')) if (l.startsWith('data: ')) { const e = JSON.parse(l.slice(6)); if (e.type === 'presence') bag[key] = e.online; } }); resolve(r); }); });
  const seen = {};
  const rT = await listen(T, 'T', seen);
  await new Promise((r) => setTimeout(r, 250));
  eq((seen.T || []).length, 1, 'só o administrador online');
  const rE = await listen(E, 'E', seen);
  await new Promise((r) => setTimeout(r, 250));
  eq([...(seen.T || [])].sort(), [meId0, ed.id].sort(), 'o administrador vê o Editor online (em tempo real)');
  eq((await call('GET', '/api/presence', null, W)).j.online.length, 2, 'consulta direta de quem está online');
  rE.destroy();
  await new Promise((r) => setTimeout(r, 300));
  eq(seen.T, [meId0], 'o Editor saiu e some da lista');
  const ls = (await call('GET', '/api/users', null, T)).j.find((u) => u.id === ed.id).lastSeen;
  ok(ls > 0, 'fica registrado quando foi visto pela última vez');
  rT.destroy();

  console.log('5) editar e remover usuário');
  eq((await call('PATCH', `/api/users/${w.id}`, { name: 'Escritora' }, T)).j.name, 'Escritora', 'admin renomeia usuário');
  eq((await call('PATCH', `/api/users/${w.id}`, { name: 'Editor' }, T)).s, 400, 'nome repetido recusado');
  eq((await call('DELETE', `/api/users/${w.id}`, null, E)).s, 403, 'só admin remove');
  const meId = (await call('GET', '/api/me', null, T)).j.id;
  eq((await call('DELETE', `/api/users/${meId}`, null, T)).s, 400, 'não remove a si mesmo');
  eq((await call('PATCH', `/api/users/${meId}`, { role: 'user' }, T)).s, 400, 'não deixa o sistema sem administrador');
  eq((await call('DELETE', `/api/users/${w.id}`, null, T)).s, 200, 'admin remove usuário');
  eq((await call('GET', '/api/projects', null, W)).s, 401, 'sessão do removido cai');
  eq((await call('POST', '/api/login', { name: 'Escritora', password: 'escritor123' })).s, 401, 'removido não entra');
  const list = (await call('GET', '/api/users', null, E)).j;
  ok(list.find((u) => u.id === w.id).removed === true, 'continua na lista (marcado removido) para colorir o histórico');
  g = (await call('GET', `/api/notes/${nt.id}`, null, T)).j;
  ok(g.segments.some((x) => x.author === w.id), 'o que ele escreveu continua na nota');
  eq((await call('POST', '/api/users', { name: 'Escritora', password: 'novasenha123' }, T)).s, 200, 'o nome pode ser usado de novo');
  const members = (await call('GET', '/api/projects', null, T)).j[0].members;
  ok(!(w.id in members), 'sai de todos os projetos');

  await srv.close();
  console.log(`\n${pass} verificações ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
