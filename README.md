# 🎬 Hmovie - Portal Minimalista de Filmes, Séries, TV e Esportes

**Hmovie** é uma aplicação web moderna, ultra-rápida e totalmente **adaptativa/responsiva** (desenvolvida para funcionar com perfeição em celulares, tablets, laptops, PCs e monitores Ultra-Wide 4K).

---

## 🌟 Recursos Principais

- **📱 Design 100% Adaptativo**: Interface responsiva com suporte completo a gestos de toque no celular, rolagem suave com `scroll-snap`, gaveta de menu mobile e modais dinâmicos.
- **⚡ Performance & Carregamento Progressivo**: As capas e títulos são renderizados de forma progressiva e resiliente (`Promise.allSettled`), sem travar a navegação.
- **🎥 Reprodutor Hmovie Theater Mode**: Reprodutor integrado com suporte a filmes, séries com seletor de episódios (que no celular se adapta verticalmente abaixo do vídeo sem distorcer o player) e canais de TV ao vivo/jogos.
- **🔐 Autenticação & Histórico**: Cadastro e Login de usuários com JWT, controle de sessões no Redis, histórico de *"Continuar Assistindo"* e *"Minha Lista"*.
- **⚡ Cache de Alta Performance (Redis DB 1)**: Validação de sessão e cache de histórico/favoritos em memória.
- **🛡️ Fallback Automático**: Se o banco de dados remoto MySQL ou Redis ficarem indisponíveis, o servidor ativa automaticamente um banco e cache em memória sem derrubar a aplicação.

---

## 🏗️ Arquitetura do Código Frontend (`public/app.js`)

O JavaScript do lado do cliente foi **modularizado** utilizando Namespaces organizados:

| Módulo | Responsabilidade |
| :--- | :--- |
| `Hmovie.State` | Gerenciamento reativo do estado global da aplicação. |
| `Hmovie.UI` | Manipulação de DOM, modais, sistema de **Toast Notifications**, e atalhos de teclado (tecla `ESC` para fechar players/modais). |
| `Hmovie.Router` | Roteador SPA (Single Page Application) que troca as visualizações dinamicamente. |
| `Hmovie.API` | Camada central de requisições HTTP para a API proxy interna e TMDB. |
| `Hmovie.Home` | Carregamento de episódios lançados, canais populares e destaques na tela inicial. |
| `Hmovie.Catalog` | Renderização e paginação progressiva de Filmes, Séries, Animes e Doramas. |
| `Hmovie.LiveTV` | Grade de Canais de TV ao vivo com filtro por categorias e busca rápida. |
| `Hmovie.Sports` | Agenda esportiva com status de jogos *"Ao Vivo" / "Agendado"* e suporte a múltiplas opções de transmissão. |
| `Hmovie.Player` | Reprodutor de vídeo Theater Mode, geração de embeds e montagem de episódios. |
| `Hmovie.Auth` | Gestão de conta do usuário, JWT, histórico de visualização e lista de favoritos. |

---

## 🛠️ Tecnologias Utilizadas

- **Servidor Backend**: Node.js (`http`, `fs`, `path`, `url`).
- **Frontend**: HTML5 Semântico, Vanilla CSS3 (Variáveis CSS, CSS Grid, Flexbox, Animações), JavaScript ES6+ Modular.
- **Banco de Dados Relacional**: MySQL 8 (Tabelas `users`, `history`, `watchlist`).
- **Banco em Memória**: Redis (DB 1) para cache e sessões de usuários.
- **APIs Externas Proxyfadas**: TMDB API (The Movie Database) & Superflix API.

---

## 🚀 Como Executar o Projeto

1. **Instalar Dependências**:
   ```bash
   npm install
   ```

2. **Configurar Variáveis de Ambiente (`.env`)**:
   Crie ou edite o arquivo `.env` na raiz do projeto:
   ```env
   PORT=3000
   JWT_SECRET=sua_chave_secreta_jwt
   TMDB_API_KEY=sua_chave_api_tmdb
   
   MYSQL_HOST=seu_host_mysql
   MYSQL_PORT=3306
   MYSQL_USER=seu_usuario
   MYSQL_PASSWORD=sua_senha
   MYSQL_DATABASE=hmovie_db

   REDIS_HOST=seu_host_redis
   REDIS_PORT=6379
   REDIS_PASSWORD=sua_senha_redis
   REDIS_DB=1
   ```

3. **Iniciar o Servidor**:
   ```bash
   npm start
   ```
   Acesse a aplicação no navegador em: `http://localhost:3000`

---

## 📄 Licença

Este projeto é de uso educacional e privado. Desenvolvido para proporcionar uma experiência fluida de streaming minimalista.
