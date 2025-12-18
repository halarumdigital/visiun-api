import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

// Swagger Schemas
const motorcycleModelResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    brand: { type: 'string' },
    model: { type: 'string' },
    active: { type: 'boolean' },
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
const createMotorcycleModelSchema = z.object({
  brand: z.string().min(1, 'Marca é obrigatória'),
  model: z.string().min(1, 'Modelo é obrigatório'),
  active: z.boolean().optional().default(true),
});

const updateMotorcycleModelSchema = createMotorcycleModelSchema.partial();

const motorcycleModelsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/motorcycle-models
   * Listar todos os modelos de motocicletas
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os modelos de motocicletas cadastrados',
      tags: ['Modelos de Motocicletas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          active: { type: 'boolean', description: 'Filtrar por status ativo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: motorcycleModelResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { active } = request.query as { active?: boolean };

    const where: any = {};
    if (typeof active === 'boolean') {
      where.active = active;
    }

    const models = await prisma.motorcycleModel.findMany({
      where,
      orderBy: [
        { brand: 'asc' },
        { model: 'asc' },
      ],
    });

    return reply.status(200).send({
      success: true,
      data: models,
    });
  });

  /**
   * GET /api/motorcycle-models/:id
   * Obter modelo por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter modelo de motocicleta por ID',
      tags: ['Modelos de Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do modelo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleModelResponseSchema,
          },
        },
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const model = await prisma.motorcycleModel.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundError('Modelo não encontrado');
    }

    return reply.status(200).send({
      success: true,
      data: model,
    });
  });

  /**
   * POST /api/motorcycle-models
   * Criar novo modelo de motocicleta
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Criar novo modelo de motocicleta',
      tags: ['Modelos de Motocicletas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['brand', 'model'],
        properties: {
          brand: { type: 'string', minLength: 1, description: 'Marca da motocicleta' },
          model: { type: 'string', minLength: 1, description: 'Modelo da motocicleta' },
          active: { type: 'boolean', default: true, description: 'Status ativo' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleModelResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createMotorcycleModelSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;

    // Verificar se já existe um modelo com a mesma marca e modelo
    const existing = await prisma.motorcycleModel.findFirst({
      where: {
        brand: { equals: data.brand, mode: 'insensitive' },
        model: { equals: data.model, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new BadRequestError('Já existe um modelo com esta marca e nome');
    }

    const model = await prisma.motorcycleModel.create({
      data: {
        brand: data.brand.trim(),
        model: data.model.trim(),
        active: data.active ?? true,
      },
    });

    return reply.status(201).send({
      success: true,
      data: model,
    });
  });

  /**
   * PUT /api/motorcycle-models/:id
   * Atualizar modelo de motocicleta
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Atualizar modelo de motocicleta',
      tags: ['Modelos de Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do modelo' },
        },
      },
      body: {
        type: 'object',
        properties: {
          brand: { type: 'string', minLength: 1, description: 'Marca da motocicleta' },
          model: { type: 'string', minLength: 1, description: 'Modelo da motocicleta' },
          active: { type: 'boolean', description: 'Status ativo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleModelResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateMotorcycleModelSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const existingModel = await prisma.motorcycleModel.findUnique({
      where: { id },
    });

    if (!existingModel) {
      throw new NotFoundError('Modelo não encontrado');
    }

    const data = body.data;

    // Verificar se já existe outro modelo com a mesma marca e modelo
    if (data.brand || data.model) {
      const duplicate = await prisma.motorcycleModel.findFirst({
        where: {
          id: { not: id },
          brand: { equals: data.brand || existingModel.brand, mode: 'insensitive' },
          model: { equals: data.model || existingModel.model, mode: 'insensitive' },
        },
      });

      if (duplicate) {
        throw new BadRequestError('Já existe um modelo com esta marca e nome');
      }
    }

    const model = await prisma.motorcycleModel.update({
      where: { id },
      data: {
        ...(data.brand && { brand: data.brand.trim() }),
        ...(data.model && { model: data.model.trim() }),
        ...(typeof data.active === 'boolean' && { active: data.active }),
      },
    });

    return reply.status(200).send({
      success: true,
      data: model,
    });
  });

  /**
   * DELETE /api/motorcycle-models/:id
   * Excluir modelo de motocicleta
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Excluir modelo de motocicleta',
      tags: ['Modelos de Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do modelo' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existingModel = await prisma.motorcycleModel.findUnique({
      where: { id },
    });

    if (!existingModel) {
      throw new NotFoundError('Modelo não encontrado');
    }

    await prisma.motorcycleModel.delete({
      where: { id },
    });

    return reply.status(200).send({
      success: true,
      message: 'Modelo excluído com sucesso',
    });
  });

  /**
   * GET /api/motorcycle-models/brands
   * Listar todas as marcas distintas
   */
  app.get('/brands', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todas as marcas de motocicletas cadastradas',
      tags: ['Modelos de Motocicletas'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: { type: 'string' } },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const brands = await prisma.motorcycleModel.findMany({
      where: { active: true },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });

    return reply.status(200).send({
      success: true,
      data: brands.map(b => b.brand),
    });
  });
};

export default motorcycleModelsRoutes;
