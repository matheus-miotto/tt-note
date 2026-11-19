// Testes da prévia de links (usa um servidor HTTP local de mentira)
'use strict';
const http = require('http');
const { fetchPreview, privateIp } = require('./linkpreview');
let fail = 0;
const t = (nome, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log((ok ? 'ok   ' : 'ERRO ') + nome + (ok ? '' : ` -> obtido ${JSON.stringify(got)} esperado ${JSON.stringify(want)}`)); };
const srv = http.createServer((req, res) => {
  if (req.url === '/a') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end('<html><head><title>Ignorado</title><meta property="og:title" content="Título &amp; legal"><meta property="og:description" content="Descrição  longa"><meta property="og:image" content="/img.png"><meta property="og:site_name" content="Meu Site"></head></html>'); }
  if (req.url === '/b') { res.setHeader('Content-Type', 'text/html'); return res.end('<title>So titulo</title>'); }
  if (req.url === '/r') { res.statusCode = 302; res.setHeader('Location', '/b'); return res.end(); }
  if (req.url === '/i.png') { res.setHeader('Content-Type', 'image/png'); return res.end(Buffer.from([1, 2, 3])); }
  if (req.url === '/pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.end('x'); }
  res.statusCode = 404; res.end('nao');
});
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const o = { allowPrivate: true };
  t('IPs privados bloqueados', ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '8.8.8.8', '2606:4700::1111'].map(privateIp), [true, true, true, true, true, true, true, true, false, false]);
  t('por padrão não acessa endereço local', await fetchPreview(base + '/a?priv'), null);
  t('protocolo file: recusado', await fetchPreview('file:///etc/passwd', o), null);
  t('usuário na URL recusado', await fetchPreview('http://a:b@127.0.0.1/', o), null);
  const a = await fetchPreview(base + '/a', o);
  t('og:title com entidade', a.title, 'Título & legal');
  t('og:description', a.description, 'Descrição longa');
  t('imagem relativa vira absoluta', a.image, base + '/img.png');
  t('nome do site', a.site, 'Meu Site');
  t('usa <title> quando não há og', (await fetchPreview(base + '/b', o)).title, 'So titulo');
  t('segue redirecionamento', (await fetchPreview(base + '/r', o)).title, 'So titulo');
  t('link de imagem vira miniatura', (await fetchPreview(base + '/i.png', o)).image, base + '/i.png');
  t('tipo sem prévia (pdf)', await fetchPreview(base + '/pdf', o), null);
  t('404', await fetchPreview(base + '/x', o), null);
  srv.close();
  console.log(fail ? `\n${fail} ERRO(S)` : '\nTudo certo');
  process.exit(fail ? 1 : 0);
})();
