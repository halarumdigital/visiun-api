import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';

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
                created_at: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { name, slug, plugsign_token } = request.body as { name: string; slug: string; plugsign_token?: string };

    const city = await prisma.city.create({
      data: {
        name,
        slug,
        plugsign_token: plugsign_token || null,
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
                created_at: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, slug, plugsign_token } = request.body as { name?: string; slug?: string; plugsign_token?: string };

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
