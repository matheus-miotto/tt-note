// Gera o hash SHA-256 do instalador da versão atual (para quem baixa conferir que o arquivo é o oficial).
// Grava "installer/TT Note Setup X.exe.sha256" e mantém a lista "installer/SHA256SUMS.txt" com todas as versões.
//   node tools/hash.js            (roda sozinho no fim de "npm run installer")
// Para conferir no Windows:  certutil -hashfile "TT Note Setup X.exe" SHA256   (ou PowerShell: Get-FileHash "TT Note Setup X.exe")
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'installer');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const name = `TT Note Setup ${version}.exe`;
const file = path.join(dir, name);
if (!fs.existsSync(file)) { console.error('Instalador não encontrado: ' + file); process.exit(1); }
const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(file + '.sha256', `${hash} *${name}\n`);
const sums = path.join(dir, 'SHA256SUMS.txt');
const lines = fs.existsSync(sums) ? fs.readFileSync(sums, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.endsWith(' *' + name)) : [];
lines.push(`${hash} *${name}`);
lines.sort((a, b) => a.split(' *')[1].localeCompare(b.split(' *')[1], undefined, { numeric: true }));
fs.writeFileSync(sums, lines.join('\n') + '\n');
console.log(`SHA-256 de ${name}\n${hash}`);
