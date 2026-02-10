import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const profissionaisRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/profissionais
   * Listar profissionais (com filtro por cidade e join de oficina)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar profissionais com filtro por cidade',
      tags: ['Profissionais'],
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

    if (context.role === 'master_br' && query.city_id) {
      conditions.push(`p.city_id = $${paramIndex++}::uuid`);
      params.push(query.city_id);
    } else if (context.role !== 'master_br' && context.cityId) {
      conditions.push(`p.city_id = $${paramIndex++}::uuid`);
      params.push(context.cityId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const profissionais = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id::text, p.nome, p.cpf, p.telefone, p.email, p.especialidade,
              p.oficina_id::text, o.nome as oficina_nome,
              p.observacoes, p.ativo, p.city_id::text, p.created_at
       FROM profissionais p
       LEFT JOIN oficinas o ON o.id = p.oficina_id
       ${whereClause}
       ORDER BY p.nome`,
      ...params
    );

    return reply.status(200).send({ success: true, data: profissionais });
  });

  /**
   * GET /api/profissionais/mais-agendado
   * Retorna o profissional mais usado nas ordens de serviço
   */
  app.get('/mais-agendado', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Profissional mais agendado nas ordens de serviço',
      tags: ['Profissionais'],
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

    try {
      const conditions: string[] = ['os.profissional_id IS NOT NULL'];
      const params: any[] = [];
      let paramIndex = 1;

      if (context.role === 'master_br' && query.city_id) {
        conditions.push(`os.city_id = $${paramIndex++}::uuid`);
        params.push(query.city_id);
      } else if (context.role !== 'master_br' && context.cityId) {
        conditions.push(`os.city_id = $${paramIndex++}::uuid`);
        params.push(context.cityId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await prisma.$queryRawUnsafe<{ nome: string; total: string }[]>(
        `SELECT pr.nome, COUNT(os.id)::text as total
         FROM ordens_servico os
         JOIN profissionais pr ON pr.id = os.profissional_id
         ${whereClause}
         GROUP BY pr.nome
         ORDER BY COUNT(os.id) DESC
         LIMIT 1`,
        ...params
      );

      const nome = result.length > 0 ? result[0].nome : 'Nenhum agendado';
      return reply.status(200).send({ success: true, data: { nome } });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar profissional mais agendado');
      return reply.status(200).send({ success: true, data: { nome: 'N/A' } });
    }
  });

  /**
   * GET /api/profissionais/oficinas
   * Listar oficinas ativas (para dropdown do formulário)
   */
  app.get('/oficinas', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar oficinas ativas para seleção',
      tags: ['Profissionais'],
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

    const conditions: string[] = ['ativo = true'];
    const params: any[] = [];
    let paramIndex = 1;

    if (context.role === 'master_br' && query.city_id) {
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(query.city_id);
    } else if (context.role !== 'master_br' && context.cityId) {
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(context.cityId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const oficinas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id::text, nome, ativo
       FROM oficinas ${whereClause}
       ORDER BY nome`,
      ...params
    );

    return reply.status(200).send({ success: true, data: oficinas });
  });

  /**
   * POST /api/profissionais
   * Criar um novo profissional
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar um novo profissional',
      tags: ['Profissionais'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const body = request.body as any;

    try {
      const cityId = body.city_id || context.cityId;

      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO profissionais (id, nome, cpf, telefone, email, especialidade,
                                    oficina_id, observacoes, ativo, city_id, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5,
                 $6::uuid, $7, $8, $9::uuid, $10::uuid)
         RETURNING id::text`,
        body.nome,
        body.cpf || null,
        body.telefone || null,
        body.email || null,
        body.especialidade || null,
        body.oficina_id || null,
        body.observacoes || null,
        body.ativo !== undefined ? body.ativo : true,
        cityId || null,
        body.created_by || context.userId || null
      );

      return reply.status(201).send({
        success: true,
        data: { id: result[0]?.id, message: 'Profissional criado com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao criar profissional');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao criar profissional',
      });
    }
  });

  /**
   * PUT /api/profissionais/:id
   * Atualizar um profissional
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar um profissional',
      tags: ['Profissionais'],
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

      if (body.nome !== undefined) { sets.push(`nome = $${paramIdx++}`); params.push(body.nome); }
      if (body.cpf !== undefined) { sets.push(`cpf = $${paramIdx++}`); params.push(body.cpf || null); }
      if (body.telefone !== undefined) { sets.push(`telefone = $${paramIdx++}`); params.push(body.telefone || null); }
      if (body.email !== undefined) { sets.push(`email = $${paramIdx++}`); params.push(body.email || null); }
      if (body.especialidade !== undefined) { sets.push(`especialidade = $${paramIdx++}`); params.push(body.especialidade); }
      if (body.oficina_id !== undefined) { sets.push(`oficina_id = $${paramIdx++}::uuid`); params.push(body.oficina_id || null); }
      if (body.observacoes !== undefined) { sets.push(`observacoes = $${paramIdx++}`); params.push(body.observacoes || null); }
      if (body.ativo !== undefined) { sets.push(`ativo = $${paramIdx++}`); params.push(body.ativo); }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: 'Nenhum campo para atualizar' });
      }

      params.push(id);
      await prisma.$queryRawUnsafe(
        `UPDATE profissionais SET ${sets.join(', ')} WHERE id = $${paramIdx}::uuid`,
        ...params
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Profissional atualizado com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar profissional');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao atualizar profissional',
      });
    }
  });

  /**
   * DELETE /api/profissionais/:id
   * Excluir um profissional
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir um profissional',
      tags: ['Profissionais'],
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
        `DELETE FROM profissionais WHERE id = $1::uuid`,
        id
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Profissional excluído com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao excluir profissional');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao excluir profissional',
      });
    }
  });
};

export default profissionaisRoutes;
