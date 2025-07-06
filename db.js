require('dotenv').config(); // Carrega as variáveis de ambiente do .env
const { Pool } = require('pg');

// Use a variável de ambiente para a string de conexão do Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Use esta opção se tiver problemas com SSL em alguns ambientes de hospedagem.
                              // Em produção, para maior segurança, você pode precisar de um certificado.
  }
});

// Testar a conexão (opcional, mas recomendado)
pool.on('connect', () => {
  console.log('Conectado ao banco de dados Neon.');
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool de conexão do banco de dados:', err);
  process.exit(-1); // Encerrar o processo em caso de erro crítico de conexão
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(), // Para transações ou múltiplas operações com o mesmo cliente
};