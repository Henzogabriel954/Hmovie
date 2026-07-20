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

// Session management
const memorySessions = {};
const memoryCache = {};

async function setSession(token, userData, ttlSeconds = 604800) {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(`session:${token}`, JSON.stringify(userData), { EX: ttlSeconds });
      return;
    } catch (e) {}
  }
  memorySessions[token] = userData;
}

async function getSession(token) {
  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(`session:${token}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {}
  }
  return memorySessions[token] || null;
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
  memoryCache[key] = value;
}

async function getCache(key) {
  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {}
  }
  return memoryCache[key] || null;
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
  clearCache
};
