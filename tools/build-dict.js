// Gera os dicionários compactos do corretor (dict/pt-BR.bin e dict/en.bin) a partir dos .dic do Hunspell (tools/dict-src).
//   node tools/build-dict.js
// Formato (tudo alinhado em 4 bytes):  "TTD1" | tamanho do JSON | JSON {n, dataLen, flags:[...]} | offsets (n+1) × uint32 |
// índice de flags n × uint16 (completado até múltiplo de 4) | palavras em UTF-8 coladas, em ordem de bytes (busca binária).
const fs = require('fs');
const path = require('path');

function build(srcDic, outBin) {
  const lines = fs.readFileSync(srcDic, 'utf8').split(/\r?\n/);
  const map = new Map(); // palavra -> flags (junta linhas repetidas)
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i]; if (!ln || ln[0] === '#') continue;
    const sp = ln.search(/[\s\t]/); const head = sp < 0 ? ln : ln.slice(0, sp);
    const sl = head.indexOf('/');
    const w = sl < 0 ? head : head.slice(0, sl); const fl = sl < 0 ? '' : head.slice(sl + 1);
    if (w) map.set(w, (map.get(w) || '') + fl);
  }
  const words = [...map.keys()].map((w) => ({ w, b: Buffer.from(w, 'utf8') })).sort((a, b) => Buffer.compare(a.b, b.b));
  const flagTable = ['']; const flagIdx = new Map([['', 0]]);
  const n = words.length;
  const offs = new Uint32Array(n + 1); const fidx = new Uint16Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    offs[i] = total; total += words[i].b.length;
    const f = map.get(words[i].w);
    if (!flagIdx.has(f)) { flagIdx.set(f, flagTable.length); flagTable.push(f); }
    fidx[i] = flagIdx.get(f);
  }
  offs[n] = total;
  if (flagTable.length > 65535) throw new Error('flags demais');
  const json = Buffer.from(JSON.stringify({ n, dataLen: total, flags: flagTable }), 'utf8');
  const jsonPad = (4 - (json.length % 4)) % 4;
  const fidxBytes = Buffer.from(fidx.buffer, fidx.byteOffset, fidx.byteLength);
  const fidxPad = (4 - (fidxBytes.length % 4)) % 4;
  const head = Buffer.alloc(8); head.write('TTD1', 0, 'latin1'); head.writeUInt32LE(json.length + jsonPad, 4);
  const out = Buffer.concat([head, json, Buffer.alloc(jsonPad), Buffer.from(offs.buffer), fidxBytes, Buffer.alloc(fidxPad), Buffer.concat(words.map((x) => x.b))]);
  fs.writeFileSync(outBin, out);
  console.log(`${path.basename(outBin)}: ${n} palavras, ${flagTable.length} combinações de flags, ${(out.length / 1048576).toFixed(2)} MB`);
}

const root = path.join(__dirname, '..');
build(path.join(__dirname, 'dict-src', 'pt-BR.dic'), path.join(root, 'dict', 'pt-BR.bin'));
build(path.join(__dirname, 'dict-src', 'en.dic'), path.join(root, 'dict', 'en.bin'));
