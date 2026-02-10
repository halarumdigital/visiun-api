import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const citiesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/cities
   * Listar todas as cidades
   */
  app.get('/', {
    schema: {
      description: 'Listar todas as cidades',
      tags: ['Cidades'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  plugsign_token: { type: 'string', nullable: true },
                  asaas_wallet_id: { type: 'string', nullable: true },
                  created_at: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const cities = await prisma.city.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        plugsign_token: true,
        asaas_wallet_id: true,
        created_at: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return reply.status(200).send({
      success: true,
      data: cities,
    });
  });

  /**
   * GET /api/cities/plugsign-token
   * Resolve o token PlugSign baseado no contexto do usuário autenticado
   * - Se city_id é fornecido, retorna o token dessa cidade
   * - Se não, resolve pelo role: regional/admin usa city_id do usuário, franchisee usa city da franquia
   */
  app.get('/plugsign-token', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter token PlugSign baseado no contexto do usuário',
      tags: ['Cidades'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const ctx = getContext(request);
    const { city_id } = request.query as { city_id?: string };

    let targetCityId = city_id;

    // Se não foi passado city_id, resolver pelo contexto do usuário
    if (!targetCityId) {
      if (ctx.isMasterOrAdmin()) {
        return reply.status(400).send({
          success: false,
          error: 'Master/Admin precisa informar city_id',
        });
      }

      if (ctx.isRegional()) {
        targetCityId = ctx.cityId || undefined;
      } else if (ctx.isFranchisee() && ctx.franchiseeId) {
        // Buscar a cidade da franquia
        const franchisee = await prisma.franchisee.findUnique({
          where: { id: ctx.franchiseeId },
          select: { city_id: true },
        });
        targetCityId = franchisee?.city_id || undefined;
      }
    }

    if (!targetCityId) {
      return reply.status(400).send({
        success: false,
        error: 'Não foi possível determinar a cidade para obter o token',
      });
    }

    const city = await prisma.city.findUnique({
      where: { id: targetCityId },
      select: { id: true, name: true, plugsign_token: true },
    });

    if (!city) {
      return reply.status(404).send({
        success: false,
        error: 'Cidade não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: {
        city_id: city.id,
        city_name: city.name,
        plugsign_token: city.plugsign_token || null,
      },
    });
  });

  /**
   * GET /api/cities/:id
   * Obter cidade por ID
   */
  app.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Obter cidade por ID',
      tags: ['Cidades'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const city = await prisma.city.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        plugsign_token: true,
        asaas_wallet_id: true,
        created_at: true,
      },
    });

    if (!city) {
      return reply.status(404).send({
        success: false,
        error: 'Cidade não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: city,
    });
  });

  /**
   * POST /api/cities
   * Criar nova cidade
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Criar nova cidade',
      tags: ['Cidades'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'slug'],
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
          plugsign_token: { type: 'string', nullable: true },
          asaas_wallet_id: { type: 'string', nullable: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                slug: { type: 'string' },
                plugsign_token: { type: 'string', nullable: true },
                asaas_wallet_id: { type: 'string', nullable: true },
                created_at: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { name, slug, plugsign_token, asaas_wallet_id } = request.body as { name: string; slug: string; plugsign_token?: string; asaas_wallet_id?: string };

    const city = await prisma.city.create({
      data: {
        name,
        slug,
        plugsign_token: plugsign_token || null,
        asaas_wallet_id: asaas_wallet_id || null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: city,
    });
  });

  /**
   * PUT /api/cities/:id
   * Atualizar cidade
   */
  app.put<{ Params: { id: string } }>('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Atualizar cidade',
      tags: ['Cidades'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
          plugsign_token: { type: 'string', nullable: true },
          asaas_wallet_id: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                slug: { type: 'string' },
                plugsign_token: { type: 'string', nullable: true },
                asaas_wallet_id: { type: 'string', nullable: true },
                created_at: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, slug, plugsign_token, asaas_wallet_id } = request.body as { name?: string; slug?: string; plugsign_token?: string; asaas_wallet_id?: string };

    const existingCity = await prisma.city.findUnique({ where: { id } });
    if (!existingCity) {
      return reply.status(404).send({
        success: false,
        error: 'Cidade não encontrada',
      });
    }

    const city = await prisma.city.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(slug && { slug }),
        plugsign_token: plugsign_token !== undefined ? (plugsign_token || null) : existingCity.plugsign_token,
        asaas_wallet_id: asaas_wallet_id !== undefined ? (asaas_wallet_id || null) : existingCity.asaas_wallet_id,
      },
    });

    return reply.status(200).send({
      success: true,
      data: city,
    });
  });

  /**
   * DELETE /api/cities/:id
   * Excluir cidade
   */
  app.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Excluir cidade',
      tags: ['Cidades'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const existingCity = await prisma.city.findUnique({ where: { id } });
    if (!existingCity) {
      return reply.status(404).send({
        success: false,
        error: 'Cidade não encontrada',
      });
    }

    await prisma.city.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
      message: 'Cidade excluída com sucesso',
    });
  });
};

export default citiesRoutes;
