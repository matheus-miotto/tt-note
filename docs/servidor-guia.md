# Servidor colaborativo — guia de instalação e uso

Fase 1. O servidor roda no notebook parado; o administrador e a equipe entram pelo TT Note (menu lateral **☁ Compartilhado**).

## 1. No notebook (servidor)
1. Instale o TT Note normalmente (o servidor vem dentro do app; não precisa instalar Node).
2. **Arquivo → Servidor neste computador → ▶ Iniciar servidor.** Na primeira vez o app pede o nome e a senha do administrador (mínimo 8 caracteres) e prepara o servidor (copia ~265 MB uma vez). Não abre janela e **continua rodando em segundo plano mesmo que você feche o TT Note**. A porta é a **8787** e os dados ficam em `C:\ProgramData\TT Note Server` (estado, anexos, `server.log`, `config.json`).
3. **Atualizar o app não derruba o servidor.** O servidor roda como "TT Note Server.exe" (uma cópia com outro nome, em `C:\ProgramData\TT Note Server Runtime`), então o instalador não o fecha. Depois de instalar uma versão nova, use **⟳ Reiniciar (aplica a versão nova do app)** para o servidor passar a usar o código novo; os dados não mudam.
4. **■ Parar servidor** para com calma (grava tudo antes de sair). **Iniciar junto com o Windows** (marcar/desmarcar no mesmo menu) cria um atalho oculto na pasta Inicializar, para o servidor subir sozinho quando você entrar no Windows. Também há "Abrir a pasta de dados" e "Ver o registro (server.log)".
5. Em Energia, desligue a suspensão do notebook ("Nunca suspender" na tomada).
6. Firewall: na primeira vez o Windows pergunta se libera a porta; libere **só para rede privada**. Com o Tailscale (abaixo) nem isso é necessário para a internet.

(O comando antigo `"TT Note.exe" --servidor` ainda funciona, mas esse processo se chama "TT Note.exe" e o instalador o fecha ao atualizar. Prefira o menu.)

Opções avançadas (porta, pasta) ficam em `config.json` na pasta de dados.

## 2. Acesso de fora de casa: Tailscale (VPN)
Decisão do projeto: **não abrir porta no roteador**. Use o [Tailscale](https://tailscale.com/) (grátis para até 3 usuários, e outros planos para mais).
1. Instale o Tailscale no notebook e crie a conta; convide os colegas (menu *Share*/*Users*) ou use uma conta só com os 3 aparelhos.
2. Cada colega instala o Tailscale no PC (e no celular, para a página web da fase 2).
3. No notebook, veja o endereço do Tailscale (algo como `100.x.y.z`, ou o nome `notebook.xxxx.ts.net`).
4. No TT Note de cada pessoa: lateral → **☁ Compartilhado** → informe `100.x.y.z:8787`, o usuário e a senha.

## 3. Usuários e projetos (administrador)
Clique direito em **☁ Compartilhado**:
- **Usuários…** abre uma janela única: **criar** (nome, senha, tipo, cor), **renomear** (clique no nome), **mudar a cor**, **trocar a senha** (🔑), **desativar/reativar** (impede o login sem apagar nada) e **remover** (o usuário perde o acesso e sai dos projetos, mas o que ele escreveu continua nas notas, com o nome dele marcado "removido"). Há uma caixinha "mostrar removidos". O sistema não deixa remover/desativar você mesmo nem ficar sem nenhum administrador.
- **Novo projeto…** → nome → abre **Quem acessa este projeto**.
- Clique direito num projeto: **Nova nota…**, **Quem acessa este projeto…**, **Renomear**.

### Permissões no projeto (uma lista com todos os usuários)
| Papel | O que pode |
|---|---|
| Sem acesso | Não vê o projeto |
| Só lê | Lê tudo |
| Escreve | Escreve e **edita só as próprias mensagens** (e marca tarefas) |
| Edita todos | Também **edita/apaga/restaura as mensagens dos outros** (sempre com a versão antiga guardada) |
| Administra | Tudo isso + gerencia o projeto (acessos, regras da nota, apagar nota) |
Administradores do servidor têm acesso total a todos os projetos. A mudança vale na hora.

### Regra por nota (por guia): ⚙ Regras
No cabeçalho de cada nota (visível a quem administra o projeto):
- **Seguir o papel de cada pessoa** (padrão): só quem tem "Edita todos" edita mensagens de outros.
- **Só o autor edita**: ninguém edita a mensagem de outra pessoa (só administradores).
- **Todos que escrevem editam**: qualquer um com "Escreve" edita as mensagens de todos.
Marcar tarefas continua liberado para quem escreve em qualquer regra (fica registrado quem marcou).

## 4. Como funcionam as notas
- A nota é um texto contínuo dividido em **trechos**: cada trecho mostra o **nome (colorido) de quem escreveu**, data e hora.
- Escreva na caixa de baixo (**Ctrl+Enter** envia). Cole imagens (Ctrl+V) ou use **📎 Anexar** para imagens, arquivos e vídeos.
- **Qualquer um pode editar o trecho de outro** (✎): aparece "editado por …" e a **versão anterior fica guardada**. Em 🕘 está o histórico completo, com **Restaurar esta versão**.
- **Tarefas** (`- [ ] item`): qualquer um marca/desmarca; aparece embaixo do trecho "● Fulano marcou: item · hora".
- **Apagar** (🗑) só esconde o trecho; dá para restaurar. Os botões ✎/🗑 só aparecem quando a sua permissão deixa.
- **Emoji:** o botão 😊 da caixa de texto abre o seletor (categorias, recentes). **Reações:** passe o mouse numa mensagem e use ☺＋ para reagir; clicar numa reação sua tira; o nome de quem reagiu aparece ao parar o mouse. **Stickers:** na aba *Stickers* do 😊, envie um emoji grande ou uma imagem da equipe; **＋ Adicionar sticker** envia uma imagem (até 2 MB) para todos usarem (quem enviou, ou o administrador, remove da lista; as mensagens antigas continuam mostrando a imagem).
- **Não lido:** ao abrir, o que mudou desde a sua última leitura aparece com **NOVO** e há um contador azul na lateral (projeto e nota). Não há notificação fora do app.
- Mudanças dos colegas aparecem na hora, sem atualizar.

## 5. Backup para o Google Drive
1. Instale o **Google Drive para computador** no notebook e entre na conta; ele cria uma pasta (ex.: `G:\Meu Drive`).
2. Edite `C:\ProgramData\TT Note Server\config.json` e preencha (com o servidor parado):
   ```json
   {
     "port": 8787,
     "maxFileMB": 200,
     "backup": {
       "dir": "G:\\Meu Drive\\TT Note Backup",
       "passphrase": "UMA SENHA LONGA SÓ SUA — guarde também fora do notebook",
       "hour": 3,
       "keepDaily": 14,
       "keepWeekly": 8
     }
   }
   ```
3. O servidor faz o backup **uma vez por dia** (depois das 3h, enquanto estiver ligado). Fazer agora: `"C:\ProgramData\TT Note Server Runtime\TT Note Server.exe"` com a variável `ELECTRON_RUN_AS_NODE=1` e os argumentos `"C:\ProgramData\TT Note Server Runtimepp\server\index.js" --backup-agora` (ou, com o app, `"TT Note.exe" --servidor --backup-agora`).
4. O backup vai **criptografado** (AES-256): estado em `estado-AAAA-MM-DD_HHMM.ttb` (guarda 14 diários + 8 semanais) e cada anexo copiado uma vez em `files\`.
5. **Restaurar** (em um computador novo ou depois de um problema), com a senha do backup:
   ```
   "…\TT Note.exe" --servidor --restaurar "G:\Meu Drive\TT Note Backup" --dir "C:\ProgramData\TT Note Server" --senha-backup "SUA SENHA"
   ```
   **Teste a restauração** uma vez numa pasta de teste (`--dir "C:\teste"`) para ter certeza.
- Sem a senha do backup não há como abrir os arquivos. Guarde-a em outro lugar.
- Vídeos grandes enchem o Drive (15 GB grátis): ajuste `maxFileMB` ou limpe de tempos em tempos.

## 4b. Vários servidores, bloco próprio e figurinhas
- **Bloco "Compartilhado"** na lateral, separado de "Projetos" (dá para recolher, ou esconder em Exibir → Bloco "Compartilhado"). As notas compartilhadas abertas **não aparecem em "Arquivos abertos"**: elas ficam marcadas com ● no próprio bloco, e fecham com Ctrl+W.
- **Mais de um servidor ao mesmo tempo:** o **＋** do bloco adiciona outro servidor (endereço, usuário, senha e um nome opcional, como "Equipe" ou "Cliente X"). Cada servidor tem o seu cabeçalho com a bolinha de conexão, os seus projetos e o seu login; botão direito no cabeçalho: renomear, atualizar, trocar senha, sair. Logins antigos (um servidor só) são migrados sozinhos.
- **Esconder imagens:** cada imagem ou vídeo nas mensagens tem uma setinha (▾/▸) para escondê-lo e mostrá-lo (a escolha fica lembrada), e o botão **🖼 Esconder imagens** no topo da nota esconde ou mostra todas de uma vez.
- **🏷 Figurinhas:** botão ao lado do 😊 na caixa de texto, como no WhatsApp/Mattermost. O painel mostra **Recentes**, **Minhas figurinhas**, **Da equipe** e **Emoji grandes**, com busca por nome. Clicar envia. **＋ Criar** abre o criador: imagem (arquivo, Ctrl+V ou arrastada) ou emoji, zoom e posição (arraste e roda do mouse), forma (arredondada, quadrada ou redonda), fundo transparente ou colorido e texto por cima com contorno. **Salvar na minha coleção** guarda no servidor, e fica disponível para sempre (e para a equipe usar). Apagar: × sobre a figurinha (só quem criou ou o administrador).

## 4c. Enter, online e reações com figurinha
- **Enviar:** **Enter** envia a mensagem; **Ctrl+Enter** (ou Shift+Enter) quebra a linha. Vale também ao editar uma mensagem (Enter salva).
- **Quem está online:** ao lado do nome do servidor aparece 👥 N (quantos estão com o app aberto agora) e, dentro da nota, o botão **👥 N online**. Clicar abre a lista de todos os usuários com bolinha verde para quem está online e "visto há…" para os outros. Atualiza em tempo real.
- **Reagir com figurinha:** em ☺＋ de uma mensagem, além dos emoji há a aba **Stickers** (emoji grandes e as figurinhas da equipe); a reação aparece como a imagem da figurinha com o contador, e clicar de novo tira.
- **GIF e imagem pronta como figurinha:** no painel 🏷 Figurinhas, o botão **🎞 GIF** envia o arquivo **sem alterar** (o GIF continua animado; limite de 4 MB). No criador, ao escolher um GIF a prévia **anima** e dá para pôr **texto, forma e fundo em cima**: com "manter a animação" marcado, tudo entra em todos os quadros e a figurinha sai como GIF animado (reduzido para 256 px; até 4 MB). Desmarcando, sai uma imagem parada; e **Salvar o GIF original** envia o arquivo sem alterações.
- **Criador de figurinha:** agora com **fonte** (13 opções), negrito/itálico, tamanho, cor, contorno e posição do texto (dá para arrastar o texto), além de colar com Ctrl+V, escolher arquivo ou soltar a imagem na janela. Erros aparecem na própria janela.

## 5b. Atualizar o app dos colegas pelo servidor (sem navegador e sem aviso do SmartScreen)
O aviso "normalmente não é baixado / Fornecedor desconhecido" vem do navegador (o instalador não é assinado). Baixando **pelo próprio app**, o Windows não marca o arquivo como "da internet", então o aviso não aparece.
1. **Quem publica (administrador):** com o instalador novo em mãos (`TT Note Setup X.Y.Z.exe`), Ajuda → **Publicar instalador no servidor…**, escolha o arquivo e **confirme a versão** (já vem preenchida pelo nome do arquivo; dá para corrigir). Com mais de um servidor, escolha em qual publicar. Se o servidor deste computador estiver rodando com o código antigo, o app o reinicia sozinho e tenta de novo. Se o servidor está neste mesmo computador, o arquivo é copiado direto; se está em outro, é enviado pela conexão (use a VPN: o túnel gratuito do Cloudflare recusa envios acima de ~100 MB). O servidor guarda os 2 últimos instaladores.
2. **Cada pessoa:** **não há verificação automática**: o app só consulta o servidor quando você pede, em Ajuda → **Verificar atualização do app (pelo servidor)**. Se houver versão mais nova, aparece um botão discreto **⬇ Baixar X.Y.Z** no canto superior direito (ao lado de Novidades), sem caixa de mensagem. **Você decide em duas etapas:** (1) clique em **Baixar**: o app baixa (mostra o progresso no próprio botão, confere o hash) e **continua aberto**; (2) quando terminar, o botão vira o verde **✔ Instalar X.Y.Z e reiniciar** e **espera você**: só quando você clicar nele o app fecha guardando o que estava aberto, instala em silêncio e abre de novo sozinho. Consultar de novo não baixa outra vez (mostra o botão de instalar). Botão direito esconde. Atalhos e dados ficam como estavam.
3. **No computador do servidor:** depois de atualizar por esse caminho, o servidor é reiniciado sozinho com o código novo (ele roda como "TT Note Server.exe", não é derrubado pela instalação). Se você instalou por outro meio, use Arquivo → Servidor neste computador → ⟳ Reiniciar.
4. **Só a primeira vez é manual:** quem está numa versão sem esse recurso (anterior à 1.20.0) precisa instalar a 1.20.0 pelo arquivo uma vez. Nesse primeiro arquivo o aviso do SmartScreen pode aparecer: "Mais informações → Executar assim mesmo", ou clique direito no arquivo → Propriedades → Desbloquear. Dali em diante, só pelo app.

## 4d. Grupos de projetos e canvas compartilhado
**Grupos de projetos** (só o administrador): clique direito no servidor → **Novo grupo de projetos…**; clique direito num projeto → **Mover para o grupo…**; clique direito no grupo → Novo projeto neste grupo, Renomear, Apagar (os projetos NÃO são apagados, só saem do grupo). Os grupos são pastas recolhíveis na lateral. **Permissão por grupo e por projeto**: clique direito no grupo → **Quem acessa este grupo…** e escolha o papel de cada pessoa (só lê, escreve, edita todos, administra). O papel do grupo vale para **todos os projetos do grupo**, inclusive os criados depois. Se a pessoa também tiver um papel direto num projeto, **vale o mais alto dos dois** (o grupo nunca diminui o que ela já tem no projeto; para dar MENOS num projeto específico, deixe a pessoa fora do grupo e dê o papel só nesse projeto). No projeto, a janela "Quem acessa este projeto" mostra "do grupo: …" quando o papel vem do grupo. Só o administrador do servidor cria/apaga grupos, define o acesso do grupo e move projetos entre grupos; quem administra o grupo administra os projetos dele (membros, renomear), mas não mexe no grupo. Quem não tem papel no grupo só vê o grupo se tiver acesso a algum projeto dentro dele.

**Canvas compartilhado** (um editor por vez): clique direito num projeto → **Novo canvas…** (aparece com ▦ na lista). Ao abrir, ele vem em **somente leitura**; clique em **✏️ Editar** para travar o quadro para você. Os outros veem as suas mudanças **ao vivo** e a faixa mostra "🔒 Fulano está editando". Suas mudanças são salvas sozinhas; **Terminar edição** libera. Se fechar a aba ou o app cair, a trava expira em ~90 s. O administrador pode **Assumir** a edição de outra pessoa. **🕘 Versões** lista os pontos de restauração (começo de cada edição e a cada 5 min; guarda 30) e dá para restaurar quando você está editando. Imagens coladas ou escolhidas (+ Imagem) sobem para o servidor e todos veem; o botão "+ Nota" (nota do seu computador) não existe no canvas compartilhado. **Ver JSON** funciona: mostra o texto do canvas; fica **só para leitura** enquanto você não está editando, e quem está editando pode alterar o JSON (se ele ficar incompleto durante a digitação, aparece "JSON inválido: ainda não salvo" e nada é enviado até ficar válido; os carimbos de autoria `by`/`editedBy` são do servidor e não dá para falsificar pelo JSON). **Autoria:** o topo do canvas mostra "criado por X · última edição de Y · data"; cada cartão tem uma etiqueta com o nome colorido de quem o criou (e "✎ nome" de quem mexeu por último; passe o mouse para ver os dois com data/hora). O servidor é quem carimba (o app não consegue inventar autoria); mover ou redimensionar também conta como edição. Canvas criados antes dessa versão só passam a ter etiqueta nos cartões novos ou editados. Na página web o canvas aparece só para ler (cartões em lista, com a autoria).

## 4e. Responder e mencionar (@nome)
- **↩ Responder:** em cada mensagem. A resposta fica na ordem normal da conversa, com uma citação da mensagem original em cima; clicar na citação leva até ela. Se a original for apagada, aparece "mensagem apagada". Esc cancela a resposta.
- **@nome:** digite `@` no campo de escrever e escolha na lista (só aparecem as pessoas que enxergam o projeto; Enter ou Tab escolhem). `@todos` avisa todo o projeto. Quem não tem acesso ao projeto não é mencionado (vira só texto). `@` dentro de código (`` `assim` `` ou bloco) e no meio de palavra (email@nome) não conta. Editar a mensagem para incluir uma menção também avisa.
- **Para você:** o contador **@N** (laranja) aparece na nota, no projeto e no cabeçalho "Compartilhado" (“N para você”) com as menções a você e as respostas às suas mensagens que você ainda não leu. Dentro da nota, essas mensagens ganham a marca "@ para você". Abrir a nota zera.
- **Aviso do Windows (opcional, vem desligado):** Preferências → "Compartilhado: avisar no Windows quando me mencionarem ou responderem". Só avisa quando você não está olhando aquela nota. Clicar no aviso abre a nota. Aviso com a página fechada no celular não existe.
- A página web também responde, menciona e mostra o contador.

## 4f. Mensagens seguidas e "ver só esta conversa"
- **Mensagens seguidas da mesma pessoa** (até 5 minutos entre uma e outra, sem outra pessoa ou mensagem apagada no meio) aparecem **"meio juntas"**: o nome e a hora aparecem só na primeira; as seguintes ficam coladas, sem repetir o nome. **Cada uma continua sendo uma mensagem separada**: ao passar o mouse aparecem a hora e os botões ↩ Responder, ✎ Editar, 🗑 Apagar e 🕘 Histórico, e dá para reagir a cada uma.
- **Ver só uma conversa:** uma mensagem que tem respostas mostra o botão **💬 N respostas** (e as mensagens que são respostas ou têm respostas ganham o 💬 no topo). Clicar abre **só a conversa**: a mensagem original e todas as respostas (em cadeia), com a barra "💬 Só esta conversa" no alto e o botão **← Voltar a todas as mensagens**, que leva de volta ao ponto onde você estava. Dentro da conversa, o que você escrever entra nela (responde à última mensagem do fio). Funciona no app e na página web.
- O botão de reagir (☺＋) passou a aparecer só ao passar o mouse, sem ocupar uma linha vazia embaixo de cada mensagem.

## 4g. Ocultar / exibir mensagem
- Em cada mensagem há o botão **👁** (aparece ao passar o mouse). Ao clicar, a mensagem **some e fica só o nome da pessoa** com "mensagem oculta" e o botão **👁 Exibir** (clicar na linha também exibe). **As respostas a ela (e as respostas das respostas) ficam ocultas junto**; a linha mostra quantas são.
- **Qualquer interação nova exibe a mensagem de volta sozinha**: uma resposta nova, uma reação (ou tirar uma), uma edição, uma tarefa marcada, ela ser apagada. Abrir a conversa (💬) ou clicar na citação de uma resposta que aponta para ela também a exibe.
- Vale só **no seu aparelho** (fica guardado no app/navegador; ninguém mais vê o que você ocultou e a página web do celular tem a sua própria lista). Funciona no app e na página web.

## 4h. Busca de emojis (português e inglês)
O seletor de emojis (😊 no campo de escrever e ☺＋ nas reações) agora **busca por nome e palavra-chave em português e inglês** em uma lista de ~1.600 emojis: "gato", "gat" ou "cat" acham os gatos; "coração" ou "heart", os corações; também entende o jeito de falar ("joinha", "valeu", "kkk", "parabéns", "tchau"). Ignora acento e maiúsculas, aceita só o começo da palavra e várias palavras juntas ("gato feliz"). Passar o mouse num resultado mostra o nome ("gato · cat"). Continua dando para filtrar por categoria (rostos, gestos, festa…). Mostra só emojis que o Windows 11 desenha (até o Emoji 14, sem bandeiras de países). A lista vem do pacote emojibase-data; para atualizar: `node tools/gen-emoji.js`.

## 4i. Chamar a atenção (tremer a tela, como no MSN)
Para quando a pessoa não responde. **Só funciona com a permissão de quem recebe.**
- **Quem recebe decide** (padrão: **ninguém**): clique direito no servidor → **Chamar atenção: quem pode tremer a minha tela…** e escolha **Ninguém**, **Só as pessoas que eu escolher** (com a lista para marcar) ou **Todos que dividem projeto comigo**. Só você muda isso; nem o administrador altera a sua permissão. Vale por servidor.
- **Quem chama:** na nota, o botão **📳 Chamar atenção** abre a lista das pessoas do projeto: mostra "online · aceita", "offline agora" ou "não aceita chamadas de atenção". Também há o botão 📳 ao lado de cada pessoa na janela de online. Só dá para chamar quem está **online** e **aceita você**.
- **O que acontece para quem recebe:** a janela do app **treme** (se estiver maximizada, o conteúdo treme), **pisca na barra de tarefas**, toca um **som curto** e aparece um aviso grande no topo com o nome de quem chamou e o botão "Abrir a conversa". Na página web (celular) a página treme, o celular vibra e aparece o aviso.
- **Contra abuso:** cada pessoa só pode chamar a mesma pessoa **1 vez a cada 15 s**, e no máximo **6 chamadas por minuto** no total. Fica registrado no `events.jsonl` (quem chamou quem). Não precisa projeto em comum para o administrador, mas as demais pessoas só chamam quem divide algum projeto com elas.
- A página web só **recebe** a chamada (a permissão se escolhe no app). Correção junto: a lista de "quem está online" agora já vem preenchida ao entrar (antes só atualizava quando alguém entrava ou saía).

## 5c. Página web (celular e qualquer navegador)
O próprio servidor entrega a página: abra **`http://ENDEREÇO:8787`** (com o Tailscale: `http://100.x.y.z:8787`) no navegador do celular ou do PC e entre com o mesmo usuário e senha. Nada para instalar.
- Lista de projetos e notas (com o número de não lidas), **busca** em todas as notas que você pode ver.
- Nota com os trechos de cada autor (nome colorido, data/hora), imagens, vídeos, código, tabelas, **marcar tarefas**, reagir, editar/apagar (com a mesma regra de permissão), **histórico e restaurar**.
- Escrever (Enter envia no PC; no celular o Enter quebra a linha e o botão Enviar envia), **anexar foto/arquivo/vídeo**, 📷 tirar foto na hora, colar imagem.
- Tempo real: mensagens novas aparecem sozinhas; 👥 mostra quem está online.
- No celular: menu do navegador → **Adicionar à tela inicial** para abrir como um app. O Tailscale precisa estar ligado no celular.
- Não tem (ainda): criar projeto/nota, figurinhas, regras da nota e gerenciar usuários — isso continua no app do Windows.

## 5d. Registros (logs) de atualização
Para descobrir por que uma atualização não chegou:
- **No PC que envia** (e em qualquer PC que verifica/baixa): Ajuda → **Registro de envio/download de atualização (log)**. Arquivo `update.log` em `%APPDATA%\TT Note`. Mostra: tamanho do instalador, para qual servidor foi, quanto tempo levou, e o erro exato (HTTP, tempo esgotado, conexão recusada). Nunca grava senha nem token.
- **No servidor**: `C:\ProgramData\TT Note Server\server.log`, linhas com **[atualização]**: quem enviou (usuário e endereço), tamanho declarado, progresso a cada 25 MB, se a conexão foi interrompida e quantos MB chegaram, SHA-256 no fim; e quando um cliente baixa: se recebeu completo ou interrompeu.

## 5e. Envio do instalador em partes (retomável)
Publicar um instalador para um servidor em outro computador agora envia em **partes de 8 MB**. Se a internet cair ou o túnel demorar, o app repete a parte que falhou e, se parar de vez, **na próxima tentativa continua de onde parou** (o servidor guarda o que já chegou por até 24 h). O progresso aparece numa **barra fixa no canto superior direito** (ao lado de Novidades): "Publicando 1.36.0 · 54% (176 de 320 MB)", depois "conferindo no servidor…" e, no fim, o verde "✔ Versão publicada" (some sozinho em alguns segundos). Se falhar, a barra fica vermelha com o motivo até você clicar nela (passe o mouse para ver a mensagem inteira). Servidores antigos, sem essa função, continuam recebendo de uma vez só. Os registros (seção 5d) mostram cada parte.

## 6. Limites da fase 1 (o que ainda não existe)
- Página web (celular/navegador) e busca: prontos (seção 5c). Falta nela: criar projeto/nota, figurinhas e administração.
- Se a rede cair, o app avisa e **guarda o que você digitou na caixa**, mas só envia quando você clicar em Enviar com a conexão de volta (fila offline completa: fase 3).
- Administração de usuários é feita no app (sem tela de histórico de acessos); o registro de ações fica em `events.jsonl` na pasta de dados.
- Canvas compartilhado: fase 3.

## 7. Testes
`npm run servidor:teste` (inclui as atualizações pelo servidor) sobe servidores temporários e verifica login, permissões (inclusive as regras por nota), histórico, tarefas, não lidos, tempo real, anexos (com Range), reações, stickers, remoção de usuário, backup criptografado e restauração (90 verificações).
