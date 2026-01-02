import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { NotFoundError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';

// Swagger Schemas
const rastreadorResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    cnpj: { type: 'string', nullable: true },
    empresa: { type: 'string', nullable: true },
    franqueado: { type: 'string', nullable: true },
    chassi: { type: 'string', nullable: true },
    placa: { type: 'string', nullable: true },
    rastreador: { type: 'string', nullable: true },
    tipo: { type: 'string', nullable: true },
    moto: { type: 'string', nullable: true },
    mes: { type: 'string', nullable: true },
    valor: { type: 'string', nullable: true },
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

// Schemas de validacao
const createRastreadorSchema = z.object({
  cnpj: z.string().optional().nullable(),
  empresa: z.string().optional().nullable(),
  franqueado: z.string().optional().nullable(),
  chassi: z.string().optional().nullable(),
  placa: z.string().optional().nullable(),
  rastreador: z.string().optional().nullable(),
  tipo: z.string().optional().nullable(),
  moto: z.string().optional().nullable(),
  mes: z.string().optional().nullable(),
  valor: z.string().optional().nullable(),
});

const updateRastreadorSchema = createRastreadorSchema.partial();

const rastreadoresRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/rastreadores
   * Listar rastreadores
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar rastreadores',
      tags: ['Rastreadores'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          franqueado: { type: 'string' },
          mes: { type: 'string' },
          placa: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: rastreadorResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { franqueado, mes, placa } = request.query as {
      franqueado?: string;
      mes?: string;
      placa?: string;
    };

    const where: any = {};

    // Filtros opcionais
    if (franqueado) {
      where.franqueado = franqueado;
    }
    if (mes) {
      where.mes = mes;
    }
    if (placa) {
      where.placa = { contains: placa, mode: 'insensitive' };
    }

    const rastreadores = await prisma.rastreador.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    return reply.send({ success: true, data: rastreadores });
  });

  /**
   * GET /api/rastreadores/:id
   * Obter rastreador por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter rastreador por ID',
      tags: ['Rastreadores'],
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
            data: rastreadorResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const rastreador = await prisma.rastreador.findUnique({
      where: { id },
    });

    if (!rastreador) {
      throw new NotFoundError('Rastreador nao encontrado');
    }

    return reply.send({ success: true, data: rastreador });
  });

  /**
   * POST /api/rastreadores
   * Criar novo rastreador
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar novo rastreador',
      tags: ['Rastreadores'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          cnpj: { type: 'string' },
          empresa: { type: 'string' },
          franqueado: { type: 'string' },
          chassi: { type: 'string' },
          placa: { type: 'string' },
          rastreador: { type: 'string' },
          tipo: { type: 'string' },
          moto: { type: 'string' },
          mes: { type: 'string' },
          valor: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rastreadorResponseSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createRastreadorSchema.parse(request.body);

    const rastreador = await prisma.rastreador.create({
      data: body,
    });

    return reply.status(201).send({ success: true, data: rastreador });
  });

  /**
   * POST /api/rastreadores/batch
   * Importar rastreadores em lote
   */
  app.post('/batch', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Importar rastreadores em lote',
      tags: ['Rastreadores'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['rastreadores'],
        properties: {
          rastreadores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                cnpj: { type: 'string' },
                empresa: { type: 'string' },
                franqueado: { type: 'string' },
                chassi: { type: 'string' },
                placa: { type: 'string' },
                rastreador: { type: 'string' },
                tipo: { type: 'string' },
                moto: { type: 'string' },
                mes: { type: 'string' },
                valor: { type: 'string' },
              },
            },
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            count: { type: 'number' },
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rastreadores } = request.body as { rastreadores: any[] };

    // Validar cada rastreador
    const validatedData = rastreadores.map(r => createRastreadorSchema.parse(r));

    // Inserir em lote
    const result = await prisma.rastreador.createMany({
      data: validatedData,
    });

    return reply.status(201).send({
      success: true,
      message: `${result.count} rastreadores importados com sucesso`,
      count: result.count,
    });
  });

  /**
   * PUT /api/rastreadores/:id
   * Atualizar rastreador
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar rastreador',
      tags: ['Rastreadores'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          cnpj: { type: 'string' },
          empresa: { type: 'string' },
          franqueado: { type: 'string' },
          chassi: { type: 'string' },
          placa: { type: 'string' },
          rastreador: { type: 'string' },
          tipo: { type: 'string' },
          moto: { type: 'string' },
          mes: { type: 'string' },
          valor: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rastreadorResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateRastreadorSchema.parse(request.body);

    // Verificar se o rastreador existe
    const existing = await prisma.rastreador.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Rastreador nao encontrado');
    }

    const rastreador = await prisma.rastreador.update({
      where: { id },
      data: body,
    });

    return reply.send({ success: true, data: rastreador });
  });

  /**
   * DELETE /api/rastreadores/:id
   * Deletar rastreador
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar rastreador',
      tags: ['Rastreadores'],
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
            message: { type: 'string' },
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Verificar se o rastreador existe
    const existing = await prisma.rastreador.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Rastreador nao encontrado');
    }

    await prisma.rastreador.delete({ where: { id } });

    return reply.send({ success: true, message: 'Rastreador excluido com sucesso' });
  });
};

export default rastreadoresRoutes;
