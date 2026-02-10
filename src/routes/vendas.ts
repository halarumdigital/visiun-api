import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';

// Swagger Schemas
const vendaResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    data_compra: { type: 'string' },
    parceiro: { type: 'string' },
    status: { type: 'string' },
    entregue: { type: 'boolean' },
    franqueado: { type: 'string' },
    cnpj: { type: 'string' },
    razao_social: { type: 'string' },
    quantidade: { type: 'number' },
    marca: { type: 'string' },
    modelo: { type: 'string' },
    valor_unitario: { type: 'number' },
    valor_total: { type: 'number' },
    city_id: { type: 'string', format: 'uuid', nullable: true },
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
const createVendaSchema = z.object({
  data_compra: z.string(),
  parceiro: z.string(),
  status: z.enum(['PAGO', 'PAGANDO', 'PENDENTE']).default('PENDENTE'),
  entregue: z.boolean().default(false),
  franqueado: z.string(),
  cnpj: z.string(),
  razao_social: z.string(),
  quantidade: z.number().int().min(0).default(0),
  marca: z.string(),
  modelo: z.string(),
  valor_unitario: z.number().min(0).default(0),
  valor_total: z.number().min(0).default(0),
  city_id: z.string().uuid().optional().nullable(),
});

const updateVendaSchema = createVendaSchema.partial();

const vendasRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/vendas
   * Listar vendas (com filtro por cidade)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar vendas de motos',
      tags: ['Vendas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: vendaResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const { city_id } = request.query as { city_id?: string };

    const where: any = {};

    // Filtro por cidade
    if (city_id) {
      where.city_id = city_id;
    } else if (context.cityId && !context.isMasterOrAdmin()) {
      where.city_id = context.cityId;
    }

    const vendas = await prisma.venda.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        city: true,
      },
    });

    // Converter Decimal para number
    const vendasFormatted = vendas.map(v => ({
      ...v,
      valor_unitario: Number(v.valor_unitario),
      valor_total: Number(v.valor_total),
    }));

    return reply.send({ success: true, data: vendasFormatted });
  });

  /**
   * GET /api/vendas/:id
   * Obter venda por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter venda por ID',
      tags: ['Vendas'],
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
            data: vendaResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const venda = await prisma.venda.findUnique({
      where: { id },
      include: { city: true },
    });

    if (!venda) {
      throw new NotFoundError('Venda nao encontrada');
    }

    return reply.send({
      success: true,
      data: {
        ...venda,
        valor_unitario: Number(venda.valor_unitario),
        valor_total: Number(venda.valor_total),
      },
    });
  });

  /**
   * POST /api/vendas
   * Criar nova venda
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar nova venda',
      tags: ['Vendas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['data_compra', 'parceiro', 'franqueado', 'cnpj', 'razao_social', 'marca', 'modelo'],
        properties: {
          data_compra: { type: 'string' },
          parceiro: { type: 'string' },
          status: { type: 'string', enum: ['PAGO', 'PAGANDO', 'PENDENTE'] },
          entregue: { type: 'boolean' },
          franqueado: { type: 'string' },
          cnpj: { type: 'string' },
          razao_social: { type: 'string' },
          quantidade: { type: 'number' },
          marca: { type: 'string' },
          modelo: { type: 'string' },
          valor_unitario: { type: 'number' },
          valor_total: { type: 'number' },
          city_id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: vendaResponseSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createVendaSchema.parse(request.body);
    const context = getContext(request);

    // Se nao houver city_id no body, usar o do contexto
    const city_id = body.city_id || context.cityId;

    // Converter data_compra para formato ISO-8601 completo
    const data_compra = new Date(body.data_compra).toISOString();

    const venda = await prisma.venda.create({
      data: {
        data_compra,
        parceiro: body.parceiro,
        status: body.status,
        entregue: body.entregue,
        franqueado: body.franqueado,
        cnpj: body.cnpj,
        razao_social: body.razao_social,
        quantidade: body.quantidade,
        marca: body.marca,
        modelo: body.modelo,
        valor_unitario: body.valor_unitario,
        valor_total: body.valor_total,
        city_id,
      },
      include: { city: true },
    });

    return reply.status(201).send({
      success: true,
      data: {
        ...venda,
        valor_unitario: Number(venda.valor_unitario),
        valor_total: Number(venda.valor_total),
      },
    });
  });

  /**
   * PUT /api/vendas/:id
   * Atualizar venda
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar venda',
      tags: ['Vendas'],
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
          data_compra: { type: 'string' },
          parceiro: { type: 'string' },
          status: { type: 'string', enum: ['PAGO', 'PAGANDO', 'PENDENTE'] },
          entregue: { type: 'boolean' },
          franqueado: { type: 'string' },
          cnpj: { type: 'string' },
          razao_social: { type: 'string' },
          quantidade: { type: 'number' },
          marca: { type: 'string' },
          modelo: { type: 'string' },
          valor_unitario: { type: 'number' },
          valor_total: { type: 'number' },
          city_id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: vendaResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateVendaSchema.parse(request.body);

    // Verificar se a venda existe
    const existingVenda = await prisma.venda.findUnique({ where: { id } });
    if (!existingVenda) {
      throw new NotFoundError('Venda nao encontrada');
    }

    // Converter data_compra para formato ISO-8601 se presente
    const updateData = {
      ...body,
      ...(body.data_compra && { data_compra: new Date(body.data_compra).toISOString() }),
    };

    const venda = await prisma.venda.update({
      where: { id },
      data: updateData,
      include: { city: true },
    });

    return reply.send({
      success: true,
      data: {
        ...venda,
        valor_unitario: Number(venda.valor_unitario),
        valor_total: Number(venda.valor_total),
      },
    });
  });

  /**
   * DELETE /api/vendas/:id
   * Deletar venda
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar venda',
      tags: ['Vendas'],
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

    // Verificar se a venda existe
    const existingVenda = await prisma.venda.findUnique({ where: { id } });
    if (!existingVenda) {
      throw new NotFoundError('Venda nao encontrada');
    }

    await prisma.venda.delete({ where: { id } });

    return reply.send({ success: true, message: 'Venda excluida com sucesso' });
  });
};

export default vendasRoutes;
