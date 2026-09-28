# Findings & Notebook de Descobertas e Bugs (Hmovie)

## 1. Problema dos Botões de Login e Registro Fora da Tela
- **Causa 1 (Navbar Mobile):** Múltiplos elementos disputando espaço estreito (320px–400px), empurrando o botão "Entrar" para fora do viewport.
- **Causa 2 (Menu Hambúrguer sem Auth):** O menu gaveta não tinha opção de Entrar/Registrar/Logout, dependendo apenas do header estreito.
- **Causa 3 (Modal de Autenticação):** Falta de `overflow-y: auto` e safe-area-padding cortava campos e botões em telas pequenas ou com teclado virtual.
- **Solução:** Seção de auth no drawer, centralização automática do modal, scroll touch e overscroll containment.

## 2. Problema de Rolagem de Episódios a partir do Ep 10
- **Causa 1 (CSS Flexbox sem `min-height: 0`):** `.player-sidebar` e `.sidebar-list` expandiam além da tela dentro de `.player-body` com `overflow: hidden`, cortando episódios 10+.
- **Causa 2 (Modal de Detalhes):** `.episodes-list` com `max-height: 160px` fixo dentro de `.modal-body` gerando conflito de scroll aninhado.
- **Solução:** `min-height: 0` + `overflow-y: auto` nos containers flexbox; scroll touch e overscroll containment.

## 3. Falta de Seletor de Episódios no Modo Paisagem (Landscape)
- **Causa 1 (`display: none !important`):** A media query landscape escondia `.player-sidebar` completamente sem alternativa.
- **Causa 2 (Escopo JS / IIFE):** `Player` não estava exposto no `window`, causando `ReferenceError` nos handlers inline do HTML.
- **Causa 3 (Overlay flutuante sobre o player):** Abordagem inicial de overlay com backdrop não funcionava bem em telas estreitas de landscape.

### Solução Final: Troca de Tela (Screen Swap)
Em vez de um overlay flutuante, implementamos **troca de tela completa**:
- Ao clicar "Episódios" no landscape: o player (vídeo) desaparece completamente e a lista de episódios ocupa a tela inteira.
- Ao selecionar um episódio: a lista fecha e o player volta com o novo episódio carregando.
- Controlado pela classe CSS `episodes-mode` no `#player-modal`:
  - `.player-window.episodes-mode .player-body { display: none }` — esconde o vídeo
  - `.player-window.episodes-mode .player-episodes-overlay` — vira `position: relative; flex: 1` (tela cheia sólida)
  - `.player-window:not(.episodes-mode) .player-episodes-overlay { display: none }` — esconde a lista quando está no player
- No modo retrato/desktop, o overlay continua funcionando como overlay flutuante normalmente.
