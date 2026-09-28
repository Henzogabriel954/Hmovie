const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

async function handleAuthRoutes(pathname, req, res, { parseRequestBody, sendJSON, getAuthUser }) {
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await parseRequestBody(req);

    if (body._parseError) {
      sendJSON(res, 400, { success: false, error: 'JSON inválido no corpo da requisição.' });
      return true;
    }

    const { username, password } = body;
    
    if (!username || !password || username.trim().length < 3 || password.length < 4) {
      sendJSON(res, 400, { success: false, error: 'Usuário (mín. 3 caracteres) e Senha (mín. 4 caracteres) inválidos.' });
      return true;
    }

    if (!config.JWT_SECRET) {
      sendJSON(res, 500, { success: false, error: 'Servidor não configurado corretamente (JWT).' });
      return true;
    }

    const cleanUsername = username.trim().toLowerCase();
    const hash = await bcrypt.hash(password, 10);

    try {
      const user = await db.createUser(cleanUsername, hash);
      const token = jwt.sign({ id: user.id, username: user.username }, config.JWT_SECRET, { expiresIn: '7d' });
      const userData = { id: user.id, username: user.username };
      await db.setSession(token, userData);
      
      sendJSON(res, 200, { success: true, token, user: userData });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        sendJSON(res, 400, { success: false, error: 'Nome de usuário já cadastrado.' });
      } else {
        sendJSON(res, 500, { success: false, error: 'Erro ao cadastrar conta.' });
      }
    }
    return true;
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseRequestBody(req);

    if (body._parseError) {
      sendJSON(res, 400, { success: false, error: 'JSON inválido no corpo da requisição.' });
      return true;
    }

    const { username, password } = body;

    // T7 — Validação de inputs vazios no login
    if (!username || !password) {
      sendJSON(res, 400, { success: false, error: 'Usuário e senha são obrigatórios.' });
      return true;
    }

    if (!config.JWT_SECRET) {
      sendJSON(res, 500, { success: false, error: 'Servidor não configurado corretamente (JWT).' });
      return true;
    }
    
    try {
      const user = await db.findUserByUsername(username);
      
      if (!user) {
        const errorMsg = db.isMysqlConnected() ? 'Usuário ou senha incorretos.' : 'Usuário não encontrado.';
        sendJSON(res, 400, { success: false, error: errorMsg });
        return true;
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        const errorMsg = db.isMysqlConnected() ? 'Usuário ou senha incorretos.' : 'Senha incorreta.';
        sendJSON(res, 400, { success: false, error: errorMsg });
        return true;
      }

      const userData = { id: user.id, username: user.username };
      const token = jwt.sign(userData, config.JWT_SECRET, { expiresIn: '7d' });
      await db.setSession(token, userData);

      sendJSON(res, 200, { success: true, token, user: userData });
    } catch (err) {
      sendJSON(res, 500, { success: false, error: 'Erro de autenticação.' });
    }
    return true;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await getAuthUser(req);
    if (!user) {
      sendJSON(res, 401, { success: false, error: 'Não autorizado.' });
    } else {
      sendJSON(res, 200, { success: true, user });
    }
    return true;
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      await db.removeSession(authHeader.substring(7));
    }
    sendJSON(res, 200, { success: true });
    return true;
  }

  return false;
}

module.exports = { handleAuthRoutes };
