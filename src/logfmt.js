// Formata automaticamente logs de integração colados no editor:
//   [requesicao](url): {"a":1}                → o JSON vira um bloco ````JSON formatado
//   [consulta](nome): select …  (várias linhas) → um bloco ````SQL com a consulta formatada
//   SQL (título): update …  (várias linhas)    → idem (o bloco acaba na linha em branco ou em "Registros: …")
// O resto do texto fica como está; blocos que já estão numa cerca ```` são deixados quietos (dá para rodar de novo).
import { formatSql } from './sqlfmt.js';

const HDR = /^(\[[^\]\n]+\]\([^)\n]*\):|SQL \([^)\n]*\):)[ \t]*(.*)$/;
const SQL_START = /^\s*(select|with|insert|update|delete|create|alter|drop|merge|truncate|declare|call)\b/i;
const FENCE = '````';
const OP_ALONE = /^\s*(union(\s+all)?|intersect|except)\s*$/i;
// consulta com UNION/INTERSECT/EXCEPT sozinho na linha: cada parte é formatada separadamente (o formatador, ao ver quebras, só as preserva)
function fmtBody(body, opts) {
  const o = { indent: opts.sqlIndent || 4, caseKw: opts.caseKw };
  if (!body.some((l) => OP_ALONE.test(l))) return formatSql(body.join('\n'), o);
  const parts = []; let cur = [];
  for (const l of body) { if (OP_ALONE.test(l)) { parts.push(formatSql(cur.join('\n'), o), l.trim()); cur = []; } else cur.push(l); }
  parts.push(formatSql(cur.join('\n'), o));
  return parts.join('\n');
}

const isHeaderWithBody = (line) => { const m = HDR.exec(line); return !!m && (SQL_START.test(m[2]) || /^[{[]/.test(m[2].trim())); };
const looksLikeLog = (text) => /^(\[[^\]\n]+\]\([^)\n]*\):|SQL \([^)\n]*\):)[ \t]*(\{|\[|select\b|with\b|insert\b|update\b|delete\b)/im.test(text);

export const hasLog = looksLikeLog;

// opts: { indent (JSON), sqlIndent, caseKw }  →  { text, blocks: { sql, json } }
export function formatLog(text, opts = {}) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = []; const stats = { sql: 0, json: 0 };
  const jsonIndent = opts.indent ?? 2;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // cerca já existente: copia até fechar
    const fm = /^(`{3,}|~{3,})/.exec(line);
    if (fm) {
      out.push(line); i++;
      while (i < lines.length && !lines[i].startsWith(fm[1])) out.push(lines[i++]);
      if (i < lines.length) out.push(lines[i++]);
      continue;
    }
    const m = HDR.exec(line);
    if (m) {
      const rest = m[2].trim();
      if (/^[{[]/.test(rest)) {
        try {
          const pretty = JSON.stringify(JSON.parse(rest), null, jsonIndent);
          out.push(m[1] + ' ', FENCE + 'JSON', pretty, FENCE); stats.json++; i++; continue;
        } catch { /* não é JSON válido: deixa como está */ }
      } else if (SQL_START.test(rest)) {
        const body = [rest]; let j = i + 1;
        const SETOP = /^\s*(union(\s+all)?|intersect|except)\b/i;
        const stop = (l) => /^Registros:/i.test(l) || isHeaderWithBody(l) || /^(`{3,}|~{3,})/.test(l);
        while (j < lines.length && !stop(lines[j])) {
          if (lines[j].trim() === '') { // linha em branco no meio da consulta: só continua se vier UNION/INTERSECT/EXCEPT (ou se o que veio antes for um deles)
            let k = j; while (k < lines.length && lines[k].trim() === '') k++;
            const prev = body[body.length - 1] || '';
            if (k < lines.length && !stop(lines[k]) && (SETOP.test(lines[k]) || (SETOP.test(prev) && prev.trim().split(/\s+/).length <= 2))) { j = k; continue; }
            break;
          }
          body.push(lines[j++]);
        }
        out.push(m[1] + ' ', FENCE + 'SQL', fmtBody(body, opts), FENCE);
        stats.sql++; i = j; continue;
      }
    }
    out.push(line); i++;
  }
  return { text: out.join('\n'), blocks: stats };
}
