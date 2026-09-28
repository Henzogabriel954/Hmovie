# 📚 Documentação Técnica Completa da SuperFlixAPI & Hmovie

Documentação baseada na referência oficial em [superflixapi.pro/doc](https://superflixapi.pro/doc) e na implementação do **Hmovie**.

---

## 🏛️ 1. Visão Geral da Arquitetura

O Hmovie utiliza a **SuperFlixAPI** para catálogo, transmissões e reprodução, combinada com a **TMDB API** para metadados e o **Redis** para cache.

```
[ Usuário / Navegador ]
         │
         ▼
[ Backend Proxy Node.js (routes/proxy.js) ]
   ├── SuperFlixAPI (superflixapi.pro) ──> Catálogo, Canais, Jogos, Calendário e Player
   ├── TMDB API (themoviedb.org) ─────────> Sinopses em PT-BR, Banners, Notas e Duração
   └── Redis Cache (DB 1) ────────────────> Cache de 24h para alta performance
```

---

## 🎬 2. Endpoint `/lista` (Catálogo e Dados)

O endpoint `/lista` é a central de dados da SuperFlixAPI. No Hmovie, o backend faz o proxy em `/api/lista`.

### 2.1. Parâmetros Aceitos

| Parâmetro | Valores Possíveis | Descrição |
| :--- | :--- | :--- |
| `category` | `filme`, `serie`, `anime`, `dorama`, `canais`, `eventos`, `channel_categories`, `event_categories`, `guia`, `pesquisa` | Categoria de consulta desejada |
| `type` | `tmdb`, `imdb`, `generos` | Tipo de identificador retornado ou listagem de gêneros |
| `format` | `json`, `html` | Formato da resposta (utilizamos sempre `json`) |
| `genero` | `slug_do_genero` (ex: `acao`, `comedia`) | Filtra os itens por gênero |
| `q` | texto de busca (ex: `batman`) | Termo de pesquisa (quando `category=pesquisa`) |
| `limit` | número (ex: `20`) | Limite de resultados na pesquisa |
| `sport` | esporte (ex: `futebol`) | Filtra eventos esportivos |
| `status` | status do jogo | Filtra eventos ao vivo / agendados |

---

### 2.2. Exemplos de Consultas

#### 🎥 Catálogo de Filmes / Séries / Animes / Doramas
```http
GET /api/lista?category=filme&type=tmdb&format=json
GET /api/lista?category=serie&type=tmdb&format=json
GET /api/lista?category=anime&type=tmdb&format=json
GET /api/lista?category=dorama&type=tmdb&format=json
```
- **Retorno**: Lista de IDs do TMDB disponíveis para streaming no servidor.

#### 🏷️ Gêneros de Conteúdo
```http
GET /api/lista?category=filme&type=generos&format=json
GET /api/lista?category=serie&type=generos&format=json
```

#### 🔍 Filtrar Catálogo por Gênero
```http
GET /api/lista?category=filme&type=tmdb&genero=acao&format=json
GET /api/lista?category=serie&type=tmdb&genero=animacao&format=json
```

#### 📺 Canais de TV Ao Vivo
```http
GET /api/lista?category=canais&format=json
GET /api/lista?category=channel_categories&format=json
GET /api/lista?category=guia&format=json
```
- **Retorno**: Lista de canais com `name`, `category`, `logo_url` e link de stream/embed.

#### ⚽ Eventos Esportivos e Futebol Ao Vivo
```http
GET /api/lista?category=eventos&format=json
GET /api/lista?category=event_categories&format=json
```
- **Retorno**: Lista de partidas com `title`, `competition`, `event_logo`, `competition_logo`, `play_event_url`, `play_event_direct_url` e `embeds`.

#### 🔎 Pesquisa Direta na SuperFlixAPI
```http
GET /api/lista?category=pesquisa&q=Vingadores&format=json&limit=20
```

---

## 📅 3. Endpoint de Calendário (Lançamentos Recentes)

```http
GET /api/calendario
```
- **URL Real**: `https://superflixapi.pro/calendario.php`
- **Descrição**: Dados em tempo real sobre episódios lançados recentemente.
- **Campos retornados**:
  - `title`: Nome da produção
  - `season`: Número da temporada
  - `number`: Número do episódio
  - `episode`: Nome/título do episódio
  - `tmdb_id`: ID TMDB
  - `poster` / `backdrop`: Caminhos das imagens
  - `type`: `1` (Série), `3` (Anime), `5` (Dorama)

---

## 🎥 4. Reprodutor de Streaming (Embed Iframe)

O player do SuperFlixAPI suporta reprodução direta de Filmes, Séries, Animes e Doramas usando IDs TMDB ou IMDb.

### 4.1. Estrutura de URLs

- **Filme por ID TMDB**:
  ```
  https://superflixapi.pro/filme/{TMDB_ID}
  ```
  *Exemplo:* `https://superflixapi.pro/filme/550`

- **Filme por ID IMDb**:
  ```
  https://superflixapi.pro/filme/{IMDB_ID}
  ```
  *Exemplo:* `https://superflixapi.pro/filme/tt0068646`

- **Séries, Animes e Doramas (Player Geral)**:
  ```
  https://superflixapi.pro/serie/{TMDB_OU_IMDB_ID}
  ```
  *Exemplo:* `https://superflixapi.pro/serie/1396`

- **Séries, Animes e Doramas (Episódio Específico)**:
  ```
  https://superflixapi.pro/serie/{ID}/{TEMPORADA}/{EPISODIO}
  ```
  *Exemplo:* `https://superflixapi.pro/serie/1396/1/1`

---

### 4.2. Parâmetros de Personalização do Player (Hash `#`)

É possível passar parâmetros ao final da URL do iframe usando hash `#` para customizar o player:

| Parâmetro | Exemplo | Efeito |
| :--- | :--- | :--- |
| `#color:{HEX}` | `#color:7c3aed` ou `#color:ff0000` | Altera a cor dos botões e controles do player (sem a `#` no código hex). |
| `#noEpList` | `#noEpList` | Oculta a lista nativa de episódios do player (ideal quando temos nossa própria lista). |
| `#noLink` | `#noLink` | Remove o botão de link externo no player. |
| `#transparent` | `#transparent` | Deixa o fundo do player transparente. |

#### Exemplo com múltiplos parâmetros combinados:
```
https://superflixapi.pro/serie/1396/1/1#color:7c3aed#noEpList#noLink#transparent
```

---

## 📁 5. Arquivos de Implementação no Projeto

- **Proxy Backend**: [`routes/proxy.js`](routes/proxy.js)
- **Servidor HTTP**: [`server.js`](server.js)
- **Camada de Dados & Player Frontend**: [`public/app.js`](public/app.js)
- **Variáveis de Ambiente**: `.env`
