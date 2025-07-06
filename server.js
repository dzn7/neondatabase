// server.js - Versão Final: Com Neon DB e Mercado Pago

require('dotenv').config(); // Carrega as variáveis de ambiente do .env

const express = require('express');
const cors = require('cors'); // Para permitir requisições do seu frontend

// Importa o módulo do Mercado Pago
const { MercadoPagoConfig, Payment, Preference } = require('mercadopago');
// Importa o módulo de conexão com o banco de dados Neon
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000; // A porta que seu servidor irá escutar

// =========================================================
// CONFIGURAÇÕES DO MERCADO PAGO
// =========================================================
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
if (!accessToken) {
    console.error("ERRO CRÍTICO: MERCADOPAGO_ACCESS_TOKEN não está definido no .env!");
    process.exit(1); // Encerrar o processo se o token não estiver configurado
}
// Inicializa o cliente do Mercado Pago
const client = new MercadoPagoConfig({ accessToken });
const payment = new Payment(client);
const preference = new Preference(client);

// =========================================================
// CONFIGURAÇÃO DE CORS (Permite múltiplos domínios para segurança)
// =========================================================
const allowedOrigins = [
    'http://127.0.0.1:5500/index.html',
    'https://acaiemcasasite.onrender.com',
    'https://edienayteste.onrender.com',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://localhost:5500', // Adicionado para teste local do PWA
    'null' // Para testar arquivos locais diretamente no navegador (remover em produção)
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permite requisições sem origem (como de arquivos locais no navegador ou Postman)
    // E permite origens listadas em allowedOrigins
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions)); // Aplica as opções de CORS
app.use(express.json()); // Habilita o Express para entender JSON no corpo das requisições

// Middleware para log de requisições
app.use((req, res, next) => {
    console.log(`📝 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// =========================================================
// ROTAS DA API (Neon DB e Mercado Pago)
// =========================================================

// Rota de teste simples para verificar se o servidor está online
app.get('/', (req, res) => {
    res.json({
        message: 'API Edienai Lanches Online!',
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        mercadoPagoConfigured: !!accessToken,
        dbConnected: true // Presume conexão via db.js
    });
});

// Rota de Health Check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage()
    });
});

// Rota de Debug (para desenvolvimento)
app.get('/debug', (req, res) => {
    res.json({
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        mercadoPagoToken: accessToken ? 'Configurado' : 'Não configurado',
        backendUrl: process.env.BACKEND_URL || 'Não configurado',
        frontendUrl: process.env.FRONTEND_URL || 'Não configurado',
        allowedOrigins: allowedOrigins
    });
});

// --- ROTAS DO NEON DB ---

// GET /api/produtos - Retorna todos os produtos do Neon
app.get('/api/produtos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM produtos ORDER BY categoria, nome;');
    const produtosAgrupados = {};
    result.rows.forEach(produto => {
      if (!produtosAgrupados[produto.categoria]) {
        produtosAgrupados[produto.categoria] = [];
      }
      produtosAgrupados[produto.categoria].push(produto);
    });
    res.status(200).json(produtosAgrupados);
  } catch (error) {
    console.error('Erro ao buscar produtos do Neon:', error);
    res.status(500).json({ message: 'Erro ao buscar produtos.', error: error.message });
  }
});

// **** ROTA ADICIONADA ****
// PUT /api/produtos - Substitui todos os produtos pelos novos dados vindos do painel
app.put('/api/produtos', async (req, res) => {
  const allProducts = req.body;
  const client = await db.getClient();

  try {
    await client.query('BEGIN'); // Inicia a transação

    // Limpa a tabela de produtos para inserir os novos
    // RESTART IDENTITY reinicia a contagem do ID autoincremental, o que é uma boa prática.
    await client.query('TRUNCATE TABLE produtos RESTART IDENTITY');

    // Prepara a query de inserção
    const insertQuery = `
      INSERT INTO produtos (id, nome, descricao, preco, categoria, imagem_url, num_complementos_gratis)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    // Itera sobre cada categoria e produto para inserir no banco
    for (const categoryKey in allProducts) {
      const productsInCategory = allProducts[categoryKey];
      for (const product of productsInCategory) {
        const productValues = [
          product.id,
          product.nome,
          product.descricao || null,
          product.preco,
          categoryKey,
          product.imagem_url || null,
          product.num_complementos_gratis || 0
        ];
        await client.query(insertQuery, productValues);
      }
    }

    await client.query('COMMIT'); // Finaliza a transação com sucesso
    res.status(200).json({ message: 'Produtos atualizados com sucesso!' });

  } catch (error) {
    await client.query('ROLLBACK'); // Desfaz a transação em caso de erro
    console.error('Erro ao atualizar produtos no Neon DB:', error);
    res.status(500).json({ message: 'Erro ao atualizar os produtos.', error: error.message });
  } finally {
    client.release(); // Libera o cliente de volta para o pool de conexões
  }
});


// GET /api/complementos - Retorna todos os complementos disponíveis do Neon
app.get('/api/complementos', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM complementos_disponiveis ORDER BY categoria, nome;');
    const complementosFormatados = {};
    result.rows.forEach(complemento => {
        complementosFormatados[complemento.id] = {
            name: complemento.nome,
            price: parseFloat(complemento.preco),
            category: complemento.categoria
        };
    });
    res.status(200).json(complementosFormatados);
  } catch (error) {
    console.error('Erro ao buscar complementos do Neon:', error);
    res.status(500).json({ message: 'Erro ao buscar complementos.', error: error.message });
  }
});

// GET /api/pedidos - Retorna todos os pedidos com seus itens e complementos
app.get('/api/pedidos', async (req, res) => {
  try {
    const querySql = `
      SELECT
          p.id_pedido, p.nome_cliente, p.email_cliente, p.tipo_entrega,
          p.endereco_entrega, p.numero_mesa, p.observacoes, p.metodo_pagamento,
          p.troco_para, p.valor_total, p.status, p.data_hora_envio,
          i.id_item_pedido, i.id_produto, i.nome_produto, i.quantidade,
          i.preco_base_produto, i.preco_unitario_com_complementos, i.total_item_preco,
          c.id_complemento_disponivel, c.nome_complemento, c.preco_complemento
      FROM
          pedidos p
      LEFT JOIN
          itens_do_pedido i ON p.id_pedido = i.id_pedido
      LEFT JOIN
          complementos_do_item c ON i.id_item_pedido = c.id_item_pedido
      ORDER BY
          p.data_hora_envio DESC, i.id_item_pedido, c.id_complemento_disponivel;
    `;
    
    const result = await db.query(querySql);
    const ordersMap = new Map();

    result.rows.forEach(row => {
      // Cria ou recupera o objeto do pedido
      if (!ordersMap.has(row.id_pedido)) {
        ordersMap.set(row.id_pedido, {
          orderId: row.id_pedido,
          customerName: row.nome_cliente,
          customerEmail: row.email_cliente,
          deliveryOption: {
            type: row.tipo_entrega,
            address: row.endereco_entrega,
            tableNumber: row.numero_mesa
          },
          observations: row.observacoes,
          paymentMethod: row.metodo_pagamento,
          trocoPara: row.troco_para,
          total: row.valor_total,
          status: row.status,
          sentAt: row.data_hora_envio,
          items: []
        });
      }

      const order = ordersMap.get(row.id_pedido);

      // Adiciona itens ao pedido, se existirem e ainda não tiverem sido adicionados
      if (row.id_item_pedido && !order.items.some(item => item.id_item_pedido === row.id_item_pedido)) {
        order.items.push({
          id_item_pedido: row.id_item_pedido, // Usar id_item_pedido para identificação interna
          productId: row.id_produto,
          name: row.nome_produto, // Mapeia para 'name' como o frontend espera
          quantity: row.quantidade,
          basePrice: row.preco_base_produto,
          unitPriceWithComplements: row.preco_unitario_com_complementos,
          totalItemPrice: row.total_item_preco,
          complements: [] // Inicializa array de complementos para este item
        });
      }

      const currentItem = order.items.find(item => item.id_item_pedido === row.id_item_pedido);

      // Adiciona complementos ao item, se existirem e ainda não tiverem sido adicionados
      if (row.id_complemento_disponivel && currentItem && !currentItem.complements.some(comp => comp.id === row.id_complemento_disponivel)) {
        currentItem.complements.push({
          id: row.id_complemento_disponivel,
          name: row.nome_complemento, // Mapeia para 'name'
          price: parseFloat(row.preco_complemento) // Certificar que o preço é numérico
        });
      }
    });

    res.status(200).json(Array.from(ordersMap.values()));
  } catch (error) {
    console.error('Erro ao buscar pedidos do Neon:', error);
    res.status(500).json({ message: 'Erro ao buscar pedidos.', error: error.message });
  }
});


// POST /api/pedidos - Recebe e salva um novo pedido no Neon
app.post('/api/pedidos', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN'); // Inicia a transação

    const {
      orderId, customerName, customerEmail, items, deliveryOption,
      observations, paymentMethod, trocoPara, total, status, sentAt
    } = req.body;

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
      customerEmail || null,
      deliveryOption.type,
      deliveryOption.address || null,
      deliveryOption.tableNumber || null,
      observations || '',
      paymentMethod,
      trocoPara || null,
      total,
      status || 'pendente',
      sentAt ? new Date(sentAt) : new Date()
    ]);

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
        item.name, // Já vem como 'name' do frontend
        item.quantity,
        item.basePrice,
        item.unitPriceWithComplements,
        item.totalItemPrice
      ]);
      const insertedItemId = itemResult.rows[0].id_item_pedido;

      for (const comp of item.complements) {
        const insertCompSql = `
          INSERT INTO complementos_do_item (
            id_item_pedido, id_complemento_disponivel, nome_complemento, preco_complemento
          ) VALUES ($1, $2, $3, $4);
        `;
        await client.query(insertCompSql, [
          insertedItemId,
          comp.id,
          comp.name, // Já vem como 'name' do frontend
          comp.price
        ]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Pedido salvo com sucesso no Neon!', orderId: orderId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao salvar pedido no Neon:', error);
    res.status(500).json({ message: 'Erro ao salvar pedido.', error: error.message });
  } finally {
    client.release();
  }
});


// PUT /api/pedidos - Atualiza o status de pedidos no Neon (usado pelo Dashboard do Dono)
app.put('/api/pedidos', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN'); // Inicia a transação

    const updatedOrders = req.body; // Espera um array de pedidos do dashboard

    if (!Array.isArray(updatedOrders)) {
      throw new Error('Corpo da requisição para PUT /api/pedidos deve ser um array de pedidos.');
    }

    // Itera sobre cada pedido recebido e atualiza seu status no banco de dados
    for (const order of updatedOrders) {
      if (order.orderId && order.status) {
        const updateSql = `
          UPDATE pedidos
          SET status = $1
          WHERE id_pedido = $2;
        `;
        await client.query(updateSql, [order.status, order.orderId]);
      } else {
        console.warn(`Pedido inválido encontrado na atualização PUT: ${JSON.stringify(order)}`);
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Status dos pedidos atualizados com sucesso!' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao atualizar status dos pedidos no Neon:', error);
    res.status(500).json({ message: 'Erro ao atualizar status dos pedidos.', error: error.message });
  } finally {
    client.release();
  }
});


// --- ROTAS DO MERCADO PAGO (INTEGRADAS) ---

// ROTA PARA CRIAR PAGAMENTO PIX
app.post('/create-mercadopago-pix', async (req, res) => {
    console.log('🔄 Iniciando criação de pagamento PIX...');
    try {
        const { customerName, customerEmail, items, total } = req.body;

        const validationErrors = []; // Validação de dados (simplificada para o exemplo)
        if (!customerName || !customerEmail || !items || items.length === 0 || !total) {
            validationErrors.push('Dados do pedido incompletos.');
        }
        if (validationErrors.length > 0) {
            return res.status(400).json({ message: 'Dados do pedido incompletos ou inválidos.', errors: validationErrors });
        }

        const externalReference = `acai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const itemsDescription = items.map(item => `${item.title} (${item.quantity}x)`).join(', ').substring(0, 255);
        const description = `Pedido Açaí em Casa - ${customerName}: ${itemsDescription}`;

        const paymentData = {
            transaction_amount: parseFloat(total.toFixed(2)),
            description: description,
            payment_method_id: 'pix',
            payer: { email: customerEmail.trim(), first_name: customerName.trim() },
            external_reference: externalReference,
            notification_url: process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/mercadopago-webhook` : undefined,
        };

        if (!paymentData.notification_url) {
            return res.status(500).json({ message: 'Erro de configuração: URL de notificação não definida.' });
        }

        const paymentResponse = await payment.create({ body: paymentData });

        const pixInfo = paymentResponse.point_of_interaction.transaction_data;
        if (!pixInfo || !pixInfo.qr_code_base64 || !pixInfo.qr_code) {
            throw new Error('QR Code PIX não foi gerado corretamente na resposta do Mercado Pago');
        }

        res.status(200).json({
            paymentId: paymentResponse.id,
            qrCodeImage: `data:image/png;base64,${pixInfo.qr_code_base64}`,
            pixCopiaECola: pixInfo.qr_code,
            status: paymentResponse.status,
            externalReference: externalReference
        });

    } catch (error) {
        console.error('💥 ERRO em /create-mercadopago-pix:', error.cause || error.message);
        res.status(500).json({ message: 'Erro ao criar pagamento Pix.', details: error.cause || error.message });
    }
});


// ROTA PARA CRIAR PREFERÊNCIA DO MERCADO PAGO (PARA BRICKS)
app.post('/create-mercadopago-preference', async (req, res) => {
    console.log('🔄 Iniciando criação de preferência do Mercado Pago...');
    try {
        const { items, customerName, customerEmail, total } = req.body;

        const validationErrors = []; // Validação de dados (simplificada para o exemplo)
        if (!items || items.length === 0 || !customerName || !customerEmail || !total) {
            validationErrors.push('Dados incompletos ou inválidos para criar preferência.');
        }
        if (validationErrors.length > 0) {
            return res.status(400).json({ message: 'Dados incompletos ou inválidos para criar preferência.', errors: validationErrors });
        }

        const externalReference = `pref-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const notificationUrl = process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/mercadopago-webhook` : undefined;
        if (!notificationUrl) {
            return res.status(500).json({ message: 'Erro de configuração: URL de notificação não definida.' });
        }

        const frontendBaseUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5500'; // Define a URL base do frontend

        const preferenceBody = {
            items: items.map(item => ({
                title: item.title,
                unit_price: parseFloat(item.unit_price),
                quantity: parseInt(item.quantity)
            })),
            payer: { name: customerName.trim(), email: customerEmail.trim() },
            external_reference: externalReference,
            back_urls: {
                success: `${frontendBaseUrl}/pedido-concluido.html`, // Use o nome do seu arquivo de sucesso
                failure: `${frontendBaseUrl}/failure.html`, // Crie estas páginas se não existirem
                pending: `${frontendBaseUrl}/pending.html`
            },
            auto_return: 'approved',
            notification_url: notificationUrl,
        };

        const createdPreference = await preference.create({ body: preferenceBody });
        res.status(200).json({ id: createdPreference.id });

    } catch (error) {
        console.error('💥 ERRO ao criar preferência:', error.cause || error.message);
        res.status(500).json({ message: 'Erro ao criar preferência de pagamento.', details: error.cause || error.message });
    }
});


// ROTA PARA CRIAR PAGAMENTO COM CARTÃO (chamada pelo Brick)
app.post('/create-mercadopago-card', async (req, res) => {
    console.log('🔄 Iniciando criação de pagamento com cartão...');
    try {
        const { token, issuer_id, payment_method_id, transaction_amount, installments, payer, external_reference, description } = req.body;

        if (!token || !transaction_amount || !installments || !payer || !payer.email) {
            return res.status(400).json({ message: 'Dados do pagamento com cartão incompletos.' });
        }

        const paymentData = {
            token, issuer_id, payment_method_id,
            transaction_amount: parseFloat(transaction_amount.toFixed(2)),
            installments, payer, external_reference, description,
            notification_url: process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/mercadopago-webhook` : undefined,
        };

        if (!paymentData.notification_url) {
            return res.status(500).json({ message: 'Erro de configuração: URL de notificação não definida.' });
        }

        const paymentResponse = await payment.create({ body: paymentData });
        res.status(201).json({
            status: paymentResponse.status,
            status_detail: paymentResponse.status_detail,
            id: paymentResponse.id,
        });

    } catch (error) {
        console.error('💥 Erro em /create-mercadopago-card:', error.cause || error.message);
        res.status(500).json({ message: 'Erro ao processar pagamento com cartão.', details: error.cause || error.message });
    }
});

// ROTA DE WEBHOOK (para Mercado Pago - recebe notificações de status de pagamento)
app.post('/mercadopago-webhook', (req, res) => {
    console.log('🔔 --- Webhook Mercado Pago Recebido ---');
    // Você pode adicionar lógica aqui para atualizar o status do pedido no Neon
    // com base na notificação de pagamento do Mercado Pago (req.query.topic, req.query.id, req.body.data.id)
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    // IMPORTANTE: Responda rapidamente ao Mercado Pago para evitar timeouts
    res.sendStatus(200);
});


// =========================================================
// INICIAR O SERVIDOR
// =========================================================

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend rodando na porta ${PORT}`);
  console.log(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 Mercado Pago configurado: ${accessToken ? 'SIM' : 'NÃO'}`);
  console.log(`🔗 Backend URL: ${process.env.BACKEND_URL || 'Não configurado'}`);
  console.log(`🌐 Frontend URL (para back_urls): ${process.env.FRONTEND_URL || 'Não configurado'}`);
  console.log(`🎯 Origens permitidas:`, allowedOrigins);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('💥 Erro não capturado no processo:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Promise rejeitada não tratada:', reason);
    process.exit(1);
});
