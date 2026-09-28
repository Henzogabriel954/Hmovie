const config = require('../config');
const db = require('../db');

async function handleProxy(targetUrl, res, cacheTtlSeconds = 0) {
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': config.USER_AGENT,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API respondeu com status: ${response.status}`);
    }

    const data = await response.json();
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    };

    if (cacheTtlSeconds > 0) {
      headers['Cache-Control'] = `public, max-age=${cacheTtlSeconds}, s-maxage=${cacheTtlSeconds}`;
    }

    res.writeHead(200, headers);
    res.end(JSON.stringify(data));
    return data;
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: 'Erro de conexão.' }));
    return null;
  }
}

async function handleProxyRoutes(pathname, parsedUrl, req, res) {
  if (pathname === '/api/lista') {
    const targetQuery = parsedUrl.search ? parsedUrl.search : '';
    await handleProxy(`https://superflixapi.pro/lista${targetQuery}`, res);
    return true;
  }
  if (pathname === '/api/calendario') {
    await handleProxy('https://superflixapi.pro/calendario.php', res);
    return true;
  }

  // Secure TMDB Proxy (Keeps API Key hidden, caches in Redis for 24h & sends Cache-Control)
  if (pathname.startsWith('/api/tmdb/')) {
    if (!config.TMDB_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'TMDB API Key não configurada.' }));
      return true;
    }

    const cacheKey = `tmdb_cache:${pathname}${parsedUrl.search || ''}`;
    const cachedData = await db.getCache(cacheKey);

    if (cachedData) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Cache': 'HIT'
      });
      res.end(JSON.stringify(cachedData));
      return true;
    }

    const tmdbEndpoint = pathname.replace('/api/tmdb/', '');
    let targetUrl = `https://api.themoviedb.org/3/${tmdbEndpoint}`;
    const queryParams = new URLSearchParams(parsedUrl.query);
    queryParams.set('api_key', config.TMDB_API_KEY);
    if (!queryParams.has('language')) queryParams.set('language', 'pt-BR');
    targetUrl += `?${queryParams.toString()}`;

    const data = await handleProxy(targetUrl, res, 86400);
    if (data) {
      await db.setCache(cacheKey, data, 86400); // Salva no Redis por 24 Horas
    }
    return true;
  }

  return false;
}

module.exports = { handleProxyRoutes, handleProxy };
