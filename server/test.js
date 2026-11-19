'use strict';
// Teste de ponta a ponta do servidor (sobe numa porta livre, pasta temporária):  node server/test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer } = require('./index');
const backup = require('./backup');

let pass = 0; let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ✗ FALHOU:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsrv-'));
  const bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttbak-'));
  const rdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttres-'));
  const srv = startServer({ dir, port: 0, host: '127.0.0.1', admin: ['Matheus', 'senhaforte1'] });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body, token, raw) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(raw ? raw.headers : { 'Content-Type': 'application/json' }) }, body: raw ? raw.body : body == null ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch { /* binário */ }
    return { s: r.status, j, t, h: r.headers };
  };

  console.log('1) login e limite de tentativas');
  eq((await call('POST', '/api/login', { name: 'Matheus', password: 'errada' })).s, 401, 'senha errada');
  const m = await call('POST', '/api/login', { name: 'matheus', password: 'senhaforte1' });
  eq(m.s, 200, 'login do admin (nome sem diferenciar maiúsculas)');
  const A = m.j.token;
  eq((await call('GET', '/api/projects')).s, 401, 'sem login não acessa');
  for (let i = 0; i < 5; i++) await call('POST', '/api/login', { name: 'Fulano', password: 'x' });
  eq((await call('POST', '/api/login', { name: 'Fulano', password: 'x' })).s, 429, 'bloqueio após várias tentativas');

  console.log('1b) limite de tentativas por endereço real (Tailscale Funnel)');
  {
    const tryLogin = async (ip, pw, xff) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': xff || ip } : {}) }, body: JSON.stringify({ name: 'Matheus', password: pw }) }); await r.text(); return r.status; };
    for (let i = 0; i < 5; i++) await tryLogin('203.0.113.5', 'errada');
    eq(await tryLogin('203.0.113.5', 'errada'), 429, 'quem erra muito é bloqueado pelo seu endereço');
    eq(await tryLogin('203.0.113.9', 'senhaforte1'), 200, 'outro endereço (pelo proxy) não é bloqueado junto');
    eq(await tryLogin(null, 'senhaforte1'), 200, 'acesso direto também continua funcionando');
    eq(await tryLogin('x', 'errada', '203.0.113.5, 198.51.100.7'), 401, 'endereço inventado no começo do cabeçalho é ignorado (vale o último)');
  }
  console.log('2) usuários e projetos com permissão');
  const c1 = (await call('POST', '/api/users', { name: 'Colega 1', password: 'colega1234' }, A)).j;
  const c2 = (await call('POST', '/api/users', { name: 'Colega 2', password: 'colega5678' }, A)).j;
  ok(c1.color && c2.color && c1.color !== c2.color, 'cada usuário recebe uma cor');
  eq((await call('POST', '/api/users', { name: 'X', password: 'curta' }, A)).s, 400, 'senha curta recusada');
  const B = (await call('POST', '/api/login', { name: 'Colega 1', password: 'colega1234' })).j.token;
  const C = (await call('POST', '/api/login', { name: 'Colega 2', password: 'colega5678' })).j.token;
  eq((await call('POST', '/api/users', { name: 'Y', password: 'senhaboa123' }, B)).s, 403, 'colega comum não cria usuário');
  eq((await call('POST', '/api/projects', { name: 'Loja' }, B)).s, 403, 'colega comum não cria projeto');
  const proj = (await call('POST', '/api/projects', { name: 'Loja Online', members: { [c1.id]: 'edit' } }, A)).j;
  const proj2 = (await call('POST', '/api/projects', { name: 'App Secreto', members: { [c2.id]: 'read' } }, A)).j;
  eq((await call('GET', '/api/projects', null, B)).j.map((p) => p.name), ['Loja Online'], 'Colega 1 só vê o projeto dele');
  eq((await call('GET', '/api/projects', null, C)).j.map((p) => p.name), ['App Secreto'], 'Colega 2 só vê o dele');
  eq((await call('GET', '/api/projects', null, A)).j.length, 2, 'admin vê todos');
  eq((await call('GET', `/api/projects/${proj.id}/notes`, null, C)).s, 403, 'sem permissão no projeto');

  console.log('3) notas em trechos, edição de outro com histórico, restaurar');
  const note = (await call('POST', `/api/projects/${proj.id}/notes`, { title: 'Pagamento' }, A)).j;
  const s1 = (await call('POST', `/api/notes/${note.id}/segments`, { text: 'Realizei esse processo…\n- [ ] Teste do pagamento\n- [ ] Teste do frete' }, A)).j;
  eq(s1.author, (await call('GET', '/api/me', null, A)).j.id, 'o trecho guarda o autor');
  const s2 = (await call('POST', `/api/notes/${note.id}/segments`, { text: 'Perfeito, seguimos nos testes' }, B)).j;
  eq((await call('POST', `/api/notes/${note.id}/segments`, { text: 'oi' }, C)).s, 403, 'sem acesso não escreve');
  eq((await call('PATCH', `/api/notes/${note.id}/segments/${s1.id}`, { text: 'Realizei esse processo (corrigido)\n- [ ] Teste do pagamento' }, B)).s, 200, 'editar o trecho de outro é permitido');
  let got = (await call('GET', `/api/notes/${note.id}`, null, A)).j;
  const seg1 = got.segments.find((s) => s.id === s1.id);
  eq(seg1.versions.length, 2, 'versão antiga guardada');
  eq(seg1.versions[1].by, c1.id, 'a edição registra quem editou');
  ok(seg1.versions[0].text.includes('Teste do frete'), 'texto original preservado');
  await call('POST', `/api/notes/${note.id}/segments/${s1.id}/restore`, { version: 1 }, A);
  got = (await call('GET', `/api/notes/${note.id}`, null, A)).j;
  ok(got.segments[0].versions.slice(-1)[0].text.includes('Teste do frete') && got.segments[0].versions.length === 3, 'restaurar cria nova versão (histórico segue completo)');
  eq(got.segments[0].versions[2].kind, 'restore', 'tipo restore');

  console.log('4) checkbox registra quem marcou');
  const ck = await call('POST', `/api/notes/${note.id}/segments/${s1.id}/check`, { line: 1, checked: true }, B);
  eq(ck.s, 200, 'marcar tarefa');
  const last = ck.j.versions.slice(-1)[0];
  ok(last.text.includes('- [x] Teste do pagamento') && last.kind === 'check' && last.by === c1.id && /marcou/.test(last.label), 'versão do tipo check com autor e rótulo');
  eq((await call('POST', `/api/notes/${note.id}/segments/${s1.id}/check`, { line: 0 }, B)).s, 400, 'linha que não é tarefa');

  console.log('5) não lidos');
  const unreadB0 = (await call('GET', `/api/projects/${proj.id}/notes`, null, B)).j[0].unread;
  ok(unreadB0 >= 1, 'Colega 1 tem alterações de outros para ler (' + unreadB0 + ')');
  await call('POST', `/api/notes/${note.id}/read`, null, B);
  eq((await call('GET', `/api/projects/${proj.id}/notes`, null, B)).j[0].unread, 0, 'depois de abrir, zera');
  await call('PATCH', `/api/notes/${note.id}/segments/${s2.id}`, { text: 'Perfeito, seguimos nos testes amanhã' }, A);
  eq((await call('GET', `/api/projects/${proj.id}/notes`, null, B)).j[0].unread, 1, 'nova edição do Matheus vira 1 não lido para o Colega 1');
  eq((await call('GET', '/api/projects', null, B)).j[0].unread, 1, 'o projeto soma os não lidos');

  console.log('6) tempo real (SSE) só para quem tem permissão');
  const events = { A: [], C: [] };
  const listen = (tok, key) => new Promise((resolve) => {
    const req = http.get(base + '/api/events', { headers: { Authorization: 'Bearer ' + tok } }, (res) => {
      res.on('data', (d) => { for (const l of d.toString().split('\n')) if (l.startsWith('data: ')) events[key].push(JSON.parse(l.slice(6))); });
      resolve(req);
    });
  });
  const ra = await listen(A, 'A'); const rc = await listen(C, 'C');
  await new Promise((r) => setTimeout(r, 200));
  await call('POST', `/api/notes/${note.id}/segments`, { text: 'novo trecho em tempo real' }, B);
  await new Promise((r) => setTimeout(r, 300));
  ok(events.A.some((e) => e.type === 'note' && e.what === 'add'), 'admin recebe o evento');
  ok(!events.C.some((e) => e.type === 'note'), 'Colega 2 (sem permissão) não recebe');
  ra.destroy(); rc.destroy();

  console.log('7) anexos: envio, download com Range e permissão');
  const bytes = Buffer.alloc(300000, 7);
  const up = await call('POST', `/api/projects/${proj.id}/files?name=${encodeURIComponent('foto do produto.png')}`, null, B, { headers: { 'Content-Type': 'image/png' }, body: bytes });
  eq(up.s, 200, 'upload');
  const fid = up.j.id;
  const dl = await fetch(base + `/api/files/${fid}`, { headers: { Authorization: 'Bearer ' + B } });
  eq((await dl.arrayBuffer()).byteLength, 300000, 'download completo');
  const rg = await fetch(base + `/api/files/${fid}`, { headers: { Authorization: 'Bearer ' + A, Range: 'bytes=100-199' } });
  eq([rg.status, (await rg.arrayBuffer()).byteLength, rg.headers.get('content-range')], [206, 100, 'bytes 100-199/300000'], 'Range (vídeo em trechos)');
  eq((await fetch(base + `/api/files/${fid}`, { headers: { Authorization: 'Bearer ' + C } })).status, 403, 'quem não é do projeto não baixa');
  eq((await fetch(base + `/api/files/${fid}?t=${B}`)).status, 200, 'token na URL (para <img> e <video>)');
  srv.cfg.maxFileMB = 0.1;
  eq((await call('POST', `/api/projects/${proj.id}/files?name=g.bin`, null, B, { headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).s, 413, 'limite de tamanho');

  console.log('8) desativar usuário derruba a sessão');
  await call('PATCH', `/api/users/${c2.id}`, { disabled: true }, A);
  eq((await call('GET', '/api/projects', null, C)).s, 401, 'sessão do desativado deixa de valer');
  eq((await call('POST', '/api/login', { name: 'Colega 2', password: 'colega5678' })).s, 401, 'não entra mais');

  console.log('9) backup criptografado e restauração');
  srv.cfg.backup = { dir: bdir, passphrase: 'segredo do backup', keepDaily: 14, keepWeekly: 8 };
  console.log('  ', await backup.run(srv.core, srv.cfg));
  const files = fs.readdirSync(bdir);
  ok(files.some((f) => f.startsWith('estado-')) && files.includes('salt.bin') && fs.readdirSync(path.join(bdir, 'files')).length === 1, 'estado + anexo no destino');
  const raw = fs.readFileSync(path.join(bdir, files.find((f) => f.startsWith('estado-'))));
  ok(!raw.includes('Teste do pagamento') && !raw.includes('Loja Online'), 'o backup não contém texto legível');
  ok(!fs.readFileSync(path.join(bdir, 'files', fs.readdirSync(path.join(bdir, 'files'))[0])).includes(Buffer.alloc(100, 7)), 'o anexo também está criptografado');
  let wrong = '';
  try { await backup.restore(bdir, rdir, 'senha errada'); } catch (e) { wrong = e.message; }
  ok(/incorreta/.test(wrong), 'senha errada não restaura: ' + wrong);
  const r = await backup.restore(bdir, rdir, 'segredo do backup');
  eq(r.files, 1, 'anexo restaurado');
  const restored = JSON.parse(fs.readFileSync(path.join(rdir, 'state.json'), 'utf8'));
  ok(Object.values(restored.notes)[0].segments.length === 3 && Object.keys(restored.sessions).length === 0, 'notas e histórico restaurados, sem sessões');
  eq(fs.readFileSync(path.join(rdir, 'files', fid)).equals(bytes), true, 'anexo idêntico ao original');
  const second = await backup.run(srv.core, srv.cfg);
  ok(/0 anexo/.test(second), 'segundo backup não copia o anexo de novo');

  console.log('9b) apagar projeto');
  {
    const np = (await call('POST', '/api/projects', { name: 'Temporario' }, A)).j;
    eq((await call('DELETE', `/api/projects/${np.id}`, null, A)).s, 200, 'admin apaga o projeto');
    ok(!(await call('GET', '/api/projects', null, A)).j.some((p) => p.id === np.id), 'projeto some da lista');
    eq((await call('GET', `/api/projects/${np.id}/notes`, null, A)).s, 404, 'projeto apagado não responde mais');
  }
  console.log('9c) página web e busca');
  {
    const pg = await call('GET', '/');
    ok(pg.s === 200 && /<title>TT Note<\/title>/.test(pg.t) && /text\/html/.test(pg.h.get('content-type')), 'a raiz serve a página web');
    ok(/default-src 'self'/.test(pg.h.get('content-security-policy')), 'página com política de segurança');
    eq((await call('GET', '/api/ping')).j.ok, true, '/api/ping continua em JSON');
    eq((await call('GET', '/api/search?q=pagamento')).s, 401, 'busca exige login');
    const bu = await call('GET', '/api/search?q=' + encodeURIComponent('PAGAMENTO'), null, A);
    ok(bu.s === 200 && bu.j.length > 0 && bu.j.every((h) => h.nid && h.title), 'busca acha a nota sem diferenciar maiúsculas');
    eq((await call('GET', '/api/search?q=a', null, A)).j.length, 0, 'busca curta demais não devolve nada');
  }
  console.log('9d) grupos de projetos');
  await call('POST', '/api/users', { name: 'Colega 3', password: 'colega9999' }, A);
  const D = (await call('POST', '/api/login', { name: 'Colega 3', password: 'colega9999' })).j.token; // sem acesso a nenhum projeto
  {
    eq((await call('POST', '/api/groups', { name: 'Clientes' }, B)).s, 403, 'colega comum não cria grupo');
    const g = (await call('POST', '/api/groups', { name: 'Clientes' }, A)).j;
    ok(g && g.id && g.name === 'Clientes', 'admin cria o grupo');
    eq((await call('POST', '/api/groups', { name: 'clientes' }, A)).s, 400, 'nome repetido (sem diferenciar maiúsculas) é recusado');
    eq((await call('GET', '/api/groups', null, D)).j, [], 'quem não vê nenhum projeto do grupo não vê o grupo');
    eq((await call('PATCH', `/api/projects/${proj.id}`, { group: g.id }, B)).s, 403, 'só o admin muda o grupo de um projeto');
    eq((await call('PATCH', `/api/projects/${proj.id}`, { group: 'naoexiste' }, A)).s, 400, 'grupo inexistente é recusado');
    eq((await call('PATCH', `/api/projects/${proj.id}`, { group: g.id }, A)).s, 200, 'admin coloca o projeto no grupo');
    eq((await call('GET', '/api/projects', null, B)).j[0].group, g.id, 'a lista de projetos traz o grupo');
    eq((await call('GET', '/api/groups', null, B)).j.map((x) => x.name), ['Clientes'], 'quem vê um projeto do grupo vê o grupo');
    eq((await call('GET', '/api/groups', null, D)).j, [], 'o outro colega continua sem ver (a permissão é por projeto)');
    eq((await call('PATCH', `/api/groups/${g.id}`, { name: 'Clientes VIP' }, A)).j.name, 'Clientes VIP', 'renomear o grupo');
    eq((await call('DELETE', `/api/groups/${g.id}`, null, B)).s, 403, 'colega não apaga grupo');
    eq((await call('DELETE', `/api/groups/${g.id}`, null, A)).s, 200, 'admin apaga o grupo');
    eq((await call('GET', '/api/projects', null, B)).j[0].group, null, 'os projetos continuam, só saem do grupo');
    const g2 = (await call('POST', '/api/groups', { name: 'Pessoal' }, A)).j;
    const np = (await call('POST', '/api/projects', { name: 'Já no grupo', group: g2.id }, A)).j;
    eq(np.group, g2.id, 'criar o projeto já dentro de um grupo');
  }

  console.log('9e) canvas compartilhado (um editor por vez)');
  {
    const cv = (await call('POST', `/api/projects/${proj.id}/notes`, { title: 'Quadro', type: 'canvas' }, B)).j;
    eq(cv.type, 'canvas', 'cria uma nota do tipo canvas');
    const nid = cv.id;
    eq((await call('GET', `/api/notes/${nid}`, null, D)).s, 403, 'sem acesso ao projeto não abre');
    let g = (await call('GET', `/api/notes/${nid}`, null, A)).j;
    ok(g.type === 'canvas' && g.canvas.version === 1 && JSON.parse(g.canvas.text).nodes.length === 0 && g.lock === null, 'abre vazio, versão 1, sem trava');
    eq((await call('POST', `/api/notes/${nid}/segments`, { text: 'oi' }, A)).s, 400, 'não dá para escrever mensagem num canvas');
    eq((await call('POST', `/api/notes/${note.id}/lock`, {}, A)).s, 400, 'trava só existe para canvas');
    const doc = (n) => JSON.stringify({ nodes: Array.from({ length: n }, (_, i) => ({ id: 'n' + i, type: 'text', text: 'card ' + i, x: i * 10, y: 0, width: 200, height: 80 })), edges: [] });
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: doc(1), baseVersion: 1 }, B)).j.version, 2, 'salvar sem ter pegado a trava pega a trava e grava (versão 2)');
    eq((await call('POST', `/api/notes/${nid}/lock`, {}, A)).s, 409, 'outra pessoa não consegue travar enquanto B edita');
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: doc(2), baseVersion: 2 }, A)).s, 409, 'nem salvar');
    g = (await call('GET', `/api/notes/${nid}`, null, A)).j;
    eq(g.lock.by, c1.id, 'todos veem quem está editando');
    eq((await call('DELETE', `/api/notes/${nid}/lock`, null, D)).s, 403, 'sem acesso não solta a trava de ninguém');
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: 'não é json', baseVersion: 2 }, B)).s, 400, 'JSON inválido é recusado');
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: '{"nodes":5}', baseVersion: 2 }, B)).s, 400, 'nodes precisa ser lista');
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: doc(2), baseVersion: 1 }, B)).s, 409, 'versão desatualizada é recusada');
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: doc(3), baseVersion: 2 }, B)).j.version, 3, 'o dono da trava continua salvando');
    ok(JSON.parse((await call('GET', `/api/notes/${nid}`, null, A)).j.canvas.text).nodes.length === 3, 'os outros veem o conteúdo novo');
    eq((await call('GET', `/api/projects/${proj.id}/notes`, null, A)).j.find((n) => n.id === nid).unread, 1, 'aparece como não lido para quem não alterou');
    const forced = await call('POST', `/api/notes/${nid}/lock`, { force: true }, A);
    eq(forced.s, 200, 'administrador pode assumir a edição (force)');
    eq((await call('PUT', `/api/notes/${nid}/canvas`, { text: doc(4), baseVersion: 3 }, B)).s, 409, 'quem perdeu a trava não salva mais');
    eq((await call('DELETE', `/api/notes/${nid}/lock`, null, A)).s, 200, 'soltar a trava');
    eq((await call('GET', `/api/notes/${nid}`, null, B)).j.lock, null, 'sem trava depois de soltar');
    srv.core.state.notes[nid].lock = { by: c1.id, ts: Date.now() - 200000, exp: Date.now() - 1000 }; // trava vencida (app fechou)
    eq((await call('POST', `/api/notes/${nid}/lock`, {}, A)).s, 200, 'trava vencida não segura ninguém');
    const h = (await call('GET', `/api/notes/${nid}/canvas/history`, null, B)).j;
    ok(h.length >= 2 && h[0].current && h[0].version === 3, 'histórico: versão atual primeiro, com pontos de restauração');
    eq((await call('POST', `/api/notes/${nid}/canvas/restore`, { version: h[1].version }, B)).s, 409, 'restaurar exige ser quem edita');
    const rs = await call('POST', `/api/notes/${nid}/canvas/restore`, { version: h[h.length - 1].version }, A);
    eq(rs.j.version, 4, 'restaurar cria uma versão nova (nada se perde)');
    ok(JSON.parse((await call('GET', `/api/notes/${nid}`, null, A)).j.canvas.text).nodes.length < 3, 'o conteúdo voltou ao ponto escolhido');
    eq((await call('DELETE', `/api/notes/${nid}`, null, A)).s, 200, 'apagar o canvas como qualquer nota');
  }

  console.log('9f) permissão por grupo');
  {
    const d3 = (await call('GET', '/api/users', null, A)).j.find((u) => u.name === 'Colega 3');
    const grp = (await call('POST', '/api/groups', { name: 'Equipe Alfa' }, A)).j;
    const pa = (await call('POST', '/api/projects', { name: 'Alfa 1', group: grp.id }, A)).j;
    const pb = (await call('POST', '/api/projects', { name: 'Alfa 2', group: grp.id, members: { [c1.id]: 'edit' } }, A)).j;
    const roles = async (tok) => Object.fromEntries((await call('GET', '/api/projects', null, tok)).j.map((p) => [p.name, p.role]));
    eq((await call('PATCH', `/api/groups/${grp.id}`, { members: { [d3.id]: 'write' } }, B)).s, 403, 'colega comum não muda o acesso do grupo');
    const up = await call('PATCH', `/api/groups/${grp.id}`, { members: { [d3.id]: 'write', naoexiste: 'read', [c1.id]: 'xx' } }, A);
    eq(up.s, 200, 'admin define o acesso do grupo');
    eq((await call('GET', '/api/groups', null, A)).j.find((g) => g.id === grp.id).members, { [d3.id]: 'write' }, 'usuário inexistente e papel inválido são descartados');
    eq(await roles(D), { 'Alfa 1': 'write', 'Alfa 2': 'write' }, 'quem tem papel no grupo vê todos os projetos do grupo, com esse papel');
    const gl = (await call('GET', '/api/groups', null, D)).j.find((g) => g.id === grp.id);
    ok(gl && gl.role === 'write' && gl.members === undefined, 'o membro vê o grupo e o próprio papel, sem a lista de todos');
    eq((await call('POST', `/api/projects/${pa.id}/notes`, { title: 'Nota do D' }, D)).s, 200, 'o papel do grupo vale na prática (escrever)');
    eq((await call('PATCH', `/api/projects/${pa.id}`, { name: 'x' }, D)).s, 403, 'escrever não dá poder de administrar o projeto');
    await call('PATCH', `/api/groups/${grp.id}`, { members: { [c1.id]: 'read' } }, A);
    eq(await roles(D), {}, 'tirar do grupo tira o acesso herdado');
    const rb = await roles(B);
    ok(rb['Alfa 1'] === 'read' && rb['Alfa 2'] === 'edit', 'vale o mais alto: lê pelo grupo, mas tem "edita" direto no Alfa 2');
    await call('PATCH', `/api/groups/${grp.id}`, { members: { [c1.id]: 'admin' } }, A);
    eq((await roles(B))['Alfa 1'], 'admin', 'admin do grupo administra os projetos dele');
    eq((await call('PATCH', `/api/projects/${pa.id}`, { members: { [d3.id]: 'read' } }, B)).s, 200, 'e consegue dar acesso a alguém no projeto');
    eq((await call('PATCH', `/api/projects/${pa.id}`, { group: null }, B)).s, 403, 'mas não tira o projeto do grupo (só o admin do servidor)');
    eq((await call('PATCH', `/api/groups/${grp.id}`, { name: 'x' }, B)).s, 403, 'nem mexe no grupo');
    const info = (await call('GET', '/api/projects', null, A)).j.find((p) => p.id === pa.id);
    eq(info.inherited, { [c1.id]: 'admin' }, 'o admin vê quem tem acesso herdado do grupo');
    await call('PATCH', `/api/groups/${grp.id}`, { members: { [d3.id]: 'read' } }, A);
    eq((await call('DELETE', `/api/users/${d3.id}`, null, A)).s, 200, 'remover o usuário...');
    eq((await call('GET', '/api/groups', null, A)).j.find((g) => g.id === grp.id).members, {}, '...também o tira dos grupos');
  }

  console.log('9g) quem criou e quem editou o canvas e cada cartão');
  {
    const cv = (await call('POST', `/api/projects/${proj.id}/notes`, { title: 'Autoria', type: 'canvas' }, B)).j;
    eq(cv.by, c1.id, 'o canvas guarda quem criou');
    const mk = (nodes) => JSON.stringify({ nodes, edges: [] }, null, 2) + '\n';
    const n1 = { id: 'a', type: 'text', text: 'primeiro', x: 0, y: 0, width: 200, height: 80 };
    const forged = { id: 'b', type: 'text', text: 'segundo', x: 300, y: 0, width: 200, height: 80, by: 'inventado', editedBy: 'inventado' };
    const r1 = await call('PUT', `/api/notes/${cv.id}/canvas`, { text: mk([n1, forged]), baseVersion: 1 }, B);
    eq(r1.s, 200, 'salva dois cartões novos');
    let doc = JSON.parse((await call('GET', `/api/notes/${cv.id}`, null, A)).j.canvas.text);
    ok(doc.nodes.every((n) => n.by === c1.id && n.ts && !n.editedBy), 'cada cartão novo é carimbado com quem criou (o que o cliente mandar de autoria é ignorado)');
    ok(typeof r1.j.text === 'string' && JSON.parse(r1.j.text).nodes[0].by === c1.id, 'a resposta traz o texto já carimbado');
    await call('POST', `/api/notes/${cv.id}/lock`, { force: true }, A);
    const cur = (await call('GET', `/api/notes/${cv.id}`, null, A)).j.canvas;
    const nodes = JSON.parse(cur.text).nodes;
    nodes[0].text = 'primeiro (editado pelo admin)';
    const r2 = await call('PUT', `/api/notes/${cv.id}/canvas`, { text: mk(nodes), baseVersion: cur.version }, A);
    eq(r2.s, 200, 'o admin edita um cartão');
    doc = JSON.parse((await call('GET', `/api/notes/${cv.id}`, null, B)).j.canvas.text);
    const a = doc.nodes.find((n) => n.id === 'a'); const b = doc.nodes.find((n) => n.id === 'b');
    ok(a.by === c1.id && a.editedBy !== undefined && a.editedBy !== c1.id && a.editedTs, 'o cartão editado mostra o criador original e quem editou');
    ok(b.by === c1.id && b.editedBy === undefined, 'o cartão que ninguém mexeu continua sem "editado por"');
    nodes[1].x = 999; // só mover também conta como edição
    const cur2 = (await call('GET', `/api/notes/${cv.id}`, null, A)).j.canvas;
    const n2 = JSON.parse(cur2.text).nodes; n2[1].x = 999;
    await call('PUT', `/api/notes/${cv.id}/canvas`, { text: mk(n2), baseVersion: cur2.version }, A);
    doc = JSON.parse((await call('GET', `/api/notes/${cv.id}`, null, B)).j.canvas.text);
    ok(doc.nodes.find((n) => n.id === 'b').editedBy !== undefined, 'mover um cartão conta como edição');
    const info = (await call('GET', `/api/projects/${proj.id}/notes`, null, B)).j.find((n) => n.id === cv.id);
    ok(info.by === c1.id && info.lastBy !== c1.id, 'a lista mostra quem criou e quem alterou por último');
    // canvas antigo (sem o campo "by"): descobre pelo histórico
    delete srv.core.state.notes[cv.id].by;
    eq((await call('GET', `/api/notes/${cv.id}`, null, B)).j.by, c1.id, 'canvas antigo, sem o registro: o criador sai da versão 1 do histórico');
    srv.core.state.notes[cv.id].snaps = [];
    eq((await call('GET', `/api/notes/${cv.id}`, null, B)).j.by, null, 'sem registro e sem a versão 1: desconhecido (null)');
    await call('DELETE', `/api/notes/${cv.id}`, null, A);
  }

  console.log('9h) responder e mencionar (@nome)');
  {
    const mkU = async (name) => { const u = (await call('POST', '/api/users', { name, password: 'senhaboa123' }, A)).j; const t = (await call('POST', '/api/login', { name, password: 'senhaboa123' })).j.token; return { id: u.id, t }; };
    const ana = await mkU('Ana'); const anaM = await mkU('Ana Maria'); const sem = await mkU('Sem Acesso');
    await call('PATCH', `/api/projects/${proj.id}`, { members: { [c1.id]: 'edit', [ana.id]: 'write', [anaM.id]: 'write' } }, A);
    const nt = (await call('POST', `/api/projects/${proj.id}/notes`, { title: 'Conversa de menções' }, A)).j;
    const post = async (tok, text, extra = {}) => call('POST', `/api/notes/${nt.id}/segments`, { text, ...extra }, tok);
    const people = (await call('GET', `/api/projects/${proj.id}/people`, null, B)).j.map((u) => u.name);
    ok(['Matheus', 'Colega 1', 'Ana', 'Ana Maria'].every((n) => people.includes(n)) && !people.includes('Sem Acesso'), 'a lista do @ traz só quem enxerga o projeto');
    eq((await call('GET', `/api/projects/${proj.id}/people`, null, sem.t)).s, 403, 'quem não vê o projeto não pega a lista');
    const m1 = (await post(A, '@Ana Maria veja isso')).j;
    eq(m1.mentions, [anaM.id], '"@Ana Maria" não conta como "@Ana" (vale o nome mais comprido)');
    const m2 = (await post(A, '@Ana e @Sem Acesso olhem')).j;
    eq(m2.mentions, [ana.id], 'quem não vê o projeto não é mencionado (vira só texto)');
    eq((await post(A, 'fale com a email@Ana agora')).j.mentions, [], '"@" no meio de uma palavra não é menção');
    eq((await post(A, '@ana maria e @ANA')).j.mentions.sort(), [ana.id, anaM.id].sort(), 'não diferencia maiúsculas');
    eq((await post(A, '@Matheus eu mesmo')).j.mentions, [], 'ninguém menciona a si mesmo');
    eq((await post(A, 'em código `@Ana` ou\n```\n@Ana Maria\n```\nnão conta')).j.mentions, [], '@ dentro de código não é menção');
    const all = (await post(B, 'pessoal, @todos aqui')).j;
    eq(all.mentions.sort(), [ana.id, anaM.id, (await call('GET', '/api/me', null, A)).j.id].sort(), '@todos avisa todos do projeto, menos quem escreveu');
    const mineOf = async (tok) => (await call('GET', `/api/projects/${proj.id}/notes`, null, tok)).j.find((n) => n.id === nt.id).mine;
    eq(await mineOf(ana.t), 3, 'a Ana tem 3 mensagens "para ela" (2 menções diretas + @todos)');
    eq((await call('GET', '/api/projects', null, ana.t)).j.find((p) => p.id === proj.id).mine, 3, 'o projeto soma as mensagens "para você"');
    await call('POST', `/api/notes/${nt.id}/read`, {}, ana.t);
    eq(await mineOf(ana.t), 0, 'abrir a nota zera');
    // responder
    const base = (await post(ana.t, 'minha mensagem original')).j;
    const mineBefore = await mineOf(ana.t);
    const rep = await post(B, 'respondendo à Ana', { replyTo: base.id });
    eq(rep.j.replyTo, base.id, 'a resposta guarda a mensagem respondida');
    eq(await mineOf(ana.t), mineBefore + 1, 'quem foi respondido recebe "para você"');
    eq((await post(B, 'x', { replyTo: 'naoexiste' })).s, 400, 'responder a mensagem inexistente é recusado');
    const other = (await call('POST', `/api/projects/${proj.id}/notes`, { title: 'Outra' }, A)).j;
    const oseg = (await call('POST', `/api/notes/${other.id}/segments`, { text: 'em outra nota' }, A)).j;
    eq((await post(B, 'x', { replyTo: oseg.id })).s, 400, 'não dá para responder a uma mensagem de outra nota');
    const gone = (await post(A, 'vou apagar')).j;
    await call('DELETE', `/api/notes/${nt.id}/segments/${gone.id}`, null, A);
    eq((await post(B, 'x', { replyTo: gone.id })).s, 400, 'não dá para responder a uma mensagem apagada');
    await call('DELETE', `/api/notes/${nt.id}/segments/${rep.j.id}`, null, B);
    eq(await mineOf(ana.t), mineBefore, 'apagar a resposta tira o aviso');
    // editar para incluir uma menção
    await call('POST', `/api/notes/${nt.id}/read`, {}, ana.t);
    const ed = (await post(B, 'texto sem menção')).j;
    eq(await mineOf(ana.t), 0, 'sem menção, sem aviso');
    await call('PATCH', `/api/notes/${nt.id}/segments/${ed.id}`, { text: 'agora com @Ana' }, B);
    eq(await mineOf(ana.t), 1, 'editar a mensagem para incluir a menção avisa');
    await call('DELETE', `/api/notes/${other.id}`, null, A);
  }

  console.log('9i) chamar a atenção (tremer a tela) só com permissão');
  {
    const mkU = async (name) => { const u = (await call('POST', '/api/users', { name, password: 'senhaboa123' }, A)).j; const t = (await call('POST', '/api/login', { name, password: 'senhaboa123' })).j.token; return { id: u.id, t }; };
    const ze = await mkU('Zé Chamado'); const mari = await mkU('Mari Chama'); const solo = await mkU('Sem Projeto');
    await call('PATCH', `/api/projects/${proj.id}`, { members: { [c1.id]: 'edit', [ze.id]: 'write', [mari.id]: 'write' } }, A);
    // escuta de verdade as mensagens em tempo real de cada pessoa
    const listen = async (tok) => {
      const ctl = new AbortController(); const got = [];
      const r = await fetch(`${base}/api/events?t=${tok}`, { signal: ctl.signal });
      (async () => { const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; try { for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const m = chunk.match(/^data: (.*)$/m); if (m) { try { got.push(JSON.parse(m[1])); } catch { /* ignora */ } } } } } catch { /* fechou */ } })();
      return { got, close: () => ctl.abort() };
    };
    const nudge = (tok, to, extra = {}) => call('POST', '/api/nudge', { to, ...extra }, tok);
    const reset = () => { srv.core.nudgeLast.clear(); srv.core.nudgeLog.clear(); };
    eq((await nudge(mari.t, ze.id)).s, 403, 'por padrão ninguém pode chamar a atenção de ninguém');
    ok(/não aceita/.test((await nudge(mari.t, ze.id)).j.error), 'a mensagem diz que a pessoa não aceita');
    eq((await call('GET', '/api/me', null, ze.t)).j.nudge, { mode: 'none', allow: [] }, 'a configuração padrão de quem recebe é "ninguém"');
    const set = await call('PATCH', '/api/me', { nudge: { mode: 'list', allow: [mari.id, 'naoexiste', ze.id] } }, ze.t);
    eq(set.s, 200, 'cada pessoa define quem pode chamar a atenção dela');
    eq((await call('GET', '/api/me', null, ze.t)).j.nudge, { mode: 'list', allow: [mari.id] }, 'ids inexistentes e o próprio usuário são descartados');
    eq((await call('PATCH', `/api/users/${ze.id}`, { nudge: { mode: 'all' } }, A)).s, 200, '(admin editando outro usuário não altera essa permissão)');
    eq((await call('GET', '/api/me', null, ze.t)).j.nudge.mode, 'list', 'só o dono muda a própria permissão (nem o admin)');
    const vis = (tok) => call('GET', '/api/users', null, tok).then((r) => Object.fromEntries(r.j.map((u) => [u.name, u.nudge])));
    eq((await vis(mari.t))['Zé Chamado'], true, 'a lista de usuários diz quem aceita o MEU chamado');
    eq((await vis(c1 ? B : mari.t))['Zé Chamado'], false, 'e para quem não foi liberado, não');
    eq((await nudge(mari.t, ze.id)).s, 409, 'sem estar online, não dá para chamar');
    const lz = await listen(ze.t); const lm = await listen(mari.t); const lc = await listen(B);
    await new Promise((r) => setTimeout(r, 300));
    const nt = (await call('POST', `/api/projects/${proj.id}/notes`, { title: 'Chamada' }, A)).j;
    const r1 = await nudge(mari.t, ze.id, { nid: nt.id });
    eq(r1.s, 200, 'com permissão e online: chama');
    await new Promise((r) => setTimeout(r, 400));
    const ev1 = lz.got.find((x) => x.type === 'nudge');
    ok(ev1 && ev1.to === ze.id && ev1.from === mari.id && ev1.nid === nt.id, 'quem foi chamado recebe o evento em tempo real (com a nota)');
    ok(!lm.got.some((x) => x.type === 'nudge') && !lc.got.some((x) => x.type === 'nudge'), 'ninguém mais recebe');
    const again = await nudge(mari.t, ze.id);
    ok(again.s === 429 && /Aguarde/.test(again.j.error), 'repetir logo em seguida é barrado (espera de 15 s)');
    reset();
    eq((await nudge(B, ze.id)).s, 403, 'quem não está na lista não pode (mesmo no mesmo projeto)');
    await call('PATCH', '/api/me', { nudge: { mode: 'all' } }, ze.t);
    eq((await nudge(B, ze.id)).s, 200, '"todos": qualquer pessoa do servidor que divide projeto pode');
    reset();
    eq((await nudge(ze.t, ze.id)).s, 400, 'não dá para chamar a própria atenção');
    eq((await nudge(solo.t, ze.id)).s, 403, 'sem projeto em comum não pode, mesmo que a pessoa aceite todos');
    // limite geral: no máximo 6 por minuto por quem chama
    const alvos = [];
    for (let i = 0; i < 7; i++) { const x = await mkU('Alvo ' + i); await call('PATCH', `/api/projects/${proj.id}`, { members: { [c1.id]: 'edit', [ze.id]: 'write', [mari.id]: 'write', [x.id]: 'write', ...Object.fromEntries(alvos.map((a) => [a.id, 'write'])) } }, A); await call('PATCH', '/api/me', { nudge: { mode: 'all' } }, x.t); alvos.push(x); }
    const ls = []; for (const a of alvos) ls.push(await listen(a.t));
    await new Promise((r) => setTimeout(r, 300));
    reset();
    const rs = []; for (const a of alvos) rs.push((await nudge(mari.t, a.id)).s);
    eq(rs, [200, 200, 200, 200, 200, 200, 429], 'no máximo 6 chamadas por minuto por pessoa');
    await call('PATCH', '/api/me', { nudge: { mode: 'none' } }, ze.t);
    reset();
    eq((await nudge(mari.t, ze.id)).s, 403, 'voltar para "ninguém" bloqueia de novo');
    for (const l of [lz, lm, lc, ...ls]) l.close();
  }

  console.log('10) reiniciar o servidor mantém os dados');
  await srv.close();
  await new Promise((r) => setTimeout(r, 300)); // deixa o cliente descartar as conexões antigas
  const srv2 = startServer({ dir, port: 0, host: '127.0.0.1' });
  const p2 = await srv2.listen();
  const again = await (await fetch(`http://127.0.0.1:${p2}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Matheus', password: 'senhaforte1' }) })).json();
  ok(again.token, 'login depois de reiniciar');
  const nl = await (await fetch(`http://127.0.0.1:${p2}/api/projects/${proj.id}/notes`, { headers: { Authorization: 'Bearer ' + again.token } })).json();
  ok(nl.some((n) => n.title === 'Pagamento'), 'a nota continua lá');
  ok(fs.existsSync(path.join(dir, 'events.jsonl')) && fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').includes('segment.edit'), 'auditoria registrada em events.jsonl');
  await srv2.close();
  console.log(`\n${pass} verificações ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e.stack, e.cause && e.cause.stack); process.exit(1); });
