// Sintaxes que o Sublime traz de fábrica e que não vêm no CodeMirror: Batch, Makefile, Git (commit e .gitignore), Graphviz (DOT),
// expressões regulares, reStructuredText, AppleScript, ActionScript, ASP, ERB/Rails e MATLAB. Cada uma é um analisador simples por linha.
import { StreamLanguage, LanguageDescription, LanguageSupport } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { octave } from '@codemirror/legacy-modes/mode/octave';

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

/* ───── Batch (.bat, .cmd) ───── */
const BAT_KW = words('if else for in do goto call set setlocal endlocal echo exit pause shift rem not exist defined errorlevel equ neq lss leq gtr geq start title cls cd chdir md mkdir rd rmdir del erase copy xcopy robocopy move ren rename type more dir path prompt ver vol color mode choice find findstr sort tasklist taskkill timeout assoc pushd popd');
export const batch = StreamLanguage.define({
  name: 'batch',
  startState: () => ({ bol: true }),
  token(stream, st) {
    if (stream.sol()) st.bol = true;
    if (stream.eatSpace()) return null;
    const bol = st.bol; st.bol = false;
    if (bol) {
      if (stream.match(/^@?rem(?=\s|$).*/i) || stream.match(/^::.*/)) return 'comment';
      if (stream.match(/^:[A-Za-z0-9_.\-]+/)) return 'def';
      stream.match(/^@/);
    }
    if (stream.match(/^%%?[~0-9A-Za-z_:\-*.\\$]+%?/) || stream.match(/^![A-Za-z0-9_]+!/)) return 'variable-2';
    if (stream.match(/^"(?:[^"]|"")*"?/)) return 'string';
    if (stream.match(/^(?:==|\|\||&&|[<>|&]+|[+\-*/=])/)) return 'operator';
    if (stream.match(/^\d+/)) return 'number';
    const w = stream.match(/^[A-Za-z_][\w.\-]*/);
    if (w) return BAT_KW.has(w[0].toLowerCase()) ? 'keyword' : null;
    stream.next();
    return null;
  },
});

/* ───── Makefile ───── */
const MK_DIR = words('include -include sinclude ifeq ifneq ifdef ifndef else endif define endef export unexport override vpath undefine private');
export const makefile = StreamLanguage.define({
  name: 'makefile',
  startState: () => ({ recipe: false }),
  token(stream, st) {
    if (stream.sol()) { st.recipe = stream.peek() === '\t'; if (st.recipe) { stream.next(); } }
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^\$[({][^)}]*[)}]/) || stream.match(/^\$[@<^?*%+|]/) || stream.match(/^\$\$[A-Za-z_]\w*/)) return 'variable-2';
    if (st.recipe) {
      if (stream.match(/^[@\-+]+/)) return 'operator';
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'[^']*'?/)) return 'string';
      stream.match(/^[^\s$#"']+/) || stream.next();
      return null;
    }
    if (stream.sol() || stream.string.slice(0, stream.pos).trim() === '') {
      const d = stream.match(/^[-\w.]+(?=\s|$)/);
      if (d && MK_DIR.has(d[0])) return 'keyword';
      if (d) { stream.backUp(d[0].length); }
      if (stream.match(/^[A-Za-z_][\w.]*(?=\s*(?:[:+?!]?=|::=))/)) return 'variable';
      if (stream.match(/^[^\s#=:$][^:=#$]*?(?=:(?!=))/)) return 'def'; // alvo:
    }
    if (stream.match(/^(?:::=|:=|\+=|\?=|!=|=|::|:|\|)/)) return 'operator';
    if (stream.match(/^\.[A-Z_]+/)) return 'keyword';
    stream.match(/^[^\s$#:=]+/) || stream.next();
    return null;
  },
});

/* ───── Git: mensagem de commit / rebase e .gitignore ───── */
const GIT_REBASE = words('pick p reword r edit e squash s fixup f exec x break b drop d label l reset t merge m');
export const gitCommit = StreamLanguage.define({
  name: 'git-commit',
  startState: () => ({ line: 0 }),
  token(stream, st) {
    if (stream.sol()) st.line++;
    if (stream.sol() && stream.match(/^#.*/)) return 'comment';
    if (st.line === 1 && stream.sol()) { stream.skipToEnd(); return 'header'; }
    if (stream.sol()) {
      const r = stream.match(/^([a-z]+)(?=\s+[0-9a-f]{6,})/i);
      if (r && GIT_REBASE.has(r[1].toLowerCase())) return 'keyword';
      if (stream.match(/^[A-Z][A-Za-z\-]+(?=:\s)/)) return 'property';
    }
    if (stream.match(/^[0-9a-f]{7,40}\b/)) return 'number';
    if (stream.match(/^#\d+/)) return 'number';
    if (stream.match(/^<[^>\s]+@[^>\s]+>/)) return 'link';
    stream.next();
    return null;
  },
});
export const gitIgnore = StreamLanguage.define({
  name: 'gitignore',
  token(stream) {
    if (stream.sol() && stream.match(/^#.*/)) return 'comment';
    if (stream.sol() && stream.match(/^!/)) return 'operator';
    if (stream.match(/^\*\*|^[*?]/)) return 'keyword';
    if (stream.match(/^\[[^\]]*\]/)) return 'string-2';
    if (stream.match(/^\/+/)) return 'bracket';
    stream.next();
    return null;
  },
});

/* ───── Graphviz (DOT) ───── */
const DOT_KW = words('strict graph digraph subgraph node edge');
export const dot = StreamLanguage.define({
  name: 'dot',
  startState: () => ({ block: false }),
  token(stream, st) {
    if (st.block) { if (stream.skipTo('*/')) { stream.match('*/'); st.block = false; } else stream.skipToEnd(); return 'comment'; }
    if (stream.eatSpace()) return null;
    if (stream.match('/*')) { st.block = true; if (stream.skipTo('*/')) { stream.match('*/'); st.block = false; } else stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^\/\/.*/) || (stream.sol() && stream.match(/^#.*/))) return 'comment';
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^<[^>]*>/)) return 'string-2';
    if (stream.match(/^(?:->|--)/)) return 'operator';
    if (stream.match(/^[=;,:]/)) return 'operator';
    if (stream.match(/^[{}\[\]]/)) return 'bracket';
    if (stream.match(/^-?(?:\d+\.?\d*|\.\d+)/)) return 'number';
    const w = stream.match(/^[A-Za-z_][\w]*/);
    if (w) {
      if (DOT_KW.has(w[0].toLowerCase())) return 'keyword';
      if (stream.match(/^(?=\s*=)/)) return 'property';
      return 'variable';
    }
    stream.next();
    return null;
  },
});

/* ───── Expressões regulares ───── */
export const regex = StreamLanguage.define({
  name: 'regex',
  token(stream) {
    if (stream.match(/^\\[\s\S]/)) return 'string-2';
    if (stream.match(/^\[\^?(?:\\.|[^\]\\])*\]?/)) return 'string';
    if (stream.match(/^\(\?(?:[:=!>]|<[=!]|<\w+>|P<\w+>|#[^)]*|[imsxu-]+)/)) return 'keyword';
    if (stream.match(/^[()]/)) return 'bracket';
    if (stream.match(/^(?:[*+?]|\{\d+(?:,\d*)?\})\??/)) return 'operator';
    if (stream.match(/^[\^$]/)) return 'meta';
    if (stream.match(/^\|/)) return 'operator';
    if (stream.match(/^\./)) return 'atom';
    stream.next();
    return null;
  },
});

/* ───── reStructuredText ───── */
export const rst = StreamLanguage.define({
  name: 'rst',
  token(stream) {
    if (stream.sol()) {
      if (stream.match(/^([=\-~`#"'^+*:._])\1{2,}\s*$/)) return 'header';
      if (stream.match(/^\.\.\s+[\w\-+:.]+::/)) return 'keyword';
      if (stream.match(/^\.\.\s+_[^:]+:/)) return 'def';
      if (stream.match(/^\.\.(?:\s.*)?$/)) return 'comment';
      if (stream.match(/^\s*(?:[-*+•]|\d+[.)]|#[.)]|[a-z][.)])\s/i)) return 'meta';
      if (stream.match(/^:[^:\s][^:]*:(?=\s|$)/)) return 'property';
    }
    if (stream.match(/^``[^`]+``/)) return 'string';
    if (stream.match(/^\*\*[^*]+\*\*/)) return 'strong';
    if (stream.match(/^\*[^*\s][^*]*\*/)) return 'em';
    if (stream.match(/^:[\w\-+.]+:`[^`]*`/)) return 'keyword';
    if (stream.match(/^`[^`]+`__?/)) return 'link';
    if (stream.match(/^https?:\/\/[^\s<>]+/)) return 'link';
    stream.next();
    return null;
  },
});

/* ───── AppleScript ───── */
const AS_KW = words('tell end if then else repeat with without times while until from to by exit return set get copy put into on of in the a an is are was were be and or not contains does equal equals begin script property global local try error considering ignoring using terms from every first last middle some item items application activate run open close delay display dialog say log beep ask choose script use given continue');
export const applescript = StreamLanguage.define({
  name: 'applescript',
  startState: () => ({ block: 0 }),
  token(stream, st) {
    if (st.block) {
      while (!stream.eol()) { if (stream.match('(*')) st.block++; else if (stream.match('*)')) { st.block--; if (!st.block) return 'comment'; } else stream.next(); }
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('(*')) { st.block = 1; while (!stream.eol()) { if (stream.match('(*')) st.block++; else if (stream.match('*)')) { st.block--; if (!st.block) break; } else stream.next(); } return 'comment'; }
    if (stream.match(/^--.*/) || stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\|[^|]*\|/)) return 'variable';
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/^(?:true|false|missing value|null|pi|return|tab|space|quote)\b/)) return 'atom';
    if (stream.match(/^[«»¬≠≤≥÷×&=<>+\-*/^]/)) return 'operator';
    const w = stream.match(/^[A-Za-z_][\w]*/);
    if (w) return AS_KW.has(w[0].toLowerCase()) ? 'keyword' : null;
    stream.next();
    return null;
  },
});

const lang = (name, ext, support, o = {}) => LanguageDescription.of({ name, extensions: ext, alias: o.alias || [], filename: o.filename, load: async () => support() });
export const extraLanguages = [
  lang('Batch File', ['bat', 'cmd'], () => new LanguageSupport(batch), { alias: ['batch', 'bat', 'cmd'] }),
  lang('Makefile', ['mk', 'mak'], () => new LanguageSupport(makefile), { filename: /^(GNUmakefile|Makefile|makefile)$/, alias: ['make'] }),
  lang('Git Commit', [], () => new LanguageSupport(gitCommit), { filename: /^(COMMIT_EDITMSG|MERGE_MSG|TAG_EDITMSG|SQUASH_MSG|git-rebase-todo)$/, alias: ['git'] }),
  lang('Git Ignore', ['gitignore', 'dockerignore', 'npmignore'], () => new LanguageSupport(gitIgnore), { filename: /^\.(gitignore|dockerignore|npmignore|gitattributes)$/, alias: ['gitignore'] }),
  lang('Graphviz (DOT)', ['dot', 'gv'], () => new LanguageSupport(dot), { alias: ['graphviz'] }),
  lang('Regular Expression', ['regex', 'regexp'], () => new LanguageSupport(regex), { alias: ['regex'] }),
  lang('reStructuredText', ['rst', 'rest'], () => new LanguageSupport(rst), { alias: ['rst'] }),
  lang('AppleScript', ['applescript', 'scpt'], () => new LanguageSupport(applescript)),
  lang('ActionScript', ['as'], () => javascript({ typescript: true })),
  lang('ASP', ['asp', 'aspx', 'ashx'], () => html({ matchClosingTags: true, autoCloseTags: true })),
  lang('HTML (Rails)', ['erb', 'rhtml', 'html.erb'], () => html({ matchClosingTags: true, autoCloseTags: true })),
  lang('MATLAB', ['mlx'], () => new LanguageSupport(StreamLanguage.define(octave)), { alias: ['matlab'] }),
];
