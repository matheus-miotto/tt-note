// Diferenças por linha entre dois textos (maior subsequência comum).
// Retorna os índices (0-based) das linhas que só existem em A (removidas) e só em B (adicionadas).
// Espaços no fim da linha são ignorados.
export function diffLines(aLines, bLines) {
  const norm = (s) => s.replace(/\s+$/, '');
  const A = aLines.map(norm);
  const B = bLines.map(norm);
  const delA = new Set();
  const addB = new Set();
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++; // começo igual
  let ea = A.length;
  let eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; } // fim igual
  const n = ea - s;
  const m = eb - s;
  const markAll = () => { for (let i = s; i < ea; i++) delA.add(i); for (let j = s; j < eb; j++) addB.add(j); };
  if (n === 0 || m === 0 || n * m > 6000000) { // nada em comum no miolo, ou grande demais para o LCS: marca o miolo todo
    markAll();
    return { delA, addB };
  }
  const w = m + 1;
  const T = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      T[i * w + j] = A[s + i] === B[s + j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[s + i] === B[s + j]) { i++; j++; }
    else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) { delA.add(s + i); i++; }
    else { addB.add(s + j); j++; }
  }
  while (i < n) { delA.add(s + i); i++; }
  while (j < m) { addB.add(s + j); j++; }
  return { delA, addB };
}
