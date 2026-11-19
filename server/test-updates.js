'use strict';
// Atualizações do app pelo servidor:  node server/test-updates.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('./index');
const updates = require('./updates');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALHOU:', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)})`);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttupd-'));
  const srv = startServer({ dir, port: 0, host: '127.0.0.1', admin: ['Matheus', 'senhaforte1'] });
  const port = await srv.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body, token, raw) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(raw ? raw.headers : { 'Content-Type': 'application/json' }) }, body: raw ? raw.body : body == null ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* sem json */ }
    return { s: r.status, j };
  };
  const A = (await call('POST', '/api/login', { name: 'Matheus', password: 'senhaforte1' })).j.token;
  await call('POST', '/api/users', { name: 'Colega', password: 'colega1234' }, A);
  const C = (await call('POST', '/api/login', { name: 'Colega', password: 'colega1234' })).j.token;
  const fake = (n) => Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(1.5 * 1024 * 1024 + n)]);
  const raw = (b) => ({ headers: { 'Content-Type': 'application/octet-stream' }, body: b });

  console.log('1) comparar versões');
  ok(updates.compare('1.20.0', '1.19.9') > 0 && updates.compare('1.19.1', '1.19.1') === 0 && updates.compare('1.9.0', '1.10.0') < 0 && updates.compare('2.0.0', '1.99.99') > 0, 'ordem numérica (1.9.0 < 1.10.0)');

  console.log('2) publicar (só administrador)');
  eq((await call('GET', '/api/app/latest', null, C)).j, { version: null }, 'sem nada publicado');
  eq((await call('GET', '/api/app/latest')).s, 401, 'precisa estar logado');
  const b1 = fake(1);
  eq((await call('POST', '/api/app/publish?version=1.19.2', null, C, raw(b1))).s, 403, 'colega não publica');
  eq((await call('POST', '/api/app/publish?version=abc', null, A, raw(b1))).s, 400, 'versão inválida');
  eq((await call('POST', '/api/app/publish?version=1.19.2', null, A, raw(Buffer.alloc(5000, 1)))).s, 400, 'arquivo pequeno demais');
  eq((await call('POST', '/api/app/publish?version=1.19.2', null, A, raw(Buffer.concat([Buffer.from('PK'), crypto.randomBytes(2 * 1024 * 1024)])))).s, 400, 'não é um .exe');
  const p1 = await call('POST', '/api/app/publish?version=1.19.2', null, A, raw(b1));
  eq(p1.s, 200, 'administrador publica');
  eq(p1.j.sha256, crypto.createHash('sha256').update(b1).digest('hex'), 'o servidor calcula o hash do arquivo recebido');

  console.log('3) todos veem e baixam');
  const l = (await call('GET', '/api/app/latest', null, C)).j;
  eq([l.version, l.size], ['1.19.2', b1.length], 'colega vê a versão mais nova');
  const dl = await fetch(base + '/api/app/download', { headers: { Authorization: 'Bearer ' + C } });
  const got = Buffer.from(await dl.arrayBuffer());
  eq([dl.status, crypto.createHash('sha256').update(got).digest('hex') === l.sha256], [200, true], 'download completo e idêntico (hash confere)');
  eq((await fetch(base + '/api/app/download')).status, 401, 'download exige login');
  {
    const H = { headers: { Authorization: 'Bearer ' + C } };
    const rng = async (r) => fetch(base + '/api/app/download', { headers: { Authorization: 'Bearer ' + C, Range: r } });
    const r1 = await rng('bytes=0-99'); const b1r = Buffer.from(await r1.arrayBuffer());
    eq([r1.status, r1.headers.get('content-range'), b1r.length, b1r.equals(got.subarray(0, 100))], [206, `bytes 0-99/${got.length}`, 100, true], 'Range: primeiros 100 bytes');
    const r2 = await rng(`bytes=${got.length - 50}-`); const b2r = Buffer.from(await r2.arrayBuffer());
    eq([r2.status, b2r.length, b2r.equals(got.subarray(got.length - 50))], [206, 50, true], 'Range aberto até o fim');
    const r3 = await rng('bytes=-30'); const b3r = Buffer.from(await r3.arrayBuffer());
    eq([r3.status, b3r.equals(got.subarray(got.length - 30))], [206, true], 'Range dos últimos 30 bytes');
    const r4 = await rng(`bytes=${got.length - 10}-${got.length + 999}`); const b4r = Buffer.from(await r4.arrayBuffer());
    eq([r4.status, b4r.length], [206, 10], 'fim além do arquivo é cortado');
    eq((await rng(`bytes=${got.length + 5}-`)).status, 416, 'começo além do arquivo: 416');
    const full = await fetch(base + '/api/app/download', H);
    eq([full.status, full.headers.get('accept-ranges')], [200, 'bytes'], 'sem Range continua igual e avisa que aceita');
    await full.arrayBuffer();
    // pedaços colados dão o arquivo inteiro
    const half = Math.floor(got.length / 2);
    const pa = Buffer.from(await (await rng(`bytes=0-${half - 1}`)).arrayBuffer()); const pb = Buffer.from(await (await rng(`bytes=${half}-`)).arrayBuffer());
    eq(crypto.createHash('sha256').update(Buffer.concat([pa, pb])).digest('hex') === l.sha256, true, 'dois pedaços juntos conferem com o hash');
  }

  console.log('4) só guarda os 2 últimos instaladores');
  await call('POST', '/api/app/publish?version=1.19.3', null, A, raw(fake(2)));
  await new Promise((r) => setTimeout(r, 30));
  await call('POST', '/api/app/publish?version=1.19.4', null, A, raw(fake(3)));
  const files = fs.readdirSync(path.join(dir, 'updates')).filter((f) => f.endsWith('.exe')).sort();
  eq(files, ['TT Note Setup 1.19.3.exe', 'TT Note Setup 1.19.4.exe'], 'ficam os dois mais novos');
  eq((await call('GET', '/api/app/latest', null, C)).j.version, '1.19.4', 'a última publicada vale');
  ok(!fs.readdirSync(path.join(dir, 'updates')).some((f) => f.startsWith('.upload-')), 'sem sobras de upload');
  ok(fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').includes('app.publish'), 'publicação fica na auditoria');

  console.log('5) publicação local (arquivo direto na pasta, sem rede)');
  const tmp = path.join(os.tmpdir(), 'ttupd-local.exe');
  fs.writeFileSync(tmp, fake(9));
  const loc = await updates.ingest(dir, tmp, '1.20.0', false);
  eq((await call('GET', '/api/app/latest', null, C)).j.version, '1.20.0', 'cópia local vira a mais nova');
  ok(fs.existsSync(tmp), 'o arquivo original é mantido');
  fs.unlinkSync(tmp);

  console.log('3) envio em partes com retomada');
  {
    const big = fake(77); // ~1,5 MB
    const id = crypto.createHash('sha1').update('teste-partes').digest('hex').slice(0, 24);
    const q = `upload=${id}`;
    const cut = 700000;
    eq((await call('GET', `/api/app/publish-status?${q}`, null, C)).s, 403, 'colega não consulta o envio');
    eq((await call('GET', `/api/app/publish-status?${q}`, null, A)).j, { received: 0 }, 'começa com 0 bytes');
    eq((await call('POST', `/api/app/publish-chunk?upload=zz&offset=0`, null, A, raw(big.subarray(0, 10)))).s, 400, 'identificador inválido');
    eq((await call('POST', `/api/app/publish-chunk?${q}&offset=0`, null, C, raw(big.subarray(0, cut)))).s, 403, 'colega não envia partes');
    eq((await call('POST', `/api/app/publish-chunk?${q}&offset=0`, null, A, raw(big.subarray(0, cut)))).j, { received: cut }, 'primeira parte chega');
    const wrong = await call('POST', `/api/app/publish-chunk?${q}&offset=5`, null, A, raw(big.subarray(5, 100)));
    ok(wrong.s === 409 && wrong.j.received === cut, 'parte fora de lugar volta 409 dizendo onde o servidor está');
    // "queda de conexão": o app pergunta quanto chegou e continua dali
    eq((await call('GET', `/api/app/publish-status?${q}`, null, A)).j, { received: cut }, 'o servidor lembra o que já chegou');
    eq((await call('POST', `/api/app/publish-chunk?${q}&offset=${cut}`, null, A, raw(big.subarray(cut)))).j, { received: big.length }, 'continua de onde parou');
    eq((await call('POST', `/api/app/publish-finish?${q}&version=1.30.0&size=${big.length + 5}`, null, A)).s, 409, 'tamanho diferente do esperado não publica');
    eq((await call('POST', `/api/app/publish-finish?${q}&version=abc`, null, A)).s, 400, 'versão inválida no fim');
    const fin = await call('POST', `/api/app/publish-finish?${q}&version=1.30.0&size=${big.length}`, null, A);
    ok(fin.s === 200 && fin.j.version === '1.30.0' && fin.j.size === big.length, 'publica a versão e confere o tamanho');
    const dl = await fetch(`${base}/api/app/download`, { headers: { Authorization: 'Bearer ' + C } });
    const got = Buffer.from(await dl.arrayBuffer());
    ok(got.equals(big), 'o arquivo baixado é idêntico ao enviado em partes');
    eq((await call('POST', `/api/app/publish-finish?${q}&version=1.30.1`, null, A)).s, 404, 'envio já concluído não existe mais');
  }

  await srv.close();
  console.log(`\n${pass} verificações ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
