// Snippets (como no Sublime): digite o gatilho e aperte Tab. Sintaxe do Sublime: $1, $2… são as paradas do Tab; ${1:texto} já vem
// preenchido e selecionado; $0 é onde o cursor termina. Os seus próprios ficam no settings.json em "snippets":
//   [{ "trigger": "ass", "content": "Att,\n${1:Matheus}", "scope": ["Markdown"], "description": "Assinatura" }]
import { snippet } from '@codemirror/autocomplete';

const G = {
  js: ['JavaScript', 'TypeScript', 'JSX', 'TSX', 'ActionScript', 'Vue', 'CoffeeScript'],
  py: ['Python', 'Cython'],
  html: ['HTML', 'HTML (Rails)', 'ASP', 'Vue', 'Angular Template', 'XML'],
  css: ['CSS', 'SCSS', 'Sass', 'LESS', 'Stylus'],
  md: ['Markdown'],
  sql: ['SQL', 'MySQL', 'PostgreSQL', 'MariaDB SQL', 'MS SQL', 'PLSQL', 'SQLite'],
  sh: ['Shell', 'Batch File', 'PowerShell'],
  java: ['Java', 'C#', 'Kotlin', 'Scala'],
  c: ['C', 'C++', 'Objective-C'],
  go: ['Go'], rust: ['Rust'], php: ['PHP'],
};
const S = (scope, trigger, content, description) => ({ scope, trigger, content, description });

export const BUILTIN = [
  S(null, 'lorem', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.$0', 'Texto de exemplo (Lorem ipsum)'),
  S(null, 'date', '$DATE', 'Data de hoje'),
  S(null, 'time', '$TIME', 'Hora agora'),
  S(null, 'now', '$DATETIME', 'Data e hora agora'),
  // JavaScript / TypeScript
  S(G.js, 'log', 'console.log(${1:valor});$0', 'console.log'),
  S(G.js, 'fn', 'function ${1:nome}(${2:args}) {\n\t$0\n}', 'função'),
  S(G.js, 'afn', 'const ${1:nome} = (${2:args}) => {\n\t$0\n};', 'arrow function'),
  S(G.js, 'for', 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t$0\n}', 'for'),
  S(G.js, 'forof', 'for (const ${1:item} of ${2:lista}) {\n\t$0\n}', 'for…of'),
  S(G.js, 'if', 'if (${1:condição}) {\n\t$0\n}', 'if'),
  S(G.js, 'ife', 'if (${1:condição}) {\n\t$2\n} else {\n\t$0\n}', 'if / else'),
  S(G.js, 'try', 'try {\n\t$1\n} catch (${2:erro}) {\n\t$0\n}', 'try / catch'),
  S(G.js, 'class', 'class ${1:Nome} {\n\tconstructor(${2:args}) {\n\t\t$0\n\t}\n}', 'classe'),
  S(G.js, 'imp', "import ${1:nome} from '${2:modulo}';$0", 'import'),
  S(G.js, 'af', 'async function ${1:nome}(${2:args}) {\n\t$0\n}', 'função async'),
  S(G.js, 'prom', 'new Promise((resolve, reject) => {\n\t$0\n});', 'Promise'),
  // Python
  S(G.py, 'def', 'def ${1:nome}(${2:args}):\n\t${0:pass}', 'função'),
  S(G.py, 'class', 'class ${1:Nome}:\n\tdef __init__(self${2:, args}):\n\t\t${0:pass}', 'classe'),
  S(G.py, 'if', 'if ${1:condição}:\n\t$0', 'if'),
  S(G.py, 'ife', 'if ${1:condição}:\n\t$2\nelse:\n\t$0', 'if / else'),
  S(G.py, 'for', 'for ${1:item} in ${2:lista}:\n\t$0', 'for'),
  S(G.py, 'while', 'while ${1:condição}:\n\t$0', 'while'),
  S(G.py, 'try', 'try:\n\t$1\nexcept ${2:Exception} as ${3:e}:\n\t$0', 'try / except'),
  S(G.py, 'with', 'with ${1:open(arquivo)} as ${2:f}:\n\t$0', 'with'),
  S(G.py, 'main', 'if __name__ == "__main__":\n\t${0:main()}', 'ponto de entrada'),
  S(G.py, 'print', 'print(${1:valor})$0', 'print'),
  // HTML
  S(G.html, 'html:5', '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n\t<meta charset="utf-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<title>${1:Título}</title>\n</head>\n<body>\n\t$0\n</body>\n</html>', 'documento HTML5'),
  S(G.html, 'div', '<div${1: class="${2:classe}"}>\n\t$0\n</div>', 'div'),
  S(G.html, 'a', '<a href="${1:#}">${2:texto}</a>$0', 'link'),
  S(G.html, 'img', '<img src="${1:arquivo}" alt="${2:descrição}">$0', 'imagem'),
  S(G.html, 'ul', '<ul>\n\t<li>${1:item}</li>$0\n</ul>', 'lista'),
  S(G.html, 'table', '<table>\n\t<thead>\n\t\t<tr><th>${1:título}</th></tr>\n\t</thead>\n\t<tbody>\n\t\t<tr><td>${2:valor}</td></tr>\n\t</tbody>\n</table>$0', 'tabela'),
  S(G.html, 'script', '<script${1: src="${2:arquivo.js}"}>$0</script>', 'script'),
  S(G.html, 'link', '<link rel="stylesheet" href="${1:estilo.css}">$0', 'link CSS'),
  S(G.html, 'form', '<form action="${1:/}" method="${2:post}">\n\t$0\n</form>', 'formulário'),
  // CSS
  S(G.css, 'flex', 'display: flex;\nalign-items: ${1:center};\njustify-content: ${2:center};$0', 'flexbox'),
  S(G.css, 'grid', 'display: grid;\ngrid-template-columns: ${1:repeat(3, 1fr)};\ngap: ${2:1rem};$0', 'grid'),
  S(G.css, 'media', '@media (max-width: ${1:768px}) {\n\t$0\n}', 'media query'),
  S(G.css, 'kf', '@keyframes ${1:nome} {\n\tfrom { $2 }\n\tto { $0 }\n}', '@keyframes'),
  // Markdown
  S(G.md, 'link', '[${1:texto}](${2:https://})$0', 'link'),
  S(G.md, 'img', '![${1:descrição}](${2:arquivo})$0', 'imagem'),
  S(G.md, 'code', '```${1:linguagem}\n$0\n```', 'bloco de código'),
  S(G.md, 'todo', '- [ ] ${1:tarefa}\n- [ ] $0', 'tarefas'),
  S(G.md, 'table', '| ${1:Coluna 1} | ${2:Coluna 2} |\n| --- | --- |\n| ${3:valor} | ${4:valor} |$0', 'tabela'),
  // SQL
  S(G.sql, 'sel', 'SELECT ${1:*}\nFROM ${2:tabela}\nWHERE ${3:condição};$0', 'SELECT'),
  S(G.sql, 'ins', 'INSERT INTO ${1:tabela} (${2:colunas})\nVALUES (${3:valores});$0', 'INSERT'),
  S(G.sql, 'upd', 'UPDATE ${1:tabela}\nSET ${2:coluna} = ${3:valor}\nWHERE ${4:condição};$0', 'UPDATE'),
  S(G.sql, 'del', 'DELETE FROM ${1:tabela}\nWHERE ${2:condição};$0', 'DELETE'),
  S(G.sql, 'join', '${1:INNER} JOIN ${2:tabela} ON ${3:a.id} = ${4:b.id}$0', 'JOIN'),
  // Shell / Batch / PowerShell
  S(G.sh, 'if', 'if [ ${1:condição} ]; then\n\t$0\nfi', 'if (shell)'),
  S(G.sh, 'for', 'for ${1:i} in ${2:lista}; do\n\t$0\ndone', 'for (shell)'),
  // Java / C# / Kotlin / Scala
  S(G.java, 'main', 'public static void main(String[] args) {\n\t$0\n}', 'main'),
  S(G.java, 'for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for'),
  // C / C++
  S(G.c, 'main', 'int main(int argc, char *argv[]) {\n\t$0\n\treturn 0;\n}', 'main'),
  S(G.c, 'for', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'for'),
  S(G.c, 'inc', '#include <${1:stdio.h}>$0', '#include'),
  // Go / Rust / PHP
  S(G.go, 'func', 'func ${1:nome}(${2:args}) ${3:error} {\n\t$0\n}', 'função'),
  S(G.go, 'iferr', 'if err != nil {\n\t${1:return err}\n}$0', 'if err != nil'),
  S(G.rust, 'fn', 'fn ${1:nome}(${2:args}) {\n\t$0\n}', 'função'),
  S(G.rust, 'impl', 'impl ${1:Tipo} {\n\t$0\n}', 'impl'),
  S(G.php, 'fn', 'function ${1:nome}(${2:args}) {\n\t$0\n}', 'função'),
  S(G.php, 'foreach', 'foreach (${1:lista} as ${2:item}) {\n\t$0\n}', 'foreach'),
];

const p2 = (n) => String(n).padStart(2, '0');
function expandVars(t) {
  const d = new Date();
  const date = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return t.replace(/\$DATETIME/g, `${date} ${time}`).replace(/\$DATE/g, date).replace(/\$TIME/g, time).replace(/\$FILENAME/g, '');
}
// Sublime → CodeMirror: $1 → ${1}, $0 → ${} (final)
export function toCm(content) {
  return expandVars(String(content)).replace(/\$0|\$\{0\}/g, '${}').replace(/\$(\d+)(?![\d{])/g, '${$1}');
}

// Snippets que valem para a linguagem (os seus ficam por cima dos de fábrica com o mesmo gatilho)
export function snippetsFor(lang, user = []) {
  const ok = (s) => !s.scope || s.scope.length === 0 || (Array.isArray(s.scope) ? s.scope : [s.scope]).some((n) => n === lang);
  const mine = (Array.isArray(user) ? user : []).filter((s) => s && s.trigger && s.content && ok(s));
  const seen = new Set(mine.map((s) => s.trigger));
  return [...mine, ...BUILTIN.filter((s) => ok(s) && !seen.has(s.trigger))];
}

// Tab depois do gatilho: expande e deixa o cursor na primeira parada (Tab pula para a próxima, Esc sai)
export function tryExpand(view, list) {
  const st = view.state; const r = st.selection.main;
  if (!r.empty) return false;
  const line = st.doc.lineAt(r.head);
  const before = line.text.slice(0, r.head - line.from);
  const m = /([\w:.\-]+)$/.exec(before);
  if (!m) return false;
  const sn = list.find((s) => s.trigger === m[1]);
  if (!sn) return false;
  snippet(toCm(sn.content))(view, null, r.head - m[1].length, r.head);
  return true;
}
export function insertSnippet(view, sn) {
  const r = view.state.selection.main;
  snippet(toCm(sn.content))(view, null, r.from, r.to);
}
