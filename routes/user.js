const db = require('../db');

async function handleUserRoutes(pathname, req, res, { parseRequestBody, sendJSON, getAuthUser }) {
  if (pathname === '/api/user/history' && req.method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJSON(res, 401, { success: false, error: 'Não autorizado.' });
      return true;
    }

    const cacheKey = `user:${user.id}:history`;
    const cachedHistory = await db.getCache(cacheKey);
    if (cachedHistory) {
      sendJSON(res, 200, { success: true, history: cachedHistory, fromCache: true });
      return true;
    }

    try {
      const history = await db.getUserHistory(user.id);
      if (db.isMysqlConnected()) {
        await db.setCache(cacheKey, history, 300);
      }
      sendJSON(res, 200, { success: true, history });
    } catch (err) {
      sendJSON(res, 500, { success: false, error: 'Erro ao carregar histórico.' });
    }
    return true;
  }

  if (pathname === '/api/user/history' && req.method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJSON(res, 401, { success: false, error: 'Não autorizado.' });
      return true;
    }

    const body = await parseRequestBody(req);
    const { media_type, media_id, title, poster, season = 1, episode = 1, progress = 0 } = body;

    if (!media_type || !media_id || !title) {
      sendJSON(res, 400, { success: false, error: 'Dados incompletos.' });
      return true;
    }

    const cacheKey = `user:${user.id}:history`;

    try {
      await db.upsertHistory(user.id, { media_type, media_id, title, poster, season, episode, progress });
      if (db.isMysqlConnected()) {
        await db.clearCache(cacheKey);
      }
      sendJSON(res, 200, { success: true });
    } catch (err) {
      sendJSON(res, 500, { success: false, error: 'Erro ao salvar histórico.' });
    }
    return true;
  }

  if (pathname === '/api/user/watchlist' && req.method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJSON(res, 401, { success: false, error: 'Não autorizado.' });
      return true;
    }

    const cacheKey = `user:${user.id}:watchlist`;
    const cachedWatchlist = await db.getCache(cacheKey);
    if (cachedWatchlist) {
      sendJSON(res, 200, { success: true, watchlist: cachedWatchlist, fromCache: true });
      return true;
    }

    try {
      const watchlist = await db.getUserWatchlist(user.id);
      if (db.isMysqlConnected()) {
        await db.setCache(cacheKey, watchlist, 300);
      }
      sendJSON(res, 200, { success: true, watchlist });
    } catch (err) {
      sendJSON(res, 500, { success: false, error: 'Erro ao carregar lista.' });
    }
    return true;
  }

  if (pathname === '/api/user/watchlist' && req.method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJSON(res, 401, { success: false, error: 'Não autorizado.' });
      return true;
    }

    const body = await parseRequestBody(req);
    const { media_type, media_id, title, poster } = body;
    const cacheKey = `user:${user.id}:watchlist`;

    try {
      const result = await db.toggleWatchlistItem(user.id, { media_type, media_id, title, poster });
      if (db.isMysqlConnected()) {
        await db.clearCache(cacheKey);
      }
      sendJSON(res, 200, { success: true, added: result.added });
    } catch (err) {
      sendJSON(res, 500, { success: false, error: 'Erro ao atualizar lista.' });
    }
    return true;
  }

  return false;
}

module.exports = { handleUserRoutes };
