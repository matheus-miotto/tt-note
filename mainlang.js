// Textos do processo principal (bandeja, caixa "Sobre", filtros dos diálogos de arquivo) nos idiomas do app.
// O idioma vem do settings.json ("language") ou do Windows, e muda na hora quando o usuário troca no app.
const D = {
  en: {
    '(vazia)': '(empty)', 'Nova nota flutuante': 'New floating note', 'Mostrar / ocultar notas': 'Show / hide notes', 'Notas ({0})': 'Notes ({0})',
    'Abrir o TT Note': 'Open TT Note', Sair: 'Quit', 'Editor de texto criado pelo Matheus. Agilidade e organização em um só lugar.': 'Text editor created by Matheus. Agility and organization in one place.',
    'Versão {0}': 'Version {0}', 'Apagar esta nota?': 'Delete this note?', Apagar: 'Delete', Cancelar: 'Cancel',
    'Instalador do TT Note (.exe)': 'TT Note installer (.exe)', Imagens: 'Images', Notas: 'Notes', 'Todos os arquivos': 'All files', 'Texto e código': 'Text and code', 'Documento do Word': 'Word document',
  },
  es: {
    '(vazia)': '(vacía)', 'Nova nota flutuante': 'Nueva nota flotante', 'Mostrar / ocultar notas': 'Mostrar / ocultar notas', 'Notas ({0})': 'Notas ({0})',
    'Abrir o TT Note': 'Abrir TT Note', Sair: 'Salir', 'Editor de texto criado pelo Matheus. Agilidade e organização em um só lugar.': 'Editor de texto creado por Matheus. Agilidad y organización en un solo lugar.',
    'Versão {0}': 'Versión {0}', 'Apagar esta nota?': '¿Eliminar esta nota?', Apagar: 'Eliminar', Cancelar: 'Cancelar',
    'Instalador do TT Note (.exe)': 'Instalador de TT Note (.exe)', Imagens: 'Imágenes', Notas: 'Notas', 'Todos os arquivos': 'Todos los archivos', 'Texto e código': 'Texto y código', 'Documento do Word': 'Documento de Word',
  },
  'pt-PT': {
    '(vazia)': '(vazia)', 'Abrir o TT Note': 'Abrir o TT Note', Apagar: 'Eliminar', 'Apagar esta nota?': 'Eliminar esta nota?', 'Todos os arquivos': 'Todos os ficheiros',
    'Instalador do TT Note (.exe)': 'Instalador do TT Note (.exe)', 'Texto e código': 'Texto e código',
  },
};
let cur = 'pt-BR';
const ok = (l) => l === 'pt-BR' || !!D[l];
function detect(locale) {
  const l = String(locale || '').toLowerCase();
  if (l.startsWith('pt-pt')) return 'pt-PT';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('en')) return 'en';
  return 'pt-BR';
}
function setLang(l) { cur = ok(l) ? l : 'pt-BR'; return cur; }
const getLang = () => cur;
function tm(s, ...a) {
  const v = (D[cur] || {})[s];
  return String(v != null ? v : s).replace(/\{(\d+)\}/g, (m, n) => (a[+n] != null ? a[+n] : m));
}
module.exports = { setLang, getLang, tm, detect };
