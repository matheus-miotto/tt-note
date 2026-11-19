// Filtros SQL a partir de uma lista (IN, NOT IN, LIKE, NOT LIKE, = com OR, BETWEEN, só a lista).
// Módulo puro (sem DOM): usado pelo editor e pelos testes.

export const FILTER_TYPES = [
  ['in', 'IN', "coluna IN ('a', 'b')"],
  ['notin', 'NOT IN', "coluna NOT IN ('a', 'b')"],
  ['like', 'LIKE (vários, com OR)', "(col LIKE '%a%' OR col LIKE '%b%')"],
  ['notlike', 'NOT LIKE (vários, com AND)', "(col NOT LIKE '%a%' AND col NOT LIKE '%b%')"],
  ['eq', '= com OR', "(col = 'a' OR col = 'b')"],
  ['between', 'BETWEEN (dois valores)', "col BETWEEN 'a' AND 'b'"],
  ['list', 'Só a lista', "'a', 'b', 'c'"],
];
export const FILTER_DEFAULTS = { quotes: 'auto', wild: 'both', layout: 'line', dedupe: true, batch: 0, cols: {} };

const unquote = (s) => {
  s = s.trim().replace(/,$/, '').trim();
  const m = /^(['"])([\s\S]*)\1$/.exec(s);
  return m ? m[2].replace(/''/g, "'") : s;
};

// Separa os valores: uma linha cada; se tudo veio numa linha só, separa por vírgula, ponto e vírgula ou tab
export function parseValues(text, dedupe = true) {
  let parts = String(text).split(/\r?\n/);
  if (parts.filter((p) => p.trim()).length <= 1) parts = String(text).split(/[,;\t]/);
  let out = parts.map(unquote).filter((s) => s !== '');
  if (dedupe) out = [...new Set(out)];
  return out;
}

const isNum = (v) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v);
const isNull = (v) => /^null$/i.test(v);
const esc = (v) => v.replace(/'/g, "''");

export function buildFilter(type, text, o = {}) {
  const opt = { ...FILTER_DEFAULTS, ...o };
  const col = ((opt.cols && opt.cols[type]) ?? opt.col ?? '').trim();
  const vals = parseValues(text, opt.dedupe);
  const warn = [];
  if (!vals.length) return { text: '', warn: ['Não há valores na seleção'] };
  const multi = opt.layout === 'lines';
  const allNum = vals.every((v) => isNum(v) || isNull(v));
  const bare = opt.quotes === 'never' || (opt.quotes === 'auto' && allNum);
  const lit = (v) => (isNull(v) ? 'NULL' : bare ? v : `'${esc(v)}'`);
  const colName = col || 'coluna';

  if (type === 'list') {
    return { text: vals.map(lit).join(multi ? '\n, ' : ', '), warn };
  }
  if (type === 'in' || type === 'notin') {
    const kw = type === 'in' ? 'IN' : 'NOT IN';
    if (vals.some(isNull)) warn.push(type === 'in' ? 'NULL dentro do IN nunca casa (use IS NULL)' : 'NULL dentro do NOT IN faz a consulta não retornar nada');
    const mk = (chunk, withCol) => {
      const items = multi ? '\n    ' + chunk.map(lit).join('\n  , ') + '\n' : chunk.map(lit).join(', ');
      return `${withCol ? colName + ' ' : ''}${kw} (${items})`;
    };
    const n = Number(opt.batch) || 0;
    if (n > 0 && vals.length > n) {
      const chunks = []; for (let i = 0; i < vals.length; i += n) chunks.push(vals.slice(i, i + n));
      const join = type === 'in' ? ' OR ' : ' AND ';
      return { text: '(' + chunks.map((c) => mk(c, true)).join(multi ? `\n${join.trim()} ` : join) + ')', warn };
    }
    if (vals.length > 1000) warn.push('Mais de 1000 itens: o Oracle recusa. Ative "dividir em lotes".');
    return { text: mk(vals, !!col), warn };
  }
  if (type === 'between') {
    if (vals.length !== 2) return { text: '', warn: ['BETWEEN precisa de exatamente 2 valores (há ' + vals.length + ')'] };
    return { text: `${col ? col + ' ' : ''}BETWEEN ${lit(vals[0])} AND ${lit(vals[1])}`, warn };
  }
  // LIKE, NOT LIKE e = : uma condição por valor
  const like = type === 'like' || type === 'notlike';
  const cond = vals.map((v) => {
    if (!like) return `${colName} = ${lit(v)}`;
    const body = esc(v);
    const pat = opt.wild === 'start' ? `${body}%` : opt.wild === 'end' ? `%${body}` : opt.wild === 'none' ? body : `%${body}%`;
    return `${colName} ${type === 'like' ? 'LIKE' : 'NOT LIKE'} '${pat}'`;
  });
  const glue = type === 'notlike' ? 'AND' : 'OR';
  const joined = cond.join(multi ? `\n${glue} ` : ` ${glue} `);
  return { text: cond.length > 1 ? `(${joined})` : joined, warn };
}
