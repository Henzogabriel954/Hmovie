/**
 * @file app.js
 * @description Hmovie - Engine Modularizado de Aplicação Web (Filmes, Séries, Animes, TV e Esportes)
 * @author Deepmind Antigravity Team
 * @version 2.0.0
 */

'use strict';

/**
 * Namespace Principal do Hmovie
 * @namespace Hmovie
 */
const Hmovie = (function () {

  // =========================================================================
  // 1. ESTADO GLOBAL DA APLICAÇÃO (STATE MANAGEMENT)
  // =========================================================================
  const state = {
    activeView: 'home',
    playerColor: localStorage.getItem('player_color') || '7c3aed',
    prefNoEpList: localStorage.getItem('pref_no_ep_list') !== 'false',
    prefNoLink: localStorage.getItem('pref_no_link') !== 'false',
    prefTransparent: localStorage.getItem('pref_transparent') !== 'false',

    // Estado do Usuário Autenticado
    userToken: localStorage.getItem('hmovie_token') || '',
    currentUser: null,
    authMode: 'login',

    // Listas em memória
    tvChannels: [],
    sportsEvents: [],
    recentEpisodes: [],
    userHistory: [],
    userWatchlist: [],

    // Estado do Catálogo Ativo
    catalog: {
      category: '',
      genre: '',
      searchQuery: '',
      items: [],
      loadedCount: 0,
      pageSize: 24,
      type: 'movie',
      loading: false
    },

    activeShow: null,
    activePlayer: null,
    heroItem: null
  };

  const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p';

  // =========================================================================
  // 2. SISTEMA DE CACHE LOCAL PERSISTENTE (24H LOCALSTORAGE + MEMÓRIA RAM)
  // =========================================================================
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Horas em milissegundos

  const cache = {
    meta: new Map(),
    details: new Map(),
    seasons: new Map(),

    get(type, key) {
      if (this[type] && this[type].has(key)) {
        return this[type].get(key);
      }
      try {
        const itemStr = localStorage.getItem(`hm_cache_${type}_${key}`);
        if (itemStr) {
          const item = JSON.parse(itemStr);
          if (Date.now() - item.timestamp < CACHE_TTL_MS) {
            if (this[type]) this[type].set(key, item.data);
            return item.data;
          } else {
            localStorage.removeItem(`hm_cache_${type}_${key}`);
          }
        }
      } catch (e) {}
      return null;
    },

    set(type, key, data) {
      if (!data) return;
      if (this[type]) this[type].set(key, data);
      try {
        localStorage.setItem(`hm_cache_${type}_${key}`, JSON.stringify({
          timestamp: Date.now(),
          data: data
        }));
      } catch (e) {
        this.cleanOldStorage();
      }
    },

    cleanOldStorage() {
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('hm_cache_')) localStorage.removeItem(k);
        });
      } catch (e) {}
    }
  };

  // =========================================================================
  // 3. SISTEMA DE NOTIFICAÇÕES TOAST (UX ENHANCEMENTS)
  // =========================================================================
  /**
   * Exibe uma mensagem Toast elegante na tela do usuário.
   * @param {string} message - Texto da notificação.
   * @param {'success'|'error'|'info'} type - Tipo da notificação.
   * @param {number} duration - Tempo em milissegundos para desaparecer.
   */
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // =========================================================================
  // 4. CLIENTE DE API (API LAYER)
  // =========================================================================
  const API = {
    /**
     * Faz requisições HTTP para a API interna do Node.js.
     * @param {string} url - Endpoint relativo ou absoluto.
     * @returns {Promise<any>}
     */
    async fetchJSON(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      return res.json();
    },

    /**
     * Busca metadados resumidos de um item TMDB com cache de 24 horas.
     * @param {string} type - 'movie' ou 'tv'
     * @param {string|number} id - ID no TMDB
     * @returns {Promise<object|null>}
     */
    async fetchTMDBMeta(type, id) {
      const key = `${type}_${id}`;
      const cached = cache.get('meta', key);
      if (cached) return cached;

      try {
        const data = await this.fetchJSON(`/api/tmdb/${type}/${id}`);
        if (data) cache.set('meta', key, data);
        return data;
      } catch (e) { return null; }
    },

    /**
     * Busca detalhes completos de um filme/série no TMDB com cache de 24 horas.
     * @param {string} type - 'movie' ou 'tv'
     * @param {string|number} id - ID no TMDB
     * @returns {Promise<object|null>}
     */
    async fetchTMDBDetails(type, id) {
      const key = `${type}_${id}`;
      const cached = cache.get('details', key);
      if (cached) return cached;

      try {
        const data = await this.fetchJSON(`/api/tmdb/${type}/${id}`);
        if (data) cache.set('details', key, data);
        return data;
      } catch (e) { return null; }
    },

    /**
     * Busca os episódios de uma temporada específica com cache de 24 horas.
     * @param {string|number} tvId - ID da série no TMDB
     * @param {string|number} seasonNum - Número da temporada
     * @returns {Promise<object|null>}
     */
    async fetchTMDBSeason(tvId, seasonNum) {
      const key = `${tvId}_s${seasonNum}`;
      const cached = cache.get('seasons', key);
      if (cached) return cached;

      try {
        const data = await this.fetchJSON(`/api/tmdb/tv/${tvId}/season/${seasonNum}`);
        if (data) cache.set('seasons', key, data);
        return data;
      } catch (e) { return null; }
    }
  };

  // =========================================================================
  // 5. INICIALIZAÇÃO DE UI & EVENTOS GLOBAIS
  // =========================================================================
  function initUI() {
    // Links de navegação do menu desktop e drawer mobile
    const navLinks = document.querySelectorAll('.nav-link[data-view], .btn-settings-icon[data-view]');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        Router.switchView(view);
        UI.closeMobileDrawer();
      });
    });

    // Toggle do menu hambúrguer no celular
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('mobile-menu-drawer').classList.toggle('show');
      });
    }

    // Fechar menu mobile ao clicar fora
    document.addEventListener('click', (e) => {
      const drawer = document.getElementById('mobile-menu-drawer');
      const btn = document.getElementById('mobile-menu-btn');
      if (drawer && drawer.classList.contains('show') && !drawer.contains(e.target) && !btn.contains(e.target)) {
        drawer.classList.remove('show');
      }
    });

    // Atalhos globais de teclado (Teclas ESC e ENTER)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        Player.close();
        UI.closeModal('details-modal');
        UI.closeModal('auth-modal');
      }
    });

    // Botões de ação da Hero Showcase
    document.getElementById('hero-play-btn')?.addEventListener('click', () => {
      if (state.heroItem) Player.playItem(state.heroItem);
    });
    document.getElementById('hero-info-btn')?.addEventListener('click', () => {
      if (state.heroItem) Catalog.openDetails(state.heroItem);
    });

    // Rolagem horizontal por botões nos carrosséis
    UI.setupScroll('btn-prev-releases', 'btn-next-releases', 'releases-carousel');
    UI.setupScroll('btn-prev-channels', 'btn-next-channels', 'channels-carousel');
    UI.setupScroll('btn-prev-continue', 'btn-next-continue', 'continue-watching-row');

    // Barra de Pesquisa Global com Debounce
    const searchInput = document.getElementById('global-search');
    const clearBtn = document.getElementById('clear-search-btn');
    let debounceTimer;

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          Catalog.handleSearch(q);
        }, 400);
      });

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          searchInput.value = '';
          clearBtn.style.display = 'none';
          Catalog.handleSearch('');
        });
      }
    }

    // Modal de Autenticação
    document.getElementById('btn-open-login')?.addEventListener('click', () => UI.openModal('auth-modal'));
    document.getElementById('btn-logout')?.addEventListener('click', Auth.handleLogout);

    // Salvar Preferências de Configuração
    document.getElementById('btn-save-settings')?.addEventListener('click', UI.saveSettings);

    // Seleção de Cores do Reprodutor
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const customInput = document.getElementById('player-custom-color');
        if (customInput) customInput.value = '';
        state.playerColor = e.currentTarget.dataset.color;
        localStorage.setItem('player_color', state.playerColor);
        showToast('Cor do reprodutor alterada com sucesso!', 'info');
      });
    });

    document.getElementById('player-custom-color')?.addEventListener('input', (e) => {
      let color = e.target.value.trim().replace('#', '');
      if (color.length === 6) {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        state.playerColor = color;
        localStorage.setItem('player_color', state.playerColor);
        showToast('Cor personalizada aplicada!', 'info');
      }
    });

    // Carregar Mais no Catálogo
    document.getElementById('load-more-btn')?.addEventListener('click', () => {
      Catalog.loadNextPage();
    });

    // Botões "Ver Todos" das seções
    document.querySelectorAll('.view-all-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        Router.switchView(e.currentTarget.dataset.target);
      });
    });
  }

  // =========================================================================
  // 6. CONTROLADOR DE INTERFACE E MODAIS (UI MODULE)
  // =========================================================================
  const UI = {
    openModal(id) {
      document.getElementById(id)?.classList.add('show');
    },
    closeModal(id) {
      document.getElementById(id)?.classList.remove('show');
    },
    closeMobileDrawer() {
      document.getElementById('mobile-menu-drawer')?.classList.remove('show');
    },
    setupScroll(prevId, nextId, rowId) {
      const prev = document.getElementById(prevId);
      const next = document.getElementById(nextId);
      const row = document.getElementById(rowId);
      if (prev && next && row) {
        prev.onclick = () => row.scrollBy({ left: -360, behavior: 'smooth' });
        next.onclick = () => row.scrollBy({ left: 360, behavior: 'smooth' });
      }
    },
    loadAppState() {
      const noEp = document.getElementById('pref-no-ep-list');
      const noLink = document.getElementById('pref-no-link');
      const transparent = document.getElementById('pref-transparent');

      if (noEp) noEp.checked = state.prefNoEpList;
      if (noLink) noLink.checked = state.prefNoLink;
      if (transparent) transparent.checked = state.prefTransparent;

      const swatches = document.querySelectorAll('.color-btn');
      let matched = false;
      swatches.forEach(swatch => {
        if (swatch.dataset.color === state.playerColor) {
          swatch.classList.add('active');
          matched = true;
        } else {
          swatch.classList.remove('active');
        }
      });

      const customInput = document.getElementById('player-custom-color');
      if (customInput) customInput.value = matched ? '' : state.playerColor;
    },
    saveSettings() {
      state.prefNoEpList = document.getElementById('pref-no-ep-list').checked;
      state.prefNoLink = document.getElementById('pref-no-link').checked;
      state.prefTransparent = document.getElementById('pref-transparent').checked;

      localStorage.setItem('pref_no_ep_list', state.prefNoEpList);
      localStorage.setItem('pref_no_link', state.prefNoLink);
      localStorage.setItem('pref_transparent', state.prefTransparent);

      showToast('Preferências salvas com sucesso!', 'success');
    }
  };

  // =========================================================================
  // 7. SISTEMA DE ROTAS E NAVEGAÇÃO (ROUTER MODULE)
  // =========================================================================
  const Router = {
    switchView(viewName) {
      state.activeView = viewName;

      document.querySelectorAll('.nav-link').forEach(link => {
        if (link.dataset.view === viewName) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });

      document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
      window.scrollTo({ top: 0, behavior: 'smooth' });

      switch (viewName) {
        case 'home':
          document.getElementById('view-home')?.classList.add('active');
          Home.load();
          break;
        case 'movies':
          document.getElementById('view-catalog')?.classList.add('active');
          Catalog.initView('filme', 'movie', 'Filmes');
          break;
        case 'series':
          document.getElementById('view-catalog')?.classList.add('active');
          Catalog.initView('serie', 'tv', 'Séries');
          break;
        case 'animes':
          document.getElementById('view-catalog')?.classList.add('active');
          Catalog.initView('anime', 'tv', 'Animes');
          break;
        case 'doramas':
          document.getElementById('view-catalog')?.classList.add('active');
          Catalog.initView('dorama', 'tv', 'Doramas');
          break;
        case 'watchlist':
          document.getElementById('view-watchlist')?.classList.add('active');
          Auth.loadWatchlistView();
          break;
        case 'live-tv':
          document.getElementById('view-live-tv')?.classList.add('active');
          LiveTV.loadView();
          break;
        case 'sports':
          document.getElementById('view-sports')?.classList.add('active');
          Sports.loadView();
          break;
        case 'settings':
          document.getElementById('view-settings')?.classList.add('active');
          UI.loadAppState();
          break;
      }
    }
  };

  // =========================================================================
  // 8. MÓDULO DA TELA INICIAL (HOME MODULE)
  // =========================================================================
  const Home = {
    async load() {
      try {
        const calendarData = await API.fetchJSON('/api/calendario');
        state.recentEpisodes = Array.isArray(calendarData) ? calendarData : [];
        this.renderRecentEpisodes(state.recentEpisodes);

        if (state.recentEpisodes.length > 0 && !state.heroItem) {
          const idx = Math.floor(Math.random() * Math.min(8, state.recentEpisodes.length));
          this.setupHero(state.recentEpisodes[idx]);
        }
      } catch (err) { console.error('Erro ao carregar episódios recentes:', err); }

      try {
        const channelsRes = await API.fetchJSON('/api/lista?category=canais&format=json');
        if (channelsRes && channelsRes.success) {
          state.tvChannels = channelsRes.data || [];
          this.renderChannelsHighlight(state.tvChannels.slice(0, 14));
        }
      } catch (err) { console.error('Erro ao carregar canais populares:', err); }

      try {
        const eventsRes = await API.fetchJSON('/api/lista?category=eventos&format=json');
        if (eventsRes && eventsRes.success) {
          state.sportsEvents = eventsRes.data || [];
          this.renderSportsHighlights(state.sportsEvents.slice(0, 5));
        }
      } catch (err) { console.error('Erro ao carregar jogos de hoje:', err); }
    },

    setupHero(item) {
      state.heroItem = item;
      const titleEl = document.getElementById('hero-title');
      const descEl = document.getElementById('hero-desc');
      const tagEl = document.getElementById('hero-tag');
      const bgEl = document.getElementById('hero-bg');

      if (titleEl) titleEl.textContent = item.title || 'Hmovie Portal';
      if (descEl) descEl.textContent = item.episode ? `Temporada ${item.season}, Episódio ${item.number}: "${item.episode}"` : 'Assista ao conteúdo pelo reprodutor minimalista.';
      if (tagEl) tagEl.textContent = item.status || 'Destaque Hmovie';

      if (bgEl) {
        if (item.backdrop) bgEl.style.backgroundImage = `url(${TMDB_IMAGE_URL}/original${item.backdrop})`;
        else if (item.poster) bgEl.style.backgroundImage = `url(${TMDB_IMAGE_URL}/original${item.poster})`;
        else bgEl.style.backgroundImage = 'linear-gradient(135deg, #181826, #08080d)';
      }
    },

    renderRecentEpisodes(episodes) {
      const container = document.getElementById('releases-carousel');
      if (!container) return;
      container.innerHTML = '';

      if (!episodes || episodes.length === 0) {
        container.innerHTML = '<div class="notice-box">Nenhum episódio no momento.</div>';
        return;
      }

      const grouped = this.groupEpisodes(episodes);

      grouped.forEach(item => {
        const card = document.createElement('div');
        card.className = 'movie-card';

        let typeTag = 'série';
        let typeClass = 'type-serie';
        if (item.type === 3) { typeTag = 'anime'; typeClass = 'type-anime'; }
        else if (item.type === 5) { typeTag = 'dorama'; typeClass = 'type-dorama'; }

        const poster = item.poster ? `${TMDB_IMAGE_URL}/w342${item.poster}` : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=342&auto=format&fit=crop';
        const epBadgeText = (item.minNumber === item.maxNumber)
          ? `${item.season}T ${item.minNumber} Ep`
          : `${item.season}T ${item.minNumber}-${item.maxNumber} Ep`;

        const epSubTitle = (item.minNumber === item.maxNumber)
          ? (item.episode || `Episódio ${item.minNumber}`)
          : `Episódios ${item.minNumber} ao ${item.maxNumber}`;

        card.innerHTML = `
          <div class="card-poster-wrapper">
            <img class="card-poster" src="${poster}" alt="${item.title}" loading="lazy" decoding="async">
            <div class="card-overlay"><div class="card-play-icon"><i class="fa-solid fa-play"></i></div></div>
            <span class="card-badge ${typeClass}">${typeTag}</span>
          </div>
          <div class="card-details">
            <div class="card-title">${item.title}</div>
            <div class="card-subtitle">${epSubTitle}</div>
            <span class="card-ep-label">${epBadgeText}</span>
          </div>
        `;

        card.onclick = () => {
          if (item.minNumber === item.maxNumber) {
            Player.playItem({
              type: 'serie',
              id: item.tmdb_id,
              season: item.season,
              episode: item.maxNumber,
              title: item.title,
              poster: item.poster,
              subtitle: `T${item.season}: E${item.maxNumber} - ${item.episode || ''}`
            });
          } else {
            Catalog.openDetails({ type: 'tv', id: item.tmdb_id });
          }
        };

        container.appendChild(card);
      });
    },

    groupEpisodes(episodes) {
      const groupsMap = new Map();
      episodes.forEach(ep => {
        const seasonNum = ep.season || 1;
        const key = `${ep.tmdb_id || ep.title}_S${seasonNum}`;
        const epNum = parseInt(ep.number || 1, 10);

        if (!groupsMap.has(key)) {
          groupsMap.set(key, { ...ep, minNumber: epNum, maxNumber: epNum, episodesList: [ep] });
        } else {
          const existing = groupsMap.get(key);
          existing.minNumber = Math.min(existing.minNumber, epNum);
          existing.maxNumber = Math.max(existing.maxNumber, epNum);
          existing.episodesList.push(ep);
        }
      });
      return Array.from(groupsMap.values());
    },

    renderChannelsHighlight(channels) {
      const container = document.getElementById('channels-carousel');
      if (!container) return;
      container.innerHTML = '';

      channels.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.innerHTML = `
          <div class="channel-logo-wrapper">
            <img class="channel-logo" src="${ch.logo_url}" alt="${ch.name}" loading="lazy" decoding="async" onerror="this.parentNode.innerHTML='<i class=\\'fa-solid fa-satellite-dish\\' style=\\'font-size:1.5rem;color:#7c3aed\\'></i>'">
          </div>
          <div class="channel-name">${ch.name}</div>
          <div class="channel-genre">${ch.category || 'TV'}</div>
        `;
        card.onclick = () => Player.playChannel(ch);
        container.appendChild(card);
      });
    },

    renderSportsHighlights(events) {
      const container = document.getElementById('sports-highlights');
      if (!container) return;
      container.innerHTML = '';
      events.forEach(ev => container.appendChild(Sports.createRow(ev)));
    }
  };

  // =========================================================================
  // 9. MÓDULO DO CATÁLOGO DE MÍDIAS (CATALOG MODULE)
  // =========================================================================
  const Catalog = {
    async initView(category, type, title) {
      state.catalog.category = category;
      state.catalog.type = type;
      state.catalog.genre = '';
      state.catalog.searchQuery = '';
      state.catalog.items = [];
      state.catalog.loadedCount = 0;

      const titleEl = document.getElementById('catalog-title');
      const gridEl = document.getElementById('catalog-grid');
      const genresEl = document.getElementById('genres-container');
      const gridWrap = document.querySelector('.catalog-grid-wrapper');

      if (titleEl) titleEl.textContent = title;
      if (gridEl) gridEl.innerHTML = '';
      if (genresEl) genresEl.innerHTML = '';
      if (gridWrap) gridWrap.style.display = 'block';

      try {
        const genresRes = await API.fetchJSON(`/api/lista?category=${category}&type=generos&format=json`);
        if (genresRes && genresRes.success) this.renderGenres(genresRes.data);
      } catch (e) { console.error('Erro ao carregar gêneros:', e); }

      this.loadItems();
    },

    renderGenres(genres) {
      const container = document.getElementById('genres-container');
      if (!container || !Array.isArray(genres)) return;
      container.innerHTML = '';

      const allBtn = document.createElement('button');
      allBtn.className = 'genre-pill active';
      allBtn.textContent = 'Todos';
      allBtn.onclick = (e) => {
        document.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
        e.target.classList.add('active');
        state.catalog.genre = '';
        state.catalog.items = [];
        state.catalog.loadedCount = 0;
        document.getElementById('catalog-grid').innerHTML = '';
        this.loadItems();
      };
      container.appendChild(allBtn);

      genres.sort((a, b) => (b.items_count || 0) - (a.items_count || 0)).slice(0, 12).forEach(g => {
        const pill = document.createElement('button');
        pill.className = 'genre-pill';
        pill.textContent = g.name;
        pill.onclick = (e) => {
          document.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('active'));
          e.target.classList.add('active');
          state.catalog.genre = g.slug;
          state.catalog.items = [];
          state.catalog.loadedCount = 0;
          document.getElementById('catalog-grid').innerHTML = '';
          this.loadItems();
        };
        container.appendChild(pill);
      });
    },

    async loadItems() {
      if (state.catalog.loading) return;
      state.catalog.loading = true;

      const loader = document.getElementById('catalog-loader');
      const loadMoreBtn = document.getElementById('load-more-btn');

      if (loader) loader.style.display = 'flex';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';

      try {
        if (state.catalog.items.length === 0) {
          let endpoint = `/api/lista?category=${state.catalog.category}&type=tmdb&format=json`;
          if (state.catalog.genre) endpoint += `&genero=${state.catalog.genre}`;
          const res = await API.fetchJSON(endpoint);

          let ids = [];
          if (Array.isArray(res)) {
            ids = res;
          } else if (res && Array.isArray(res.data)) {
            ids = res.data.map(item => typeof item === 'object' ? (item.tmdb_id || item.imdb_id || item.id) : item);
          }
          state.catalog.items = ids.filter(Boolean);
        }
        await this.loadNextPage();
      } catch (err) {
        console.error('Erro ao carregar itens do catálogo:', err);
        const grid = document.getElementById('catalog-grid');
        if (grid) grid.innerHTML = '<div class="notice-box">Erro ao carregar os itens desta seção. Tente novamente.</div>';
      } finally {
        state.catalog.loading = false;
        if (loader) loader.style.display = 'none';
      }
    },

    async loadNextPage() {
      const start = state.catalog.loadedCount;
      const end = Math.min(start + state.catalog.pageSize, state.catalog.items.length);
      const loadMoreBtn = document.getElementById('load-more-btn');

      if (start >= state.catalog.items.length) {
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        return;
      }

      const ids = state.catalog.items.slice(start, end);
      const grid = document.getElementById('catalog-grid');
      state.catalog.loadedCount = end;

      // Renderização Progressiva Responsiva
      const fetchPromises = ids.map(async (id) => {
        try {
          const meta = await API.fetchTMDBMeta(state.catalog.type, id);
          if (meta && (meta.title || meta.name) && grid) {
            grid.appendChild(this.createCard(meta));
          }
        } catch (e) {
          console.warn('Erro ao carregar TMDB meta para o ID:', id, e);
        }
      });

      await Promise.allSettled(fetchPromises);

      if (grid && grid.children.length === 0 && state.catalog.loadedCount >= state.catalog.items.length) {
        grid.innerHTML = '<div class="notice-box">Nenhum item encontrado nesta categoria.</div>';
      }

      if (loadMoreBtn) {
        loadMoreBtn.style.display = end < state.catalog.items.length ? 'block' : 'none';
      }
    },

    createCard(meta) {
      const card = document.createElement('div');
      card.className = 'movie-card';

      const poster = meta.poster_path ? `${TMDB_IMAGE_URL}/w342${meta.poster_path}` : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=342&auto=format&fit=crop';
      const rating = meta.vote_average ? meta.vote_average.toFixed(1) : '--';
      const year = meta.release_date ? meta.release_date.split('-')[0] : (meta.first_air_date ? meta.first_air_date.split('-')[0] : '----');
      const type = meta.media_type || (meta.first_air_date || meta.name ? 'tv' : state.catalog.type || 'movie');
      const label = type === 'tv' ? 'Série' : 'Filme';

      card.innerHTML = `
        <div class="card-poster-wrapper">
          <img class="card-poster" src="${poster}" alt="${meta.title || meta.name}" loading="lazy" decoding="async">
          <div class="card-overlay"><div class="card-play-icon"><i class="fa-solid fa-circle-info"></i></div></div>
          <div class="card-rating"><i class="fa-solid fa-star"></i> ${rating}</div>
        </div>
        <div class="card-details">
          <div class="card-title">${meta.title || meta.name}</div>
          <div class="card-subtitle">${year} • ${label}</div>
        </div>
      `;

      card.onclick = () => this.openDetails({ type: type, id: meta.id, meta });
      return card;
    },

    async handleSearch(query) {
      const q = query.trim();

      if (state.activeView === 'live-tv') {
        LiveTV.filter(q, null);
        return;
      }
      if (state.activeView === 'sports') {
        Sports.filter(q, null);
        return;
      }

      if (!q) {
        if (state.activeView === 'catalog-search') {
          Router.switchView('home');
        } else if (state.activeView === 'home') {
          Home.load();
        } else {
          this.loadItems();
        }
        return;
      }

      const grid = document.getElementById('catalog-grid');
      const catalogTitle = document.getElementById('catalog-title');
      const gridWrap = document.querySelector('.catalog-grid-wrapper');

      document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
      document.getElementById('view-catalog')?.classList.add('active');
      state.activeView = 'catalog-search';

      if (catalogTitle) catalogTitle.textContent = `Resultados da busca por: "${q}"`;
      document.getElementById('genres-container').innerHTML = '';
      document.getElementById('load-more-btn').style.display = 'none';

      if (gridWrap) gridWrap.style.display = 'block';
      if (grid) grid.innerHTML = '<div class="loader-box"><div class="spinner"></div></div>';

      try {
        const res = await API.fetchJSON(`/api/tmdb/search/multi?query=${encodeURIComponent(q)}&page=1`);
        const results = (res.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');

        if (grid) {
          grid.innerHTML = '';
          if (results.length === 0) {
            grid.innerHTML = `<div class="notice-box"><i class="fa-solid fa-magnifying-glass" style="font-size:2rem;margin-bottom:1rem;color:var(--text-muted)"></i><br>Nenhum resultado encontrado para "${q}".</div>`;
            return;
          }
          results.forEach(meta => grid.appendChild(this.createCard(meta)));
        }
      } catch (e) {
        if (grid) grid.innerHTML = `<div class="notice-box">Erro ao realizar a busca.</div>`;
      }
    },

    async openDetails(item) {
      state.activeShow = item;
      UI.openModal('details-modal');

      document.getElementById('details-title').textContent = 'Carregando...';
      document.getElementById('details-overview').textContent = '';
      document.getElementById('details-genres').innerHTML = '';
      document.getElementById('details-series-nav').style.display = 'none';
      document.getElementById('details-play-btn').style.display = 'none';

      try {
        const details = await API.fetchTMDBDetails(item.type, item.id);
        if (!details) throw new Error('Erro metadata');

        state.activeShow.details = details;
        const title = details.title || details.name;
        const poster = details.poster_path;

        document.getElementById('details-title').textContent = title;
        document.getElementById('details-overview').textContent = details.overview || 'Sinopse não disponível.';
        document.getElementById('details-rating').innerHTML = `<i class="fa-solid fa-star"></i> ${(details.vote_average || 0).toFixed(1)}`;

        const rel = details.release_date || details.first_air_date || '';
        document.getElementById('details-year').textContent = rel ? rel.split('-')[0] : '----';

        const watchlistBtn = document.getElementById('details-watchlist-btn');
        if (watchlistBtn) {
          watchlistBtn.onclick = () => Auth.toggleWatchlist({
            media_type: item.type === 'movie' ? 'filme' : 'serie',
            media_id: item.id,
            title: title,
            poster: poster
          });
        }

        const playBtn = document.getElementById('details-play-btn');

        if (item.type === 'movie') {
          document.getElementById('details-duration').textContent = details.runtime ? `${details.runtime} min` : '-- min';
          document.getElementById('details-type').textContent = 'Filme';
          if (playBtn) {
            playBtn.style.display = 'inline-flex';
            playBtn.onclick = () => {
              UI.closeModal('details-modal');
              Player.playItem({ type: 'filme', id: item.id, title: title, poster: poster });
            };
          }
        } else {
          document.getElementById('details-duration').textContent = `${details.number_of_seasons || 1} Temp.`;
          document.getElementById('details-type').textContent = 'Série';
          this.loadSeasons(details, poster);
          document.getElementById('details-series-nav').style.display = 'block';
        }

        const genresContainer = document.getElementById('details-genres');
        if (details.genres && genresContainer) {
          details.genres.forEach(g => {
            const span = document.createElement('span');
            span.className = 'badge';
            span.textContent = g.name;
            genresContainer.appendChild(span);
          });
        }

        const bg = document.getElementById('details-backdrop');
        if (bg) {
          if (details.backdrop_path) bg.style.backgroundImage = `url(${TMDB_IMAGE_URL}/original${details.backdrop_path})`;
          else bg.style.backgroundImage = 'linear-gradient(135deg, #181826, #08080d)';
        }

      } catch (e) {
        document.getElementById('details-title').textContent = 'Erro ao carregar detalhes.';
      }
    },

    loadSeasons(details, poster) {
      const selector = document.getElementById('season-selector');
      if (!selector) return;
      selector.innerHTML = '';

      (details.seasons || []).filter(s => s.episode_count > 0).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.season_number;
        opt.textContent = s.name || `Temporada ${s.season_number}`;
        selector.appendChild(opt);
      });

      selector.onchange = (e) => this.loadEpisodes(details.id, e.target.value, poster);
      if (details.seasons && details.seasons.length > 0) {
        const first = details.seasons[0].season_number === 0 && details.seasons.length > 1 ? details.seasons[1].season_number : details.seasons[0].season_number;
        selector.value = first;
        this.loadEpisodes(details.id, first, poster);
      }
    },

    async loadEpisodes(tvId, seasonNum, poster) {
      const container = document.getElementById('episodes-container');
      if (!container) return;
      container.innerHTML = '<div class="loader-box"><div class="spinner"></div></div>';

      try {
        const res = await API.fetchTMDBSeason(tvId, seasonNum);
        container.innerHTML = '';
        if (!res || !res.episodes) return;

        res.episodes.forEach(ep => {
          const btn = document.createElement('button');
          btn.className = 'ep-btn';
          btn.innerHTML = `<span class="ep-btn-num">Episódio ${ep.episode_number}</span><span class="ep-btn-name">${ep.name}</span>`;
          btn.onclick = () => {
            UI.closeModal('details-modal');
            Player.playItem({
              type: 'serie', id: tvId, season: seasonNum, episode: ep.episode_number,
              title: state.activeShow.details.name, poster: poster,
              subtitle: `T${seasonNum}: E${ep.episode_number} - ${ep.name}`
            });
          };
          container.appendChild(btn);
        });
      } catch (e) { container.innerHTML = '<p>Erro ao carregar episódios.</p>'; }
    }
  };

  // =========================================================================
  // 10. MÓDULO DE TV AO VIVO (LIVE TV MODULE)
  // =========================================================================
  const LiveTV = {
    async loadView() {
      const container = document.getElementById('tv-channels-grid');
      if (container) container.innerHTML = '<div class="loader-box"><div class="spinner"></div></div>';

      try {
        if (state.tvChannels.length === 0) {
          const res = await API.fetchJSON('/api/lista?category=canais&format=json');
          if (res && res.success) state.tvChannels = res.data || [];
        }
        this.renderCategories();
        this.filter('', 'all');
      } catch (e) { console.error(e); }
    },

    renderCategories() {
      const container = document.getElementById('tv-categories-container');
      if (!container) return;
      container.innerHTML = '';

      const cats = ['Todos', ...new Set(state.tvChannels.map(ch => ch.category).filter(Boolean))];
      cats.forEach(cat => {
        const pill = document.createElement('button');
        pill.className = cat === 'Todos' ? 'genre-pill active' : 'genre-pill';
        pill.textContent = cat;
        pill.onclick = (e) => {
          document.querySelectorAll('#tv-categories-container .genre-pill').forEach(p => p.classList.remove('active'));
          e.target.classList.add('active');
          this.filter(document.getElementById('global-search').value.trim(), cat === 'Todos' ? 'all' : cat);
        };
        container.appendChild(pill);
      });
    },

    filter(q, cat) {
      const container = document.getElementById('tv-channels-grid');
      if (!container) return;
      container.innerHTML = '';

      if (!cat) {
        const active = document.querySelector('#tv-categories-container .genre-pill.active');
        cat = active ? active.textContent : 'all';
        if (cat === 'Todos') cat = 'all';
      }

      const regex = new RegExp(q, 'i');
      const filtered = state.tvChannels.filter(ch => (regex.test(ch.name) || (ch.category && regex.test(ch.category))) && (cat === 'all' || ch.category === cat));

      if (filtered.length === 0) {
        container.innerHTML = '<div class="notice-box">Nenhum canal encontrado.</div>';
        return;
      }

      filtered.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.innerHTML = `
          <div class="channel-logo-wrapper">
            <img class="channel-logo" src="${ch.logo_url}" alt="${ch.name}" loading="lazy" decoding="async" onerror="this.parentNode.innerHTML='<i class=\\'fa-solid fa-satellite-dish\\' style=\\'font-size:1.5rem;color:#7c3aed\\'></i>'">
          </div>
          <div class="channel-name">${ch.name}</div>
          <div class="channel-genre">${ch.category || 'TV'}</div>
        `;
        card.onclick = () => Player.playChannel(ch);
        container.appendChild(card);
      });
    }
  };

  // =========================================================================
  // 11. MÓDULO DE ESPORTES E JOGOS (SPORTS MODULE)
  // =========================================================================
  const Sports = {
    async loadView() {
      const container = document.getElementById('sports-agenda-list');
      if (container) container.innerHTML = '<div class="loader-box"><div class="spinner"></div></div>';

      try {
        if (state.sportsEvents.length === 0) {
          const res = await API.fetchJSON('/api/lista?category=eventos&format=json');
          if (res && res.success) state.sportsEvents = res.data || [];
        }
        this.renderCategories();
        this.setupStatusTabs();
        this.filter('', null);
      } catch (e) { console.error(e); }
    },

    renderCategories() {
      const container = document.getElementById('sports-categories-container');
      if (!container) return;
      container.innerHTML = '';
      const cats = ['Todos', ...new Set(state.sportsEvents.map(ev => ev.category).filter(Boolean))];
      cats.forEach(cat => {
        const pill = document.createElement('button');
        pill.className = cat === 'Todos' ? 'genre-pill active' : 'genre-pill';
        pill.textContent = cat;
        pill.onclick = (e) => {
          document.querySelectorAll('#sports-categories-container .genre-pill').forEach(p => p.classList.remove('active'));
          e.target.classList.add('active');
          this.filter(document.getElementById('global-search').value.trim(), null);
        };
        container.appendChild(pill);
      });
    },

    setupStatusTabs() {
      document.querySelectorAll('.status-tabs .status-btn').forEach(btn => {
        btn.onclick = (e) => {
          document.querySelectorAll('.status-tabs .status-btn').forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          this.filter(document.getElementById('global-search').value.trim(), null);
        };
      });
    },

    filter(q, cat) {
      const container = document.getElementById('sports-agenda-list');
      if (!container) return;
      container.innerHTML = '';

      if (!cat) {
        const active = document.querySelector('#sports-categories-container .genre-pill.active');
        cat = active ? active.textContent : 'Todos';
      }

      const statusActive = document.querySelector('.status-tabs .status-btn.active');
      const statusFilter = statusActive ? statusActive.dataset.status : 'all';

      const regex = new RegExp(q, 'i');
      const filtered = state.sportsEvents.filter(ev => {
        const matchQ = regex.test(ev.title) || regex.test(ev.competition) || regex.test(ev.category);
        const matchCat = cat === 'Todos' || ev.category === cat;
        let matchStatus = true;
        if (statusFilter === 'live') matchStatus = ev.status === 'live';
        else if (statusFilter === 'upcoming') matchStatus = ev.status === 'upcoming';
        return matchQ && matchCat && matchStatus;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="notice-box">Nenhum evento encontrado.</div>';
        return;
      }

      filtered.forEach(ev => container.appendChild(this.createRow(ev)));
    },

    createRow(ev) {
      const row = document.createElement('div');
      row.className = 'sport-row';

      const isLive = ev.status === 'live';
      const badge = isLive 
        ? '<span class="sport-badge live"><span class="pulse-dot"></span> AO VIVO</span>'
        : '<span class="sport-badge">AGENDADO</span>';

      const timeInfo = this.formatTime(ev.start_time);

      let teams = '';
      if (ev.visual_model === 'versus') {
        teams = `
          <div class="sport-teams">
            <img class="team-logo" src="${ev.time1 || 'https://superflixapi.pro/img/team/generic.png'}" loading="lazy" decoding="async" onerror="this.src='https://superflixapi.pro/img/team/generic.png'">
            <span class="team-names">${ev.time1_name} <span>x</span> ${ev.time2_name}</span>
            <img class="team-logo" src="${ev.time2 || 'https://superflixapi.pro/img/team/generic.png'}" loading="lazy" decoding="async" onerror="this.src='https://superflixapi.pro/img/team/generic.png'">
          </div>
        `;
      } else {
        teams = `<div class="sport-teams"><span class="team-names">${ev.title}</span></div>`;
      }

      row.innerHTML = `
        ${badge}
        ${teams}
        <div class="sport-competition">${ev.competition || ev.category || 'Esporte'}</div>
        <div class="sport-time-box">${timeInfo}</div>
      `;

      row.onclick = () => Player.playSportEvent(ev);
      return row;
    },

    formatTime(str) {
      if (!str) return '--:--';
      try {
        const d = new Date(str.replace(' ', 'T'));
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) { return str; }
    }
  };

  // =========================================================================
  // 12. MÓDULO DO REPRODUTOR DE VÍDEO (PLAYER MODULE)
  // =========================================================================
  const Player = {
    playItem(args) {
      state.activePlayer = args;
      UI.openModal('player-modal');

      const titleEl = document.getElementById('player-title');
      const subEl = document.getElementById('player-subtitle');
      if (titleEl) titleEl.textContent = args.title || 'Hmovie';
      if (subEl) subEl.textContent = args.subtitle || '';

      Auth.recordWatchHistory(args);

      const loader = document.getElementById('player-iframe-loader');
      const wrapper = document.getElementById('player-iframe-wrapper');
      const sidebar = document.getElementById('player-sidebar');

      if (loader) loader.style.display = 'flex';
      const oldIframe = wrapper?.querySelector('iframe');
      if (oldIframe) oldIframe.remove();

      let embedUrl = args.type === 'filme' 
        ? `https://superflixapi.pro/filme/${args.id}` 
        : `https://superflixapi.pro/serie/${args.id}/${args.season}/${args.episode}`;

      if (args.type === 'filme' && sidebar) sidebar.classList.remove('show');
      else this.loadSidebar(args);

      let hash = '';
      if (state.playerColor) hash += `#color:${state.playerColor}`;
      if (state.prefNoEpList) hash += '#noEpList';
      if (state.prefNoLink) hash += '#noLink';
      if (state.prefTransparent) hash += '#transparent';
      embedUrl += hash;

      const iframe = document.createElement('iframe');
      iframe.src = embedUrl;
      iframe.allow = "autoplay *; encrypted-media *; picture-in-picture *; fullscreen *";
      iframe.allowFullscreen = true;
      iframe.onload = () => { if (loader) loader.style.display = 'none'; };
      if (wrapper) wrapper.appendChild(iframe);
    },

    playChannel(ch) {
      UI.openModal('player-modal');
      const titleEl = document.getElementById('player-title');
      const subEl = document.getElementById('player-subtitle');
      if (titleEl) titleEl.textContent = ch.name;
      if (subEl) subEl.textContent = 'TV AO VIVO';

      Auth.recordWatchHistory({ type: 'canal', id: ch.id, title: ch.name, poster: ch.logo_url });

      const loader = document.getElementById('player-iframe-loader');
      const wrapper = document.getElementById('player-iframe-wrapper');
      document.getElementById('player-sidebar')?.classList.remove('show');

      if (loader) loader.style.display = 'flex';
      const old = wrapper?.querySelector('iframe');
      if (old) old.remove();

      const iframe = document.createElement('iframe');
      iframe.src = ch.embed_url;
      iframe.allow = "autoplay *; encrypted-media *; picture-in-picture *; fullscreen *";
      iframe.allowFullscreen = true;
      iframe.onload = () => { if (loader) loader.style.display = 'none'; };
      if (wrapper) wrapper.appendChild(iframe);
    },

    playSportEvent(ev) {
      UI.openModal('player-modal');
      const titleEl = document.getElementById('player-title');
      const subEl = document.getElementById('player-subtitle');
      if (titleEl) titleEl.textContent = ev.title;
      if (subEl) subEl.textContent = ev.competition || 'Transmissão Esportiva';

      Auth.recordWatchHistory({ type: 'evento', id: ev.id, title: ev.title, poster: ev.event_logo || '' });

      const loader = document.getElementById('player-iframe-loader');
      const wrapper = document.getElementById('player-iframe-wrapper');
      if (loader) loader.style.display = 'flex';

      const old = wrapper?.querySelector('iframe');
      if (old) old.remove();

      let streamUrl = ev.play_event_direct_url || ev.play_event_url;
      if (ev.embeds && ev.embeds.length > 0) streamUrl = ev.embeds[0].embed_url;

      const iframe = document.createElement('iframe');
      iframe.src = streamUrl;
      iframe.allow = "autoplay *; encrypted-media *; picture-in-picture *; fullscreen *";
      iframe.allowFullscreen = true;
      iframe.onload = () => { if (loader) loader.style.display = 'none'; };
      if (wrapper) wrapper.appendChild(iframe);

      if (ev.embeds && ev.embeds.length > 1) this.renderSportsSidebar(ev);
      else document.getElementById('player-sidebar')?.classList.remove('show');
    },

    renderSportsSidebar(ev) {
      const sidebar = document.getElementById('player-sidebar');
      if (!sidebar) return;
      sidebar.classList.add('show');
      document.getElementById('player-sidebar-head').innerHTML = '<h4>Opções de Transmissão</h4>';
      const list = document.getElementById('player-sidebar-episodes');
      if (!list) return;
      list.innerHTML = '';

      ev.embeds.forEach((emb, i) => {
        const btn = document.createElement('button');
        btn.className = i === 0 ? 'ep-btn active' : 'ep-btn';
        btn.innerHTML = `<span class="ep-btn-num">Opção ${i + 1}</span><span class="ep-btn-name">${emb.provider}</span>`;
        btn.onclick = () => {
          document.querySelectorAll('#player-sidebar-episodes .ep-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const loader = document.getElementById('player-iframe-loader');
          if (loader) loader.style.display = 'flex';
          const iframe = document.getElementById('player-iframe-wrapper')?.querySelector('iframe');
          if (iframe) iframe.src = emb.embed_url;
        };
        list.appendChild(btn);
      });
    },

    async loadSidebar(args) {
      const sidebar = document.getElementById('player-sidebar');
      if (!sidebar) return;
      sidebar.classList.add('show');
      document.getElementById('player-sidebar-head').innerHTML = '<h4>Episódios</h4>';
      const list = document.getElementById('player-sidebar-episodes');
      if (!list) return;
      list.innerHTML = '';

      try {
        const res = await API.fetchTMDBSeason(args.id, args.season);
        if (!res || !res.episodes) return;

        res.episodes.forEach(ep => {
          const btn = document.createElement('button');
          const active = ep.episode_number == args.episode;
          btn.className = active ? 'ep-btn active' : 'ep-btn';
          btn.innerHTML = `<span class="ep-btn-num">Episódio ${ep.episode_number}</span><span class="ep-btn-name">${ep.name}</span>`;
          btn.onclick = () => {
            document.querySelectorAll('#player-sidebar-episodes .ep-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            args.episode = ep.episode_number;

            const subEl = document.getElementById('player-subtitle');
            if (subEl) subEl.textContent = `T${args.season}: E${ep.episode_number} - ${ep.name}`;

            Auth.recordWatchHistory(args);

            let embedUrl = `https://superflixapi.pro/serie/${args.id}/${args.season}/${ep.episode_number}`;
            let hash = '';
            if (state.playerColor) hash += `#color:${state.playerColor}`;
            if (state.prefNoEpList) hash += '#noEpList';
            if (state.prefNoLink) hash += '#noLink';
            if (state.prefTransparent) hash += '#transparent';
            embedUrl += hash;

            const iframe = document.getElementById('player-iframe-wrapper')?.querySelector('iframe');
            if (iframe) iframe.src = embedUrl;
          };
          list.appendChild(btn);
        });
      } catch (e) { console.error('Erro ao carregar sidebar de episódios:', e); }
    },

    close() {
      UI.closeModal('player-modal');
      const iframe = document.getElementById('player-iframe-wrapper')?.querySelector('iframe');
      if (iframe) iframe.remove();
      state.activePlayer = null;
    }
  };

  // =========================================================================
  // 13. MÓDULO DE AUTENTICAÇÃO E CONTA DE USUÁRIO (AUTH MODULE)
  // =========================================================================
  const Auth = {
    async checkAuth() {
      if (!state.userToken) {
        this.updateUserUI(null);
        return;
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${state.userToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            state.currentUser = data.user;
            this.updateUserUI(data.user);
            this.loadWatchHistory();
            return;
          }
        }
      } catch (e) {}

      localStorage.removeItem('hmovie_token');
      state.userToken = '';
      this.updateUserUI(null);
    },

    updateUserUI(user) {
      const loginBtn = document.getElementById('btn-open-login');
      const userBox = document.getElementById('user-profile-box');
      const navWatchlist = document.getElementById('nav-btn-watchlist');
      const mobileWatchlist = document.getElementById('mobile-btn-watchlist');

      if (user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (userBox) userBox.style.display = 'flex';
        const nameEl = document.getElementById('user-name');
        const avatarEl = document.getElementById('user-avatar');

        if (nameEl) nameEl.textContent = user.username;
        if (avatarEl) avatarEl.textContent = user.username.charAt(0).toUpperCase();

        if (navWatchlist) navWatchlist.style.display = 'inline-flex';
        if (mobileWatchlist) mobileWatchlist.style.display = 'inline-flex';
      } else {
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (userBox) userBox.style.display = 'none';
        if (navWatchlist) navWatchlist.style.display = 'none';
        if (mobileWatchlist) mobileWatchlist.style.display = 'none';
        const continueSec = document.getElementById('continue-watching-section');
        if (continueSec) continueSec.style.display = 'none';
      }
    },

    switchAuthTab(mode) {
      state.authMode = mode;
      const tabLogin = document.getElementById('tab-login');
      const tabRegister = document.getElementById('tab-register');
      const titleEl = document.getElementById('auth-title');
      const submitBtn = document.getElementById('btn-auth-submit');
      const errEl = document.getElementById('auth-error-msg');

      if (tabLogin) tabLogin.className = mode === 'login' ? 'auth-tab active' : 'auth-tab';
      if (tabRegister) tabRegister.className = mode === 'register' ? 'auth-tab active' : 'auth-tab';
      if (titleEl) titleEl.textContent = mode === 'login' ? 'Entrar no Hmovie' : 'Criar Conta no Hmovie';
      if (submitBtn) submitBtn.textContent = mode === 'login' ? 'Entrar' : 'Cadastrar';
      if (errEl) errEl.style.display = 'none';
    },

    async handleSubmit(e) {
      e.preventDefault();
      const usernameInput = document.getElementById('auth-username');
      const passwordInput = document.getElementById('auth-password');
      const errorMsg = document.getElementById('auth-error-msg');

      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value.trim() : '';

      if (errorMsg) errorMsg.style.display = 'none';
      const endpoint = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          state.userToken = data.token;
          state.currentUser = data.user;
          localStorage.setItem('hmovie_token', data.token);

          this.updateUserUI(data.user);
          UI.closeModal('auth-modal');
          this.loadWatchHistory();
          showToast(`Bem-vindo, ${data.user.username}!`, 'success');
        } else {
          if (errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.textContent = data.error || 'Erro ao autenticar.';
          }
        }
      } catch (err) {
        if (errorMsg) {
          errorMsg.style.display = 'block';
          errorMsg.textContent = 'Erro de conexão com o servidor.';
        }
      }
    },

    async handleLogout() {
      if (state.userToken) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.userToken}` }
          });
        } catch (e) {}
      }

      localStorage.removeItem('hmovie_token');
      state.userToken = '';
      state.currentUser = null;
      Auth.updateUserUI(null);
      showToast('Sessão encerrada.', 'info');
    },

    async recordWatchHistory(playArgs) {
      if (!state.userToken) return;
      try {
        await fetch('/api/user/history', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.userToken}`
          },
          body: JSON.stringify({
            media_type: playArgs.type,
            media_id: String(playArgs.id),
            title: playArgs.title,
            poster: playArgs.poster || '',
            season: playArgs.season || 1,
            episode: playArgs.episode || 1
          })
        });
        this.loadWatchHistory();
      } catch (e) {}
    },

    async loadWatchHistory() {
      if (!state.userToken) return;
      try {
        const res = await fetch('/api/user/history', {
          headers: { 'Authorization': `Bearer ${state.userToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            state.userHistory = data.history || [];
            this.renderContinueWatching(state.userHistory);
          }
        }
      } catch (e) {}
    },

    renderContinueWatching(history) {
      const section = document.getElementById('continue-watching-section');
      const container = document.getElementById('continue-watching-row');
      if (!container || !section) return;
      container.innerHTML = '';

      if (!history || history.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';

      history.forEach(item => {
        const card = document.createElement('div');
        card.className = 'movie-card';

        const poster = item.poster ? `${TMDB_IMAGE_URL}/w342${item.poster}` : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=342&auto=format&fit=crop';
        const sub = item.media_type === 'serie' ? `Temp. ${item.season} Ep. ${item.episode}` : 'Filme';

        card.innerHTML = `
          <div class="card-poster-wrapper">
            <img class="card-poster" src="${poster}" alt="${item.title}" loading="lazy" decoding="async">
            <div class="card-overlay"><div class="card-play-icon"><i class="fa-solid fa-play"></i></div></div>
            <span class="card-badge type-movie">Assistido</span>
          </div>
          <div class="card-details">
            <div class="card-title">${item.title}</div>
            <div class="card-subtitle">${sub}</div>
          </div>
        `;

        card.onclick = () => {
          Player.playItem({
            type: item.media_type,
            id: item.media_id,
            season: item.season,
            episode: item.episode,
            title: item.title,
            subtitle: sub
          });
        };

        container.appendChild(card);
      });
    },

    async loadWatchlistView() {
      const grid = document.getElementById('watchlist-grid');
      if (!grid) return;
      grid.innerHTML = '<div class="loader-box"><div class="spinner"></div></div>';

      if (!state.userToken) {
        grid.innerHTML = '<div class="notice-box">Faça login para salvar seus favoritos.</div>';
        return;
      }

      try {
        const res = await fetch('/api/user/watchlist', {
          headers: { 'Authorization': `Bearer ${state.userToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            state.userWatchlist = data.watchlist || [];
            this.renderWatchlistGrid(state.userWatchlist);
          }
        }
      } catch (e) {
        grid.innerHTML = '<div class="notice-box">Erro ao carregar sua lista.</div>';
      }
    },

    renderWatchlistGrid(items) {
      const grid = document.getElementById('watchlist-grid');
      if (!grid) return;
      grid.innerHTML = '';

      if (!items || items.length === 0) {
        grid.innerHTML = '<div class="notice-box">Sua lista de favoritos está vazia.</div>';
        return;
      }

      items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'movie-card';

        const poster = item.poster ? `${TMDB_IMAGE_URL}/w342${item.poster}` : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?q=80&w=342&auto=format&fit=crop';

        card.innerHTML = `
          <div class="card-poster-wrapper">
            <img class="card-poster" src="${poster}" alt="${item.title}" loading="lazy" decoding="async">
            <div class="card-overlay"><div class="card-play-icon"><i class="fa-solid fa-play"></i></div></div>
            <span class="card-badge type-serie">${item.media_type}</span>
          </div>
          <div class="card-details">
            <div class="card-title">${item.title}</div>
          </div>
        `;

        card.onclick = () => {
          Catalog.openDetails({ type: item.media_type === 'filme' ? 'movie' : 'tv', id: item.media_id });
        };

        grid.appendChild(card);
      });
    },

    async toggleWatchlist(item) {
      if (!state.userToken) {
        UI.openModal('auth-modal');
        return;
      }

      try {
        const res = await fetch('/api/user/watchlist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.userToken}`
          },
          body: JSON.stringify(item)
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.added ? 'Adicionado à sua lista!' : 'Removido da sua lista.', 'success');
          if (state.activeView === 'watchlist') this.loadWatchlistView();
        }
      } catch (e) {
        showToast('Erro ao atualizar lista.', 'error');
      }
    }
  };

  // Funções Globais expostas para compatibilidade com os handlers inline HTML
  window.switchView = (view) => Router.switchView(view);
  window.closeModal = (id) => UI.closeModal(id);
  window.openModal = (id) => UI.openModal(id);
  window.switchAuthTab = (mode) => Auth.switchAuthTab(mode);
  window.handleAuthSubmit = (e) => Auth.handleSubmit(e);
  window.closePlayer = () => Player.close();

  // Inicialização no carregamento da página
  document.addEventListener('DOMContentLoaded', () => {
    initUI();
    UI.loadAppState();
    Auth.checkAuth();
    Router.switchView('home');
  });

  return {
    state,
    Router,
    Catalog,
    LiveTV,
    Sports,
    Player,
    Auth,
    UI,
    showToast
  };

})();
