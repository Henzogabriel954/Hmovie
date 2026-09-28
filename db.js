require('dotenv').config();
const mysql = require('mysql2/promise');
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

let mysqlPool = null;
let redisClient = null;

let isMysqlConnected = false;
let isRedisConnected = false;

// Fallback JSON DB path
const FALLBACK_DB_PATH = path.join(__dirname, 'fallback_db.json');

function getFallbackData() {
  if (!fs.existsSync(FALLBACK_DB_PATH)) {
    const initialData = { users: [], history: [], watchlist: [] };
    fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(FALLBACK_DB_PATH, 'utf-8'));
  } catch (e) {
    return { users: [], history: [], watchlist: [] };
  }
}

function saveFallbackData(data) {
  fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(data, null, 2));
}

// 1. Initialize Remote MySQL Connection & Create Tables
async function initMySQL() {
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_PORT || '3306');
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const dbName = process.env.MYSQL_DATABASE || 'hmovie_db';

  try {
    // Try connecting directly to database
    try {
      mysqlPool = mysql.createPool({
        host, port, user, password, database: dbName,
        waitForConnections: true, connectionLimit: 10, queueLimit: 0, connectTimeout: 6000
      });
      const conn = await mysqlPool.getConnection();
      conn.release();
    } catch (dbErr) {
      // If database does not exist, connect without db and create it
      if (dbErr.code === 'ER_BAD_DB_ERROR' || dbErr.errno === 1049) {
        const tempConn = await mysql.createConnection({ host, port, user, password, connectTimeout: 6000 });
        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        await tempConn.end();

        mysqlPool = mysql.createPool({
          host, port, user, password, database: dbName,
          waitForConnections: true, connectionLimit: 10, queueLimit: 0, connectTimeout: 6000
        });
      } else {
        throw dbErr;
      }
    }

    // Ensure Tables Exist
    const conn = await mysqlPool.getConnection();
    
    // Users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // History table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        media_type VARCHAR(20) NOT NULL,
        media_id VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        poster VARCHAR(550),
        season INT DEFAULT 1,
        episode INT DEFAULT 1,
        progress INT DEFAULT 0,
        watched_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY user_media_ep (user_id, media_type, media_id, season, episode),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Watchlist table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        media_type VARCHAR(20) NOT NULL,
        media_id VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        poster VARCHAR(550),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY user_media (user_id, media_type, media_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    conn.release();
    isMysqlConnected = true;
    console.log(`[MySQL] Conectado com sucesso ao banco remoto MySQL (${host}:${port}/${dbName})!`);
  } catch (err) {
    isMysqlConnected = false;
    console.warn(`[MySQL Remote Warn] Não foi possível conectar ao MySQL remoto (${host}:${port}): ${err.message}. Ativando fallback local.`);
  }
}

// 2. Initialize Remote Redis Connection (DB 1)
async function initRedis() {
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = process.env.REDIS_PORT || '6379';
  const redisPass = process.env.REDIS_PASSWORD ? `:${encodeURIComponent(process.env.REDIS_PASSWORD)}@` : '';
  const redisDb = process.env.REDIS_DB || '1'; // Default to DB 1 as requested!

  try {
    redisClient = createClient({
      url: `redis://${redisPass}${redisHost}:${redisPort}/${redisDb}`,
      database: parseInt(redisDb),
      socket: { connectTimeout: 5000 }
    });

    redisClient.on('error', (err) => {
      if (isRedisConnected) {
        console.warn(`[Redis Error] ${err.message}`);
      }
      isRedisConnected = false;
    });

    await redisClient.connect();
    isRedisConnected = true;
    console.log(`[Redis] Conectado com sucesso ao Redis remoto (${redisHost}:${redisPort} DB ${redisDb})!`);
  } catch (err) {
    isRedisConnected = false;
    console.warn(`[Redis Remote Warn] Não foi possível conectar ao Redis remoto (${redisHost}:${redisPort}): ${err.message}. Ativando cache local.`);
  }
}

// Session management (com TTL para evitar memory leak sem Redis)
const memorySessions = {};   // { token: { data, expiresAt } }
const memoryCache = {};      // { key: { data, expiresAt } }

// Limpeza periódica de entradas expiradas (a cada 5 minutos)
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(memorySessions)) {
    if (memorySessions[key].expiresAt && now > memorySessions[key].expiresAt) {
      delete memorySessions[key];
    }
  }
  for (const key of Object.keys(memoryCache)) {
    if (memoryCache[key].expiresAt && now > memoryCache[key].expiresAt) {
      delete memoryCache[key];
    }
  }
}, 5 * 60 * 1000).unref();

async function setSession(token, userData, ttlSeconds = 604800) {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(`session:${token}`, JSON.stringify(userData), { EX: ttlSeconds });
      return;
    } catch (e) {}
  }
  memorySessions[token] = { data: userData, expiresAt: Date.now() + (ttlSeconds * 1000) };
}

async function getSession(token) {
  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(`session:${token}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {}
  }
  const entry = memorySessions[token];
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) delete memorySessions[token];
  return null;
}

async function removeSession(token) {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(`session:${token}`);
      return;
    } catch (e) {}
  }
  delete memorySessions[token];
}

// Query Cache Helper
async function setCache(key, value, ttlSeconds = 300) {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return;
    } catch (e) {}
  }
  memoryCache[key] = { data: value, expiresAt: Date.now() + (ttlSeconds * 1000) };
}

async function getCache(key) {
  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {}
  }
  const entry = memoryCache[key];
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) delete memoryCache[key];
  return null;
}

async function clearCache(key) {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
      return;
    } catch (e) {}
  }
  delete memoryCache[key];
}

// --------------------------------------------------
// Repository Layer
// --------------------------------------------------

async function findUserByUsername(username) {
  const cleanUsername = (username || '').trim().toLowerCase();
  if (isMysqlConnected) {
    const [rows] = await mysqlPool.query('SELECT * FROM users WHERE username = ?', [cleanUsername]);
    if (rows.length > 0) return rows[0];
    return null;
  } else {
    const fallback = getFallbackData();
    return fallback.users.find(u => u.username === cleanUsername) || null;
  }
}

async function createUser(username, passwordHash) {
  const cleanUsername = (username || '').trim().toLowerCase();
  if (isMysqlConnected) {
    const [result] = await mysqlPool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [cleanUsername, passwordHash]);
    return { id: result.insertId, username: cleanUsername };
  } else {
    const fallback = getFallbackData();
    if (fallback.users.some(u => u.username === cleanUsername)) {
      throw { code: 'ER_DUP_ENTRY' }; // Mock duplicate entry error
    }
    const userId = Date.now();
    const userData = { id: userId, username: cleanUsername, password_hash: passwordHash };
    fallback.users.push(userData);
    saveFallbackData(fallback);
    return { id: userId, username: cleanUsername };
  }
}

async function getUserHistory(userId, limit = 50) {
  if (isMysqlConnected) {
    const [rows] = await mysqlPool.query(
      'SELECT id, media_type, media_id, title, poster, season, episode, progress, watched_at FROM history WHERE user_id = ? ORDER BY watched_at DESC LIMIT ?',
      [userId, limit]
    );
    return rows;
  } else {
    const fallback = getFallbackData();
    const userHistory = (fallback.history || [])
      .filter(h => h.user_id === userId)
      .sort((a,b) => new Date(b.watched_at) - new Date(a.watched_at));
    return userHistory.slice(0, limit);
  }
}

async function upsertHistory(userId, data) {
  const { media_type, media_id, title, poster, season = 1, episode = 1, progress = 0 } = data;
  if (isMysqlConnected) {
    await mysqlPool.query(`
      INSERT INTO history (user_id, media_type, media_id, title, poster, season, episode, progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        poster = VALUES(poster),
        season = VALUES(season),
        episode = VALUES(episode),
        progress = VALUES(progress),
        watched_at = CURRENT_TIMESTAMP
    `, [userId, media_type, String(media_id), title, poster || '', season, episode, progress]);
  } else {
    const fallback = getFallbackData();
    fallback.history = fallback.history || [];
    const idx = fallback.history.findIndex(h => 
      h.user_id === userId && h.media_type === media_type && String(h.media_id) === String(media_id) && h.season == season && h.episode == episode
    );
    const record = {
      id: Date.now(),
      user_id: userId,
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
    saveFallbackData(fallback);
  }
}

async function getUserWatchlist(userId) {
  if (isMysqlConnected) {
    const [rows] = await mysqlPool.query('SELECT id, media_type, media_id, title, poster, created_at FROM watchlist WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return rows;
  } else {
    const fallback = getFallbackData();
    return (fallback.watchlist || []).filter(w => w.user_id === userId);
  }
}

async function toggleWatchlistItem(userId, data) {
  const { media_type, media_id, title, poster } = data;
  if (isMysqlConnected) {
    const [existing] = await mysqlPool.query('SELECT id FROM watchlist WHERE user_id = ? AND media_type = ? AND media_id = ?', [userId, media_type, String(media_id)]);
    if (existing.length > 0) {
      await mysqlPool.query('DELETE FROM watchlist WHERE id = ?', [existing[0].id]);
      return { added: false };
    } else {
      await mysqlPool.query('INSERT INTO watchlist (user_id, media_type, media_id, title, poster) VALUES (?, ?, ?, ?, ?)', [userId, media_type, String(media_id), title, poster || '']);
      return { added: true };
    }
  } else {
    const fallback = getFallbackData();
    fallback.watchlist = fallback.watchlist || [];
    const idx = fallback.watchlist.findIndex(w => w.user_id === userId && w.media_type === media_type && String(w.media_id) === String(media_id));
    if (idx >= 0) {
      fallback.watchlist.splice(idx, 1);
      saveFallbackData(fallback);
      return { added: false };
    } else {
      fallback.watchlist.push({ id: Date.now(), user_id: userId, media_type, media_id: String(media_id), title, poster: poster || '', created_at: new Date().toISOString() });
      saveFallbackData(fallback);
      return { added: true };
    }
  }
}

module.exports = {
  initMySQL,
  initRedis,
  getMysqlPool: () => mysqlPool,
  isMysqlConnected: () => isMysqlConnected,
  isRedisConnected: () => isRedisConnected,
  getFallbackData,
  saveFallbackData,
  setSession,
  getSession,
  removeSession,
  setCache,
  getCache,
  clearCache,
  findUserByUsername,
  createUser,
  getUserHistory,
  upsertHistory,
  getUserWatchlist,
  toggleWatchlistItem,
  async shutdown() {
    try {
      if (redisClient && isRedisConnected) {
        await redisClient.quit();
        console.log('[Redis] Conexão encerrada.');
      }
    } catch (e) {}
    try {
      if (mysqlPool) {
        await mysqlPool.end();
        console.log('[MySQL] Pool de conexões encerrado.');
      }
    } catch (e) {}
  }
};
