import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';

const templatesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/templates
   * Listar todos os templates ativos
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os templates ativos',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const templates = await prisma.contractTemplate.findMany({
      where: {
        is_active: true,
      },
      include: {
        contract_type: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log('📋 [TEMPLATES] Todos os templates ativos:', templates.map(t => t.name));

    return reply.send({
      success: true,
      data: templates,
    });
  });

  /**
   * GET /api/templates/by-name/:name
   * Buscar template por nome exato
   */
  app.get('/by-name/:name', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar template por nome exato',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do template' },
        },
        required: ['name'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              nullable: true,
              additionalProperties: true,
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { name } = request.params as { name: string };

    const template = await prisma.contractTemplate.findFirst({
      where: {
        name: name,
        is_active: true,
      },
      include: {
        contract_type: true,
      },
    });

    return reply.send({
      success: true,
      data: template,
    });
  });

  /**
   * GET /api/templates/search/:query
   * Buscar templates que contenham o texto no nome
   */
  app.get('/search/:query', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar templates que contenham o texto no nome',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto para buscar no nome' },
        },
        required: ['query'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { query } = request.params as { query: string };

    console.log(`🔍 [TEMPLATES] Buscando templates com query: "${query}"`);

    const templates = await prisma.contractTemplate.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive',
        },
        is_active: true,
      },
      include: {
        contract_type: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log(`🔍 [TEMPLATES] Encontrados ${templates.length} templates:`, templates.map(t => t.name));

    return reply.send({
      success: true,
      data: templates,
    });
  });

  /**
   * GET /api/templates/:id
   * Buscar template por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar template por ID',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do template' },
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
              nullable: true,
              additionalProperties: true,
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      include: {
        contract_type: true,
      },
    });

    return reply.send({
      success: true,
      data: template,
    });
  });

  /**
   * GET /api/templates/:id/clauses
   * Buscar cláusulas de um template
   */
  app.get('/:id/clauses', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar cláusulas de um template',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do template' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const clauses = await prisma.contractClause.findMany({
      where: {
        template_id: id,
      },
      orderBy: {
        order_index: 'asc',
      },
    });

    return reply.send({
      success: true,
      data: clauses,
    });
  });
};

export default templatesRoutes;
