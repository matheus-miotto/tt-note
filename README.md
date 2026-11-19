# TT Note

Editor pessoal: Sublime Text + Obsidian. Electron + CodeMirror 6.

    npm start        # compila e abre
    npm run dist     # gera .exe portátil (precisa de electron-builder)

Configurações: `Ctrl+,` abre o settings.json (fica em %APPDATA%\tt-note\settings.json).
Para mudar atalhos, use `"keybindings": {"ctrl+p": "goto", "ctrl+b": null}` (null desativa).
Os ids dos comandos estão em `COMMANDS` em src/renderer.js.

## Atalhos (estilo Sublime)
Ctrl+P arquivo (`nome:linha`) · Ctrl+Shift+P comandos · Ctrl+R título/símbolo · Ctrl+G linha
Ctrl+D próxima ocorrência · Ctrl+clique multi-cursor · Ctrl+Shift+L dividir seleção em linhas
Ctrl+Shift+D duplicar · Ctrl+Shift+K apagar linha · Ctrl+Shift+↑/↓ mover · Ctrl+J juntar · F9 ordenar
Ctrl+Shift+F buscar em arquivos · Ctrl+K Ctrl+B barra lateral · Ctrl+K Ctrl+U/L maiúsc./minúsc.

## Estilo Obsidian
`[[nota]]` / `[[nota|alias]]` (autocomplete ao digitar `[[`; Alt+clique ou Alt+Enter abre; cria se não existir)
`#tags` · Ctrl+K Ctrl+R backlinks · Ctrl+Shift+V preview · Ctrl+Shift+G grafo
Ctrl+N nova nota · Ctrl+K Ctrl+D nota diária

F2 renomear nota (atualiza todos os [[links]]) · minimap: "minimap": true/false no settings.json ou comando "Alternar minimap"

Live Preview (Ctrl+E liga/desliga; "livePreview" no settings.json): o Markdown aparece renderizado no próprio editor; a sintaxe só reaparece onde o cursor está. Alt+clique abre [[links]] e [texto](url).

## Projetos, arquivos e JSON
Barra lateral: botão **Novo** cria um projeto (pasta); clique direito em pasta/arquivo/área vazia: Novo arquivo, Nova pasta, Renomear, Mostrar no Explorer, Excluir (vai para a Lixeira, com confirmação).
Ctrl+N cria arquivo sem título (Markdown); ao salvar/fechar pergunta se quer salvar e onde (começa na pasta do projeto). Ctrl+K Ctrl+N cria nota direto na pasta do projeto.
JSON: Ctrl+K Ctrl+J formata (seleção, JSON sob o cursor ou arquivo todo; funciona dentro de .md). "Minificar JSON" na paleta. Indentação: `"jsonIndent"` no settings.json.

Sintaxe: clique em "Markdown/JSON/…" no canto inferior direito (ou Ctrl+K Ctrl+S) para escolher a linguagem do arquivo; a escolha fica lembrada. "Automático" volta a detectar pela extensão.

Em arquivos .md, "Formatar JSON" coloca o resultado num bloco ```json (colorido). Funciona com o cursor em qualquer linha dentro do JSON.

Outros formatos (Editar → Formatar como…): XML, SQL, JavaScript, CSS e HTML; Ctrl+K Ctrl+F detecta o tipo sozinho. XML e SQL também têm "Linearizar"/"Compactar" (uma linha). XML inválido avisa em vez de alterar o texto. SQL usa o dialeto do tipo do arquivo; `"sqlDialect"`, `"sqlKeywordCase"` (upper/lower) e `"formatIndent"` no settings.json (ou em Preferências). Em .md o resultado vai para um bloco ```sql / ```xml…

Clique direito no editor: Formatar JSON (da seleção, se houver), Minificar, Copiar/Recortar/Colar, Definir sintaxe. Colar um JSON num .md já cria o bloco ```json formatado ("autoJsonOnPaste": false desliga).

## Vários projetos (barra lateral)
Cada pasta aberta é um projeto na barra lateral: **Abrir** (Ctrl+Shift+O) adiciona uma pasta sem fechar as outras; **Novo** cria uma pasta nova como projeto. Clique no nome para recolher/expandir; ● indica arquivos não salvos; × fecha o projeto.
Fechar um projeto (ou o app) com arquivos não salvos pergunta: Salvar tudo / Fechar sem salvar / Cancelar.
Busca em arquivos, Ctrl+P e backlinks/[[links]] valem para todos os projetos abertos. Arraste a borda da barra lateral para mudar a largura. Os projetos abertos são lembrados ao reabrir.

## Arquivos soltos (fora de projetos)
Ctrl+O abre arquivos de qualquer pasta (Desktop etc.); também dá para arrastar arquivos/pastas do Explorer para a janela, ou usar "Abrir com…" no Windows. Ctrl+K Ctrl+O = recentes. Aparecem em "Arquivos abertos" com o nome da pasta.
Codificação e quebra de linha são detectadas (UTF-8, UTF-8 BOM, Windows-1252/ANSI, UTF-16) e preservadas ao salvar; clique em "Windows-1252 · CRLF" na barra de status para reabrir com outra codificação ou converter.
O app é de instância única: abrir outro arquivo com ele já aberto manda o arquivo para a janela existente.

## Barra de menus
Menus no topo, como no Sublime: Arquivo, Editar, Seleção, Localizar, Exibir, Ir para, Projeto, Preferências, Ajuda. Mostram os atalhos e marcam (✓) as opções ligadas. Em Preferências ficam fonte, tabulação, quebra de linha, minimap, Live Preview, salvar automaticamente etc.; as escolhas são gravadas no settings.json.

## Importar do Sublime Text e do Obsidian
Arquivo → Importar → **Do Sublime Text…**: reabre as abas da última sessão do Sublime (arquivos reais, abas sem título com o texto, alterações não salvas e posição do cursor), lê as preferências (fonte, tabulação…), traz arquivos/pastas recentes e abre projetos `.sublime-project` encontrados. Só lê; o Sublime não é alterado. Rodar de novo não duplica.
Arquivo → Importar → **Do Obsidian (abrir cofre)…**: abre o cofre como projeto e reabre as notas que estavam abertas nele.
Compatibilidade Obsidian: `[[pasta/Nota]]`, `[[Nota#Título]]`, `[[Nota#^bloco]]`, `[[Nota|apelido]]`, apelidos (`aliases`) e tags (`tags`) no frontmatter, `![[imagem.png|300]]`, callouts `> [!tipo]`, `==destaque==`, `^id-de-bloco`, tarefas clicáveis, tabelas com formatação, e nota diária seguindo `.obsidian/daily-notes.json` (pasta, formato e modelo). A pasta `.obsidian` nunca é alterada.
Arquivos sem título mostram a 1ª linha como nome da aba e sugerem esse nome ao salvar.

## Grupos de abas
Em "Arquivos abertos" dá para organizar as abas em **grupos e subgrupos** (só organização, como pastas virtuais). Clique direito na lista → Novo grupo (use `Clientes/Alinare` para criar grupo e subgrupo de uma vez); arraste as abas para o grupo, ou clique direito na aba → Mover para grupo…; arrastar para a área vazia tira do grupo. Clique direito no grupo: novo subgrupo, renomear, salvar em pastas, fechar abas, excluir (as abas não fecham).
**Salvar:** uma aba sem título dentro de um grupo pergunta se salva nas pastas do grupo (a hierarquia vira pastas dentro da pasta base — o projeto atual ou outra que você escolher); "Salvar grupo em pastas…" faz isso com o grupo inteiro. Nomes repetidos viram `Nome (2).md`. Os grupos ficam lembrados entre sessões.

## Versões
Formato `1.{melhorias}.{ajustes}`: `npm run melhoria -- "texto"` (funcionalidade nova, zera os ajustes) e `npm run ajuste -- "texto"` (correção). Atualiza o package.json e o CHANGELOG.md; `npm run versao` mostra a atual. Para a janela **Novidades** (botão na barra de menus, abre sozinha ao atualizar) escreva o texto como `"novo: … | melhoria: … | correção: …"`; tudo fica em `novidades.json`. `TT_NO_NEWS=1` impede a abertura automática (útil em testes). `npm run installer` gera `installer\TT Note Setup <versão>.exe`.

## Quebra de linha automática (Auto Wrap)
Como o pacote AutoWrap do Sublime: ao digitar e a linha passar da largura, ela quebra sozinha no último espaço (ou antes de `(`, `[`, `{`); se a linha de baixo continua o parágrafo, o excesso desce para ela. Palavras maiores que a largura não são cortadas.
Ligar/desligar: **Editar → Quebra automática de linha**, `Alt+Shift+W` ou clique em "Auto Wrap 72" na barra de status (a escolha fica lembrada por arquivo). Arquivos `COMMIT_EDITMSG`, `MERGE_MSG`, `TAG_EDITMSG` e `*.gitcommit` abrem ligados (`autoWrapFiles`).
Largura: `autoWrapWidth`, senão a 1ª régua de `autoWrapRulers` (padrão `[72, 80]`), senão 80 — a mesma ordem do Sublime. Menu Preferências → Largura da quebra automática. As réguas aparecem nas colunas de `autoWrapRulers` quando a quebra está ligada.
`Alt+Q` reformata o parágrafo sob o cursor (ou a seleção) na largura. Arquivo → Importar → Do Sublime Text lê `rulers`/`auto_wrap_width` do seu Git Commit.sublime-settings.

## Rascunhos e alterações não salvas (como o Sublime)
Abas sem título com texto e arquivos com alterações pendentes são gravados sozinhos (a cada pausa na digitação) na pasta de dados do app e **voltam como estavam ao reabrir**, inclusive nos mesmos grupos. Ao fechar o app com itens não salvos: **Salvar tudo**, **Fechar e manter para depois** (rascunhos voltam) ou **Descartar e fechar**.
A importação do Sublime só pula o que **já está aberto agora**; se você fechar as abas e importar de novo, elas voltam. Procura o Sublime Text 4 (`%APPDATA%\Sublime Text`) e o 3 (`%APPDATA%\Sublime Text 3`).

Barra de abas do topo: escondida por padrão, porque as abas ficam em "Arquivos abertos" na lateral. Para mostrar: Exibir → Barra de abas no topo (`"tabBar": true` no settings.json).

## Fechar sem perguntar e voltar na mesma sessão
Como o Sublime e o Obsidian: fechar o app **não pergunta nada**, mesmo com arquivos não salvos. Ao reabrir, volta tudo como estava: abas na mesma ordem, aba ativa, cursor e rolagem de cada aba, painéis abertos (barra lateral, backlinks, preview), grupos, rascunhos, alterações não salvas e o tamanho/posição da janela.
Para descartar de propósito: **Arquivo → Sair e descartar não salvos…**. Quem prefere o aviso de antes desliga em Preferências → "Fechar sem perguntar" (`"hotExit": false`); aí o aviso volta com Salvar tudo / Fechar e manter / Descartar. Fechar uma aba ou um projeto com alterações continua perguntando.

## Reabrir aba fechada (Ctrl+Shift+T)
Reabre a última aba fechada, e de novo, e de novo (até 40). Arquivos voltam com o cursor e a rolagem de antes; rascunhos voltam **com o texto**, mesmo que você tenha fechado sem salvar. Se o arquivo não existir mais, pula para o anterior. Também em Arquivo → Reabrir aba fechada.

## Lado a lado e comparação
- **Selecione várias abas** na lateral com Ctrl+clique (ou Shift+clique para um intervalo; a aba atual já conta) e use o clique direito: **Comparar N abas lado a lado** ou **Abrir lado a lado**. Também: clique direito numa aba → *Abrir ao lado* / *Comparar com a aba atual*; Exibir → Lado a lado / comparar → *Comparar abas…* (aceita até um grupo inteiro de abas) e *Layout: 1/2/3 colunas*.
- Na comparação a 1ª aba (à esquerda) é a **referência**: linhas só nela ficam em vermelho e as que só existem nas outras, em verde. As diferenças se atualizam enquanto você digita. **F7 / Shift+F7** vão para a próxima / anterior diferença; "Rolagem sincronizada" faz os painéis rolarem juntos.
- Cada painel é um editor completo (clique nele para dar o foco e editar). O × no cabeçalho do painel só fecha o painel; a aba continua aberta. "Sair da comparação" mantém os painéis sem as cores. Ctrl+K Ctrl+→ abre uma aba ao lado.
- Os painéis e a comparação voltam ao reabrir o app.

## Tamanho do instalador
`npm run installer` já gera o instalador enxuto (≈102 MB, antes ≈117 MB): `tools/slim.js` remove do app empacotado só o que não é usado (traduções de 55 idiomas do Chromium — ficam pt-BR e en-US — e a DLL do WebGPU), o código é minificado e a compressão é máxima. Nenhuma função foi removida. O grosso do tamanho é o motor do Electron/Chromium (≈240 MB descompactado).

## Blocos da barra lateral
"Arquivos abertos" e "Projetos" têm uma setinha (▾/▸) no título para **recolher ou expandir** o bloco (a contagem aparece ao lado). A **divisória** entre os dois blocos pode ser arrastada para aumentar ou diminuir a lista de abas; duplo clique volta ao tamanho automático. Também em Exibir → Bloco "Arquivos abertos" / "Projetos". O estado fica lembrado.

## Ctrl+K: ir para uma aba aberta
`Ctrl+K` abre a busca das **abas abertas**: digite parte do nome, do grupo, do projeto ou do caminho e dê Enter para entrar nela. A lista vem da aba usada mais recentemente para a mais antiga e **já começa na anterior** — `Ctrl+K`, `Enter` alterna entre as duas últimas. Os atalhos em sequência continuam valendo: com a busca ainda vazia, `Ctrl+K Ctrl+B` (barra lateral), `Ctrl+K Ctrl+R` (backlinks) etc. executam normalmente; `Ctrl+K` de novo ou `Esc` fecham. Também em Ir para → Ir para aba aberta.

## Notas flutuantes (como as Notas Autoadesivas)
Janelas pequenas com editor Markdown (checklists clicáveis, Live Preview), **sempre no topo** — não precisa do PowerToys. **Ctrl+Alt+N** (global, de qualquer programa) cria uma nota nova; o ícone do TT Note na bandeja do sistema tem Nova nota / Mostrar-ocultar notas / Abrir o TT Note / Sair.
Na barra da nota: 📌 fixa ou solta do topo, ● escolhe a cor, + nova, ↗ abre o TT Note, 🗑 apaga (pergunta antes), × fecha (a nota continua guardada). Esc também fecha. As notas abertas voltam no mesmo lugar, tamanho, cor e fixação quando o app é reaberto.
No TT Note: Arquivo → Notas flutuantes (nova, enviar a seleção/aba para uma nota, abrir nota…, mostrar/ocultar todas); também na paleta (Ctrl+Shift+P → "nota flutuante"). Fechar a janela principal deixa as notas abertas; **Arquivo → Sair** (ou Sair na bandeja) fecha tudo. Preferências → "Manter na bandeja ao fechar" mantém o app (e o Ctrl+Alt+N) ativo mesmo sem nenhuma janela. Atalho global: `"noteHotkey"` no settings.json (ex.: `"Control+Alt+N"`). As notas ficam em `notes.json` na pasta de dados do app.

## Temas
Preferências → **Tema**: TT Escuro (padrão, as cores de sempre), Dracula, Monokai, Nord, Tokyo Night, Gruvbox Escuro, Solarized Escuro, Meia-noite (alto contraste), Claro (GitHub), Claro (One Light) e Solarized Claro. Muda a interface e as cores do código; vale também para as notas flutuantes. Paleta: "Tema: alternar para o próximo". Fica em `"theme"` no settings.json. As cores ficam em `src/themes.js`.

## Exportar a guia para PDF e Word
**Arquivo → Exportar a guia → PDF** ou **Word (.docx)** (também na paleta de comandos) gera um arquivo da guia aberta, com títulos, listas, tarefas, citações, código, tabelas, links e **imagens**. Aceita imagens ao lado da nota (`![](pasta/foto.png)`, inclusive caminhos com espaço), embeds do Obsidian (`![[foto.png]]`), imagens da web e `data:`; WebP, SVG e BMP são convertidos para o Word. Imagem que não for encontrada vira o aviso "[imagem: nome]" em vez de travar. O PDF sai em A4; o Word usa estilos de título (aparecem no painel de navegação). Não vale para o canvas.

## Canvas (quadro de cartões)
Arquivo → **Novo canvas** (ou paleta): abre um quadro novo **sem criar arquivo** (aba "Canvas 1", como um "Sem título"); ele só vira um `.canvas` (formato JSON Canvas, o mesmo do Obsidian) quando você salvar com Ctrl+S. Fonte e tamanho do texto: botões A− / A+ e a lista de fontes na barra do quadro, ou Preferências → Canvas: fonte / tamanho do texto. **Cartões:** texto (Markdown; dois cliques no fundo criam um), **notas** do projeto (renderizadas; dois cliques editam a nota ali mesmo e gravam no arquivo; ↗ abre numa aba), **imagens** e **grupos** (áreas com rótulo que levam os cartões de dentro). Botões "+ Texto / + Nota / + Imagem / + Grupo" ou arraste notas e imagens da lateral ou do Explorer para o quadro.
**Setas:** passe o mouse num cartão e arraste a bolinha de um lado até outro cartão; soltar no vazio cria um cartão novo já ligado (mapa mental). **Tab** com um cartão selecionado cria um filho ligado. Selecione um cartão ou seta para cor, rótulo, duplicar, inverter, apagar (Delete). Arrastar o fundo move o quadro, a roda dá zoom, Ctrl+0 enquadra tudo, Ctrl+D duplica, Ctrl+Z / Ctrl+Y desfazem e refazem. "Ver JSON" mostra o texto do arquivo. Salvar, rascunhos e fechar sem salvar funcionam como nos outros arquivos.

## O que o Sublime traz de fábrica (e agora o TT Note também)
- **Sintaxes:** além das ~140 do CodeMirror, **Batch (.bat/.cmd), Makefile, Git (mensagem de commit e .gitignore), Graphviz (DOT), expressões regulares, reStructuredText, AppleScript, ActionScript, ASP, HTML (Rails/ERB) e MATLAB**. Escolha em Exibir → Sintaxe (Ctrl+K Ctrl+S).
- **Tab:** insere o recuo (ou recua as linhas selecionadas); Shift+Tab desfaz. Depois do gatilho de um **snippet**, Tab expande.
- **Snippets:** `log`+Tab, `fn`+Tab, `html:5`+Tab, `def`, `for`, `sel`, `lorem`, `date`… (~70, por linguagem). Dentro do snippet, Tab pula para a próxima parada. **Ferramentas → Snippets → Criar snippet com a seleção…** guarda o seu (fica em `"snippets"` no settings.json: `{ "trigger": "ass", "content": "Att,\n${1:Matheus}", "scope": ["Markdown"] }`; `$1`, `${1:padrão}`, `$0`, `$DATE`, `$TIME`).
- **Linhas:** Ctrl+Enter (linha abaixo), Ctrl+Shift+Enter (acima), Ctrl+K Ctrl+K (apagar até o fim), Ctrl+K Ctrl+Backspace (até o começo), Ctrl+T (trocar letras), Ctrl+F9 (ordenar diferenciando maiúsculas); no menu Editar → Linha: inverter, remover repetidas, embaralhar, ordenar ignorando maiúsculas.
- **Texto:** Ctrl+K Ctrl+T (Title Case), inverter maiúsculas/minúsculas, comentário de bloco (Ctrl+Shift+/), converter indentação para espaços ou tabs.
- **Seleção:** Ctrl+Shift+M (conteúdo dos colchetes; repetir expande), Ctrl+Shift+Espaço (expandir para o bloco), Ctrl+M (ir ao colchete correspondente), Alt+F3 (todas as ocorrências).
- **Dobrar:** Ctrl+K Ctrl+1…9 (por nível), Ctrl+K Ctrl+0 ou Ctrl+K Ctrl+J (desdobrar tudo); Ctrl+Shift+[ e ] como no CodeMirror.
- **Busca:** Ctrl+E usa a seleção na busca (F3 / Shift+F3 acham o próximo/anterior) e Ctrl+I abre a busca, **fora do Markdown** (no Markdown seguem sendo Live Preview e itálico).
- **Macros:** Ctrl+Q grava, Ctrl+Q de novo para, Ctrl+Shift+Q repete; Ferramentas → Macros salva com nome.
- **Build:** Ctrl+B roda o arquivo (Python, Node, Batch, PowerShell, Go, Ruby, PHP, Java, C/C++, Rust…; no Markdown o Ctrl+B continua sendo negrito). A saída aparece num painel embaixo com os erros `arquivo:linha` clicáveis; F4 / Shift+F4 vão para o próximo/anterior; Ctrl+Pause para. Ctrl+Shift+B escolhe outro comando ou aceita um digitado (`$file`, `$file_path`, `$file_base_name`…). Seus próprios: `"builds": { "py": "python -u \"$file\"" }` no settings.json.
- **Corretor ortográfico (F6; vem ligado por padrão, em português e inglês)**, **modo sem distração (Shift+F11)**, **Alt+1…9** (ir para a aba N), **Ctrl+1…4** (focar o painel N), **Ctrl+`** (console do desenvolvedor, no lugar do console Python).
- **Esquemas de cores:** Monokai e mais Mariana, Celeste, Sixteen e Breakers (estilo Sublime; as cores são aproximações).
- Mudou: as **tarefas** (checkbox) passaram de Ctrl+K Ctrl+T para **Ctrl+K Ctrl+X**, porque Ctrl+K Ctrl+T é o Title Case do Sublime.
- **Não tem:** plugins (Package Control) nem o console Python do Sublime.

## Mostrar espaços e tabs (como o Sublime)
**Exibir → Mostrar espaços (●) e tabs (→)** desenha uma **bolinha em cada espaço** e uma **seta em cada tabulação** (também na paleta de comandos: "Mostrar espaços e tabs: alternar"). Três modos: **Nunca**, **Só no texto selecionado** (o padrão do Sublime; é o modo inicial) e **Sempre**. Só desenha; o texto não muda. Vale em todas as abas e fica guardado em `drawWhitespace` no settings.json (`none`, `selection` ou `all`).

## Colar imagem (Ctrl+V)
Como no Obsidian: com uma imagem na área de transferência (print do Win+Shift+S, imagem copiada do navegador ou arquivo de imagem copiado no Explorer), **Ctrl+V** numa nota Markdown salva o arquivo e escreve `![[Pasted image AAAAMMDDhhmmss.png]]` (ou `![](…)` se o cofre usa links Markdown); a imagem aparece no Live Preview. **No canvas**, Ctrl+V coloca a imagem como cartão (texto copiado vira cartão de texto). Onde fica o arquivo: a pasta de anexos do cofre (`.obsidian/app.json` → `attachmentFolderPath`; `"/"` = raiz, `"./"` = ao lado da nota, `"./sub"` = subpasta da nota); sem essa configuração, `"attachmentFolder"` do settings.json (ex.: `"anexos"`) ou a raiz do projeto. Fora de qualquer projeto: ao lado do arquivo aberto ou, em abas sem nome, na pasta `imagens-coladas` dos dados do app.

**Texto vale mais que imagem:** o Excel (e o Word, o PowerPoint) copiam a seleção como texto **e** como imagem ao mesmo tempo. Quando há texto na área de transferência, o Ctrl+V cola o **texto** (células do Excel viram colunas separadas por tabulação e linhas, igual ao Sublime) e não a imagem; a imagem só é colada quando não há texto (print de tela, imagem copiada do navegador). Vale nas notas, no canvas, no chat compartilhado e na página web.

## Nome embaixo das imagens
No Live Preview, cada imagem mostra o **nome do arquivo** embaixo (em cinza). Clique no nome para trocar o texto mostrado: ele é gravado na própria nota (`![[foto.png|300|Minha legenda]]` ou `![Minha legenda](foto.png)`), o **arquivo não é renomeado**. Deixar vazio volta ao nome do arquivo. Por aba: Exibir → "Nome embaixo das imagens (nesta aba)" ou a paleta; a escolha fica lembrada por arquivo.

## Projetos compartilhados (servidor para a equipe)
Um notebook vira servidor (Arquivo → Servidor neste computador → Iniciar; roda em segundo plano e sobrevive a atualizações do app) e cada pessoa entra pela lateral **☁ Compartilhado** com usuário e senha, vendo só os projetos a que tem acesso. As notas são textos em **trechos com o nome colorido de quem escreveu** (data/hora), tarefas marcadas com o nome de quem marcou, edição do trecho de outro com **histórico e restaurar**, anexos (imagens, arquivos, vídeos), "não lido" ao abrir e atualização em tempo real. Acesso de fora de casa pela VPN Tailscale; backup diário criptografado para a pasta do Google Drive. Passo a passo em `docs/servidor-guia.md`; plano e decisões em `docs/servidor-colaborativo.md`; teste: `npm run servidor:teste`.

## Atalhos e melhorias recentes
- **Tarefas em várias linhas:** selecione as linhas → Editar → "Linhas selecionadas → tarefas (checkbox)" (ou clique direito, ou Ctrl+K Ctrl+T). Repetir volta ao texto.
- **Alt+F3** (como no Sublime): seleciona todas as ocorrências da palavra sob o cursor ou do trecho selecionado, para editar todas juntas.
- **Ctrl + roda do mouse** muda o tamanho da letra do editor; no canvas muda o tamanho do texto (a roda sozinha dá zoom no quadro).
- **Canvas:** botão "▦ Voltar ao quadro" quando se vê o JSON; Enter vira quebra de linha nos cartões de texto; **Ctrl+F** busca no canvas (cartões, notas, rótulos); clique no nome na barra renomeia; **☰ Estrutura** mostra a árvore com tudo (por grupos ou por ligações) à direita, fixável.

**Atualizar pelo servidor:** o administrador publica o instalador (Ajuda → Publicar instalador no servidor…) e, depois de Ajuda → Verificar atualização, aparece o botão **⬇ Baixar** e, quando termina, o botão **✔ Instalar e reiniciar** (o app só fecha quando você clicar), sem navegador e sem aviso do SmartScreen. Detalhes em `docs/servidor-guia.md`.

**Grupos de projetos e canvas compartilhado:** pastas de projetos na lateral, com permissão por grupo (vale para todos os projetos dele; somada à do projeto, vale a mais alta) e canvas que vários veem ao vivo, com um editor por vez e histórico (seção 4d do guia).

**Busca de emojis em português e inglês:** o seletor acha "gato", "gat" e "cat" na lista completa (~1.600), com gírias como "joinha" e "kkk" (seção 4h do guia).

**Chamar a atenção (como no MSN):** 📳 faz a janela de uma pessoa tremer, piscar e tocar um som, mas só se ela permitiu (clique direito no servidor → "Chamar atenção: quem pode tremer a minha tela…"; padrão: ninguém), com limite contra abuso (seção 4i do guia).

**Ocultar mensagem:** botão 👁 deixa só o nome da pessoa (as respostas somem junto); qualquer interação nova exibe de volta (seção 4g do guia).

**Mensagens mais compactas:** mensagens seguidas da mesma pessoa ficam juntas (cada uma segue com responder, reagir, editar e histórico) e 💬 abre só uma conversa (mensagem + respostas), no app e na página web (seção 4f do guia).

**Responder e mencionar:** ↩ Responder (com citação) e @nome com lista; o contador “@N para você” junta menções e respostas às suas mensagens, com aviso opcional do Windows (seção 4e do guia).

**Página web:** abrindo `http://ENDEREÇO:8787` no navegador (celular ou PC) dá para ver projetos e notas, buscar, escrever, anexar fotos, marcar tarefas e restaurar versões, sem instalar nada (seção 5c do guia).

**Compartilhado em bloco próprio, vários servidores e figurinhas:** veja a seção 4b de `docs/servidor-guia.md`.

**Reordenar abas:** arraste uma aba da lista lateral (ou da barra de cima) e solte sobre outra: ela entra antes (metade de cima) ou depois (metade de baixo) e, se a outra estiver num grupo, entra nesse grupo. **Colar no canvas** mantém o que foi copiado: negrito, itálico, links, listas, títulos e tabelas (HTML vira Markdown), código em bloco com a indentação, e as quebras de linha.

**Canvas — colar texto com espaçamento:** texto com colunas alinhadas, indentação ou cara de código (calendário, tabela do terminal, SQL) é colado em bloco de código para manter os espaços exatamente como foram copiados; o botão **⌗** do cartão liga/desliga isso em qualquer cartão de texto.

**Canvas — ⌗ padrão ao colar:** o botão **⌗ Auto/Sempre/Nunca** na barra do quadro (ou Preferências → Canvas: colar texto) define o padrão: *Auto* detecta quando precisa preservar espaços, *Sempre* cola tudo com espaços e quebras exatos (⌗ ligado) e *Nunca* cola Markdown normal. O ⌗ de cada cartão continua liga/desliga individualmente.

## Tema personalizado (JSON, como no Mattermost)
Exibir → Tema → **Personalizado (cores e JSON)…** (ou Ctrl+Shift+P → "Tema: editar cores"). Escolha *Tema personalizado*, ajuste as cores nos seletores (a tela muda ao vivo) ou cole um JSON no campo e clique em **Aplicar JSON colado**. **Copiar tema de cores** copia o JSON para compartilhar. Aceita o formato do TT Note (`bg`, `bg2`, `fg`, `accent`, `kw`, `str`…) e também o JSON de tema do **Mattermost** (`sidebarBg`, `centerChannelBg`, `centerChannelColor`, `linkColor`…); o que faltar é calculado. Salvar grava em `theme: "custom"` e `customTheme` no settings.json; Esc cancela e volta ao tema anterior.

## Compartilhado: prévia de links e tela de envio de imagens
- **Prévia de links:** links `http(s)` nas mensagens ganham um cartão com miniatura, título e descrição (até 2 por mensagem), como no WhatsApp. Quem busca os dados é o **servidor** (`/api/link-preview`), que só acessa endereços públicos, limita tamanho e tempo e guarda o resultado por 1 hora. Funciona no app e na página web. Precisa do servidor atualizado.
- **Colar / anexar / arrastar:** abre uma tela cheia com a imagem grande, campo de legenda ("Digite uma mensagem"; o que já estava digitado vem junto), miniaturas embaixo com **+** para juntar mais arquivos e o botão redondo de enviar (Enter também envia; Esc fecha). Vai tudo numa mensagem só. Arquivos que não são imagem aparecem com o nome e o tamanho. Não tem (ainda) as ferramentas de desenhar/cortar do WhatsApp.

## Filtro SQL a partir de uma lista (IN, LIKE, NOT LIKE…)
Cole a lista (uma por linha, ou separada por vírgula/tab/ponto e vírgula), **selecione** (sem seleção vale o documento inteiro) e use:
- **Ctrl+K Ctrl+I** (ou Ferramentas → Filtro SQL): abre a janela com o tipo (IN, NOT IN, LIKE, NOT LIKE, = com OR, BETWEEN, só a lista), a coluna, o curinga do LIKE, as aspas, o formato (uma linha ou um valor por linha), remover repetidos e dividir em lotes (Oracle aceita no máximo 1000 itens por IN). O resultado aparece antes de aplicar; Enter aplica, Esc cancela, Ctrl+Z desfaz.
- **Ctrl+Alt+I** transforma direto em `IN (...)` e **Ctrl+Alt+Shift+I** em `NOT IN (...)`, com as últimas opções usadas (a coluna lembrada é a de cada tipo). "LIKE (direto)" está no menu Ferramentas e pode ganhar atalho.
- Aspas automáticas: lista só de números sai sem aspas (`IN (1, 2, 3)`); se houver texto, ou um código com zero à esquerda (`00123`), todos levam aspas. `O'Brien` vira `'O''Brien'`. `NULL` fica sem aspas e o app avisa que `IN (NULL)` nunca casa.

## Corretor ortográfico (português e inglês, embutido)
O app traz os dicionários **pt-BR (VERO) e inglês** (pasta `dict/`, licenças junto; os `.bin` são gerados por `node tools/build-dict.js` a partir dos `.dic` em `tools/dict-src/` e ocupam ~10x menos memória que o formato de texto) e o seu próprio corretor (`src/spell.js` + `src/spell-engine.js`, rodando num worker), porque o do Chromium não carregava o português. **F6** liga/desliga (vem ligado). Palavras erradas ganham um sublinhado ondulado vermelho; **botão direito** na palavra mostra as sugestões (clicar troca; o acento e o til vêm primeiro: `responsavel` → `responsável`) e **Adicionar "palavra" ao dicionário** (fica em `userDict` no settings.json).
Não confere: siglas em MAIÚSCULAS, camelCase, URLs/e-mails/caminhos, nem `código` do Markdown; em arquivos de programação só confere comentários e textos entre aspas. Com texto selecionado, o mesmo menu traz **Filtro SQL: lista → IN / NOT IN / LIKE e outros…**.

## Chat compartilhado: mais rápido e mais estável
Tudo isto é do lado do app (o servidor não muda):
- **Enviar:** a mensagem aparece na hora, como "enviando…", e o campo já fica livre; ao confirmar, ela entra na lista sem baixar a nota inteira de novo (antes: 29 requisições e ~185 KB por mensagem numa nota de 300 mensagens; agora 1 requisição). Se falhar fica marcada "não enviada" com **Reenviar** / **Descartar** (o texto não se perde). Várias mensagens seguidas saem em ordem.
- **Receber / abrir:** uma só descarga da nota por vez (pedidos juntos viram um), só a lista de projetos é atualizada (em paralelo, sem refazer tudo), e a nota abre **na hora com a última versão guardada neste PC** enquanto a rede atualiza (a cópia é apagada ao sair do servidor). Em conversas longas desenha as **últimas 150** mensagens, com "▲ Mostrar mais…" para as anteriores. Imagens carregam só quando aparecem na tela.
- **Conexão:** se o servidor ficar 60 s sem dar sinal (Wi-Fi, suspensão do PC, túnel que morreu em silêncio), o app refaz a conexão sozinho; reconecta mais rápido (1 s, 2 s, 4 s… até 15 s), na hora quando a rede volta, a janela ganha foco ou o PC acorda; **ao reconectar confere de novo a nota aberta** (antes as mensagens perdidas só apareciam na próxima mudança); consultas que falham são refeitas sozinhas.
- **Imagens:** ao colar/anexar, a tela de envio tem **"Imagens: otimizadas"** (padrão; reduz para no máximo 1920 px e salva em WebP; mostra "10,9 MB → 877 KB") ou "qualidade original".
- **⏱ Latência:** o botão no topo da nota mostra o tempo do último pedido (verde < 300 ms, amarelo < 1 s, vermelho acima); o balão traz média, pior caso, falhas e reconexões; clicar testa 3 vezes.
- **Prévia de links:** busca no PC (sem ir ao servidor), no máximo 3 por vez, e guarda o resultado por 1 dia.

## Baixar a atualização (botão "Baixar" do app)
- Com o servidor atualizado (ele passa a aceitar `Range`): o instalador é baixado em **pedaços de 8 MB, 4 ao mesmo tempo**, o que rende muito mais que uma conexão só em links com latência alta. Cada pedaço que falha é refeito sozinho (até 6 vezes, com espera crescente); se a conexão travar por 20 s sem dados, o pedaço é abortado e refeito.
- **Retoma de onde parou:** o que já veio fica em `%TEMP%\TT Note Update\*.part` (+ `.part.json`); se o download falhar ou você fechar o app, o próximo "Baixar" continua e só pega o que faltou (testado: 32 MB já baixados, a segunda tentativa trouxe só 9 MB dos 41).
- Mostra **velocidade e tempo restante** no botão. No final confere o SHA-256 do arquivo inteiro.
- Com servidor antigo (sem `Range`) usa uma conexão só, agora com vigia de travamento e até 4 tentativas (cada uma recomeça do zero). O servidor precisa ser atualizado para ter pedaços e retomada.

## Atualização automática (baixa sozinha, instala só quando você mandar)
O app verifica o servidor **20 s depois de abrir**, ao conectar num servidor, ao voltar para a janela (no máximo a cada 10 min) e **a cada 30 min**. Se há versão nova, **baixa em segundo plano** (2 conexões, para não atrapalhar o chat; o botão no canto superior mostra "Baixando 1.42.0… 40%"). Quando termina aparece o botão verde **"✔ Instalar 1.42.0 e reiniciar"** e um aviso: o app **só fecha e instala quando você clicar** (rascunhos e abas são guardados). Se a atualização já tinha sido baixada em outra sessão, não baixa de novo. Se o download falhar, volta o botão manual "⬇ Baixar". Para desligar: Preferências → "Atualização do app: baixar sozinha" (ou `"autoUpdate": false` no settings.json). Precisa estar conectado a um servidor (é de lá que vem o instalador).

## Memória
Medido (memória privada de todos os processos do app, com um arquivo aberto): **319 MB → 269 MB** com o dicionário compacto do corretor (formato binário com busca binária; abre em 40 ms em vez de 240 ms). Em **Preferências → "Aceleração de vídeo"** dá para desligar a placa de vídeo: o processo de gráficos cai de ~86 para ~19 MB (**total ~201 MB**) à custa de a tela ser desenhada pelo processador; vale ao reabrir o app (`"hardwareAcceleration": false` no settings.json). Desligar o corretor (F6) economiza o restante (~50 MB).

## Enquete (uma ou várias escolhas)
**Criar:** nas notas normais, Editar → **Inserir enquete…** (ou Ctrl+Shift+P → "Inserir enquete"); no chat compartilhado, o botão **📊 Enquete** ao lado de Anexar; na página web, o botão **📊** da barra. Janela: pergunta, de 2 a 12 opções (com ↑ ↓ ✕), **uma escolha** ou **várias escolhas** e, no compartilhado, **voto anônimo**.

**No texto** (continua legível em qualquer editor):
````
```enquete            (ou "```enquete anonima")
Onde vamos almoçar?
- ( ) Pizza           ( ) = uma escolha     [ ] = várias escolhas
- (x) Sushi           (x) / [x] = marcado (só em nota normal)
```
````
- **Nota normal:** o bloco vira um cartão no Live Preview. Clicar numa opção marca no texto (uma escolha: marcar outra desmarca a anterior; várias: liga/desliga); o lápis ✎ (ou o cursor dentro do bloco) mostra o texto para editar. Sem contagem, só a sua escolha.
- **Compartilhado (app e página web):** cada pessoa tem o seu voto; o cartão mostra barras, contagem e %, "N votos · M pessoas", o seu voto destacado e, se for aberta, quem votou (anônima: só os números). Trocar de opção move o voto; **tirar meu voto**. Quem criou (ou o administrador) pode **encerrar / reabrir**. Só vota quem pode escrever na nota; quem só lê vê o resultado. O voto aparece na hora e os outros veem em tempo real.
- **Regras:** com votos, as opções e o tipo não mudam (a pergunta pode); a enquete é uma mensagem como as outras (responder, mencionar, ocultar, apagar/restaurar leva os votos junto). Nas notas exportadas (PDF/Word) vira pergunta + lista de opções.
- **Servidor:** novo — votos guardados por pessoa (`POST …/vote`, `…/poll-close`). Com servidor antigo a enquete aparece como cartão só de leitura ("o servidor precisa ser atualizado para votar").

### Enquete com imagens
Cada opção (e a própria pergunta) pode ter uma imagem. Na janela de criar há um botão **🖼** em cada campo (ou cole um print no campo): escolha o arquivo e ele vira uma miniatura. Com imagem em todas as opções, o cartão vira uma **grade** (bom para escolher entre layouts, logos, fotos). Clicar na opção **vota**; clicar na imagem **amplia**, sem votar. No texto: `- ( ) ![A](srv-file:abc) Layout A`; só a imagem também vale (o nome vira o texto da opção). No compartilhado, as imagens são otimizadas (como nos anexos) e enviadas ao projeto; na nota normal ficam salvas junto da nota. Não precisa de mudança no servidor.

## Fixar mensagens e linhas (📌)
- **Chat compartilhado:** o botão **📌** no canto de cada mensagem fixa/desafixa (vale para todos; quem escreve pode fixar; no máximo 20 por nota). A mensagem ganha o selo "fixada por…", aparece uma **barra** no alto com a mais recente (clique para ir até ela) e o botão **📌 Fixadas (N)** no topo abre a lista de todas, com "Ir para a mensagem" (abre mesmo mensagens antigas escondidas) e "Desafixar". Na página web: 📌 em cada mensagem e 📌 N no topo. **Precisa do servidor atualizado.**
- **Guias normais:** **Ctrl+Alt+P** fixa/desafixa a linha do cursor (ou todas as linhas da seleção); também no botão direito → "Fixar esta linha" e em Editar. A linha ganha um 📌 na margem (clique nele para desafixar) e um realce. A fixação **acompanha a linha** quando você insere ou apaga texto acima, e some só se a linha inteira for apagada. Fica gravada por arquivo em `pins.json` (na pasta de dados do app); ao reabrir, procura a linha pelo texto, mesmo que ela tenha mudado de lugar.
- **Ver todas:** botão **📌 N** na barra de baixo (ou **Ctrl+Alt+Shift+P**, ou Exibir → Linhas fixadas): lista as linhas fixadas do arquivo atual e dos outros arquivos, com filtro; clicar abre o arquivo na linha; **✕** desafixa.

## Logs de integração, SQL, copiar código, quebra por guia e Insert
- **Colar um log já formatado** (num `.md`): linhas como `[requesicao](url): {json}`, `[consulta](nome): select …` e `SQL (título): update …` viram blocos de quatro crases — o JSON fica **formatado** (`JSON`) e o SQL **indentado** (`SQL`), cada um no seu bloco; o resto do texto fica igual (as linhas `Registros: …`, títulos, etc.). **Ctrl+Z desfaz a colagem inteira.** Para um log que já está no documento: **Ctrl+Alt+L** (ou botão direito / Editar → "Formatar log"), na seleção ou no documento todo; rodar de novo não muda nada. Desligar a colagem automática: `"autoLogOnPaste": false` no settings.json.
- **SQL (formatador próprio, não dá mais erro):** aceita Postgres (`::text`, `||`, `string_agg(… order by …)`), **respeita as quebras de linha que você já tem** e acrescenta o que falta: `select / from / join / where / and / group by / order by / union` cada um em sua linha e as **subconsultas abertas**, com o conteúdo recuado (4 espaços) e o `)` numa linha própria (`left join (` … `) alias on (…)`), em qualquer nível. `between … and`, `case when … and …` e funções não são quebrados. **INSERT:** `values` com cada linha de valores numa linha, `on conflict` e `returning` em linhas próprias; `insert … select` também. Por padrão **mantém as palavras como você escreveu** (Preferências → "SQL: palavras-chave" para MAIÚSCULAS ou minúsculas). Antes o botão "Formatar como SQL" recusava SQL de Postgres sem avisar bem: era a biblioteca antiga; foi trocada. Conferido contra os seus modelos: os blocos coincidem linha a linha (só difere onde o modelo não é consistente consigo mesmo).
- **Botão Copiar** em todo bloco de código (cercas ``` / ````): no editor (Live Preview, no canto do bloco), no chat compartilhado, na página web e no preview — copia só o código, sem as cercas, e mostra "✓ Copiado".
- **Quebra de linha só na guia:** Alt+Z (ou Exibir → "Quebra de linha (só nesta guia)") liga/desliga **apenas a guia atual**; guias novas nascem com quebra ligada; ao desligar, fica lembrado por arquivo.
- **Tecla Insert:** alterna **INSERIR / SOBRESCREVER** (o que você digita troca o caractere seguinte; cursor em bloco; no fim da linha acrescenta). O estado aparece na barra de baixo (clique para alternar).

## Licença

O TT Note é **código aberto para ler e modificar, com restrição comercial** (MIT + Commons Clause): você pode baixar, modificar e usar dentro da sua empresa, mas **não pode vender** o programa nem cobrar clientes por um produto ou serviço baseado nele. Veja o resumo em [`LICENCA-RESUMO.md`](LICENCA-RESUMO.md), o texto oficial em [`LICENSE`](LICENSE), as licenças de componentes de terceiros em [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md) e como contribuir em [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Idiomas do aplicativo

O TT Note fala **português (Brasil)**, **inglês**, **espanhol** e **português (Portugal)**. Troque pelo botão com a **bandeira** no canto direito da barra de menus, por **Exibir → Idioma do aplicativo…** ou pela paleta de comandos (Ctrl+Shift+P → "Idioma do aplicativo"). A escolha vale na hora, fica lembrada (chave `language` no `settings.json`: `pt-BR`, `en`, `es` ou `pt-PT`) e, se você nunca escolheu, o app usa o idioma do Windows.

- Traduz menus, comandos, diálogos, avisos, a barra de status, a bandeja do Windows e os textos de busca do editor. **O que você escreve nas notas, nomes de arquivos e mensagens do chat nunca é traduzido.**
- A **página web do servidor** (celular/navegador) também tem o botão de idioma (bandeira) e lembra a escolha no aparelho.
- Ainda em português: o histórico de "Novidades" (as notas de cada versão) e os registros técnicos (logs).
- Para quem mexe no código: os textos do código continuam em português do Brasil. Os dicionários ficam em `src/lang/*.json` e são gerados por `node tools/i18n-build.js` a partir de `tools/i18n/` (traduções em `t*.txt` e `x*.txt`, ajustes do português de Portugal em `ptpt.json`); `node tools/i18n-extract.js --loose --list` mostra os textos do código e ajuda a achar o que falta traduzir. Um texto novo sem tradução simplesmente aparece em português.

## Corretor ortográfico no chat compartilhado

O campo de mensagem (e a edição de uma mensagem) do chat compartilhado usa o mesmo corretor do editor: as palavras erradas ganham um sublinhado ondulado, o botão direito numa delas mostra as sugestões e **Adicionar ao dicionário**, e vale para português e inglês. Não confere código (`` `assim` `` e blocos), links, e-mails, @menções e :emojis:. Liga e desliga com F6 (Preferências → Corretor ortográfico).

## Apoie o projeto

O app mostra uma janela com um recado do autor e os botões **Me dê sugestões**, **Me pague um Monster** (chave Pix, com "Pix copia e cola") e **Me dê um elogio**. Ela aparece sozinha **a cada 10 vezes que o app é fechado** (ao abrir depois do 10º, 20º, 30º fechamento…); para abrir quando quiser: **Ajuda → Apoiar o projeto…**. Os dados ficam em `support.config.json` (`repo` = endereço do GitHub, `pix` = chave Pix, `pixName`/`pixCity` = nome e cidade que o banco mostra); sem `pix` o botão do Monster some, sem `repo` somem os do GitHub, e sem nenhum dos dois a janela não aparece.

## Baixar com segurança (conferir o instalador)

Baixe o instalador **só das Releases oficiais** do repositório. Cada versão traz o hash **SHA-256** do instalador (arquivo `.sha256` e a lista `SHA256SUMS.txt`). Para conferir no Windows:

```powershell
Get-FileHash "TT Note Setup 1.45.0.exe" -Algorithm SHA256
```

O resultado precisa ser **igual** ao hash publicado; se for diferente, o arquivo foi alterado e não deve ser instalado. O hash é gerado sozinho ao rodar `npm run installer` (`tools/hash.js`). O instalador ainda não é assinado digitalmente; a conferência pelo hash é a garantia de que ele é o oficial.

O pacote do app também é **protegido contra adulteração** (`tools/harden.js`, ligado no `npm run installer`): o programa só roda de dentro do `app.asar` e confere a integridade dele, então editar o conteúdo instalado (por exemplo a chave Pix da janela "Apoie o projeto") faz o programa se recusar a abrir. O arquivo `support.config.json` não vai dentro do instalador: os valores já estão compilados no código do app.
