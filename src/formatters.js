// Formatadores de código: JSON, XML, SQL, JavaScript, CSS e HTML (embutidos no app, funcionam offline).
import { formatSql } from './sqlfmt.js';
import xmlFormat from 'xml-formatter';
import beautify from 'js-beautify';

// Dialeto do SQL a partir do nome da linguagem do arquivo (ou do que estiver em "sqlDialect" no settings.json)
const SQL_DIALECTS = ['sql', 'mysql', 'mariadb', 'postgresql', 'transactsql', 'tsql', 'plsql', 'sqlite', 'bigquery', 'db2', 'hive', 'redshift', 'snowflake', 'spark', 'trino', 'n1ql', 'singlestoredb'];
export function sqlDialect(langName, setting) {
  const s = (setting || '').toLowerCase();
  if (SQL_DIALECTS.includes(s)) return s;
  const L = (langName || '').toLowerCase();
  if (/postgres/.test(L)) return 'postgresql';
  if (/maria/.test(L)) return 'mariadb';
  if (/mysql/.test(L)) return 'mysql';
  if (/ms ?sql|t-?sql|transact/.test(L)) return 'transactsql';
  if (/pl\/?sql|oracle/.test(L)) return 'plsql';
  if (/sqlite/.test(L)) return 'sqlite';
  return 'sql';
}

// SQL em uma linha: respeita strings/identificadores entre aspas e converte -- comentários em /* */
// (senão o comentário engoliria o resto da linha).
export function compactSql(sql) {
  let out = '';
  let pending = false;
  const push = (s) => { if (pending && out) out += ' '; pending = false; out += s; };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; }
      push(sql.slice(i, j + 1));
      i = j + 1;
    } else if (c === '-' && n === '-') {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = sql.length;
      const body = sql.slice(i + 2, j).replace(/\*\//g, '* /').trim();
      if (body) push(`/* ${body} */`);
      pending = true;
      i = j;
    } else if (c === '/' && n === '*') {
      const j = sql.indexOf('*/', i + 2);
      const e = j < 0 ? sql.length : j + 2;
      push(sql.slice(i, e));
      pending = true;
      i = e;
    } else if (/\s/.test(c)) {
      pending = true;
      i++;
    } else {
      push(c);
      i++;
    }
  }
  return out.trim();
}

// o: { indent, sqlLanguage, sqlCase }
export const FORMATS = {
  json: {
    label: 'JSON', fence: 'json',
    format: (t, o) => JSON.stringify(JSON.parse(t), null, o.indent),
    compact: (t) => JSON.stringify(JSON.parse(t)),
  },
  xml: {
    label: 'XML', fence: 'xml',
    format: (t, o) => {
      try {
        // estrito: avisa de XML inválido em vez de "consertar" em silêncio (com <!DOCTYPE> usa o modo tolerante)
        return xmlFormat(t.trim(), { indentation: ' '.repeat(o.indent), collapseContent: true, lineSeparator: '\n', whiteSpaceAtEndOfSelfclosingTag: false, strictMode: !/<!DOCTYPE/i.test(t) });
      } catch (e) {
        throw new Error('confira se todas as tags foram fechadas e se os nomes batem');
      }
    },
    compact: (t) => t.replace(/>\s+</g, '><').trim(), // linearizar: tira só o espaço entre as tags
  },
  sql: {
    label: 'SQL', fence: 'sql',
    format: (t, o) => formatSql(t, { indent: o.sqlIndent || 4, caseKw: o.sqlCase || 'preserve' }), // próprio: aceita Postgres, nunca dá erro e abre as subconsultas
    compact: (t) => compactSql(t),
  },
  js: {
    label: 'JavaScript', fence: 'js',
    format: (t, o) => beautify.js(t, { indent_size: o.indent, preserve_newlines: true, max_preserve_newlines: 2 }),
  },
  css: {
    label: 'CSS', fence: 'css',
    format: (t, o) => beautify.css(t, { indent_size: o.indent }),
  },
  html: {
    label: 'HTML', fence: 'html',
    format: (t, o) => beautify.html(t, { indent_size: o.indent, preserve_newlines: true, max_preserve_newlines: 2, wrap_line_length: 0 }),
  },
};

// Descobre o tipo: primeiro pelo nome da linguagem do arquivo, depois olhando o texto
export function detectKind(text, langName) {
  const L = (langName || '').toLowerCase();
  if (/json/.test(L)) return 'json';
  if (/xml|svg|xsl/.test(L)) return 'xml';
  if (/sql/.test(L)) return 'sql';
  if (/javascript|typescript|jsx|tsx/.test(L)) return 'js';
  if (/css|scss|less|sass/.test(L)) return 'css';
  if (/html/.test(L)) return 'html';
  const t = (text || '').trim();
  if (/^[[{]/.test(t)) { try { JSON.parse(t); return 'json'; } catch { /* segue */ } }
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return 'html';
  if (/^<\?xml|^<[A-Za-z][\w:.-]*[\s>/]/.test(t)) return 'xml';
  if (/^\s*(--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(select|with|insert|update|delete|create|alter|drop|merge|declare|exec|truncate)\b/i.test(t)) return 'sql';
  return null;
}
