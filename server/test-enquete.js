'use strict';
// Enquetes (votos por pessoa, única/várias, anônima, encerrar, regras de edição):  node server/test-enquete.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./index');
const poll = require('./poll');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttpoll-'));
  const srv = startServer({ dir, port: 0, host: '127.0.0.1', admin: ['Matheus', 'senhaforte1'] });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), 'Content-Type': 'application/json' }, body: b == null ? undefined : JSON.stringify(b) }); const x = await r.text(); let j = x; try { j = JSON.parse(x); } catch { /* */ } return { s: r.status, j }; };
  const A = (await call('POST', '/api/login', { name: 'Matheus', password: 'senhaforte1' })).j;
  const mk = async (name) => { const u = (await call('POST', '/api/users', { name, password: 'senha12345' }, A.token)).j; const t = (await call('POST', '/api/login', { name, password: 'senha12345' })).j.token; return { id: u.id, t }; };
  const ana = await mk('Ana'); const bia = await mk('Bia'); const leo = await mk('Leo'); const out = await mk('Fora');
  const members = { [ana.id]: 'write', [bia.id]: 'write', [leo.id]: 'read' };
  const pj = (await call('POST', '/api/projects', { name: 'Loja', members }, A.token)).j;
  const nt = (await call('POST', `/api/projects/${pj.id}/notes`, { title: 'Conversa' }, A.token)).j;
  const add = (text, t = A.token) => call('POST', `/api/notes/${nt.id}/segments`, { text }, t);
  const vote = (sid, options, t) => call('POST', `/api/notes/${nt.id}/segments/${sid}/vote`, { options }, t);
  const view = async (sid, t = A.token) => (await call('GET', `/api/notes/${nt.id}`, null, t)).j.segments.find((x) => x.id === sid);
  const SINGLE = poll.buildPoll({ question: 'Onde almoçar?', multi: false, options: ['Pizza', 'Sushi', 'Burger'] });
  const MULTI = poll.buildPoll({ question: 'Quais dias?', multi: true, options: ['Seg', 'Ter', 'Qua', 'Qui'] });
  const ANON = poll.buildPoll({ question: 'Voto secreto', multi: false, anonymous: true, options: ['Sim', 'Não'] });

  console.log('1) criar: a resposta já traz o resultado');
  const c1 = await add('vamos decidir\n' + SINGLE);
  eq(c1.s, 200, 'criou a mensagem com a enquete');
  eq([c1.j.poll.counts, c1.j.poll.people, c1.j.poll.mine, c1.j.poll.multi, c1.j.poll.anonymous, c1.j.poll.closed], [[0, 0, 0], 0, [], false, false, null], 'resultado zerado');
  ok(!('votes' in c1.j) && !('pollClosed' in c1.j), 'a resposta não traz os votos crus');
  const sid = c1.j.id;
  eq((await add('mensagem comum')).j.poll, undefined, 'mensagem comum não tem enquete');

  console.log('2) escolha única');
  const v1 = await vote(sid, [1], ana.t);
  eq([v1.s, v1.j.poll.counts, v1.j.poll.mine, v1.j.poll.people], [200, [0, 1, 0], [1], 1], 'Ana vota em Sushi');
  eq((await vote(sid, [2], ana.t)).j.poll.counts, [0, 0, 1], 'trocar o voto move (não soma)');
  eq((await vote(sid, [2], bia.t)).j.poll.counts, [0, 0, 2], 'Bia também vota em Burger');
  eq((await vote(sid, [0, 1], bia.t)).s, 400, 'única recusa duas opções');
  eq((await vote(sid, [3], bia.t)).s, 400, 'índice fora da lista');
  eq((await vote(sid, [-1], bia.t)).s, 400, 'índice negativo');
  eq((await vote(sid, 'x', bia.t)).s, 400, 'opções que não são lista');
  eq((await vote(sid, [], bia.t)).j.poll.counts, [0, 0, 1], 'lista vazia tira o voto');
  const gv = await view(sid, bia.t);
  eq([gv.poll.mine, gv.poll.counts], [[], [0, 0, 1]], 'cada um vê o seu voto (Bia sem voto, Ana contada)');
  eq((await view(sid, ana.t)).poll.mine, [2], 'Ana vê o dela');
  const o = await view(sid);
  eq(o.poll.voters, [[], [], [ana.id]], 'enquete aberta mostra quem votou');
  ok(!('votes' in o), 'o GET também não traz os votos crus');

  console.log('3) várias escolhas');
  const m = (await add(MULTI)).j;
  eq((await vote(m.id, [0, 2], ana.t)).j.poll.counts, [1, 0, 1, 0], 'Ana marca Seg e Qua');
  eq((await vote(m.id, [2, 3, 2], bia.t)).j.poll.counts, [1, 0, 2, 1], 'Bia marca Qua e Qui (repetido conta uma vez)');
  const mv = await view(m.id);
  eq([mv.poll.people, mv.poll.multi], [2, true], '2 pessoas');
  eq((await vote(m.id, [0], ana.t)).j.poll.counts, [1, 0, 1, 1], 'trocar a lista de escolhas da Ana');

  console.log('4) quem pode votar');
  eq((await vote(sid, [0], leo.t)).s, 403, 'quem só lê não vota');
  eq((await view(sid, leo.t)).poll.counts, [0, 0, 1], 'mas vê o resultado');
  ok([403, 404].includes((await vote(sid, [0], out.t)).s), 'quem não é do projeto não vota');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sid}/vote`, { options: [0] })).s, 401, 'precisa estar logado');
  const plain = (await add('texto comum')).j;
  eq((await vote(plain.id, [0], ana.t)).s, 400, 'mensagem comum não é enquete');

  console.log('5) enquete anônima');
  const an = (await add(ANON)).j;
  eq(an.poll.anonymous, true, 'marcada como anônima');
  await vote(an.id, [0], ana.t); await vote(an.id, [1], bia.t); await vote(an.id, [1], A.token);
  const av = await view(an.id, bia.t);
  eq([av.poll.counts, av.poll.people, av.poll.voters, av.poll.mine], [[1, 2], 3, null, [1]], 'conta, mas não diz quem votou (só o voto de quem pergunta)');
  ok(!JSON.stringify(av).includes('"votes"'), 'sem campo votes');
  const rawNote = JSON.stringify((await call('GET', `/api/notes/${nt.id}`, null, bia.t)).j);
  ok(!rawNote.includes('"votes"'), 'o JSON da nota não traz votos crus');

  console.log('6) encerrar');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sid}/poll-close`, { closed: true }, bia.t)).s, 403, 'outra pessoa que escreve não encerra');
  const cl = await call('POST', `/api/notes/${nt.id}/segments/${sid}/poll-close`, { closed: true }, A.token);
  eq([cl.s, !!cl.j.poll.closed, cl.j.poll.closed && cl.j.poll.closed.by], [200, true, A.user.id], 'quem criou encerra');
  eq((await vote(sid, [0], ana.t)).s, 400, 'encerrada não aceita voto');
  eq((await view(sid, ana.t)).poll.counts, [0, 0, 1], 'o resultado continua visível');
  eq((await call('POST', `/api/notes/${nt.id}/segments/${sid}/poll-close`, { closed: false }, A.token)).j.poll.closed, null, 'reabrir');
  eq((await vote(sid, [0], ana.t)).s, 200, 'depois de reabrir vota de novo');
  const bs = (await add(SINGLE, bia.t)).j;
  eq((await call('POST', `/api/notes/${nt.id}/segments/${bs.id}/poll-close`, { closed: true }, A.token)).s, 200, 'o administrador encerra a de outra pessoa');

  console.log('7) editar com votos');
  const edit = (id, text, t = A.token) => call('PATCH', `/api/notes/${nt.id}/segments/${id}`, { text }, t);
  eq((await edit(sid, 'vamos decidir\n' + poll.buildPoll({ question: 'Onde almoçamos hoje?', multi: false, options: ['Pizza', 'Sushi', 'Burger'] }))).s, 200, 'dá para mudar só a pergunta');
  eq((await view(sid)).poll.counts, [1, 0, 0], 'os votos continuam');
  eq((await edit(sid, poll.buildPoll({ question: 'Onde?', multi: false, options: ['Pizza', 'Sushi', 'Churrasco'] }))).s, 400, 'não dá para mudar uma opção');
  eq((await edit(sid, poll.buildPoll({ question: 'Onde?', multi: false, options: ['Pizza', 'Sushi'] }))).s, 400, 'nem tirar uma opção');
  eq((await edit(sid, poll.buildPoll({ question: 'Onde?', multi: true, options: ['Pizza', 'Sushi', 'Burger'] }))).s, 400, 'nem mudar o tipo');
  eq((await edit(sid, 'sem enquete nenhuma')).s, 400, 'nem tirar a enquete');
  const fresh = (await add(SINGLE)).j;
  eq((await edit(fresh.id, poll.buildPoll({ question: 'Outra', multi: true, options: ['a', 'b', 'c', 'd'] }))).s, 200, 'sem votos, pode refazer tudo');
  const dl = await call('DELETE', `/api/notes/${nt.id}/segments/${sid}`, null, A.token);
  eq(dl.s, 200, 'apagar a mensagem');
  eq((await vote(sid, [0], ana.t)).s, 400, 'apagada não aceita voto');
  const hist = (await view(sid)).versions;
  const rs = await call('POST', `/api/notes/${nt.id}/segments/${sid}/restore`, { version: hist[hist.length - 2].n }, A.token);
  eq(rs.s, 200, 'restaurar a versão anterior');
  eq((await view(sid)).poll.counts, [1, 0, 0], 'os votos voltam junto com a mensagem');

  console.log('8) aviso em tempo real');
  const ctl = new AbortController(); const got = [];
  const sse = await fetch(`${base}/api/events`, { headers: { Authorization: 'Bearer ' + bia.t }, signal: ctl.signal });
  const rd = sse.body.getReader(); const dec = new TextDecoder();
  (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; got.push(dec.decode(value)); } } catch { /* fim */ } })();
  await new Promise((r) => setTimeout(r, 300));
  await vote(m.id, [1], ana.t);
  await new Promise((r) => setTimeout(r, 400));
  ok(got.join('').includes('"what":"vote"'), 'os outros recebem um aviso "vote"');
  ctl.abort();

  console.log('9) as outras operações continuam devolvendo o trecho completo');
  const rx = await call('POST', `/api/notes/${nt.id}/segments/${sid}/react`, { emoji: '👍' }, ana.t);
  eq([rx.s, !!rx.j.poll, 'votes' in rx.j], [200, true, false], 'reagir devolve a enquete sem votos crus');

  console.log('10) o leitor da página web entende a enquete igual ao do servidor');
  {
    const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
    const code = html.slice(html.indexOf('// <poll>'), html.indexOf('// </poll>'));
    const sandbox = {}; require('vm').runInNewContext(code + '\nthis.pollFirst = pollFirst; this.pollFind = pollFind; this.pollParse = pollParse;', sandbox);
    const cases = [
      SINGLE, MULTI, ANON, 'antes\n' + SINGLE + '\ndepois', 'sem enquete', '```enquete\nQ\n- a\n```', '```enquete\nQ\n- ( ) a\n- ( ) b', 'x\n```enquete anônima\nVoto?\n- [ ] a\n- [ ] b\n- [ ] c\n```',
      '```enquete\nQual?\n![mock](srv-file:q1)\n- ( ) ![A](srv-file:x1) Layout A\n- ( ) ![[foto.png]] Foto\n- ( ) ![[so imagem.png]]\n- ( ) ![rótulo](srv-file:x3)\n- ( ) texto\n```',
      '```enquete\nQ\n- ( ) ![](file:///C:/a/foto%20(2).png) com parênteses\n- ( ) b\n```',
      '```js\ncodigo\n```\n```enquete\nQ\n- (x) a\n- ( ) b\n```', '```enquete\n- sobre o quê?\n- ( ) a\n- ( ) b\n```', '```enquete\nQ\n\n- ( ) a\n\n- ( ) b   \n```',
    ];
    for (const t of cases) {
      const a = poll.firstPoll(t); const b = sandbox.pollFirst(t);
      const strip = (p) => p && { q: p.question, qi: p.image && p.image.src, m: p.multi, an: p.anonymous, o: p.options.map((x) => [x.text, x.image && x.image.src, x.image && x.image.wiki]) };
      eq(b ? strip(b.p) : null, a ? strip(a) : null, 'mesma leitura: ' + JSON.stringify(t.slice(0, 30)));
      eq(b ? b.startLine : null, a ? a.block.startLine : null, 'mesma linha de início');
    }
  }

  console.log(`\n${pass} verificações ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
