# Histórico de versões

Formato da versão: `1.{melhorias}.{ajustes}` — melhoria = funcionalidade nova (zera os ajustes); ajuste = correção.
Gerado a partir de `novidades.json` (a lista que o app mostra em "Novidades").

## 1.51.0 — 2026-11-19
- **Novo:** QR Code do Pix na janela de apoio
- **Novo:** os botões "Me dê sugestões" e "Me dê um elogio" agora abrem o repositório do projeto no GitHub

## 1.50.1 — 2026-11-19
- **Correção:** voltou a colar imagem em notas sem título quando não há projeto aberto (o app tentava gravar dentro do próprio pacote); se a pasta de destino falhar, a imagem vai para a pasta de imagens do app

## 1.50.0 — 2026-11-19
- **Novo:** modo debug (Preferências): grava os registros de erros em arquivo (debug.log) até ser desligado, para investigar problemas
- **Melhoria:** o aviso "Não consegui salvar a imagem colada" agora mostra o motivo

## 1.49.1 — 2026-11-19
- **Correção:** voltou a colar imagem (Ctrl+V) no .md e no quadro quando a área de transferência traz também uma linha de texto (prints, WhatsApp, Teams, navegador)

## 1.49.0 — 2026-11-19
- **Novo:** traduzir o texto selecionado (botão direito → Traduzir a seleção): janelinha com o original e a tradução, escolha do idioma, copiar e substituir a seleção; usa um serviço online, pede confirmação na primeira vez e pode ser desligado em Preferências
- **Correção:** o corretor ortográfico não sublinha mais nada dentro de blocos de código (SQL, JSON etc.) e reconfere quando o Markdown termina de carregar
- **Correção:** o texto do botão e dos avisos de atualização agora são traduzidos (inglês e espanhol)

## 1.48.0 — 2026-11-19
- **Novo:** atualização rápida: o app baixa a nova versão e já deixa tudo extraído ao lado enquanto você trabalha; o botão "Reiniciar e atualizar" só troca as pastas e reabre em poucos segundos (se não der, usa o instalador como antes)
- **Correção:** setas do teclado não pulam mais várias linhas em notas Markdown que têm tabela

## 1.47.0 — 2026-11-18
- **Novo:** configuração "Tipo das novas guias" (Markdown ou Texto) para definir o padrão das guias sem título
- **Correção:** log colado com UNION/UNION ALL não deixa mais a segunda consulta fora do bloco SQL

## 1.46.0 — 2026-11-18
- **Melhoria:** a bandeira do idioma fica sempre ao lado de Novidades, fixa no canto direito, mesmo quando aparece o botão de atualizar

## 1.45.0 — 2026-11-18
- **Novo:** idiomas do aplicativo: português (Brasil), inglês, espanhol e português (Portugal), com bandeiras; o botão da bandeira fica no canto da barra de menus (também em Exibir → Idioma do aplicativo e na paleta), a escolha fica lembrada e, sem escolha, vale o idioma do Windows; traduz menus, comandos, diálogos, avisos, bandeja e a busca do editor, e nunca o que você escreve nas notas
- **Novo:** a página web do servidor também tem os quatro idiomas (botão da bandeira no cabeçalho e no login) e as mensagens de erro do servidor foram traduzidas; o servidor precisa receber a versão nova para a web ganhar o idioma
- **Novo:** corretor ortográfico nas mensagens do chat compartilhado (campo de escrever e edição): sublinha as palavras erradas, botão direito mostra as sugestões e Adicionar ao dicionário, e respeita o F6; não confere código, links, e-mails, @menções e :emojis:
- **Novo:** paleta de comandos (Ctrl+Shift+P) com Definir sintaxe: uma entrada para cada linguagem, como no Sublime
- **Novo:** janela Apoie o projeto (recado do autor, Pix com copia e cola, sugestões e elogio) que aparece a cada 10 vezes que o app é fechado; também em Ajuda → Apoiar o projeto; os dados ficam em support.config.json
- **Correção:** o aviso @ e o número de não lidas na lista de notas não sumiam ao abrir a nota (no app, a lista de notas não era atualizada; na página web, o @ não zerava)

## 1.44.0 — 2026-11-17
- **Melhoria:** privacidade: as notas compartilhadas não ficam mais guardadas neste PC (tudo fica só no servidor); a cópia local criada pelas versões 1.41 a 1.43 é apagada ao abrir e o cache de rede (imagens) é limpo ao abrir e ao fechar o app

## 1.43.0 — 2026-11-17
- **Novo:** temas prontos novos: Estilo DevExpress, Estilo DevExpress Escuro, Office 2016 Black, WXI, Neon Sakura e Neon Sakura Claro (em Configurações de exibição)
- **Correção:** a quebra de linha (Alt+Z) volta a vir ligada em toda guia nova; desligar vale só para a guia em que foi desligada e fica lembrado por arquivo

## 1.42.0 — 2026-11-17
- **Novo:** enquete: crie perguntas com uma ou várias escolhas nas notas normais (cartão clicável no Live Preview, a escolha fica no texto) e no chat compartilhado e na página web (voto por pessoa com barras, contagem e %, quem votou ou anônima, tirar o voto, encerrar e reabrir); com votos só a pergunta pode mudar; exporta para PDF e Word; opções e pergunta podem ter imagem (grade de imagens, clicar na imagem amplia, clicar na opção vota)
- **Novo:** menos memória: dicionário do corretor em formato compacto (de 319 para 269 MB no total, abre 6x mais rápido) e nova opção em Preferências, Aceleração de vídeo, que ao desligar economiza mais ~70 MB (vale ao reabrir o app)
- **Novo:** fixar mensagem no chat compartilhado (📌 na mensagem, barra com a fixada mais recente e botão Fixadas com a lista de todas, até 20 por nota; no app e na página web) e fixar linhas nas guias normais (Ctrl+Alt+P; 📌 na margem que acompanha a linha, grava por arquivo, botão 📌 na barra de baixo e Ctrl+Alt+Shift+P para ver todas as linhas fixadas de todos os arquivos)
- **Novo:** logs de integração: ao colar, JSON e SQL entram formatados, cada um em seu bloco (Ctrl+Z desfaz tudo); Ctrl+Alt+L formata um log que já está no documento
- **Melhoria:** formatador de SQL próprio: aceita Postgres (antes recusava), nunca dá erro, mantém suas quebras de linha, abre as subconsultas com recuo e fecha o parêntese em linha própria, e formata INSERT (values, on conflict, returning); mantém as palavras como você escreveu
- **Novo:** botão Copiar nos blocos de código (editor, chat compartilhado, página web e preview) e tecla Insert para alternar INSERIR / SOBRESCREVER
- **Melhoria:** a quebra de linha (Alt+Z) agora vale só para a guia em que foi ligada; guias novas nascem sem quebra

## 1.41.1 — 2026-11-16
- **Correção:** chat compartilhado: quando só a conexão em tempo real cai (mas o servidor responde e as mensagens enviam), o aviso agora é suave e a conversa se atualiza sozinha a cada poucos segundos, em vez de mostrar "sem conexão"; conexão de eventos que não recebe resposta em 15 s é refeita; o registro (Ajuda → registro de envio e download) passa a anotar cada conexão e queda dos eventos para diagnóstico

## 1.41.0 — 2026-11-16
- **Novo:** chat compartilhado muito mais rápido: a mensagem aparece na hora ao enviar (com Reenviar se falhar), enviar passa de 29 requisições para 1, receber de ~20 para 5, e a nota abre na hora com a última versão guardada no PC
- **Novo:** chat compartilhado mais estável: o app percebe sozinho quando a conexão morre em silêncio, reconecta rápido (e quando a rede volta ou o PC acorda) e atualiza a nota aberta depois de reconectar; consultas que falham são refeitas
- **Novo:** conversas longas desenham só as últimas 150 mensagens (com mostrar anteriores), imagens carregam sob demanda e, ao colar ou anexar, as imagens grandes são otimizadas antes de subir (ex.: 10,9 MB para 877 KB)
- **Novo:** indicador de latência (⏱) no topo da nota e prévia de links que não vai mais ao servidor
- **Melhoria:** baixar a atualização pelo servidor ficou mais rápido e à prova de queda: baixa em pedaços de 8 MB, 4 ao mesmo tempo, retoma de onde parou (até depois de fechar o app), refaz só o pedaço que falhou, percebe conexão travada e mostra a velocidade e o tempo que falta (com servidor sem a novidade, usa uma conexão só, com vigia e novas tentativas)
- **Novo:** atualização do app automática: o app verifica sozinho (ao abrir, ao conectar, a cada 30 min) e BAIXA em segundo plano, sem perguntar; quando está pronta aparece o botão verde "Instalar e reiniciar" e só instala quando você clicar. Se já foi baixada antes, não baixa de novo. Dá para desligar em Preferências

## 1.40.2 — 2026-11-16
- **Correção:** prévia de links passa a ser buscada no próprio PC (não depende mais de atualizar o servidor) e aparece também acima do campo enquanto você escreve, como no WhatsApp (× tira a prévia)

## 1.40.1 — 2026-11-16
- **Correção:** corretor ortográfico agora funciona em português: dicionário pt-BR e inglês embutidos, sublinhado das palavras erradas, sugestões no botão direito (responsavel → responsável) e adicionar ao dicionário; só confere comentários e textos em arquivos de código
- **Correção:** lateral: a lista do Compartilhado agora tem barra de rolagem visível e nunca passa do fim da janela (antes, com a altura salva maior que a janela, as últimas notas ficavam escondidas); Projetos sempre mantém um espaço mínimo

## 1.40.0 — 2026-11-16
- **Novo:** compartilhado: prévia de links com miniatura, título e descrição (app e página web; o servidor busca os dados com proteção contra endereços internos)
- **Novo:** compartilhado: ao colar, anexar ou arrastar imagens abre a tela de envio estilo WhatsApp (imagem grande, legenda, miniaturas com +, botão de enviar), no app e na página web
- **Novo:** filtro SQL a partir de uma lista: IN, NOT IN, LIKE, NOT LIKE, = com OR, BETWEEN e só a lista (Ctrl+K Ctrl+I abre as opções; Ctrl+Alt+I e Ctrl+Alt+Shift+I viram IN / NOT IN direto), com aspas automáticas, escape de aspa simples, remoção de repetidos, uma linha por valor e lotes de 1000
- **Novo:** corretor ortográfico: botão direito numa palavra sublinhada mostra as sugestões (clicar troca a palavra) e "Adicionar ao dicionário"
- **Melhoria:** botão direito com texto selecionado: atalhos do filtro SQL (lista → IN, NOT IN, LIKE e outros)

## 1.39.0 — 2026-11-16
- **Novo:** o que o Sublime traz de fábrica: sintaxes Batch, Makefile, Git, Graphviz, regex, reStructuredText, AppleScript, ActionScript, ASP, ERB e MATLAB
- **Novo:** snippets (gatilho + Tab, ~70 prontos e os seus), macros (Ctrl+Q / Ctrl+Shift+Q), build (Ctrl+B) com painel de saída e erros clicáveis (F4)
- **Novo:** Title Case, trocar letras, apagar até o fim/começo da linha, linha acima/abaixo, inverter/únicas/embaralhar linhas, ordenar sem diferenciar, conteúdo dos colchetes, dobrar por nível, converter indentação, comentário de bloco, usar a seleção na busca, corretor ortográfico (F6, já vem ligado por padrão, em português e inglês), modo sem distração, ir para aba/painel por número, console do desenvolvedor, esquemas de cor no estilo Sublime
- **Novo:** tema personalizado: janela com seletores de cor e campo JSON para copiar/colar o tema (aceita também o JSON de tema do Mattermost), com prévia ao vivo
- **Novo:** mudança: Tab agora recua; as tarefas (checkbox) passaram para Ctrl+K Ctrl+X

## 1.38.0 — 2026-11-16
- **Novo:** chamar a atenção (tremer a tela, como no MSN) nos compartilhados, só com a permissão de quem recebe: botão 📳 na nota e na lista de online; a janela treme, pisca e toca um som; limite de 1 a cada 15 s e 6 por minuto
- **Novo:** corrigido: a lista de quem está online já vem preenchida ao entrar no servidor

## 1.37.1 — 2026-11-16
- **Correção:** corrigido: selecionar todas as ocorrências (editar todas juntas) agora é Alt+F3, como no Sublime (antes era Ctrl+F3)

## 1.37.0 — 2026-11-16
- **Novo:** mostrar espaços (bolinha) e tabs (seta) como o Sublime: Exibir → Mostrar espaços, com os modos nunca, só no texto selecionado (padrão do Sublime) e sempre

## 1.36.2 — 2026-11-16
- **Correção:** corrigido: copiar células do Excel (ou do Word/PowerPoint) e colar agora cola o TEXTO (colunas e linhas, como no Sublime) em vez de uma imagem; a imagem só é colada quando não há texto (print de tela). Vale nas notas, no canvas, no chat compartilhado e na página web

## 1.36.1 — 2026-11-13
- **Correção:** corrigido: ao publicar a versão no servidor, agora aparece uma barra de progresso fixa no canto superior direito (percentual e MB enviados, conferindo no servidor, publicada) em vez de avisos que somem; em caso de erro a barra fica vermelha com o motivo até você clicar

## 1.36.0 — 2026-11-13
- **Novo:** busca de emojis em português e inglês no seletor (gato, gat, cat, coração, heart…), ignora acento, aceita o começo da palavra e gírias (joinha, valeu, kkk), em uma lista de ~1.600 emojis, com o nome ao passar o mouse

## 1.35.0 — 2026-11-13
- **Novo:** mudança: a atualização agora tem duas etapas que você decide: o botão ⬇ Baixar baixa sem fechar o app e, quando termina, aparece o botão verde ✔ Instalar e reiniciar, que só fecha o app quando você clicar

## 1.34.0 — 2026-11-13
- **Novo:** ocultar/exibir mensagem no compartilhado (botão 👁): fica só o nome da pessoa e as respostas ficam ocultas junto; qualquer interação nova (resposta, reação, edição, apagar) exibe de volta; vale só no seu aparelho, no app e na página web

## 1.33.1 — 2026-11-13
- **Correção:** corrigido: apertar Enter (ou clicar em Enviar) várias vezes seguidas enviava a mesma mensagem várias vezes; agora só envia uma, o campo esvazia na hora e o texto volta se o envio falhar (também para figurinhas, edição e na página web)

## 1.33.0 — 2026-11-12
- **Melhoria:** mensagens seguidas da mesma pessoa (até 5 min) ficam juntas, sem repetir o nome, e cada uma continua com responder, reagir, editar e histórico
- **Novo:** 💬 ver só uma conversa (a mensagem e todas as respostas), com voltar e envio direto dentro do fio, no app e na página web
- **Melhoria:** botão de reagir só aparece ao passar o mouse e as mensagens ficam mais compactas

## 1.32.1 — 2026-11-12
- **Correção:** corrigido: o botão Ver JSON voltou no canvas compartilhado (só leitura enquanto você não está editando; quem edita pode alterar o JSON, e JSON incompleto durante a digitação não é enviado)

## 1.32.0 — 2026-11-12
- **Novo:** ↩ Responder uma mensagem (com citação clicável) no compartilhado
- **Novo:** @nome com lista de sugestões (só quem vê o projeto, @todos) e destaque; contador @N para você (menções e respostas) na nota, no projeto e no cabeçalho
- **Novo:** aviso opcional do Windows ao ser mencionado/respondido (Preferências, desligado por padrão)
- **Melhoria:** a página web também responde, menciona e mostra o contador

## 1.31.1 — 2026-11-12
- **Correção:** corrigido: o canvas compartilhado agora mostra quem criou e quem editou: no topo (criado por / última edição de) e em cada cartão (etiqueta com o nome; passe o mouse para ver criador e editor com data); o servidor carimba a autoria

## 1.31.0 — 2026-11-12
- **Novo:** permissão por grupo de projetos (clique direito no grupo → Quem acessa este grupo…): o papel vale para todos os projetos do grupo, inclusive os novos; somado ao papel direto no projeto, vale o mais alto

## 1.30.0 — 2026-11-12
- **Novo:** grupos de projetos no compartilhado (pastas recolhíveis na lateral; a permissão continua por projeto)
- **Novo:** canvas compartilhado (Novo canvas… no projeto): um editor por vez, os outros veem ao vivo, salva sozinho, administrador pode assumir, histórico com restaurar e imagens que sobem para o servidor
- **Melhoria:** a página web mostra os grupos e abre canvas para leitura

## 1.29.0 — 2026-11-12
- **Novo:** Arquivo → Exportar a guia → PDF ou Word (.docx), com títulos, listas, tarefas, código, tabelas, links e imagens (da pasta da nota, ![[embeds]], web e data:)

## 1.28.0 — 2026-11-11
- **Novo:** envio do instalador em partes de 8 MB, com repetição automática e retomada de onde parou, e progresso na tela
- **Melhoria:** instalador menor (deixou de levar um arquivo .zip de 16 MB por engano, e .zip/.rar/.7z/.log nunca mais entram no app)

## 1.27.0 — 2026-11-11
- **Novo:** registros (logs) de atualização: no app (Ajuda → Registro de envio/download de atualização) e no servidor (server.log, linhas [atualização]) com tamanho, tempo, quem e onde falhou

## 1.26.2 — 2026-11-11
- **Correção:** corrigido: a página web do servidor dava 'Página web não encontrada' porque o app não copiava a página para a pasta do servidor
- **Correção:** corrigido: o app agora reinicia o servidor sempre que a versão do app muda (antes podia ficar com o código antigo)

## 1.26.1 — 2026-11-11
- **Correção:** melhoria de segurança: o limite de tentativas de senha passa a contar pelo endereço real de quem acessa quando o servidor é publicado pelo Tailscale Funnel/Serve (antes todos pareciam o mesmo endereço e um erro bloqueava todos)

## 1.26.0 — 2026-11-11
- **Novo:** página web do servidor (celular e navegador): abra http://ENDEREÇO:8787, entre com seu usuário e veja projetos e notas, busque, escreva, anexe foto/arquivo, marque tarefas, reaja, edite e restaure versões, com tempo real
- **Novo:** busca de texto entre as notas do servidor

## 1.25.1 — 2026-11-11
- **Correção:** corrigido: faltava a opção de apagar projeto (grupo) no compartilhado: clique direito no projeto → Apagar projeto… (só administrador; some para todos, os dados ficam guardados no servidor)

## 1.25.0 — 2026-11-11
- **Novo:** esconder imagens e vídeos nas mensagens compartilhadas — setinha em cada uma e botão Esconder imagens na nota (a escolha fica lembrada)
- **Novo:** mudança: Verificar atualização não abre mais caixa de mensagem: aparece o botão ⬇ Atualizar para X no canto superior direito, que baixa e instala ao clicar
- **Novo:** no canvas, botão ⌗ Auto/Sempre/Nunca (e Preferências) para definir o padrão de preservar espaços ao colar texto

## 1.24.0 — 2026-11-11
- **Novo:** texto, forma e fundo em cima de GIF animado nas figurinhas — a prévia anima e a figurinha sai como GIF animado
- **Correção:** canvas — texto colado com colunas alinhadas (como um calendário) mantém os espaços e as quebras também fora da edição; botão ⌗ no cartão liga e desliga o espaçamento exato
- **Novo:** mudança: o app não verifica mais atualização sozinho; só ao clicar em Ajuda → Verificar atualização

## 1.23.1 — 2026-11-11
- **Correção:** figurinhas GIF voltaram a funcionar e continuam animadas — botão 🎞 GIF no painel envia o arquivo sem alterar, e o criador tem Salvar o GIF original; o limite das figurinhas subiu para 4 MB

## 1.23.0 — 2026-11-11
- **Correção:** criador de figurinhas — a imagem não carregava (ao escolher ou colar), e agora cria e salva; ganhou fonte, negrito/itálico, tamanho, cor, contorno e texto arrastável
- **Novo:** Enter envia a mensagem e Ctrl+Enter quebra a linha
- **Novo:** ver quem está online (👥) com lista e último acesso
- **Novo:** reagir às mensagens com figurinhas
- **Novo:** arrastar as abas para mudar a ordem
- **Novo:** colar no canvas mantendo formatação, código e quebras de linha

## 1.22.0 — 2026-11-11
- **Melhoria:** conectar a um servidor agora é um formulário (endereço, usuário, senha com botão de mostrar, nome opcional) com erros na própria janela, sugestão dos endereços já usados e o último endereço já preenchido; servidor sem login ganha Entrar de novo no menu

## 1.21.1 — 2026-11-11
- **Correção:** o bloco Compartilhado ganhou a divisória para aumentar e diminuir o tamanho (arraste; duplo clique volta ao automático), além da setinha que recolhe e expande

## 1.21.0 — 2026-11-11
- **Novo:** Compartilhado virou um bloco próprio na lateral (separado de Projetos) e as notas compartilhadas abertas não aparecem mais em Arquivos abertos
- **Novo:** vários servidores ao mesmo tempo — o ＋ do bloco adiciona outro servidor, cada um com seu login, projetos e nome
- **Novo:** botão 🏷 Figurinhas (como WhatsApp/Mattermost) com Recentes, Minhas, Da equipe e Emoji grandes, e criador de figurinhas (imagem ou emoji, zoom, forma, fundo e texto) que fica salvo
- **Correção:** publicar atualização — o servidor deste computador com código antigo é reiniciado sozinho, e agora dá para confirmar/digitar a versão

## 1.20.1 — 2026-11-11
- **Melhoria:** Arquivo → Servidor neste computador → Mostrar o endereço para entrar (mostra o endereço deste computador, da rede e da VPN Tailscale, com botão Copiar)

## 1.20.0 — 2026-11-11
- **Novo:** atualização do app pelo servidor — o administrador publica o instalador (Ajuda → Publicar instalador no servidor…) e cada app conectado pergunta se quer baixar e instalar, sem navegador e sem o aviso do SmartScreen; o app fecha guardando tudo, instala em silêncio e abre de novo
- **Melhoria:** Ajuda → Verificar atualização do app (pelo servidor); o servidor deste computador reinicia sozinho com o código novo depois da atualização

## 1.19.1 — 2026-11-11
- **Correção:** o TT Note passa a se identificar no Windows com o mesmo ID do instalador, para o botão fixado na barra de tarefas não se perder ao atualizar (fixe de novo uma vez nesta versão; nas próximas atualizações deve ficar)

## 1.19.0 — 2026-11-11
- **Novo:** Arquivo → Servidor neste computador (iniciar, reiniciar, parar e iniciar com o Windows): o servidor roda em segundo plano como "TT Note Server.exe", então atualizar o app não o derruba mais e ele continua ligado mesmo com o TT Note fechado
- **Melhoria:** o servidor para com calma (grava tudo antes de sair) e a primeira vez já cria o administrador pelo app

## 1.18.0 — 2026-11-11
- **Novo:** janela de Usuários para criar, renomear, mudar cor e senha, desativar e remover (o histórico mantém o nome)
- **Novo:** janela Quem acessa o projeto com todos os usuários e papéis (só lê, escreve, edita todos, administra) e regra por nota para editar mensagens de outros (⚙ Regras)
- **Novo:** emoji, reações nas mensagens e stickers (emoji grande e imagens da equipe) nas notas compartilhadas
- **Novo:** linhas selecionadas viram tarefas (checkbox) e Ctrl+F3 seleciona todas as ocorrências da palavra
- **Novo:** canvas com árvore da estrutura (fixável), busca Ctrl+F e renomear
- **Melhoria:** Ctrl+roda muda o tamanho do texto no editor e no canvas
- **Correção:** canvas — voltar do modo JSON, quebra de linha nos cartões e texto de aviso que ficava selecionado ao arrastar o fundo

## 1.17.0 — 2026-11-11
- **Novo:** Projetos compartilhados — servidor para a equipe (TT Note.exe --servidor) e a seção ☁ Compartilhado na lateral, com login e permissão por projeto
- **Novo:** notas em trechos com o nome colorido de quem escreveu, tarefas marcadas com o nome de quem marcou, e edição do trecho de outro com histórico e restaurar versão
- **Novo:** anexos de imagem, arquivo e vídeo, marcador de não lido ao abrir e atualização em tempo real
- **Novo:** backup diário criptografado para a pasta do Google Drive e restauração; guia em docs/servidor-guia.md

## 1.16.1 — 2026-11-11
- **Correção:** dá para criar uma guia direto dentro de um grupo — clique direito no grupo → Nova guia neste grupo (ou Novo canvas neste grupo); o grupo abre e a guia já nasce dentro dele

## 1.16.0 — 2026-11-11
- **Melhoria:** imagens mostram o nome do arquivo embaixo; clique para trocar o texto mostrado (grava na nota, sem renomear o arquivo) e vazio volta ao nome
- **Melhoria:** mostrar/esconder o nome das imagens é configurado por aba (Exibir) e fica lembrado

## 1.15.0 — 2026-11-10
- **Novo:** Colar imagem com Ctrl+V nas notas Markdown, como no Obsidian — salva o arquivo (respeita a pasta de anexos do cofre) e insere ![[Pasted image ….png]] com a imagem já aparecendo
- **Novo:** Ctrl+V no canvas coloca a imagem como cartão; texto copiado vira cartão de texto
- **Melhoria:** "attachmentFolder" no settings.json escolhe a pasta de anexos quando o cofre não tem configuração do Obsidian

## 1.14.0 — 2026-11-10
- **Melhoria:** Novo canvas abre na hora, sem pedir nome nem criar arquivo — só vira .canvas quando você salvar (Ctrl+S); quadro vazio não pede para salvar ao fechar
- **Novo:** fonte e tamanho do texto do canvas (botões A− A+ e lista de fontes na barra do quadro, e Preferências → Canvas); o tamanho padrão do texto subiu para 15

## 1.13.0 — 2026-11-10
- **Novo:** Canvas — quadro infinito de cartões (Arquivo → Novo canvas): texto, notas do projeto, imagens e grupos ligados por setas, no formato .canvas do Obsidian
- **Novo:** mapa mental com Tab (cartão filho já ligado) e soltar a seta no vazio para criar outro cartão; arrastar notas e imagens da lateral ou do Explorer
- **Melhoria:** cartão de nota mostra a nota renderizada e edita direto no arquivo; zoom, enquadrar, desfazer/refazer e Ver JSON

## 1.12.0 — 2026-11-10
- **Novo:** Temas — 11 opções em Preferências → Tema (Dracula, Monokai, Nord, Tokyo Night, Gruvbox, Solarized escuro e claro, Meia-noite de alto contraste, GitHub e One Light); o padrão continua com as cores de sempre
- **Melhoria:** o tema vale para a interface, o editor, o grafo e as notas flutuantes; "Tema: alternar para o próximo" na paleta

## 1.11.1 — 2026-11-10
- **Correção:** nota solta do topo (desafixada) ganha um botão na barra de tarefas e não se perde mais atrás de outras janelas
- **Melhoria:** o ícone da bandeja agora lista todas as notas (Notas ▸) para abrir qualquer uma, mesmo as fechadas

## 1.11.0 — 2026-11-10
- **Novo:** Notas flutuantes — janelas pequenas fixadas sempre no topo (sem PowerToys), com Markdown e checklists; Ctrl+Alt+N cria uma nota de qualquer lugar do Windows
- **Novo:** ícone na bandeja do sistema (nova nota, mostrar/ocultar, abrir, sair); fechar a janela principal mantém as notas abertas
- **Melhoria:** Arquivo → Notas flutuantes, enviar a seleção ou a aba para uma nota e lista de notas na paleta; cor, fixar/soltar e posição lembrados

## 1.10.0 — 2026-11-10
- **Melhoria:** a quebra de linha normal (visual) agora vem ligada ao abrir arquivos; Ctrl+Shift+P → "Wrap" (ou Alt+Z) liga e desliga sem mexer no texto
- **Melhoria:** a quebra estilo Git (por colunas) ficou configurável em Preferências → Quebra estilo Git: ligar sozinha em arquivos de commit e largura; os comandos continuam na paleta

## 1.9.1 — 2026-11-10
- **Correção:** seleção de texto dentro de blocos de código (```) agora aparece em todas as linhas, não só na primeira; a seleção ficou mais visível

## 1.9.0 — 2026-11-10
- **Melhoria:** painel de Localizar/Substituir redesenhado (campos e botões no visual do app) e em português

## 1.8.2 — 2026-11-10
- **Correção:** ao copiar várias linhas, a quebra de linha agora vai no formato do Windows (CRLF), então o texto cola com as linhas separadas no cmd e em outros programas
- **Melhoria:** Quebra automática (Auto Wrap) e Reformatar saem dos menus e ficam só na paleta (Ctrl+Shift+P); continua ligada sozinha em COMMIT_EDITMSG

## 1.8.1 — 2026-11-09
- **Correção:** o × de fechar a aba na lateral não some mais em nomes longos (o nome é cortado com …)
- **Melhoria:** botão do meio do mouse fecha a aba na lista lateral

## 1.8.0 — 2026-11-09
- **Novo:** Formatar XML e SQL (Editar → Formatar como…); também JavaScript, CSS e HTML. Ctrl+K Ctrl+F detecta o tipo sozinho
- **Novo:** Linearizar XML e compactar SQL em uma linha
- **Melhoria:** Em arquivos Markdown o trecho formatado vai para um bloco colorido (```sql, ```xml…); formata a seleção ou o bloco do cursor
- **Melhoria:** SQL com o dialeto escolhido pelo tipo do arquivo (MySQL, PostgreSQL, T-SQL, PL/SQL…), palavras-chave em maiúsculas e recuo configuráveis em Preferências
- **Novo:** Novidades: janela com o que mudou em cada versão, que abre sozinha quando o app é atualizado, e o botão "Novidades" na barra de menus

## 1.7.0 — 2026-11-09
- **Novo:** Ctrl+K abre a busca das abas abertas: digite parte do nome, do grupo, do projeto ou do caminho e dê Enter para entrar na aba.
- **Melhoria:** A lista vem da aba usada mais recentemente para a mais antiga e já começa na anterior: Ctrl+K, Enter alterna entre as duas últimas abas.
- **Melhoria:** Os atalhos em sequência continuam funcionando (Ctrl+K Ctrl+B, Ctrl+K Ctrl+R etc.) enquanto a busca ainda está vazia.

## 1.6.0 — 2026-11-09
- **Novo:** Barra lateral: setinha em cada bloco (Arquivos abertos e Projetos) para recolher e expandir.
- **Novo:** Divisória arrastável entre os blocos para aumentar ou diminuir a lista de abas; duplo clique volta ao tamanho automático.
- **Melhoria:** A contagem de abas e de projetos aparece no título de cada bloco e o estado fica lembrado ao reabrir.

## 1.5.1 — 2026-11-09
- **Melhoria:** Instalador mais compacto (de 117 MB para 102 MB): sem idiomas extras do Chromium e sem a DLL do WebGPU, código minificado e compressão máxima. Nenhuma função foi removida.

## 1.5.0 — 2026-11-09
- **Novo:** Ctrl+Shift+T reabre a última aba fechada (e as anteriores). Rascunhos voltam com o texto.
- **Novo:** Abas lado a lado: abra duas ou mais abas em painéis (Ctrl+clique nas abas da lateral, clique direito, Comparar).
- **Novo:** Comparação com destaque das diferenças (vermelho = só na referência, verde = só nas outras), F7 e Shift+F7 para navegar e rolagem sincronizada.
- **Melhoria:** Seleção de várias abas na lateral com Ctrl/Shift+clique, layout de 2 e 3 colunas e Ctrl+K Ctrl+→ para abrir ao lado. Os painéis voltam ao reabrir o app.

## 1.4.0 — 2026-11-09
- **Novo:** Fechar sem perguntar e voltar na mesma sessão, como o Sublime e o Obsidian: ordem das abas, aba ativa, cursor e rolagem de cada aba, painéis abertos, grupos, rascunhos e alterações não salvas.
- **Melhoria:** O tamanho e a posição da janela também são lembrados. Arquivo → Sair e descartar não salvos para descartar de propósito.
- **Melhoria:** Quem prefere o aviso ao fechar pode desligar a opção "Fechar sem perguntar" em Preferências.

## 1.3.1 — 2026-11-09
- **Melhoria:** A barra de abas do topo vem escondida (as abas já ficam em Arquivos abertos); dá para mostrar em Exibir → Barra de abas no topo.
- **Correção:** O cursor sobre a lista de abas da lateral voltou a ser a seta normal, sem a mãozinha.

## 1.3.0 — 2026-11-09
- **Novo:** Rascunhos (abas sem título) e alterações não salvas são guardados e voltam ao reabrir o app, como no Sublime.
- **Correção:** A importação do Sublime pulava abas que já tinham sido importadas antes; agora só ignora o que já está aberto.
- **Melhoria:** A importação também procura o Sublime Text 3.

## 1.2.0 — 2026-11-09
- **Novo:** Quebra de linha automática (Auto Wrap) a cada N colunas ao digitar, como o pacote AutoWrap do Sublime, com réguas em 72 e 80.
- **Novo:** Liga e desliga por arquivo; COMMIT_EDITMSG já abre com a quebra ligada; Alt+Q reformata o parágrafo na largura.
- **Melhoria:** A importação do Sublime traz a largura e as réguas do seu Git Commit.sublime-settings.

## 1.1.0 — 2026-11-09
- **Novo:** Grupos e subgrupos de abas na barra lateral, só para organizar as abas abertas.
- **Novo:** Ao salvar, as pastas são criadas conforme os grupos (Clientes/Alinare vira a pasta Clientes\Alinare).
- **Melhoria:** Versionamento automático no formato 1.melhorias.ajustes.

## 1.0.0 — 2026-11-09
- **Novo:** Editor de texto com Live Preview de Markdown, multi-cursor, paleta de comandos, ir para arquivo e minimap.
- **Novo:** Barra de menus como a do Sublime, vários projetos na barra lateral e arquivos soltos (preserva a codificação ANSI e o CRLF).
- **Novo:** Importar do Sublime Text e do Obsidian, links [[wikilinks]], backlinks, tags, callouts e nota diária compatíveis com cofres do Obsidian.
- **Novo:** Formatar JSON, instalador do Windows e o ícone do TT Note.

