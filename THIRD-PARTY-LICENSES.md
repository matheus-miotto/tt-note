# Licenças de terceiros

O TT Note usa os componentes abaixo. Cada um mantém a **sua própria licença**; a Commons Clause do [`LICENSE`](LICENSE) do TT Note **não** se aplica a eles.

## Dicionários do corretor ortográfico (`dict/`, `tools/dict-src/`)

Os arquivos `dict/*.aff` e `dict/*.bin` são **derivados** dos dicionários abaixo (os `.bin` são uma versão compacta gerada por `tools/build-dict.js`). Os textos completos de licença estão em `dict/LICENSE-pt-BR.txt` e `dict/LICENSE-en.txt` e devem acompanhar qualquer redistribuição.

| Dicionário | Origem | Licença |
| --- | --- | --- |
| Português do Brasil | Projeto VERO (LibreOffice, Raimundo Santos Moura e equipe), <http://pt-br.libreoffice.org/projetos/projeto-vero-verificador-ortografico/> | GNU LGPL v3 **e** Mozilla Public License (à sua escolha) |
| Inglês (en_US) | Hunspell en_US 2020.12.07, derivado do SCOWL, <http://wordlist.sourceforge.net> | Licença própria do SCOWL (permissiva, com aviso de copyright obrigatório) |

Quem modificar esses dicionários deve seguir os termos da licença de cada um (para o VERO, LGPL v3 ou MPL, o que inclui indicar as alterações e manter o texto da licença).

## Bibliotecas incluídas no programa

| Pacote | Licença |
| --- | --- |
| codemirror, @codemirror/* (autocomplete, commands, lang-markdown, language, language-data, legacy-modes, search, state, theme-one-dark, view) | MIT |
| @replit/codemirror-minimap | MIT |
| marked | MIT |
| js-beautify | MIT |
| xml-formatter | MIT |
| emojibase-data | MIT (os dados vêm do Unicode CLDR, sob a Unicode License) |

## Ferramentas de construção (não vão dentro do programa)

| Pacote | Licença |
| --- | --- |
| electron | MIT |
| electron-builder | MIT |
| @electron/packager | BSD-2-Clause |
| esbuild | MIT |
| png-to-ico | MIT |
| sharp | Apache-2.0 |

## Electron e Chromium

O instalador inclui o Electron, que traz o Chromium e outros componentes. Os avisos completos acompanham o programa instalado nos arquivos `LICENSE` e `LICENSES.chromium.html` (pasta de instalação do TT Note). Ao redistribuir o instalador ou o programa empacotado, mantenha esses arquivos.

## Como atualizar esta lista
Ao adicionar uma dependência, confira a licença em `node_modules/<pacote>/package.json` e acrescente a linha aqui. Não adicione componentes com licença que proíba redistribuição ou que seja incompatível com o uso descrito no [`LICENSE`](LICENSE) (por exemplo GPL/AGPL em código que fica dentro do programa).

## Imagens e marcas

A imagem `assets/monster.png` (lata na janela "Apoie o projeto") foi fornecida pelo autor do projeto. "Monster" e "Monster Energy" são marcas de seus respectivos donos, sem qualquer vínculo com o TT Note, e essa imagem **não** é coberta pela licença do projeto (veja [`LICENSE`](LICENSE)). Quem fizer um fork para redistribuir deve trocá-la por uma imagem própria ou de uso livre.
