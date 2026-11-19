// Protege o app empacotado contra adulteração: liga as "fuses" do Electron que
//  - exigem que o app rode SÓ de dentro do app.asar (nada de pasta "app" solta com código trocado) e
//  - validam a integridade do app.asar (se alguém editar o conteúdo, ex.: a chave Pix, o programa se recusa a abrir).
// Roda no fim do empacotamento e antes de gerar o instalador (npm run installer).
//   node tools/harden.js "release-build/TT Note-win32-x64"
const fs = require('fs');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

const dir = process.argv[2];
const exe = dir && path.join(dir, 'TT Note.exe');
if (!exe || !fs.existsSync(exe)) { console.error('Uso: node tools/harden.js "<pasta do app empacotado>"'); process.exit(1); }
if (!fs.existsSync(path.join(dir, 'resources', 'app.asar'))) { console.error('harden: não achei resources/app.asar; sem asar não há o que proteger'); process.exit(1); }

flipFuses(exe, {
  version: FuseVersion.V1,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
}).then(() => console.log('harden: integridade do app.asar ligada (editar o conteúdo do app impede de abrir)'))
  .catch((e) => { console.error('harden falhou: ' + e.message); process.exit(1); });
