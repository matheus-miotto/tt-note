// Enxuga o app empacotado antes de gerar o instalador, tirando só o que o TT Note não usa:
//  - traduções do Chromium de idiomas que não usamos (fica pt-BR e en-US; os outros caem no en-US)
//  - dxcompiler.dll / dxil.dll: compilador de shaders do WebGPU (o editor não usa WebGPU)
// Não mexe em nada que o app use: GPU/ANGLE (d3dcompiler, libGLESv2, swiftshader), ffmpeg, ICU, snapshots, licenças.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'locales'))) { console.error('Uso: node tools/slim.js "<pasta do app empacotado>"'); process.exit(1); }

const KEEP_LOCALES = new Set(['en-US.pak', 'pt-BR.pak']);
let freed = 0;
const remove = (p) => {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return;
  freed += fs.statSync(p).size;
  fs.rmSync(p, { force: true });
};

for (const f of fs.readdirSync(path.join(dir, 'locales'))) if (!KEEP_LOCALES.has(f)) remove(path.join(dir, 'locales', f));
for (const f of ['dxcompiler.dll', 'dxil.dll']) remove(path.join(dir, f));

console.log(`slim: ${(freed / 1048576).toFixed(1)} MB a menos (idiomas extras + WebGPU); locales restantes: ${fs.readdirSync(path.join(dir, 'locales')).join(', ')}`);
