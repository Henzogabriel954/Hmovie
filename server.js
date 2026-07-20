require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const JWT_SECRET = process.env.JWT_SECRET || 'hmovie_super_secret_key_2026';
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'b32afdbbdaf169b823cde5dbd1323287';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Initialize Remote Databases
db.initMySQL();
db.initRedis();

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

async function getAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  
  const session = await db.getSession(token);
  if (session) return session;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (e) {
    return null;
  }
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
    });
    return res.end();
  }

  // --------------------------------------------------
  // 1. External API Proxies & Secure TMDB Proxy
  // --------------------------------------------------
  if (pathname === '/api/lista') {
    const targetQuery = parsedUrl.search ? parsedUrl.search : '';
    return handleProxy(`https://superflixapi.pro/lista${targetQuery}`, res);
  }
  if (pathname === '/api/calendario') {
    return handleProxy('https://superflixapi.pro/calendario.php', res);
  }

  // Secure TMDB Proxy (Keeps API Key hidden, caches in Redis for 24h & sends Cache-Control)
  if (pathname.startsWith('/api/tmdb/')) {
    const cacheKey = `tmdb_cache:${pathname}${parsedUrl.search || ''}`;
    const cachedData = await db.getCache(cacheKey);

    if (cachedData) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Cache': 'HIT'
      });
      return res.end(JSON.stringify(cachedData));
    }

    const tmdbEndpoint = pathname.replace('/api/tmdb/', '');
    let targetUrl = `https://api.themoviedb.org/3/${tmdbEndpoint}`;
    const queryParams = new URLSearchParams(parsedUrl.query);
    queryParams.set('api_key', TMDB_API_KEY);
    if (!queryParams.has('language')) queryParams.set('language', 'pt-BR');
    targetUrl += `?${queryParams.toString()}`;

    const data = await handleProxy(targetUrl, res, 86400);
    if (data) {
      await db.setCache(cacheKey, data, 86400); // Salva no Redis por 24 Horas
    }
    return;
  }

  // --------------------------------------------------
  // 2. User Authentication API
  // --------------------------------------------------
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await parseRequestBody(req);
    const { username, password } = body;
    
    if (!username || !password || username.trim().length < 3 || password.length < 4) {
      return sendJSON(res, 400, { success: false, error: 'Usuário (mín. 3 caracteres) e Senha (mín. 4 caracteres) inválidos.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const hash = await bcrypt.hash(password, 10);

    if (db.isMysqlConnected()) {
      try {
        const pool = db.getMysqlPool();
        const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [cleanUsername, hash]);
        const userId = result.insertId;
        
        const token = jwt.sign({ id: userId, username: cleanUsername }, JWT_SECRET, { expiresIn: '7d' });
        const userData = { id: userId, username: cleanUsername };
        await db.setSession(token, userData);
        
        return sendJSON(res, 200, { success: true, token, user: userData });
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return sendJSON(res, 400, { success: false, error: 'Nome de usuário já cadastrado.' });
        }
        return sendJSON(res, 500, { success: false, error: 'Erro ao cadastrar conta.' });
      }
    } else {
      const fallback = db.getFallbackData();
      if (fallback.users.some(u => u.username === cleanUsername)) {
        return sendJSON(res, 400, { success: false, error: 'Nome de usuário já cadastrado.' });
      }
      const userId = Date.now();
      const userData = { id: userId, username: cleanUsername, password_hash: hash };
      fallback.users.push(userData);
      db.saveFallbackData(fallback);
      
      const token = jwt.sign({ id: userId, username: cleanUsername }, JWT_SECRET, { expiresIn: '7d' });
      await db.setSession(token, { id: userId, username: cleanUsername });
      return sendJSON(res, 200, { success: true, token, user: { id: userId, username: cleanUsername } });
    }
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseRequestBody(req);
    const { username, password } = body;
    const cleanUsername = (username || '').trim().toLowerCase();

    if (db.isMysqlConnected()) {
      try {
        const pool = db.getMysqlPool();
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [cleanUsername]);
        
        if (rows.length === 0) {
          return sendJSON(res, 400, { success: false, error: 'Usuário ou senha incorretos.' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          return sendJSON(res, 400, { success: false, error: 'Usuário ou senha incorretos.' });
        }

        const userData = { id: user.id, username: user.username };
        const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '7d' });
        await db.setSession(token, userData);

        return sendJSON(res, 200, { success: true, token, user: userData });
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: 'Erro de autenticação.' });
      }
    } else {
      const fallback = db.getFallbackData();
      const user = fallback.users.find(u => u.username === cleanUsername);
      if (!user) {
        return sendJSON(res, 400, { success: false, error: 'Usuário não encontrado.' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return sendJSON(res, 400, { success: false, error: 'Senha incorreta.' });
      }
      const userData = { id: user.id, username: user.username };
      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '7d' });
      await db.setSession(token, userData);
      return sendJSON(res, 200, { success: true, token, user: userData });
    }
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { success: false, error: 'Não autorizado.' });
    return sendJSON(res, 200, { success: true, user });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await db.removeSession(authHeader.substring(7));
    }
    return sendJSON(res, 200, { success: true });
  }

  // --------------------------------------------------
  // 3. Private User Watch History API
  // --------------------------------------------------
  if (pathname === '/api/user/history' && req.method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { success: false, error: 'Não autorizado.' });

    const cacheKey = `user:${user.id}:history`;
    const cachedHistory = await db.getCache(cacheKey);
    if (cachedHistory) {
      return sendJSON(res, 200, { success: true, history: cachedHistory, fromCache: true });
    }

    if (db.isMysqlConnected()) {
      try {
        const pool = db.getMysqlPool();
        const [rows] = await pool.query(
          'SELECT id, media_type, media_id, title, poster, season, episode, progress, watched_at FROM history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 50',
          [user.id]
        );
        await db.setCache(cacheKey, rows, 300);
        return sendJSON(res, 200, { success: true, history: rows });
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: 'Erro ao carregar histórico.' });
      }
    } else {
      const fallback = db.getFallbackData();
      const userHistory = (fallback.history || [])
        .filter(h => h.user_id === user.id)
        .sort((a,b) => new Date(b.watched_at) - new Date(a.watched_at));
      return sendJSON(res, 200, { success: true, history: userHistory });
    }
  }

  if (pathname === '/api/user/history' && req.method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { success: false, error: 'Não autorizado.' });

    const body = await parseRequestBody(req);
    const { media_type, media_id, title, poster, season = 1, episode = 1, progress = 0 } = body;

    if (!media_type || !media_id || !title) {
      return sendJSON(res, 400, { success: false, error: 'Dados incompletos.' });
    }

    const cacheKey = `user:${user.id}:history`;

    if (db.isMysqlConnected()) {
      try {
        const pool = db.getMysqlPool();
        await pool.query(`
          INSERT INTO history (user_id, media_type, media_id, title, poster, season, episode, progress)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            poster = VALUES(poster),
            season = VALUES(season),
            episode = VALUES(episode),
            progress = VALUES(progress),
            watched_at = CURRENT_TIMESTAMP
        `, [user.id, media_type, String(media_id), title, poster || '', season, episode, progress]);

        await db.clearCache(cacheKey);
        return sendJSON(res, 200, { success: true });
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: 'Erro ao salvar histórico.' });
      }
    } else {
      const fallback = db.getFallbackData();
      fallback.history = fallback.history || [];
      const idx = fallback.history.findIndex(h => 
        h.user_id === user.id && h.media_type === media_type && String(h.media_id) === String(media_id) && h.season == season && h.episode == episode
      );
      const record = {
        id: Date.now(),
        user_id: user.id,
        media_type,
        media_id: String(media_id),
        title,
        poster: poster || '',
        season,
        episode,
        progress,
        watched_at: new Date().toISOString()
      };

      if (idx >= 0) fallback.history[idx] = record;
      else fallback.history.push(record);
      
      db.saveFallbackData(fallback);
      return sendJSON(res, 200, { success: true });
    }
  }

  // --------------------------------------------------
  // 4. Private User Watchlist API
  // --------------------------------------------------
  if (pathname === '/api/user/watchlist' && req.method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { success: false, error: 'Não autorizado.' });

    const cacheKey = `user:${user.id}:watchlist`;
    const cachedWatchlist = await db.getCache(cacheKey);
    if (cachedWatchlist) {
      return sendJSON(res, 200, { success: true, watchlist: cachedWatchlist, fromCache: true });
    }

    if (db.isMysqlConnected()) {
      try {
        const pool = db.getMysqlPool();
        const [rows] = await pool.query('SELECT id, media_type, media_id, title, poster, created_at FROM watchlist WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
        await db.setCache(cacheKey, rows, 300);
        return sendJSON(res, 200, { success: true, watchlist: rows });
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: 'Erro ao carregar lista.' });
      }
    } else {
      const fallback = db.getFallbackData();
      const list = (fallback.watchlist || []).filter(w => w.user_id === user.id);
      return sendJSON(res, 200, { success: true, watchlist: list });
    }
  }

  if (pathname === '/api/user/watchlist' && req.method === 'POST') {
    const user = await getAuthUser(req);
    if (!user) return sendJSON(res, 401, { success: false, error: 'Não autorizado.' });

    const body = await parseRequestBody(req);
    const { media_type, media_id, title, poster } = body;
    const cacheKey = `user:${user.id}:watchlist`;

    if (db.isMysqlConnected()) {
      try {
        const pool = db.getMysqlPool();
        const [existing] = await pool.query('SELECT id FROM watchlist WHERE user_id = ? AND media_type = ? AND media_id = ?', [user.id, media_type, String(media_id)]);
        
        if (existing.length > 0) {
          await pool.query('DELETE FROM watchlist WHERE id = ?', [existing[0].id]);
          await db.clearCache(cacheKey);
          return sendJSON(res, 200, { success: true, added: false });
        } else {
          await pool.query('INSERT INTO watchlist (user_id, media_type, media_id, title, poster) VALUES (?, ?, ?, ?, ?)', [user.id, media_type, String(media_id), title, poster || '']);
          await db.clearCache(cacheKey);
          return sendJSON(res, 200, { success: true, added: true });
        }
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: 'Erro ao atualizar lista.' });
      }
    } else {
      const fallback = db.getFallbackData();
      fallback.watchlist = fallback.watchlist || [];
      const idx = fallback.watchlist.findIndex(w => w.user_id === user.id && w.media_type === media_type && String(w.media_id) === String(media_id));
      
      if (idx >= 0) {
        fallback.watchlist.splice(idx, 1);
        db.saveFallbackData(fallback);
        return sendJSON(res, 200, { success: true, added: false });
      } else {
        fallback.watchlist.push({ id: Date.now(), user_id: user.id, media_type, media_id: String(media_id), title, poster: poster || '', created_at: new Date().toISOString() });
        db.saveFallbackData(fallback);
        return sendJSON(res, 200, { success: true, added: true });
      }
    }
  }

  // --------------------------------------------------
  // 5. Static File Server
  // --------------------------------------------------
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erro interno do servidor');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

async function handleProxy(targetUrl, res, cacheTtlSeconds = 0) {
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
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

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Hmovie Server rodando em: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
