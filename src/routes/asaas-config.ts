import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';

const asaasConfigRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/asaas-config
   * Listar todas as configurações do Asaas
   * Apenas master_br e admin
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Listar configurações do Asaas',
      tags: ['Asaas Config'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const configs = await prisma.asaasConfig.findMany({
      orderBy: { key: 'asc' },
    });

    return reply.status(200).send({
      success: true,
      data: configs,
    });
  });

  /**
   * PUT /api/asaas-config/:key
   * Atualizar uma configuração específica por key
   * Apenas master_br e admin
   */
  app.put<{ Params: { key: string } }>('/:key', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar configuração do Asaas por key',
      tags: ['Asaas Config'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
        required: ['key'],
      },
      body: {
        type: 'object',
        required: ['value'],
        properties: {
          value: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { key } = request.params;
    const { value } = request.body as { value: string };

    const existing = await prisma.asaasConfig.findUnique({ where: { key } });
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: `Configuração "${key}" não encontrada`,
      });
    }

    const updated = await prisma.asaasConfig.update({
      where: { key },
      data: { value },
    });

    return reply.status(200).send({
      success: true,
      data: updated,
    });
  });

  /**
   * PUT /api/asaas-config
   * Atualizar múltiplas configurações de uma vez (batch)
   * Apenas master_br e admin
   */
  app.put('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar múltiplas configurações do Asaas',
      tags: ['Asaas Config'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['configs'],
        properties: {
          configs: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'value'],
              properties: {
                key: { type: 'string' },
                value: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { configs } = request.body as { configs: { key: string; value: string }[] };

    await prisma.$transaction(
      configs.map(({ key, value }) =>
        prisma.asaasConfig.update({
          where: { key },
          data: { value },
        })
      )
    );

    return reply.status(200).send({
      success: true,
      message: 'Configurações atualizadas com sucesso',
    });
  });
};

export default asaasConfigRoutes;
