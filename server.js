require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const jwt = require('jsonwebtoken');

const config = require('./config');
const db = require('./db');
const { handleProxyRoutes } = require('./routes/proxy');
const { handleAuthRoutes } = require('./routes/auth');
const { handleUserRoutes } = require('./routes/user');

const PORT = config.PORT;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({ _parseError: true });
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
  if (session) return { id: session.id, username: session.username };
  
  if (!config.JWT_SECRET) return null;

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    return { id: decoded.id, username: decoded.username };
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
  // Route Handlers
  // --------------------------------------------------
  const utils = { parseRequestBody, sendJSON, getAuthUser };

  if (await handleProxyRoutes(pathname, parsedUrl, req, res)) return;
  if (await handleAuthRoutes(pathname, req, res, utils)) return;
  if (await handleUserRoutes(pathname, req, res, utils)) return;

  // --------------------------------------------------
  // Static File Server (com proteção contra Path Traversal)
  // --------------------------------------------------
  const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);
  const resolved = path.resolve(filePath);

  // Bloqueia tentativas de escapar da pasta public
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      // Se o arquivo não existe, serve o index.html (SPA fallback)
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, fallbackData) => {
        if (err2) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Erro interno do servidor');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallbackData);
      });
      return;
    }
    const ext = path.extname(resolved);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`  Hmovie Server rodando em: http://localhost:${PORT}`);
  console.log(`==================================================`);
});

// T12 — Graceful Shutdown
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Encerrando servidor...`);
  server.close(async () => {
    try { await db.shutdown(); } catch (e) {}
    console.log('Servidor encerrado.');
    process.exit(0);
  });
  // Se demorar mais de 5s, força o encerramento
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
