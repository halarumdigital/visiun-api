import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const servicosRoutes: FastifyPluginAsync = async (app) => {

  // ========================================
  // SERVIÇOS CRUD
  // ========================================

  /**
   * GET /api/servicos
   * Listar todos os serviços (com filtro por cidade)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar serviços com filtro por cidade',
      tags: ['Serviços'],
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

    const servicos = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id::text, codigo, nome, descricao, categoria,
              preco_base, tempo_estimado, garantia_dias,
              observacoes, ativo, city_id::text, created_at
       FROM servicos ${whereClause}
       ORDER BY nome`,
      ...params
    );

    // Converter numerics de string para number
    const mapped = servicos.map(s => ({
      ...s,
      preco_base: Number(s.preco_base) || 0,
      tempo_estimado: Number(s.tempo_estimado) || 0,
      garantia_dias: Number(s.garantia_dias) || 0,
    }));

    return reply.status(200).send({ success: true, data: mapped });
  });

  /**
   * GET /api/servicos/mais-agendado
   * Retorna o serviço mais usado nas ordens de serviço
   */
  app.get('/mais-agendado', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Serviço mais agendado nas ordens de serviço',
      tags: ['Serviços'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    try {
      const result = await prisma.$queryRawUnsafe<{ nome: string; total: string }[]>(
        `SELECT s.nome, COUNT(oss.id)::text as total
         FROM ordens_servico_servicos oss
         JOIN servicos s ON s.id = oss.servico_id
         GROUP BY s.nome
         ORDER BY COUNT(oss.id) DESC
         LIMIT 1`
      );

      const nome = result.length > 0 ? result[0].nome : 'Nenhum agendado';
      return reply.status(200).send({ success: true, data: { nome } });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar serviço mais agendado');
      return reply.status(200).send({ success: true, data: { nome: 'N/A' } });
    }
  });

  /**
   * POST /api/servicos
   * Criar um novo serviço
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar um novo serviço',
      tags: ['Serviços'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const body = request.body as any;

    try {
      const cityId = body.city_id || context.cityId;

      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO servicos (id, codigo, nome, descricao, categoria,
                               preco_base, tempo_estimado, garantia_dias,
                               observacoes, ativo, city_id, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4,
                 $5::numeric, $6::integer, $7::integer,
                 $8, $9, $10::uuid, $11::uuid)
         RETURNING id::text`,
        body.codigo || null,
        body.nome,
        body.descricao || null,
        body.categoria || null,
        Number(body.preco_base) || 0,
        Number(body.tempo_estimado) || 0,
        Number(body.garantia_dias) || 0,
        body.observacoes || null,
        body.ativo !== undefined ? body.ativo : true,
        cityId || null,
        body.created_by || context.userId || null
      );

      return reply.status(201).send({
        success: true,
        data: { id: result[0]?.id, message: 'Serviço criado com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao criar serviço');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao criar serviço',
      });
    }
  });

  /**
   * PUT /api/servicos/:id
   * Atualizar um serviço
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar um serviço',
      tags: ['Serviços'],
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
      if (body.preco_base !== undefined) { sets.push(`preco_base = $${paramIdx++}::numeric`); params.push(Number(body.preco_base) || 0); }
      if (body.tempo_estimado !== undefined) { sets.push(`tempo_estimado = $${paramIdx++}::integer`); params.push(Number(body.tempo_estimado) || 0); }
      if (body.garantia_dias !== undefined) { sets.push(`garantia_dias = $${paramIdx++}::integer`); params.push(Number(body.garantia_dias) || 0); }
      if (body.observacoes !== undefined) { sets.push(`observacoes = $${paramIdx++}`); params.push(body.observacoes); }
      if (body.ativo !== undefined) { sets.push(`ativo = $${paramIdx++}`); params.push(body.ativo); }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: 'Nenhum campo para atualizar' });
      }

      params.push(id);
      await prisma.$queryRawUnsafe(
        `UPDATE servicos SET ${sets.join(', ')} WHERE id = $${paramIdx}::uuid`,
        ...params
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Serviço atualizado com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar serviço');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao atualizar serviço',
      });
    }
  });

  /**
   * DELETE /api/servicos/:id
   * Excluir um serviço
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir um serviço',
      tags: ['Serviços'],
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
        `DELETE FROM servicos WHERE id = $1::uuid`,
        id
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Serviço excluído com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao excluir serviço');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao excluir serviço',
      });
    }
  });
};

export default servicosRoutes;
