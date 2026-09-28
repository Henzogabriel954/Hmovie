/**
 * @file config.js
 * @description Configuração centralizada do Hmovie.
 *   Todas as constantes sensíveis são lidas exclusivamente de variáveis de ambiente.
 *   Se uma variável obrigatória estiver ausente, o servidor avisa no console.
 */
require('dotenv').config();

const config = {
  PORT: parseInt(process.env.PORT || '3000', 10),

  JWT_SECRET: process.env.JWT_SECRET || '',
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',

  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Avisos de segurança na inicialização
if (!config.JWT_SECRET) {
  console.warn('[Config WARN] JWT_SECRET não definido no .env — autenticação não funcionará corretamente.');
}
if (!config.TMDB_API_KEY) {
  console.warn('[Config WARN] TMDB_API_KEY não definido no .env — proxy TMDB não funcionará.');
}

module.exports = config;
