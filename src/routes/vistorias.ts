import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';

// Swagger Schemas
const vistoriaResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    rental_id: { type: 'string', format: 'uuid', nullable: true },
    distrato_id: { type: 'string', format: 'uuid', nullable: true },
    motorcycle_id: { type: 'string', format: 'uuid' },
    city_id: { type: 'string', format: 'uuid', nullable: true },
    franchisee_id: { type: 'string', format: 'uuid', nullable: true },
    client_id: { type: 'string', format: 'uuid', nullable: true },
    inspection_date: { type: 'string', format: 'date' },
    inspection_type: { type: 'string', enum: ['entrada', 'saida', 'periodica'] },
    status: { type: 'string', enum: ['pendente', 'aprovada', 'reprovada'] },
    placa: { type: 'string', nullable: true },
    locadora: { type: 'string', nullable: true },
    locatario: { type: 'string', nullable: true },
    observations: { type: 'string', nullable: true },
    data_hora: { type: 'string', format: 'date-time', nullable: true },
    foto_1_path: { type: 'string', nullable: true },
    foto_2_path: { type: 'string', nullable: true },
    foto_3_path: { type: 'string', nullable: true },
    foto_4_path: { type: 'string', nullable: true },
    foto_5_path: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    motorcycle: {
      type: 'object',
      nullable: true,
      properties: {
        placa: { type: 'string' },
        marca: { type: 'string', nullable: true },
        modelo: { type: 'string' },
      },
    },
    franchisee: {
      type: 'object',
      nullable: true,
      properties: {
        fantasy_name: { type: 'string', nullable: true },
      },
    },
    client: {
      type: 'object',
      nullable: true,
      properties: {
        full_name: { type: 'string' },
        cpf: { type: 'string', nullable: true },
      },
    },
  },
};

const paginationSchema = {
  type: 'object',
  properties: {
    total: { type: 'number' },
    page: { type: 'number' },
    limit: { type: 'number' },
    totalPages: { type: 'number' },
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
const createVistoriaSchema = z.object({
  rental_id: z.string().uuid().optional().nullable(),
  distrato_id: z.string().uuid().optional().nullable(),
  motorcycle_id: z.string().uuid(),
  city_id: z.string().uuid().optional().nullable(),
  franchisee_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  inspection_type: z.enum(['entrada', 'saida', 'periodica']),
  placa: z.string().optional().nullable(),
  locadora: z.string().optional().nullable(),
  locatario: z.string().optional().nullable(),
  observations: z.string().optional().nullable(),
  data_hora: z.string().optional().nullable(),
});

const updateVistoriaSchema = z.object({
  observations: z.string().optional().nullable(),
  status: z.enum(['pendente', 'aprovada', 'reprovada']).optional(),
  foto_1_path: z.string().optional().nullable(),
  foto_2_path: z.string().optional().nullable(),
  foto_3_path: z.string().optional().nullable(),
  foto_4_path: z.string().optional().nullable(),
  foto_5_path: z.string().optional().nullable(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['pendente', 'aprovada', 'reprovada', 'all']).optional(),
  city_id: z.string().uuid().optional(),
  inspection_type: z.enum(['entrada', 'saida', 'periodica']).optional(),
  orderBy: z.enum(['inspection_date', 'created_at', 'status']).default('inspection_date'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
});

const vistoriasRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/vistorias
   * Listar vistorias com filtros e paginação
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar vistorias com filtros e paginação',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          search: { type: 'string', description: 'Busca por placa, locadora ou locatário' },
          status: { type: 'string', enum: ['pendente', 'aprovada', 'reprovada', 'all'] },
          city_id: { type: 'string', format: 'uuid' },
          inspection_type: { type: 'string', enum: ['entrada', 'saida', 'periodica'] },
          orderBy: { type: 'string', enum: ['inspection_date', 'created_at', 'status'], default: 'inspection_date' },
          orderDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: vistoriaResponseSchema },
            pagination: paginationSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      throw new BadRequestError(query.error.errors[0].message);
    }

    const { page, limit, search, status, city_id, inspection_type, orderBy, orderDir } = query.data;
    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    if (context.isRegional()) {
      where.city_id = context.cityId;
    } else if (context.isFranchisee()) {
      where.franchisee_id = context.franchiseeId;
    } else if (context.isMasterOrAdmin() && city_id) {
      where.city_id = city_id;
    }

    // Filtros adicionais
    if (search) {
      where.OR = [
        { placa: { contains: search, mode: 'insensitive' } },
        { locadora: { contains: search, mode: 'insensitive' } },
        { locatario: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status && status !== 'all') {
      where.status = status;
    }

    if (inspection_type) {
      where.inspection_type = inspection_type;
    }

    const [vistorias, total] = await Promise.all([
      prisma.vistoria.findMany({
        where,
        select: {
          id: true,
          rental_id: true,
          distrato_id: true,
          motorcycle_id: true,
          city_id: true,
          franchisee_id: true,
          client_id: true,
          inspection_date: true,
          inspection_type: true,
          status: true,
          placa: true,
          locadora: true,
          locatario: true,
          observations: true,
          data_hora: true,
          foto_1_path: true,
          foto_2_path: true,
          foto_3_path: true,
          foto_4_path: true,
          foto_5_path: true,
          created_by: true,
          created_at: true,
          updated_at: true,
          motorcycle: {
            select: { placa: true, marca: true, modelo: true },
          },
          franchisee: {
            select: { fantasy_name: true },
          },
          client: {
            select: { full_name: true, cpf: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderBy]: orderDir },
      }),
      prisma.vistoria.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      data: vistorias,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/vistorias/stats
   * Estatísticas de vistorias
   */
  app.get('/stats', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Estatísticas de vistorias',
      tags: ['Vistorias'],
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
            data: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                pendentes: { type: 'number' },
                aprovadas: { type: 'number' },
                reprovadas: { type: 'number' },
              },
            },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { city_id } = request.query as { city_id?: string };
    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    if (context.isRegional()) {
      where.city_id = context.cityId;
    } else if (context.isFranchisee()) {
      where.franchisee_id = context.franchiseeId;
    } else if (context.isMasterOrAdmin() && city_id) {
      where.city_id = city_id;
    }

    const [total, pendentes, aprovadas, reprovadas] = await Promise.all([
      prisma.vistoria.count({ where }),
      prisma.vistoria.count({ where: { ...where, status: 'pendente' } }),
      prisma.vistoria.count({ where: { ...where, status: 'aprovada' } }),
      prisma.vistoria.count({ where: { ...where, status: 'reprovada' } }),
    ]);

    return reply.status(200).send({
      success: true,
      data: { total, pendentes, aprovadas, reprovadas },
    });
  });

  /**
   * GET /api/vistorias/:id
   * Obter vistoria por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter vistoria por ID',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: vistoriaResponseSchema,
          },
        },
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = getContext(request);

    const vistoria = await prisma.vistoria.findUnique({
      where: { id },
      include: {
        motorcycle: {
          select: { placa: true, marca: true, modelo: true },
        },
        franchisee: {
          select: { fantasy_name: true, city_id: true },
        },
        client: {
          select: { full_name: true, cpf: true },
        },
        rental: {
          select: { id: true },
        },
      },
    });

    if (!vistoria) {
      throw new NotFoundError('Vistoria não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && vistoria.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para acessar esta vistoria');
      }
      if (context.isFranchisee() && vistoria.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para acessar esta vistoria');
      }
    }

    return reply.status(200).send({
      success: true,
      data: vistoria,
    });
  });

  /**
   * POST /api/vistorias
   * Criar vistoria
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar nova vistoria',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['motorcycle_id', 'inspection_type'],
        properties: {
          rental_id: { type: 'string', format: 'uuid' },
          distrato_id: { type: 'string', format: 'uuid' },
          motorcycle_id: { type: 'string', format: 'uuid' },
          city_id: { type: 'string', format: 'uuid' },
          franchisee_id: { type: 'string', format: 'uuid' },
          client_id: { type: 'string', format: 'uuid' },
          inspection_type: { type: 'string', enum: ['entrada', 'saida', 'periodica'] },
          placa: { type: 'string' },
          locadora: { type: 'string' },
          locatario: { type: 'string' },
          observations: { type: 'string' },
          data_hora: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: vistoriaResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createVistoriaSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;
    const context = getContext(request);

    // Se for franqueado, forçar franchisee_id e city_id
    if (context.isFranchisee()) {
      data.franchisee_id = context.franchiseeId;
      data.city_id = context.cityId;
    } else if (context.isRegional()) {
      data.city_id = context.cityId;
    }

    // Verificar se a moto existe
    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id: data.motorcycle_id },
    });

    if (!motorcycle) {
      throw new BadRequestError('Motocicleta não encontrada');
    }

    const vistoria = await prisma.vistoria.create({
      data: {
        ...data,
        inspection_date: new Date(),
        status: 'pendente',
        created_by: context.userId,
      },
      include: {
        motorcycle: {
          select: { placa: true, marca: true, modelo: true },
        },
        franchisee: {
          select: { fantasy_name: true },
        },
        client: {
          select: { full_name: true, cpf: true },
        },
      },
    });

    return reply.status(201).send({
      success: true,
      data: vistoria,
    });
  });

  /**
   * PUT /api/vistorias/:id
   * Atualizar vistoria
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar vistoria',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          observations: { type: 'string' },
          status: { type: 'string', enum: ['pendente', 'aprovada', 'reprovada'] },
          foto_1_path: { type: 'string' },
          foto_2_path: { type: 'string' },
          foto_3_path: { type: 'string' },
          foto_4_path: { type: 'string' },
          foto_5_path: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: vistoriaResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateVistoriaSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const context = getContext(request);

    const existingVistoria = await prisma.vistoria.findUnique({
      where: { id },
    });

    if (!existingVistoria) {
      throw new NotFoundError('Vistoria não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && existingVistoria.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para modificar esta vistoria');
      }
      if (context.isFranchisee() && existingVistoria.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar esta vistoria');
      }
    }

    const data = body.data;

    // Verificar se tem fotos e atualizar status automaticamente
    const hasPhotos = data.foto_1_path || data.foto_2_path || data.foto_3_path ||
                      data.foto_4_path || data.foto_5_path ||
                      existingVistoria.foto_1_path || existingVistoria.foto_2_path ||
                      existingVistoria.foto_3_path || existingVistoria.foto_4_path ||
                      existingVistoria.foto_5_path;

    // Se tem fotos e está pendente, mudar para aprovada (se não tiver status explícito)
    if (hasPhotos && existingVistoria.status === 'pendente' && !data.status) {
      data.status = 'aprovada';
    }

    const vistoria = await prisma.vistoria.update({
      where: { id },
      data,
      include: {
        motorcycle: {
          select: { placa: true, marca: true, modelo: true },
        },
        franchisee: {
          select: { fantasy_name: true },
        },
        client: {
          select: { full_name: true, cpf: true },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: vistoria,
    });
  });

  /**
   * PATCH /api/vistorias/:id/photo/:photoNumber
   * Atualizar foto específica da vistoria
   */
  app.patch('/:id/photo/:photoNumber', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar foto específica da vistoria',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'photoNumber'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          photoNumber: { type: 'number', minimum: 1, maximum: 5 },
        },
      },
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', description: 'URL da foto' },
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
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id, photoNumber } = request.params as { id: string; photoNumber: number };
    const { url } = request.body as { url: string };
    const context = getContext(request);

    const vistoria = await prisma.vistoria.findUnique({
      where: { id },
    });

    if (!vistoria) {
      throw new NotFoundError('Vistoria não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && vistoria.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para modificar esta vistoria');
      }
      if (context.isFranchisee() && vistoria.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar esta vistoria');
      }
    }

    const photoField = `foto_${photoNumber}_path`;
    const updateData: any = { [photoField]: url };

    // Se estava pendente e está adicionando foto, atualizar para aprovada
    if (vistoria.status === 'pendente') {
      updateData.status = 'aprovada';
    }

    await prisma.vistoria.update({
      where: { id },
      data: updateData,
    });

    return reply.status(200).send({
      success: true,
      message: `Foto ${photoNumber} atualizada com sucesso`,
    });
  });

  /**
   * DELETE /api/vistorias/:id/photo/:photoNumber
   * Remover foto específica da vistoria
   */
  app.delete('/:id/photo/:photoNumber', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Remover foto específica da vistoria',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id', 'photoNumber'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          photoNumber: { type: 'number', minimum: 1, maximum: 5 },
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
    const { id, photoNumber } = request.params as { id: string; photoNumber: number };
    const context = getContext(request);

    const vistoria = await prisma.vistoria.findUnique({
      where: { id },
    });

    if (!vistoria) {
      throw new NotFoundError('Vistoria não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && vistoria.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para modificar esta vistoria');
      }
      if (context.isFranchisee() && vistoria.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar esta vistoria');
      }
    }

    const photoField = `foto_${photoNumber}_path`;

    await prisma.vistoria.update({
      where: { id },
      data: { [photoField]: null },
    });

    return reply.status(200).send({
      success: true,
      message: `Foto ${photoNumber} removida com sucesso`,
    });
  });

  /**
   * GET /api/vistorias/by-rental/:rentalId
   * Listar vistorias de uma locação
   */
  app.get('/by-rental/:rentalId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar vistorias de uma locação específica',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: vistoriaResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };

    const vistorias = await prisma.vistoria.findMany({
      where: { rental_id: rentalId },
      include: {
        motorcycle: {
          select: { placa: true, marca: true, modelo: true },
        },
        franchisee: {
          select: { fantasy_name: true },
        },
        client: {
          select: { full_name: true, cpf: true },
        },
      },
      orderBy: { inspection_date: 'desc' },
    });

    return reply.status(200).send({
      success: true,
      data: vistorias,
    });
  });

  /**
   * GET /api/vistorias/by-motorcycle/:motorcycleId
   * Listar vistorias de uma motocicleta
   */
  app.get('/by-motorcycle/:motorcycleId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar vistorias de uma motocicleta específica',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['motorcycleId'],
        properties: {
          motorcycleId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: vistoriaResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { motorcycleId } = request.params as { motorcycleId: string };

    const vistorias = await prisma.vistoria.findMany({
      where: { motorcycle_id: motorcycleId },
      include: {
        motorcycle: {
          select: { placa: true, marca: true, modelo: true },
        },
        franchisee: {
          select: { fantasy_name: true },
        },
        client: {
          select: { full_name: true, cpf: true },
        },
      },
      orderBy: { inspection_date: 'desc' },
    });

    return reply.status(200).send({
      success: true,
      data: vistorias,
    });
  });

  /**
   * DELETE /api/vistorias/:id
   * Excluir vistoria
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br', 'regional'] })],
    schema: {
      description: 'Excluir uma vistoria',
      tags: ['Vistorias'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
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
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = getContext(request);

    const vistoria = await prisma.vistoria.findUnique({
      where: { id },
    });

    if (!vistoria) {
      throw new NotFoundError('Vistoria não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && vistoria.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para excluir esta vistoria');
      }
    }

    await prisma.vistoria.delete({
      where: { id },
    });

    return reply.status(200).send({
      success: true,
      message: 'Vistoria excluída com sucesso',
    });
  });
};

export default vistoriasRoutes;
