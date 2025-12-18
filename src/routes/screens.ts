import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const screensRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/screens
   * Listar todas as telas do sistema
   */
  app.get('/', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Listar todas as telas do sistema',
      tags: ['Telas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filtrar por categoria (main, admin, manutencao)' },
          active: { type: 'boolean', description: 'Filtrar por status ativo' },
        },
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
                properties: {
                  id: { type: 'string' },
                  name_pt: { type: 'string' },
                  path: { type: 'string' },
                  category: { type: 'string' },
                  order_index: { type: 'number' },
                  is_active: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { category, active } = request.query as { category?: string; active?: boolean };

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (category) {
      params.push(category);
      whereClause += ` AND category = $${params.length}`;
    }

    if (active !== undefined) {
      params.push(active);
      whereClause += ` AND is_active = $${params.length}`;
    }

    const screens = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name_pt: string;
      path: string;
      category: string;
      order_index: number;
      is_active: boolean;
    }>>(`
      SELECT id, name_pt, path, category, order_index, is_active
      FROM screens
      ${whereClause}
      ORDER BY order_index
    `, ...params);

    return reply.status(200).send({
      success: true,
      data: screens,
    });
  });

  /**
   * GET /api/screens/categories
   * Listar categorias de telas disponíveis
   */
  app.get('/categories', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Listar categorias de telas',
      tags: ['Telas'],
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
                properties: {
                  category: { type: 'string' },
                  count: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const categories = await prisma.$queryRaw<Array<{
      category: string;
      count: number;
    }>>`
      SELECT category, COUNT(*)::int as count
      FROM screens
      WHERE is_active = true
      GROUP BY category
      ORDER BY category
    `;

    return reply.status(200).send({
      success: true,
      data: categories,
    });
  });

  /**
   * GET /api/screens/grouped
   * Listar telas agrupadas por categoria
   */
  app.get('/grouped', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Listar telas agrupadas por categoria',
      tags: ['Telas'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name_pt: { type: 'string' },
                    path: { type: 'string' },
                    order_index: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const screens = await prisma.$queryRaw<Array<{
      id: string;
      name_pt: string;
      path: string;
      category: string;
      order_index: number;
    }>>`
      SELECT id, name_pt, path, category, order_index
      FROM screens
      WHERE is_active = true
      ORDER BY category, order_index
    `;

    // Agrupar por categoria
    const grouped: Record<string, typeof screens> = {};
    for (const screen of screens) {
      if (!grouped[screen.category]) {
        grouped[screen.category] = [];
      }
      grouped[screen.category].push(screen);
    }

    return reply.status(200).send({
      success: true,
      data: grouped,
    });
  });
};

export default screensRoutes;
