// Versionamento automático: 1.{melhorias}.{ajustes}
//   npm run melhoria -- "novo: o que há de novo | melhoria: o que melhorou"   -> 1.(m+1).0   (zera os ajustes)
//   npm run ajuste   -- "o que foi corrigido"                                  -> 1.m.(a+1)
//   npm run versao                                                             -> mostra a versão atual
// Vários itens se separam por " | ". Cada item pode começar com "novo:", "melhoria:" ou "correção:"
// (sem prefixo: "novo" numa melhoria e "correção" num ajuste).
// Atualiza package.json e novidades.json (a lista "Novidades" que o app mostra) e regenera o CHANGELOG.md.
const fs = require('fs');

const [, , kind, ...rest] = process.argv;
const msg = rest.join(' ').trim();
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const m = /^1\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!m) { console.error(`Versão "${pkg.version}" fora do formato 1.melhorias.ajustes`); process.exit(1); }
let [melhorias, ajustes] = [+m[1], +m[2]];

if (kind !== 'melhoria' && kind !== 'ajuste') {
  console.log(`Versão atual: ${pkg.version}  (${melhorias} melhorias, ${ajustes} ajustes desde a última melhoria)`);
  process.exit(0);
}
if (!msg) { console.error(`Descreva a mudança:  npm run ${kind} -- "texto"`); process.exit(1); }

if (kind === 'melhoria') { melhorias++; ajustes = 0; } else { ajustes++; }
const version = `1.${melhorias}.${ajustes}`;
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

const d = new Date();
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const padrao = kind === 'melhoria' ? 'novo' : 'correção';
const items = msg.split('|').map((s) => s.trim()).filter(Boolean).map((s) => {
  const t = /^(novo|melhoria|correção|correcao)\s*:\s*([\s\S]+)$/i.exec(s);
  return t ? { tipo: t[1].toLowerCase().replace('correcao', 'correção'), texto: t[2].trim() } : { tipo: padrao, texto: s };
});

const data = fs.existsSync('novidades.json') ? JSON.parse(fs.readFileSync('novidades.json', 'utf8')) : [];
data.unshift({ version, date, items });
fs.writeFileSync('novidades.json', JSON.stringify(data, null, 2) + '\n');

// CHANGELOG.md é gerado a partir de novidades.json
const rotulo = { novo: 'Novo', melhoria: 'Melhoria', 'correção': 'Correção' };
let log = '# Histórico de versões\n\nFormato da versão: `1.{melhorias}.{ajustes}` — melhoria = funcionalidade nova (zera os ajustes); ajuste = correção.\nGerado a partir de `novidades.json` (a lista que o app mostra em "Novidades").\n\n';
for (const e of data) {
  log += `## ${e.version} — ${e.date}\n` + e.items.map((i) => `- **${rotulo[i.tipo] || i.tipo}:** ${i.texto}`).join('\n') + '\n\n';
}
fs.writeFileSync('CHANGELOG.md', log);
console.log(`${kind === 'melhoria' ? 'Melhoria' : 'Ajuste'} registrado → versão ${version} (${items.length} item(ns) em novidades.json)`);
