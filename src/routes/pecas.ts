import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const pecasRoutes: FastifyPluginAsync = async (app) => {

  // ========================================
  // PEÇAS CRUD
  // ========================================

  /**
   * GET /api/pecas
   * Listar todas as peças (com filtro por cidade)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar peças com filtro por cidade',
      tags: ['Peças'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as { city_id?: string };

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Filtro de cidade
    if (context.role === 'master_br' && query.city_id) {
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(query.city_id);
    } else if (context.role !== 'master_br' && context.cityId) {
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(context.cityId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const pecas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id::text, codigo, nome, descricao, categoria, marca,
              preco_custo, preco_venda, estoque_atual, estoque_minimo,
              unidade_medida, fornecedor_id::text, observacoes, ativo,
              city_id::text, created_at
       FROM pecas ${whereClause}
       ORDER BY nome`,
      ...params
    );

    // Converter numerics de string para number
    const mapped = pecas.map(p => ({
      ...p,
      preco_custo: Number(p.preco_custo) || 0,
      preco_venda: Number(p.preco_venda) || 0,
      estoque_atual: Number(p.estoque_atual) || 0,
      estoque_minimo: Number(p.estoque_minimo) || 0,
    }));

    return reply.status(200).send({ success: true, data: mapped });
  });

  /**
   * POST /api/pecas
   * Criar uma nova peça
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar uma nova peça',
      tags: ['Peças'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const body = request.body as any;

    try {
      const cityId = body.city_id || context.cityId;

      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO pecas (id, codigo, nome, descricao, categoria, marca,
                            preco_custo, preco_venda, estoque_atual, estoque_minimo,
                            unidade_medida, fornecedor_id, observacoes, ativo,
                            city_id, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5,
                 $6::numeric, $7::numeric, $8::integer, $9::integer,
                 $10, $11::uuid, $12, $13,
                 $14::uuid, $15::uuid)
         RETURNING id::text`,
        body.codigo || null,
        body.nome,
        body.descricao || null,
        body.categoria || null,
        body.marca || null,
        Number(body.preco_custo) || 0,
        Number(body.preco_venda) || 0,
        Number(body.estoque_atual) || 0,
        Number(body.estoque_minimo) || 0,
        body.unidade_medida || 'UN',
        body.fornecedor_id || null,
        body.observacoes || null,
        body.ativo !== undefined ? body.ativo : true,
        cityId || null,
        body.created_by || context.userId || null
      );

      return reply.status(201).send({
        success: true,
        data: { id: result[0]?.id, message: 'Peça criada com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao criar peça');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao criar peça',
      });
    }
  });

  /**
   * PUT /api/pecas/:id
   * Atualizar uma peça
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar uma peça',
      tags: ['Peças'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    try {
      const sets: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (body.codigo !== undefined) { sets.push(`codigo = $${paramIdx++}`); params.push(body.codigo); }
      if (body.nome !== undefined) { sets.push(`nome = $${paramIdx++}`); params.push(body.nome); }
      if (body.descricao !== undefined) { sets.push(`descricao = $${paramIdx++}`); params.push(body.descricao); }
      if (body.categoria !== undefined) { sets.push(`categoria = $${paramIdx++}`); params.push(body.categoria); }
      if (body.marca !== undefined) { sets.push(`marca = $${paramIdx++}`); params.push(body.marca); }
      if (body.preco_custo !== undefined) { sets.push(`preco_custo = $${paramIdx++}::numeric`); params.push(Number(body.preco_custo) || 0); }
      if (body.preco_venda !== undefined) { sets.push(`preco_venda = $${paramIdx++}::numeric`); params.push(Number(body.preco_venda) || 0); }
      if (body.estoque_atual !== undefined) { sets.push(`estoque_atual = $${paramIdx++}::integer`); params.push(Number(body.estoque_atual) || 0); }
      if (body.estoque_minimo !== undefined) { sets.push(`estoque_minimo = $${paramIdx++}::integer`); params.push(Number(body.estoque_minimo) || 0); }
      if (body.unidade_medida !== undefined) { sets.push(`unidade_medida = $${paramIdx++}`); params.push(body.unidade_medida); }
      if (body.fornecedor_id !== undefined) { sets.push(`fornecedor_id = $${paramIdx++}::uuid`); params.push(body.fornecedor_id || null); }
      if (body.observacoes !== undefined) { sets.push(`observacoes = $${paramIdx++}`); params.push(body.observacoes); }
      if (body.ativo !== undefined) { sets.push(`ativo = $${paramIdx++}`); params.push(body.ativo); }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: 'Nenhum campo para atualizar' });
      }

      params.push(id);
      await prisma.$queryRawUnsafe(
        `UPDATE pecas SET ${sets.join(', ')} WHERE id = $${paramIdx}::uuid`,
        ...params
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Peça atualizada com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar peça');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao atualizar peça',
      });
    }
  });

  /**
   * DELETE /api/pecas/:id
   * Excluir uma peça
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir uma peça',
      tags: ['Peças'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.$queryRawUnsafe(
        `DELETE FROM pecas WHERE id = $1::uuid`,
        id
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Peça excluída com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao excluir peça');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao excluir peça',
      });
    }
  });

  // ========================================
  // FORNECEDORES
  // ========================================

  /**
   * GET /api/pecas/fornecedores
   * Listar fornecedores ativos
   */
  app.get('/fornecedores', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar fornecedores ativos',
      tags: ['Peças'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    const fornecedores = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id::text, nome, email, telefone, ativo
       FROM fornecedores
       WHERE ativo = true
       ORDER BY nome`
    );

    return reply.status(200).send({ success: true, data: fornecedores });
  });

  /**
   * POST /api/pecas/fornecedores
   * Criar um novo fornecedor
   */
  app.post('/fornecedores', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar um novo fornecedor',
      tags: ['Peças'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const body = request.body as any;

    try {
      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO fornecedores (id, nome, email, telefone, ativo)
         VALUES (gen_random_uuid(), $1, $2, $3, true)
         RETURNING id::text, nome, email, telefone, ativo`,
        body.nome,
        body.email || null,
        body.telefone || null
      );

      return reply.status(201).send({
        success: true,
        data: result[0] || null,
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao criar fornecedor');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao criar fornecedor',
      });
    }
  });
};

export default pecasRoutes;
