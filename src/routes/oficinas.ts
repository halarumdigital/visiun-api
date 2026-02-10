import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const oficinasRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/oficinas
   * Listar todas as oficinas (com filtro por cidade)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar oficinas com filtro por cidade',
      tags: ['Oficinas'],
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
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(query.city_id);
    } else if (context.role !== 'master_br' && context.cityId) {
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(context.cityId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const oficinas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id::text, nome, cnpj, telefone, email, endereco, cidade, estado, cep,
              especialidades, observacoes, ativo, city_id::text, created_at
       FROM oficinas ${whereClause}
       ORDER BY nome`,
      ...params
    );

    return reply.status(200).send({ success: true, data: oficinas });
  });

  /**
   * GET /api/oficinas/mais-agendada
   * Retorna a oficina mais usada nas ordens de serviço
   */
  app.get('/mais-agendada', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Oficina mais agendada nas ordens de serviço',
      tags: ['Oficinas'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    try {
      const result = await prisma.$queryRawUnsafe<{ nome: string; total: string }[]>(
        `SELECT o.nome, COUNT(os.id)::text as total
         FROM ordens_servico os
         JOIN oficinas o ON o.id = os.oficina_id
         WHERE os.oficina_id IS NOT NULL
         GROUP BY o.nome
         ORDER BY COUNT(os.id) DESC
         LIMIT 1`
      );

      const nome = result.length > 0 ? result[0].nome : 'Nenhuma agendada';
      return reply.status(200).send({ success: true, data: { nome } });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar oficina mais agendada');
      return reply.status(200).send({ success: true, data: { nome: 'N/A' } });
    }
  });

  /**
   * POST /api/oficinas
   * Criar uma nova oficina
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar uma nova oficina',
      tags: ['Oficinas'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const body = request.body as any;

    try {
      const cityId = body.city_id || context.cityId;

      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO oficinas (id, nome, cnpj, telefone, email, endereco, cidade, estado, cep,
                               especialidades, observacoes, ativo, city_id, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
                 $9::text[], $10, $11, $12::uuid, $13::uuid)
         RETURNING id::text`,
        body.nome,
        body.cnpj || null,
        body.telefone || null,
        body.email || null,
        body.endereco || null,
        body.cidade || null,
        body.estado || null,
        body.cep || null,
        body.especialidades || [],
        body.observacoes || null,
        body.ativo !== undefined ? body.ativo : true,
        cityId || null,
        body.created_by || context.userId || null
      );

      return reply.status(201).send({
        success: true,
        data: { id: result[0]?.id, message: 'Oficina criada com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao criar oficina');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao criar oficina',
      });
    }
  });

  /**
   * PUT /api/oficinas/:id
   * Atualizar uma oficina
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar uma oficina',
      tags: ['Oficinas'],
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
      if (body.cnpj !== undefined) { sets.push(`cnpj = $${paramIdx++}`); params.push(body.cnpj); }
      if (body.telefone !== undefined) { sets.push(`telefone = $${paramIdx++}`); params.push(body.telefone); }
      if (body.email !== undefined) { sets.push(`email = $${paramIdx++}`); params.push(body.email); }
      if (body.endereco !== undefined) { sets.push(`endereco = $${paramIdx++}`); params.push(body.endereco); }
      if (body.cidade !== undefined) { sets.push(`cidade = $${paramIdx++}`); params.push(body.cidade); }
      if (body.estado !== undefined) { sets.push(`estado = $${paramIdx++}`); params.push(body.estado); }
      if (body.cep !== undefined) { sets.push(`cep = $${paramIdx++}`); params.push(body.cep); }
      if (body.especialidades !== undefined) { sets.push(`especialidades = $${paramIdx++}::text[]`); params.push(body.especialidades); }
      if (body.observacoes !== undefined) { sets.push(`observacoes = $${paramIdx++}`); params.push(body.observacoes); }
      if (body.ativo !== undefined) { sets.push(`ativo = $${paramIdx++}`); params.push(body.ativo); }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: 'Nenhum campo para atualizar' });
      }

      params.push(id);
      await prisma.$queryRawUnsafe(
        `UPDATE oficinas SET ${sets.join(', ')} WHERE id = $${paramIdx}::uuid`,
        ...params
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Oficina atualizada com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar oficina');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao atualizar oficina',
      });
    }
  });

  /**
   * DELETE /api/oficinas/:id
   * Excluir uma oficina
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir uma oficina',
      tags: ['Oficinas'],
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
        `DELETE FROM oficinas WHERE id = $1::uuid`,
        id
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Oficina excluída com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao excluir oficina');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao excluir oficina',
      });
    }
  });
};

export default oficinasRoutes;
