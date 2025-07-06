const express = require('express');
const cors = require('cors');
const db = require('./db'); // Importa o módulo de conexão com o banco de dados

const app = express();
const PORT = process.env.PORT || 3000;

// =========================================================
// MIDDLEWARES
// =========================================================

// Habilita o CORS para permitir requisições do seu PWA (frontend)
app.use(cors({
  origin: '*', // Mantenha '*' para desenvolvimento. Para produção, mude para seu domínio ex: 'https://seu-pwa.com'
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Habilita o Express para entender JSON no corpo das requisições
app.use(express.json());

// =========================================================
// ROTAS DA API
// =========================================================

// Rota de teste para verificar se o servidor está funcionando
app.get('/', (req, res) => {
  res.send('Backend do Edienai Lanches está online!');
});

// Rota de teste para verificar a conexão com o banco de dados
app.get('/test-db', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() as current_time;');
    res.status(200).json({
      message: 'Conexão com o banco de dados bem-sucedida!',
      currentTime: result.rows[0].current_time
    });
  } catch (error) {
    console.error('Erro ao testar conexão com o DB:', error);
    res.status(500).json({
      message: 'Erro ao conectar ao banco de dados.',
      error: error.message
    });
  }
});

// GET /api/produtos - Retorna todos os produtos
app.get('/api/produtos', async (req, res) => {
  try {
    // Busca todos os produtos da tabela 'produtos'
    const result = await db.query('SELECT * FROM produtos ORDER BY categoria, nome;');
    // Transforma o array de resultados em um objeto agrupado por categoria, se preferir
    const produtosAgrupados = {};
    result.rows.forEach(produto => {
      if (!produtosAgrupados[produto.categoria]) {
        produtosAgrupados[produto.categoria] = [];
      }
      produtosAgrupados[produto.categoria].push(produto);
    });
    res.status(200).json(produtosAgrupados);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ message: 'Erro ao buscar produtos.', error: error.message });
  }
});

// GET /api/complementos - Retorna todos os complementos disponíveis
app.get('/api/complementos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM complementos_disponiveis ORDER BY categoria, nome;');
    const complementosFormatados = {};
    result.rows.forEach(complemento => {
        complementosFormatados[complemento.id] = {
            name: complemento.nome,
            price: parseFloat(complemento.preco), // Garante que o preço é um número
            category: complemento.categoria
        };
    });
    res.status(200).json(complementosFormatados);
  } catch (error) {
    console.error('Erro ao buscar complementos:', error);
    res.status(500).json({ message: 'Erro ao buscar complementos.', error: error.message });
  }
});

// POST /api/pedidos - Recebe e salva um novo pedido
app.post('/api/pedidos', async (req, res) => {
  const client = await db.getClient(); // Obtém um cliente para transação
  try {
    await client.query('BEGIN'); // Inicia a transação

    const {
      orderId, customerName, customerEmail, items, deliveryOption,
      observations, paymentMethod, trocoPara, total, status, sentAt
    } = req.body;

    // 1. Inserir na tabela 'pedidos'
    const insertPedidoSql = `
      INSERT INTO pedidos (
        id_pedido, nome_cliente, email_cliente, tipo_entrega, 
        endereco_entrega, numero_mesa, observacoes, metodo_pagamento, 
        troco_para, valor_total, status, data_hora_envio
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id_pedido) DO NOTHING;
    `;
    await client.query(insertPedidoSql, [
      orderId,
      customerName,
      customerEmail || null, // Garante NULL se for vazio/N/A
      deliveryOption.type,
      deliveryOption.address || null,
      deliveryOption.tableNumber || null,
      observations || '', // Garante string vazia
      paymentMethod,
      trocoPara || null,
      total,
      status || 'pendente',
      sentAt ? new Date(sentAt) : new Date()
    ]);

    // 2. Inserir na tabela 'itens_do_pedido' e 'complementos_do_item'
    for (const item of items) {
      const insertItemSql = `
        INSERT INTO itens_do_pedido (
          id_pedido, id_produto, nome_produto, quantidade, 
          preco_base_produto, preco_unitario_com_complementos, total_item_preco
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id_item_pedido;
      `;
      const itemResult = await client.query(insertItemSql, [
        orderId,
        item.productId,
        item.name,
        item.quantity,
        item.basePrice,
        item.unitPriceWithComplements,
        item.totalItemPrice
      ]);
      const insertedItemId = itemResult.rows[0].id_item_pedido; // Captura o UUID gerado

      for (const comp of item.complements) {
        const insertCompSql = `
          INSERT INTO complementos_do_item (
            id_item_pedido, id_complemento_disponivel, nome_complemento, preco_complemento
          ) VALUES ($1, $2, $3, $4);
        `;
        await client.query(insertCompSql, [
          insertedItemId,
          comp.id,
          comp.name,
          comp.price
        ]);
      }
    }

    await client.query('COMMIT'); // Confirma a transação
    res.status(201).json({ message: 'Pedido salvo com sucesso no Neon!', orderId: orderId });

  } catch (error) {
    await client.query('ROLLBACK'); // Reverte a transação em caso de erro
    console.error('Erro ao salvar pedido no Neon:', error);
    res.status(500).json({ message: 'Erro ao salvar pedido.', error: error.message });
  } finally {
    client.release(); // Libera o cliente de volta para o pool
  }
});


// =========================================================
// INICIAR O SERVIDOR
// =========================================================

app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
  console.log('Verifique a conexão com o DB em: http://localhost:${PORT}/test-db');
});