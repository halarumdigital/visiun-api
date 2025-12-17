import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';

// Swagger Schemas
const franchiseeResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    cnpj: { type: 'string', nullable: true },
    company_name: { type: 'string', nullable: true },
    fantasy_name: { type: 'string', nullable: true },
    cpf: { type: 'string', nullable: true },
    endereco: { type: 'string', nullable: true },
    email: { type: 'string', nullable: true },
    whatsapp_01: { type: 'string', nullable: true },
    whatsapp_02: { type: 'string', nullable: true },
    city_id: { type: 'string', format: 'uuid' },
    status: { type: 'string', nullable: true },
    royalties_percentage: { type: 'number', nullable: true },
    moto_limit: { type: 'number', nullable: true },
    user_id: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
    code: { type: 'string' },
  },
};

// Schemas de validação
const createFranchiseeSchema = z.object({
  cnpj: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  fantasy_name: z.string().optional().nullable(),
  cpf: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  whatsapp_01: z.string().optional().nullable(),
  whatsapp_02: z.string().optional().nullable(),
  city_id: z.string().uuid(),
  status: z.string().optional().nullable().default('active'),
  royalties_percentage: z.number().optional().nullable(),
  moto_limit: z.number().int().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
});

const franchiseesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/franchisees
   * Listar franqueados (com filtro por cidade)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar franqueados por cidade',
      tags: ['Franqueados'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: franchiseeResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const { city_id, status } = request.query as { city_id?: string; status?: string };

    const where: any = {};

    // Filtro por cidade
    if (city_id) {
      where.city_id = city_id;
    } else if (context.cityId && !context.isMasterOrAdmin()) {
      where.city_id = context.cityId;
    }

    // Filtro por status
    if (status) {
      where.status = status;
    }

    const franchisees = await prisma.franchisee.findMany({
      where,
      select: {
        id: true,
        user_id: true,
        cnpj: true,
        cpf: true,
        fantasy_name: true,
        company_name: true,
        endereco: true,
        email: true,
        whatsapp_01: true,
        whatsapp_02: true,
        city_id: true,
        royalties_percentage: true,
        moto_limit: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: [
        { fantasy_name: 'asc' },
      ],
    });

    return reply.status(200).send({
      success: true,
      data: franchisees.map(f => ({
        ...f,
        royalties_percentage: f.royalties_percentage ? Number(f.royalties_percentage) : null,
      })),
    });
  });

  /**
   * POST /api/franchisees/batch
   * Criar múltiplos franqueados (para importação CSV)
   */
  app.post('/batch', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Criar múltiplos franqueados em lote',
      tags: ['Franqueados'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          franchisees: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                cnpj: { type: 'string', nullable: true },
                company_name: { type: 'string', nullable: true },
                fantasy_name: { type: 'string', nullable: true },
                city_id: { type: 'string', format: 'uuid' },
                status: { type: 'string' },
              },
              required: ['city_id'],
            },
          },
        },
        required: ['franchisees'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                created: { type: 'number' },
              },
            },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { franchisees } = request.body as { franchisees: any[] };

    if (!franchisees || franchisees.length === 0) {
      throw new BadRequestError('Lista de franqueados vazia');
    }

    // Criar franqueados
    const result = await prisma.franchisee.createMany({
      data: franchisees.map(f => ({
        cnpj: f.cnpj,
        company_name: f.company_name,
        fantasy_name: f.fantasy_name,
        city_id: f.city_id,
        status: f.status || 'active',
      })),
      skipDuplicates: true,
    });

    return reply.status(200).send({
      success: true,
      data: {
        created: result.count,
      },
    });
  });

  /**
   * GET /api/franchisees/:id/motorcycle-count
   * Contar motocicletas únicas de um franqueado
   */
  app.get('/:id/motorcycle-count', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Contar motocicletas únicas de um franqueado',
      tags: ['Franqueados'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
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
                count: { type: 'number' },
                plates: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Verificar se franqueado existe
    const franchisee = await prisma.franchisee.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!franchisee) {
      throw new NotFoundError('Franqueado não encontrado');
    }

    // Buscar placas únicas (placa não vazia)
    const motorcycles = await prisma.motorcycle.findMany({
      where: {
        franchisee_id: id,
        placa: { not: '' },
      },
      select: { placa: true },
      distinct: ['placa'],
    });

    const plates = motorcycles.map(m => m.placa).filter(Boolean) as string[];

    return reply.status(200).send({
      success: true,
      data: {
        count: plates.length,
        plates,
      },
    });
  });
};

export default franchiseesRoutes;
