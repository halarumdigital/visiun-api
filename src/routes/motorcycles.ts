import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { auditService, AuditActions } from '../middleware/audit.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { realtimeService } from '../websocket/index.js';
import { getContext } from '../utils/context.js';

// Swagger Schemas
const motorcycleStatusEnum = ['active', 'alugada', 'relocada', 'manutencao', 'recolhida', 'indisponivel_rastreador', 'indisponivel_emplacamento', 'inadimplente', 'renegociado', 'furto_roubo'];

const motorcycleResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    placa: { type: 'string' },
    chassi: { type: 'string', nullable: true },
    renavam: { type: 'string', nullable: true },
    modelo: { type: 'string' },
    marca: { type: 'string', nullable: true },
    ano: { type: 'number', nullable: true },
    cor: { type: 'string', nullable: true },
    quilometragem: { type: 'number', nullable: true },
    codigo_cs: { type: 'string', nullable: true },
    tipo: { type: 'string', enum: ['Nova', 'Usada'], nullable: true },
    valor_semanal: { type: 'number', nullable: true },
    franqueado: { type: 'string', nullable: true },
    doc_moto: { type: 'string', format: 'uri', nullable: true },
    doc_taxa_intermediacao: { type: 'string', format: 'uri', nullable: true },
    observacoes: { type: 'string', nullable: true },
    status: { type: 'string', enum: motorcycleStatusEnum },
    city_id: { type: 'string', format: 'uuid', nullable: true },
    franchisee_id: { type: 'string', format: 'uuid', nullable: true },
    data_criacao: { type: 'string', format: 'date-time', nullable: true },
    data_ultima_mov: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    city: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
      },
      additionalProperties: true
    },
    franchisee: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string', format: 'uuid' },
        company_name: { type: 'string', nullable: true },
        fantasy_name: { type: 'string', nullable: true },
        cnpj: { type: 'string', nullable: true },
        email: { type: 'string', nullable: true },
        whatsapp_01: { type: 'string', nullable: true },
        city_id: { type: 'string', format: 'uuid', nullable: true },
      },
      additionalProperties: true
    },
  },
};

const movementResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    motorcycle_id: { type: 'string', format: 'uuid' },
    previous_status: { type: 'string' },
    new_status: { type: 'string' },
    reason: { type: 'string', nullable: true },
    created_by: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
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
const createMotorcycleSchema = z.object({
  placa: z.string().min(7, 'Placa inválida').max(8),
  chassi: z.string().optional().nullable(),
  renavam: z.string().optional().nullable(),
  modelo: z.string().min(1, 'Modelo é obrigatório'),
  marca: z.string().optional().nullable(),
  ano: z.number().int().min(1900).max(2100).optional().nullable(),
  cor: z.string().optional().nullable(),
  quilometragem: z.number().int().min(0).optional().nullable(),
  codigo_cs: z.string().optional().nullable(),
  tipo: z.enum(['Nova', 'Usada']).optional().nullable(),
  valor_semanal: z.number().min(0).optional().nullable(),
  city_id: z.string().uuid().optional().nullable(),
  franchisee_id: z.string().uuid().optional().nullable(),
  franqueado: z.string().optional().nullable(),
  doc_moto: z.string().url().optional().nullable(),
  doc_taxa_intermediacao: z.string().url().optional().nullable(),
  observacoes: z.string().optional().nullable(),
  data_ultima_mov: z.string().optional().nullable(),
  status: z.enum([
    'active', 'alugada', 'relocada', 'manutencao', 'recolhida',
    'indisponivel_rastreador', 'indisponivel_emplacamento',
    'inadimplente', 'renegociado', 'furto_roubo'
  ]).optional(),
});

const updateMotorcycleSchema = createMotorcycleSchema.partial().extend({
  status: z.enum([
    'active', 'alugada', 'relocada', 'manutencao', 'recolhida',
    'indisponivel_rastreador', 'indisponivel_emplacamento',
    'inadimplente', 'renegociado', 'furto_roubo'
  ]).optional(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum([
    'active', 'alugada', 'relocada', 'manutencao', 'recolhida',
    'indisponivel_rastreador', 'indisponivel_emplacamento',
    'inadimplente', 'renegociado', 'furto_roubo'
  ]).optional(),
  franchisee_id: z.string().uuid().optional(),
  city_id: z.string().uuid().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  orderBy: z.enum(['placa', 'modelo', 'created_at', 'data_ultima_mov', 'status']).default('created_at'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
});

const motorcyclesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/motorcycles/models
   * Listar modelos distintos de motocicletas
   */
  app.get('/models', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar modelos distintos de motocicletas',
      tags: ['Motocicletas'],
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
    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    const models = await prisma.motorcycle.findMany({
      where,
      select: { modelo: true },
      distinct: ['modelo'],
      orderBy: { modelo: 'asc' },
    });

    const modelList = models.map(m => m.modelo).filter(Boolean);

    return reply.status(200).send({
      success: true,
      data: modelList,
    });
  });

  /**
   * GET /api/motorcycles
   * Listar motocicletas
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar motocicletas com filtros e paginação',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1, description: 'Página atual' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Itens por página' },
          search: { type: 'string', description: 'Busca por placa, modelo ou chassi' },
          status: { type: 'string', enum: motorcycleStatusEnum, description: 'Status da motocicleta' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade' },
          marca: { type: 'string', description: 'Filtro por marca' },
          modelo: { type: 'string', description: 'Filtro por modelo' },
          orderBy: { type: 'string', enum: ['placa', 'modelo', 'created_at', 'data_ultima_mov', 'status'], default: 'created_at' },
          orderDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: motorcycleResponseSchema },
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

    const {
      page, limit, search, status, franchisee_id,
      city_id, marca, modelo, orderBy, orderDir
    } = query.data;

    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    // Filtros adicionais
    if (search) {
      where.OR = [
        { placa: { contains: search, mode: 'insensitive' } },
        { modelo: { contains: search, mode: 'insensitive' } },
        { chassi: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (franchisee_id) where.franchisee_id = franchisee_id;
    if (city_id) where.city_id = city_id;
    if (marca) where.marca = { contains: marca, mode: 'insensitive' };
    if (modelo) where.modelo = { contains: modelo, mode: 'insensitive' };

    const [motorcycles, total] = await Promise.all([
      prisma.motorcycle.findMany({
        where,
        include: {
          city: true,
          franchisee: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderBy]: orderDir },
      }),
      prisma.motorcycle.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      data: motorcycles,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/motorcycles/:id
   * Obter motocicleta por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter motocicleta por ID',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleResponseSchema,
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

    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id },
      include: {
        city: true,
        franchisee: true,
        rentals: {
          where: { status: 'active' },
          include: { driver: true },
        },
        movements: {
          orderBy: { created_at: 'desc' },
          take: 10,
        },
      },
    });

    if (!motorcycle) {
      throw new NotFoundError('Motocicleta não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && motorcycle.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para acessar esta motocicleta');
      }
      if (context.isFranchisee() && motorcycle.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para acessar esta motocicleta');
      }
    }

    return reply.status(200).send({
      success: true,
      data: motorcycle,
    });
  });

  /**
   * POST /api/motorcycles
   * Criar motocicleta
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar nova motocicleta',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['placa', 'modelo'],
        properties: {
          placa: { type: 'string', minLength: 7, maxLength: 8, description: 'Placa da motocicleta' },
          chassi: { type: 'string', description: 'Número do chassi' },
          renavam: { type: 'string', description: 'Número do RENAVAM' },
          modelo: { type: 'string', minLength: 1, description: 'Modelo da motocicleta' },
          marca: { type: 'string', description: 'Marca da motocicleta' },
          ano: { type: 'number', minimum: 1900, maximum: 2100, description: 'Ano de fabricação' },
          cor: { type: 'string', description: 'Cor' },
          quilometragem: { type: 'number', minimum: 0, description: 'Quilometragem atual' },
          codigo_cs: { type: 'string', description: 'Código CS' },
          tipo: { type: 'string', enum: ['Nova', 'Usada'], description: 'Tipo da motocicleta' },
          valor_semanal: { type: 'number', minimum: 0, description: 'Valor semanal' },
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          franqueado: { type: 'string', description: 'Nome do franqueado' },
          doc_moto: { type: 'string', format: 'uri', description: 'URL do documento da moto' },
          doc_taxa_intermediacao: { type: 'string', format: 'uri', description: 'URL do documento de taxa de intermediação' },
          observacoes: { type: 'string', description: 'Observações' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createMotorcycleSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;
    const context = getContext(request);

    // Se for franqueado, forçar franchisee_id
    if (context.isFranchisee()) {
      data.franchisee_id = context.franchiseeId;
      data.city_id = context.cityId;
    }

    let motorcycle;
    try {
      // Criar novo registro (permite placas duplicadas)
      motorcycle = await prisma.motorcycle.create({
        data: {
          placa: data.placa.toUpperCase(),
          chassi: data.chassi,
          renavam: data.renavam,
          modelo: data.modelo,
          marca: data.marca,
          ano: data.ano,
          cor: data.cor,
          quilometragem: data.quilometragem,
          codigo_cs: data.codigo_cs,
          tipo: data.tipo,
          valor_semanal: data.valor_semanal,
          franqueado: data.franqueado,
          doc_moto: data.doc_moto,
          doc_taxa_intermediacao: data.doc_taxa_intermediacao,
          observacoes: data.observacoes,
          city_id: data.city_id,
          franchisee_id: data.franchisee_id,
          status: data.status || 'active',
          data_criacao: new Date(),
          data_ultima_mov: data.data_ultima_mov ? new Date(data.data_ultima_mov) : null,
        } as any,
        include: {
          city: true,
          franchisee: true,
        },
      });
    } catch (prismaError: any) {
      console.error('[POST /motorcycles] Erro Prisma:', prismaError);
      // Erros comuns do Prisma
      if (prismaError.code === 'P2003') {
        throw new BadRequestError(`Erro de referência: ${prismaError.meta?.field_name || 'cidade ou franqueado não existe'}`);
      }
      throw new BadRequestError(`Erro ao criar moto: ${prismaError.message}`);
    }

    await auditService.logFromRequest(
      request,
      AuditActions.MOTORCYCLE_CREATE,
      'motorcycle',
      motorcycle.id,
      undefined,
      { placa: motorcycle.placa, modelo: motorcycle.modelo }
    );

    return reply.status(201).send({
      success: true,
      data: motorcycle,
    });
  });

  /**
   * PUT /api/motorcycles/:id
   * Atualizar motocicleta
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar motocicleta',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
        },
      },
      body: {
        type: 'object',
        properties: {
          placa: { type: 'string', minLength: 7, maxLength: 8 },
          chassi: { type: 'string' },
          renavam: { type: 'string' },
          modelo: { type: 'string', minLength: 1 },
          marca: { type: 'string' },
          ano: { type: 'number', minimum: 1900, maximum: 2100 },
          cor: { type: 'string' },
          quilometragem: { type: 'number', minimum: 0 },
          codigo_cs: { type: 'string' },
          tipo: { type: 'string', enum: ['Nova', 'Usada'] },
          valor_semanal: { type: 'number', minimum: 0 },
          city_id: { type: 'string', format: 'uuid' },
          franchisee_id: { type: 'string', format: 'uuid' },
          franqueado: { type: 'string' },
          doc_moto: { type: 'string', format: 'uri' },
          doc_taxa_intermediacao: { type: 'string', format: 'uri' },
          observacoes: { type: 'string' },
          status: { type: 'string', enum: motorcycleStatusEnum },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleResponseSchema,
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
    const body = updateMotorcycleSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const context = getContext(request);

    const existingMoto = await prisma.motorcycle.findUnique({
      where: { id },
    });

    if (!existingMoto) {
      throw new NotFoundError('Motocicleta não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && existingMoto.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar esta motocicleta');
      }
    }

    const data = body.data;

    // Se estiver alterando placa, verificar unicidade
    if (data.placa && data.placa.toUpperCase() !== existingMoto.placa) {
      const placaExists = await prisma.motorcycle.findUnique({
        where: { placa: data.placa.toUpperCase() },
      });
      if (placaExists) {
        throw new BadRequestError('Placa já cadastrada');
      }
    }

    // Se estiver alterando status, registrar movimento
    if (data.status && data.status !== existingMoto.status) {
      await prisma.motorcycleMovement.create({
        data: {
          motorcycle_id: id,
          previous_status: existingMoto.status,
          new_status: data.status,
          reason: 'Status alterado manualmente',
          created_by: context.userId,
        },
      });
    }

    const motorcycle = await prisma.motorcycle.update({
      where: { id },
      data: {
        ...data,
        placa: data.placa?.toUpperCase(),
        data_ultima_mov: data.status !== existingMoto.status ? new Date() : undefined,
      },
      include: {
        city: true,
        franchisee: true,
      },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.MOTORCYCLE_UPDATE,
      'motorcycle',
      id,
      existingMoto,
      data
    );

    return reply.status(200).send({
      success: true,
      data: motorcycle,
    });
  });

  /**
   * PATCH /api/motorcycles/:id/status
   * Alterar status da motocicleta
   */
  app.patch('/:id/status', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Alterar status da motocicleta',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
        },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: motorcycleStatusEnum, description: 'Novo status da motocicleta' },
          reason: { type: 'string', description: 'Motivo da alteração de status' },
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
                id: { type: 'string', format: 'uuid' },
                status: { type: 'string' },
              },
            },
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
    const { status, reason } = request.body as { status: string; reason?: string };
    const context = getContext(request);

    const validStatuses = [
      'active', 'alugada', 'relocada', 'manutencao', 'recolhida',
      'indisponivel_rastreador', 'indisponivel_emplacamento',
      'inadimplente', 'renegociado', 'furto_roubo'
    ];

    if (!validStatuses.includes(status)) {
      throw new BadRequestError('Status inválido');
    }

    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id },
    });

    if (!motorcycle) {
      throw new NotFoundError('Motocicleta não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && motorcycle.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar esta motocicleta');
      }
    }

    // Não permitir mudar para 'alugada' diretamente (deve ser via locação)
    if (status === 'alugada' && motorcycle.status !== 'alugada') {
      throw new BadRequestError('Status "alugada" só pode ser definido via criação de locação');
    }

    await prisma.$transaction([
      prisma.motorcycle.update({
        where: { id },
        data: {
          status: status as any,
          data_ultima_mov: new Date(),
        },
      }),
      prisma.motorcycleMovement.create({
        data: {
          motorcycle_id: id,
          previous_status: motorcycle.status,
          new_status: status,
          reason: reason || 'Status alterado manualmente',
          created_by: context.userId,
        },
      }),
    ]);

    await auditService.logFromRequest(
      request,
      AuditActions.MOTORCYCLE_STATUS_CHANGE,
      'motorcycle',
      id,
      { status: motorcycle.status },
      { status, reason }
    );

    return reply.status(200).send({
      success: true,
      data: { id, status },
    });
  });

  /**
   * GET /api/motorcycles/:id/movements
   * Histórico de movimentações da motocicleta
   */
  app.get('/:id/movements', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Histórico de movimentações da motocicleta',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1, description: 'Página atual' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Itens por página' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: movementResponseSchema },
            pagination: paginationSchema,
          },
        },
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = 1, limit = 20 } = request.query as { page?: number; limit?: number };

    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id },
    });

    if (!motorcycle) {
      throw new NotFoundError('Motocicleta não encontrada');
    }

    const [movements, total] = await Promise.all([
      prisma.motorcycleMovement.findMany({
        where: { motorcycle_id: id },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.motorcycleMovement.count({ where: { motorcycle_id: id } }),
    ]);

    return reply.status(200).send({
      success: true,
      data: movements,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/motorcycles/all
   * Listar todas as motocicletas sem paginação (para Dashboard e Exportação)
   */
  app.get('/all', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todas as motocicletas sem paginação (para Dashboard e Exportação)',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade para filtrar' },
          search: { type: 'string', description: 'Busca por placa, modelo ou chassi' },
          status: { type: 'string', enum: motorcycleStatusEnum, description: 'Status da motocicleta' },
          modelo: { type: 'string', description: 'Filtro por modelo' },
          onlyCadastro: { type: 'string', enum: ['true', 'false'], description: 'Se true, retorna apenas registros com data_criacao (cadastro original, não movimento)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: motorcycleResponseSchema },
            total: { type: 'number' },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const { city_id, search, status, modelo, onlyCadastro } = request.query as {
        city_id?: string;
        search?: string;
        status?: string;
        modelo?: string;
        onlyCadastro?: string;
      };
      const context = getContext(request);
      const where: any = {};

      // Aplicar filtro baseado no role
      const roleFilter = context.getFranchiseeFilter();
      Object.assign(where, roleFilter);

      // Aplicar filtro de cidade se fornecido
      if (city_id) {
        where.city_id = city_id;
      }

      // Filtrar apenas registros de cadastro (com data_criacao) - exclui registros de movimento
      if (onlyCadastro === 'true') {
        where.data_criacao = { not: null };
      }

      // Filtros adicionais para exportação
      if (search) {
        where.OR = [
          { placa: { contains: search, mode: 'insensitive' } },
          { modelo: { contains: search, mode: 'insensitive' } },
          { chassi: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (status) where.status = status;
      if (modelo) where.modelo = { contains: modelo, mode: 'insensitive' };

      const motorcycles = await prisma.motorcycle.findMany({
        where,
        select: {
          id: true,
          placa: true,
          chassi: true,
          renavam: true,
          modelo: true,
          marca: true,
          ano: true,
          cor: true,
          quilometragem: true,
          status: true,
          codigo_cs: true,
          tipo: true,
          valor_semanal: true,
          data_ultima_mov: true,
          data_criacao: true,
          city_id: true,
          franchisee_id: true,
          doc_moto: true,
          doc_taxa_intermediacao: true,
          observacoes: true,
          created_at: true,
          updated_at: true,
          city: {
            select: { id: true, name: true, slug: true },
          },
          franchisee: {
            select: { id: true, fantasy_name: true, company_name: true, cnpj: true, city_id: true },
          },
        },
        orderBy: [
          { created_at: 'desc' },
        ],
      });

      // Sanitizar datas inválidas para evitar erro de serialização
      const dateFields = ['data_ultima_mov', 'data_criacao', 'created_at', 'updated_at'];
      const sanitizedMotorcycles = motorcycles.map(moto => {
        const sanitized = { ...moto } as any;
        for (const field of dateFields) {
          if (sanitized[field]) {
            try {
              const date = new Date(sanitized[field]);
              if (isNaN(date.getTime())) sanitized[field] = null;
            } catch {
              sanitized[field] = null;
            }
          }
        }
        return sanitized;
      });

      return reply.status(200).send({
        success: true,
        data: sanitizedMotorcycles,
        total: sanitizedMotorcycles.length,
      });
    } catch (error) {
      console.error('[motorcycles/all] Error:', error);
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Erro interno ao buscar motocicletas',
      });
    }
  });

  /**
   * GET /api/motorcycles/stats
   * Estatísticas da frota
   */
  app.get('/stats', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Estatísticas da frota de motocicletas',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'number', description: 'Total de motocicletas' },
                active: { type: 'number', description: 'Disponíveis' },
                alugada: { type: 'number', description: 'Alugadas' },
                relocada: { type: 'number', description: 'Relocadas' },
                manutencao: { type: 'number', description: 'Em manutenção' },
                recolhida: { type: 'number', description: 'Recolhidas' },
                indisponivel_rastreador: { type: 'number', description: 'Indisponível (rastreador)' },
                indisponivel_emplacamento: { type: 'number', description: 'Indisponível (emplacamento)' },
                inadimplente: { type: 'number', description: 'Inadimplentes' },
                renegociado: { type: 'number', description: 'Renegociadas' },
                furto_roubo: { type: 'number', description: 'Furto/Roubo' },
              },
            },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const filter = context.getFranchiseeFilter();

    const statusCounts = await prisma.motorcycle.groupBy({
      by: ['status'],
      where: filter,
      _count: { status: true },
    });

    const total = statusCounts.reduce((acc, item) => acc + item._count.status, 0);

    const stats: Record<string, number> = { total };
    statusCounts.forEach(item => {
      stats[item.status] = item._count.status;
    });

    return reply.status(200).send({
      success: true,
      data: stats,
    });
  });

  /**
   * GET /api/motorcycles/available
   * Listar motos disponíveis para locação
   */
  app.get('/available', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar motocicletas disponíveis para locação',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: motorcycleResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const filter = context.getFranchiseeFilter();

    const motorcycles = await prisma.motorcycle.findMany({
      where: {
        ...filter,
        status: 'active',
      },
      include: {
        city: true,
        franchisee: true,
      },
      orderBy: { modelo: 'asc' },
    });

    return reply.status(200).send({
      success: true,
      data: motorcycles,
    });
  });

  /**
   * GET /api/motorcycles/by-plate/:placa
   * Buscar motocicleta por placa
   */
  app.get('/by-plate/:placa', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar motocicleta por placa',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['placa'],
        properties: {
          placa: { type: 'string', description: 'Placa da motocicleta' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade para filtrar' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: motorcycleResponseSchema,
          },
        },
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { placa } = request.params as { placa: string };
    const { city_id } = request.query as { city_id?: string };
    const context = getContext(request);

    const where: any = {
      placa: placa.toUpperCase(),
    };

    // Aplicar filtro baseado no role
    if (context.isFranchisee()) {
      where.franchisee_id = context.franchiseeId;
    } else if (context.isRegional()) {
      where.city_id = context.cityId;
    } else if (city_id && context.isMasterOrAdmin()) {
      where.city_id = city_id;
    }

    const motorcycle = await prisma.motorcycle.findFirst({
      where,
      orderBy: { created_at: 'desc' },
    });

    if (!motorcycle) {
      return reply.status(404).send({
        success: false,
        error: 'Motocicleta não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: motorcycle,
    });
  });

  /**
   * DELETE /api/motorcycles/by-period
   * Excluir motocicletas por período de criação
   */
  app.delete('/by-period', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Excluir motocicletas por período de criação',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['startDate', 'endDate'],
        properties: {
          startDate: { type: 'string', format: 'date-time', description: 'Data inicial' },
          endDate: { type: 'string', format: 'date-time', description: 'Data final' },
          city_id: { type: 'string', format: 'uuid', description: 'Filtrar por cidade' },
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
                deleted: { type: 'number' },
              },
            },
          },
        },
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { startDate, endDate, city_id } = request.body as {
      startDate: string;
      endDate: string;
      city_id?: string;
    };

    const where: any = {
      created_at: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    if (city_id) {
      where.city_id = city_id;
    }

    const result = await prisma.motorcycle.deleteMany({ where });

    return reply.status(200).send({
      success: true,
      data: {
        deleted: result.count,
      },
    });
  });

  /**
   * DELETE /api/motorcycles/batch
   * Excluir motocicletas em lote por IDs
   */
  app.delete('/batch', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Excluir motocicletas em lote por IDs',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Lista de IDs para excluir',
          },
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
                deleted: { type: 'number' },
              },
            },
          },
        },
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };

    if (!ids || ids.length === 0) {
      throw new BadRequestError('Lista de IDs vazia');
    }

    const result = await prisma.motorcycle.deleteMany({
      where: {
        id: { in: ids },
      },
    });

    return reply.status(200).send({
      success: true,
      data: {
        deleted: result.count,
      },
    });
  });

  /**
   * DELETE /api/motorcycles/:id
   * Excluir uma motocicleta específica pelo ID
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br', 'regional'] })],
    schema: {
      description: 'Excluir uma motocicleta específica pelo ID',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
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

    // Verificar se a moto existe
    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id },
    });

    if (!motorcycle) {
      throw new NotFoundError('Motocicleta não encontrada');
    }

    // Excluir a moto
    await prisma.motorcycle.delete({
      where: { id },
    });

    return reply.status(200).send({
      success: true,
      message: 'Motocicleta excluída com sucesso',
    });
  });

  /**
   * POST /api/motorcycles/batch
   * Criar motocicletas em lote (importação CSV)
   */
  app.post('/batch', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Criar motocicletas em lote (importação CSV)',
      tags: ['Motocicletas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['motorcycles'],
        properties: {
          motorcycles: {
            type: 'array',
            items: {
              type: 'object',
              required: ['placa', 'modelo'],
              properties: {
                placa: { type: 'string' },
                modelo: { type: 'string' },
                chassi: { type: 'string', nullable: true },
                renavam: { type: 'string', nullable: true },
                marca: { type: 'string', nullable: true },
                ano: { type: 'number', nullable: true },
                cor: { type: 'string', nullable: true },
                quilometragem: { type: 'number', nullable: true },
                tipo: { type: 'string', enum: ['Nova', 'Usada'], nullable: true },
                valor_semanal: { type: 'number', nullable: true },
                status: { type: 'string' },
                city_id: { type: 'string', format: 'uuid' },
                franchisee_id: { type: 'string', format: 'uuid', nullable: true },
                codigo_cs: { type: 'string', nullable: true },
                data_ultima_mov: { type: 'string', format: 'date-time', nullable: true },
                data_criacao: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
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
                created: { type: 'number' },
                ids: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { motorcycles } = request.body as { motorcycles: any[] };

    if (!motorcycles || motorcycles.length === 0) {
      throw new BadRequestError('Lista de motocicletas vazia');
    }

    // Criar em lotes para evitar timeout
    const batchSize = 500;
    const createdIds: string[] = [];
    let totalCreated = 0;

    for (let i = 0; i < motorcycles.length; i += batchSize) {
      const batch = motorcycles.slice(i, i + batchSize);

      // Inserir batch
      const result = await prisma.motorcycle.createMany({
        data: batch.map(m => ({
          ...m,
          placa: m.placa?.toUpperCase(),
          created_at: new Date(),
          updated_at: new Date(),
        })),
        skipDuplicates: true,
      });

      totalCreated += result.count;
    }

    return reply.status(200).send({
      success: true,
      data: {
        created: totalCreated,
        ids: createdIds,
      },
    });
  });
};

export default motorcyclesRoutes;
