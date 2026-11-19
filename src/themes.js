// Temas: cada um define as cores da interface (variáveis CSS) e do editor (CodeMirror).
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export const mix = (a, b, k) => { // k = quanto de b (0..1)
  const x = hex(a); const y = hex(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
};
const lum = (c) => { const [r, g, b] = hex(c); return 0.299 * r + 0.587 * g + 0.114 * b; };

// [id, nome, escuro?, bg, bg2, bg3, fg, dim, accent, line, link, tag, green, red, sintaxe: palavra-chave, texto, número, comentário, função, tipo]
const RAW = [
  ['dracula', 'Dracula', 1, '#282a36', '#21222c', '#343746', '#f8f8f2', '#6272a4', '#bd93f9', '#191a21', '#ff79c6', '#f1fa8c', '#50fa7b', '#ff5555', '#ff79c6', '#f1fa8c', '#bd93f9', '#6272a4', '#50fa7b', '#8be9fd'],
  ['monokai', 'Monokai', 1, '#272822', '#1e1f1c', '#31322c', '#f8f8f2', '#8f8b73', '#66d9ef', '#171814', '#ae81ff', '#e6db74', '#a6e22e', '#f92672', '#f92672', '#e6db74', '#ae81ff', '#75715e', '#a6e22e', '#66d9ef'],
  ['nord', 'Nord', 1, '#2e3440', '#272c36', '#3b4252', '#d8dee9', '#7b88a1', '#88c0d0', '#20242c', '#b48ead', '#ebcb8b', '#a3be8c', '#bf616a', '#81a1c1', '#a3be8c', '#b48ead', '#616e88', '#88c0d0', '#8fbcbb'],
  ['tokyo-night', 'Tokyo Night', 1, '#1a1b26', '#16161e', '#24283b', '#a9b1d6', '#6a7199', '#7aa2f7', '#101014', '#bb9af7', '#e0af68', '#9ece6a', '#f7768e', '#bb9af7', '#9ece6a', '#ff9e64', '#565f89', '#7aa2f7', '#2ac3de'],
  ['gruvbox', 'Gruvbox Escuro', 1, '#282828', '#1d2021', '#3c3836', '#ebdbb2', '#928374', '#83a598', '#141617', '#d3869b', '#fabd2f', '#b8bb26', '#fb4934', '#fb4934', '#b8bb26', '#d3869b', '#928374', '#fabd2f', '#8ec07c'],
  ['solarized-dark', 'Solarized Escuro', 1, '#002b36', '#00212b', '#073642', '#93a1a1', '#657b83', '#268bd2', '#001a21', '#6c71c4', '#b58900', '#859900', '#dc322f', '#859900', '#2aa198', '#d33682', '#586e75', '#268bd2', '#b58900'],
  ['midnight', 'Meia-noite (alto contraste)', 1, '#000000', '#0a0a0a', '#1a1a1a', '#e6e6e6', '#8a8a8a', '#4fc3f7', '#000000', '#ce93d8', '#ffd54f', '#81c784', '#e57373', '#ce93d8', '#81c784', '#ffb74d', '#7a7a7a', '#4fc3f7', '#ffd54f'],
  ['sublime-mariana', 'Mariana (estilo Sublime)', 1, '#303841', '#29313a', '#3a444e', '#d8dee9', '#65737e', '#6699cc', '#20262d', '#c594c5', '#fac863', '#99c794', '#ec5f67', '#c594c5', '#99c794', '#f99157', '#65737e', '#6699cc', '#fac863'],
  ['sublime-celeste', 'Celeste (estilo Sublime)', 1, '#232a33', '#1c2229', '#2c353f', '#d6dde6', '#6f7d8c', '#5fb3b3', '#12161b', '#c594c5', '#fac863', '#99c794', '#ec5f67', '#c594c5', '#99c794', '#f99157', '#6f7d8c', '#5fb3b3', '#fac863'],
  ['sublime-sixteen', 'Sixteen (estilo Sublime)', 1, '#181818', '#111111', '#282828', '#d8d8d8', '#686868', '#7cafc2', '#0a0a0a', '#ba8baf', '#f7ca88', '#a1b56c', '#ab4642', '#ba8baf', '#a1b56c', '#dc9656', '#686868', '#7cafc2', '#f7ca88'],
  ['sublime-breakers', 'Breakers (estilo Sublime, claro)', 0, '#f7f7f7', '#ebebeb', '#e1e1e1', '#2c3e50', '#7f8c8d', '#2980b9', '#d0d0d0', '#8e44ad', '#d68910', '#27ae60', '#c0392b', '#8e44ad', '#27ae60', '#d35400', '#95a5a6', '#2980b9', '#d68910'],
  ['office-2016-black', 'Office 2016 Black (estilo DevExpress)', 1, '#262626', '#1c1c1c', '#333333', '#e6e6e6', '#9a9a9a', '#0b6fc2', '#0d0d0d', '#5aa9e6', '#f0b840', '#5cb85c', '#e05555', '#5aa9e6', '#e3a27a', '#b5cea8', '#7d9a6a', '#dcdcaa', '#4ec9b0'],
  ['wxi', 'WXI (estilo DevExpress, Windows 11)', 1, '#202020', '#191919', '#2d2d2d', '#f3f3f3', '#9d9d9d', '#4cc2ff', '#101010', '#99ebff', '#fce100', '#6ccb5f', '#ff99a4', '#4cc2ff', '#ce9178', '#b5cea8', '#7a9a68', '#dcdcaa', '#4ec9b0'],
  ['devexpress', 'Estilo DevExpress', 0, '#ffffff', '#f1f3f6', '#e4eaf3', '#1e1e1e', '#6d7783', '#3d7fd1', '#c9d3e0', '#1f6fc5', '#2f5f9f', '#2e9d4f', '#d03a3a', '#1f5fbf', '#a31515', '#098658', '#6a8a52', '#795e26', '#267f99'],
  ['devexpress-dark', 'Estilo DevExpress Escuro', 1, '#2b2b2b', '#232323', '#3a3a3a', '#e8e8e8', '#9a9a9a', '#4a90d9', '#171717', '#6cb0f0', '#7fb4e8', '#5fbf7a', '#e06060', '#6cb0f0', '#ce9178', '#b5cea8', '#7a9a65', '#dcdcaa', '#4ec9b0'],
  ['neon-sakura', 'Neon Sakura', 1, '#150b1c', '#0f0715', '#251432', '#f6e6f2', '#9a7aa8', '#ff4fa3', '#09040e', '#c792ff', '#ffd1e8', '#5cffc2', '#ff5c7a', '#ff4fa3', '#ffb3d9', '#5cf0ff', '#7d6490', '#c792ff', '#5cf0ff'],
  ['neon-sakura-light', 'Neon Sakura Claro', 0, '#fff5fa', '#fde8f2', '#f9d9ea', '#3a1f33', '#9a6f88', '#e6007e', '#f0c4dc', '#8a3ffc', '#b3125f', '#0f9d6b', '#d6264f', '#d6006f', '#a8325e', '#0a8fb0', '#a98aa0', '#7a2fe0', '#0a8fb0'],
  ['github-light', 'Claro (GitHub)', 0, '#ffffff', '#f6f8fa', '#eaeef2', '#24292f', '#6e7781', '#0969da', '#d0d7de', '#8250df', '#9a6700', '#1a7f37', '#cf222e', '#cf222e', '#0a3069', '#0550ae', '#6e7781', '#8250df', '#953800'],
  ['one-light', 'Claro (One Light)', 0, '#fafafa', '#eaeaeb', '#dfdfe0', '#383a42', '#8e8f96', '#4078f2', '#d4d4d4', '#a626a4', '#c18401', '#50a14f', '#e45649', '#a626a4', '#50a14f', '#986801', '#a0a1a7', '#4078f2', '#c18401'],
  ['solarized-light', 'Solarized Claro', 0, '#fdf6e3', '#eee8d5', '#e6dfca', '#586e75', '#93a1a1', '#268bd2', '#d3cbb1', '#6c71c4', '#b58900', '#859900', '#dc322f', '#859900', '#2aa198', '#d33682', '#93a1a1', '#268bd2', '#b58900'],
];

// Tema padrão: exatamente as cores que o app já tinha
const DEFAULT = {
  id: 'tt-dark', name: 'TT Escuro (padrão)', dark: true, builtin: true,
  vars: {
    bg: '#282c34', bg2: '#21252b', bg3: '#2c313a', fg: '#abb2bf', dim: '#7f848e', accent: '#61afef', line: '#181a1f', link: '#c678dd', tag: '#e5c07b',
    green: '#98c379', red: '#e06c75', strong: '#ffffff', hover: '#3a4150', border: '#3a3f4b', border2: '#4b5263', sel: '#3b5578', sel2: '#3b4a63', danger: '#8b2f3a', onAccent: '#1b1d23', codeov: 'rgba(0,0,0,.17)',
  },
};

function fromRaw([id, name, dark, bg, bg2, bg3, fg, dim, accent, line, link, tag, green, red, kw, str, num, com, fn, ty]) {
  const d = !!dark;
  return {
    id, name, dark: d,
    vars: {
      bg, bg2, bg3, fg, dim, accent, line, link, tag, green, red,
      strong: d ? '#ffffff' : mix(fg, '#000000', 0.55),
      hover: mix(bg, fg, d ? 0.14 : 0.1), border: mix(bg, fg, d ? 0.2 : 0.18), border2: mix(bg, fg, d ? 0.3 : 0.28),
      sel: mix(bg, accent, d ? 0.34 : 0.22), sel2: mix(bg, accent, d ? 0.24 : 0.16),
      danger: mix(bg, red, d ? 0.5 : 0.25), onAccent: lum(accent) > 140 ? '#1b1d23' : '#ffffff',
      codeov: d ? 'rgba(0,0,0,.17)' : 'rgba(0,0,0,.045)',
    },
    syn: { kw, str, num, com, fn, ty },
  };
}

export const THEMES = [DEFAULT, ...RAW.map(fromRaw)];

// ---- Tema personalizado (JSON) ----
export const CUSTOM_UI = [['bg', 'Fundo do editor'], ['bg2', 'Fundo da barra lateral'], ['bg3', 'Fundo de cartões e campos'], ['fg', 'Texto'], ['dim', 'Texto apagado'], ['accent', 'Destaque (botões, seleção)'], ['line', 'Linhas e divisórias'], ['link', 'Links'], ['tag', 'Marcações / títulos'], ['green', 'Positivo (verde)'], ['red', 'Alerta (vermelho)']];
export const CUSTOM_SYN = [['kw', 'Palavras-chave'], ['str', 'Textos (strings)'], ['num', 'Números'], ['com', 'Comentários'], ['fn', 'Funções'], ['ty', 'Tipos e tags']];
const EXTRA_VARS = ['strong', 'hover', 'border', 'border2', 'sel', 'sel2', 'danger', 'onAccent'];
const okColor = (v) => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
const norm = (v) => { v = v.trim().toLowerCase(); return v.length === 4 ? '#' + [1, 2, 3].map((i) => v[i] + v[i]).join('') : v; };
// Aceita o formato do TT Note e também o JSON de tema do Mattermost (sidebarBg, centerChannelBg…)
const MM = { bg: ['centerChannelBg'], bg2: ['sidebarBg'], bg3: ['sidebarTextHoverBg', 'sidebarHeaderBg'], fg: ['centerChannelColor'], accent: ['sidebarTextActiveBorder', 'buttonBg', 'linkColor'], link: ['linkColor'], tag: ['awayIndicator', 'mentionBg'], green: ['onlineIndicator'], red: ['errorTextColor', 'dndIndicator'] };
export function customFromJson(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('O tema precisa ser um objeto JSON { ... }');
  const o = {};
  for (const [k, v] of Object.entries(obj)) if (okColor(v)) o[k] = norm(v);
  for (const [k, names] of Object.entries(MM)) if (!o[k]) for (const n of names) if (okColor(obj[n])) { o[k] = norm(obj[n]); break; }
  const dark = typeof obj.dark === 'boolean' ? obj.dark : /dark|escuro/i.test(String(obj.type || '')) ? true : /light|claro/i.test(String(obj.type || '')) ? false : o.bg ? lum(o.bg) < 128 : true;
  const base = RAW.find((r) => r[0] === (dark ? 'monokai' : 'github-light'));
  const g = fromRaw(base);
  const bg = o.bg || g.vars.bg; const fg = o.fg || g.vars.fg;
  const ui = { ...g.vars, ...g.syn };
  Object.assign(ui, { bg, fg, bg2: o.bg2 || mix(bg, dark ? '#000000' : fg, dark ? 0.25 : 0.04) });
  if (!o.bg3) ui.bg3 = mix(bg, fg, dark ? 0.1 : 0.07);
  if (!o.dim) ui.dim = mix(fg, bg, 0.5);
  if (!o.line) ui.line = mix(bg, dark ? '#000000' : fg, dark ? 0.45 : 0.15);
  for (const [k] of [...CUSTOM_UI, ...CUSTOM_SYN]) if (o[k]) ui[k] = o[k];
  const raw = [ 'custom', 'Personalizado', dark ? 1 : 0, ui.bg, ui.bg2, ui.bg3, ui.fg, ui.dim, ui.accent, ui.line, ui.link, ui.tag, ui.green, ui.red, ui.kw, ui.str, ui.num, ui.com, ui.fn, ui.ty ];
  const th = fromRaw(raw);
  for (const k of EXTRA_VARS) if (o[k]) th.vars[k] = o[k];
  return th;
}
// O que o campo JSON mostra (só as chaves do tema, sem as derivadas)
export function customToJson(th) {
  const o = { dark: th.dark };
  for (const [k] of CUSTOM_UI) o[k] = th.vars[k];
  for (const [k] of CUSTOM_SYN) o[k] = th.syn?.[k] || '#888888';
  return o;
}
let custom = null;
export function setCustomTheme(obj) { try { custom = obj ? customFromJson(obj) : null; } catch { custom = null; } }
export const themeById = (id) => (id === 'custom' && custom) || THEMES.find((x) => x.id === id) || DEFAULT;

// Variáveis CSS na raiz do documento
export function applyThemeVars(theme) {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(theme.vars)) r.setProperty('--' + (k === 'onAccent' ? 'on-accent' : k), v);
  r.colorScheme = theme.dark ? 'dark' : 'light';
}

// Tema do CodeMirror (o padrão usa o oneDark original)
export function cmTheme(theme) {
  if (theme.builtin) return oneDark;
  const p = theme.vars; const s = theme.syn;
  const base = EditorView.theme({
    '&': { color: p.fg, backgroundColor: p.bg },
    '.cm-content': { caretColor: p.accent },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.accent },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: p.sel },
    '.cm-panels': { backgroundColor: p.bg2, color: p.fg },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid ' + p.line },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid ' + p.line },
    '.cm-searchMatch': { backgroundColor: mix(p.bg, p.tag, 0.35), outline: '1px solid ' + mix(p.bg, p.tag, 0.6) },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: mix(p.bg, p.accent, 0.4) },
    '.cm-activeLine': { backgroundColor: `color-mix(in srgb, ${p.fg} ${theme.dark ? 6 : 5}%, transparent)` }, // translúcido: não esconde a seleção
    '.cm-selectionMatch': { backgroundColor: mix(p.bg, p.accent, 0.2) },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: mix(p.bg, p.accent, 0.3) },
    '.cm-gutters': { backgroundColor: p.bg, color: p.dim, border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: `color-mix(in srgb, ${p.fg} ${theme.dark ? 6 : 5}%, transparent)`, color: p.fg },
    '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: p.dim },
    '.cm-tooltip': { border: '1px solid ' + p.border, backgroundColor: p.bg2, color: p.fg },
    '.cm-tooltip .cm-tooltip-arrow:before': { borderTopColor: 'transparent', borderBottomColor: 'transparent' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: p.hover, color: p.strong },
  }, { dark: theme.dark });
  const hl = HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: s.kw },
    { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: s.str },
    { tag: [t.number, t.bool, t.null, t.atom, t.color], color: s.num },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: s.com, fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: s.fn },
    { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)], color: s.ty },
    { tag: [t.propertyName, t.attributeName, t.variableName, t.definition(t.variableName)], color: p.fg },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: mix(p.fg, p.dim, 0.35) },
    { tag: [t.heading], color: p.tag, fontWeight: 'bold' },
    { tag: [t.link, t.url], color: p.accent, textDecoration: 'underline' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.meta, t.processingInstruction, t.contentSeparator], color: p.dim },
    { tag: t.deleted, color: p.red },
    { tag: t.invalid, color: p.red },
  ]);
  return [base, syntaxHighlighting(hl)];
}
