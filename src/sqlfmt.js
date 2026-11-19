// Formatador de SQL próprio: nunca dá erro (aceita Postgres: ::tipo, ||, string_agg(... order by ...)), respeita as quebras de linha
// que o texto já tem e acrescenta o que falta: cada cláusula (select, from, join, where, and…) em sua linha e as subconsultas
// "(select …)" abertas, com o conteúdo recuado e o ")" fechando numa linha própria:
//
//   left join (
//       select a, b
//       from t
//       where x = 1
//   ) alias on (alias.a = base.a)
//
// opts: { indent: 4, caseKw: 'preserve' | 'upper' | 'lower' }

const KW = new Set(['select', 'from', 'where', 'group', 'by', 'order', 'having', 'limit', 'offset', 'union', 'all', 'intersect', 'except', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'natural', 'join', 'on', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'ilike', 'between', 'exists', 'as', 'case', 'when', 'then', 'else', 'end', 'distinct', 'insert', 'into', 'values', 'update', 'set', 'delete', 'returning', 'with', 'using', 'asc', 'desc', 'over', 'partition', 'conflict', 'do', 'nothing', 'create', 'table', 'alter', 'drop', 'default', 'true', 'false', 'lateral']);
const JOIN_MOD = new Set(['inner', 'left', 'right', 'full', 'cross', 'natural']);
const OPS3 = ['->>', '<=>', '!~*'];
const OPS2 = ['::', '||', '<>', '<=', '>=', '!=', '->', '=>', ':=', '~*', '!~', '<<', '>>'];

function tokenize(sql) {
  const toks = []; let i = 0; let nl = 0; let sp = false;
  const push = (t, v) => { toks.push({ t, v, nl, sp }); nl = 0; sp = false; };
  while (i < sql.length) {
    const c = sql[i]; const n = sql[i + 1];
    if (c === '\n') { nl++; sp = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { sp = true; i++; continue; }
    if (c === '-' && n === '-') { let j = sql.indexOf('\n', i); if (j < 0) j = sql.length; push('lc', sql.slice(i, j).replace(/\s+$/, '')); i = j; continue; }
    if (c === '/' && n === '*') { let j = sql.indexOf('*/', i + 2); j = j < 0 ? sql.length : j + 2; push('bc', sql.slice(i, j)); i = j; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; }
      push(c === "'" ? 'str' : 'qid', sql.slice(i, j + 1)); i = j + 1; continue;
    }
    if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { const j = sql.indexOf(m[0], i + m[0].length); const e = j < 0 ? sql.length : j + m[0].length; push('str', sql.slice(i, e)); i = e; continue; } }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      while (sql[j] === '.' && /[A-Za-z_*]/.test(sql[j + 1] || '')) { j++; if (sql[j] === '*') { j++; break; } while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++; }
      push('word', sql.slice(i, j)); i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < sql.length && /[0-9.eE]/.test(sql[j])) j++; push('num', sql.slice(i, j)); i = j; continue; }
    if (c === '(' || c === ')' || c === ',' || c === ';') { push(c, c); i++; continue; }
    const s3 = sql.slice(i, i + 3); const s2 = sql.slice(i, i + 2);
    if (OPS3.includes(s3)) { push('op', s3); i += 3; continue; }
    if (OPS2.includes(s2)) { push('op', s2); i += 2; continue; }
    push('op', c); i++;
  }
  return toks;
}

const newFrame = (sub, level, force) => ({ sub, level, force, clause: '', between: 0, cases: 0, paren: 0 });

export function formatSql(sql, opts = {}) {
  const IND = ' '.repeat(opts.indent || 4);
  const caseKw = opts.caseKw || 'preserve';
  const toks = tokenize(String(sql).replace(/\r\n/g, '\n'));
  if (!toks.length) return '';
  const lines = []; let cur = ''; let curLevel = 0;
  const flush = () => { const t = cur.replace(/\s+$/, ''); if (t) lines.push({ level: curLevel, text: t }); cur = ''; };
  const br = (level) => { flush(); curLevel = level; };
  const frames = [newFrame(false, 0, false)];
  const top = () => frames[frames.length - 1];
  // se o texto de nível mais alto já traz quebras de linha, só as preservamos; se vem numa linha só, quebra por cláusula
  let depth = 0; let topHasNl = false;
  for (let k = 1; k < toks.length; k++) { const t = toks[k]; if (t.t === '(') depth++; else if (t.t === ')') depth = Math.max(0, depth - 1); else if (depth === 0 && t.nl > 0) { topHasNl = true; break; } }
  frames[0].force = !topHasNl;
  const wordOf = (t) => (t && t.t === 'word' ? t.v.toLowerCase() : '');
  const kwText = (v) => { const l = v.toLowerCase(); if (!KW.has(l)) return v; return caseKw === 'upper' ? v.toUpperCase() : caseKw === 'lower' ? l : v; };
  const lineLevel = (f) => f.level + (f.paren > 0 ? 1 : 0);
  const put = (text, tok) => { if (cur && tok.sp) cur += ' '; cur += text; };
  let prev = null;

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]; const f = top(); const w = wordOf(t); const nxt = toks[k + 1];
    // quebra que já existia no texto (menos antes de ")", que tem regra própria)
    if (k > 0 && t.nl > 0 && t.t !== ')') br(lineLevel(f));

    if (t.t === ')') {
      if (f.paren > 0) { f.paren--; if (t.nl > 0) br(lineLevel(f)); put(')', t); prev = t; continue; }
      if (frames.length > 1) {
        const closed = frames.pop();
        if (closed.sub) { br(closed.level - 1); put(')', { sp: false }); } else put(')', t);
        prev = t; continue;
      }
      put(')', t); prev = t; continue;
    }
    if (t.t === '(') {
      const nw = wordOf(nxt);
      if (nw === 'select' || nw === 'with') { // subconsulta: abre e vai para a linha de baixo
        put('(', t); const base = curLevel; flush(); curLevel = base + 1;
        frames.push(newFrame(true, base + 1, true)); prev = t; continue;
      }
      if (f.clause === 'values' && f.paren === 0 && f.force && (wordOf(prev) === 'values' || (prev && prev.t === ','))) br(f.level + 1); // cada linha de "values (...)" em sua linha
      put('(', t); f.paren++; prev = t; continue;
    }
    if (t.t === ';') { put(';', { sp: false }); br(0); frames.length = 1; frames[0].clause = ''; frames[0].paren = 0; frames[0].force = true; prev = t; continue; }
    if (t.t === 'lc') { if (cur) cur += ' '; cur += t.v; flush(); curLevel = lineLevel(f); prev = t; continue; }
    if (t.t === ',') { cur = cur.replace(/\s+$/, '') + ','; prev = t; continue; }

    if (w && f.paren === 0) {
      const brk = () => { if (cur.trim()) br(f.level); else curLevel = f.level; };
      const pw = wordOf(prev); const nw = wordOf(nxt);
      let doBreak = false;
      if (w === 'select') { doBreak = !!prev && prev.t !== '(' && !(pw === 'distinct'); f.clause = 'select'; }
      else if (w === 'from' && f.clause !== 'delete') { doBreak = true; f.clause = 'from'; }
      else if (w === 'where' || w === 'having' || w === 'limit' || w === 'offset' || w === 'returning') { doBreak = true; f.clause = w; }
      else if (w === 'values') { doBreak = true; f.clause = 'values'; }
      else if (w === 'union' || w === 'intersect' || w === 'except') { doBreak = true; f.clause = 'union'; }
      else if ((w === 'group' || w === 'order') && nw === 'by') { doBreak = true; f.clause = w; }
      else if (JOIN_MOD.has(w) && !JOIN_MOD.has(pw)) { doBreak = true; f.clause = 'join'; }
      else if (w === 'join' && !JOIN_MOD.has(pw) && pw !== 'outer') { doBreak = true; f.clause = 'join'; }
      else if (w === 'on' && f.clause === 'join') { f.clause = 'on'; }
      else if (w === 'on' && nw === 'conflict') { doBreak = true; f.clause = 'conflict'; }
      else if (w === 'update') { f.clause = 'update'; }
      else if (w === 'delete') { f.clause = 'delete'; }
      else if (w === 'between') { f.between++; }
      else if (w === 'case') { f.cases++; }
      else if (w === 'end' && f.cases > 0) { f.cases--; }
      else if (w === 'and' || w === 'or') {
        if (w === 'and' && f.between > 0) f.between--;
        else if (f.cases === 0 && (f.clause === 'where' || f.clause === 'having' || f.clause === 'on')) doBreak = true;
      }
      if (doBreak && f.force) brk();
    }
    put(t.t === 'word' ? kwText(t.v) : t.v, t); prev = t;
  }
  flush();
  return lines.map((l) => IND.repeat(l.level) + l.text).join('\n');
}
