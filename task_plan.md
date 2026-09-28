# Task Plan - Melhorias e Recursos do Hmovie

## 1. Diagnóstico e Mapeamento
- [x] Analisar a estrutura do código (`index.html`, `style.css`, `app.js`)
- [x] Identificar as causas dos botões de Login/Registro ficarem para fora da tela no mobile
- [x] Identificar as causas do travamento de scroll a partir do episódio 10 na lista de episódios
- [x] Mapear o comportamento do player em modo paisagem (landscape) e a ausência de seletor de episódios

## 2. Correção de Layout Mobile: Login / Registro e Header
- [x] Ajustar a barra de navegação móvel (`.navbar-container`, `.header-actions`) para garantir que botões de Entrar/Perfil, Pesquisa e Menu fiquem 100% visíveis e clicáveis em qualquer resolução (320px+)
- [x] Adicionar botão/opção de Login/Registro também dentro do drawer do menu hambúrguer para acesso fácil e intuitivo no celular
- [x] Corrigir o modal de Autenticação (`#auth-modal` e `.auth-card`) para ter scroll suave, botões de tab e botão de submit ("Entrar"/"Cadastrar") sempre visíveis e dentro da área segura da tela, com suporte a teclado virtual e safe-area (notch)

## 3. Correção de Scroll da Lista de Séries e Episódios (Detalhes e Player)
- [x] Corrigir CSS do flexbox (`min-height: 0`, `overflow-y: auto`, `-webkit-overflow-scrolling: touch`) em `.player-sidebar`, `.sidebar-list`, `.episodes-list` e `.modal-body` para permitir rolagem infinita/completa em todos os episódios (1 a 100+)
- [x] Adicionar custom scrollbar moderno e touch-action limpo
- [x] Garantir que o modal de detalhes do conteúdo (`#details-modal`) permita rolar todos os episódios suavemente em telas pequenas

## 4. Implementação do Modal / Overlay de Episódios e Temporadas no Player (Modo Paisagem e Retrato)
- [x] Adicionar botão "Episódios" na barra superior do player (`#player-episodes-btn`) com exibição inteligente em séries
- [x] Criar modal/overlay de tela cheia (`#player-episodes-overlay`) sobreposto ao player em tela cheia / landscape / portrait
- [x] Implementar troca de tela suave no modo paisagem (screen-swap) ao clicar em "Episódios"
- [x] Implementar seletor de Temporadas e grid/lista de Episódios com indicador de episódio ativo no overlay
- [x] Integrar lógica de troca de episódio via overlay com atualização em tempo real do stream sem sair do modo tela cheia/paisagem

## 5. Marcação de Episódios Assistidos & Destaque do Último Visto
- [x] Desenvolver sistema de rastreamento de episódios híbrido (banco de dados remoto MySQL/Redis para usuários logados + `localStorage` para visitantes)
- [x] Adicionar indicador visual de status para **todos os episódios já assistidos** (badge "Visto" verde com ícone `fa-check`)
- [x] Adicionar destaque com **cor diferenciada para o Último Episódio Visto** (borda âmbar/dourada `#f59e0b`, badge "Último visto" com ícone `fa-clock-rotate-left`)
- [x] Destacar o **episódio atualmente em reprodução** com gradiente roxo/neon e badge "Reproduzindo"
- [x] Aplicar a marcação em todos os 3 locais de listagem de episódios: Modal de Detalhes da Série, Sidebar do Player e Overlay de Tela Cheia / Paisagem

## 6. Validação e Testes
- [x] Testar integridade de sintaxe em JavaScript (Node.js syntax validator)
- [x] Validar balanceamento de tags HTML e propriedades CSS
- [x] Testar responsividade e visualização em breakpoints
- [x] Atualizar `progress.md` e `findings.md`
