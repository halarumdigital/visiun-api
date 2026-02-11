import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { auditService, AuditActions } from '../middleware/audit.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { realtimeService } from '../websocket/index.js';
import { getContext, getUser } from '../utils/context.js';

// Helper para validar datas
function isValidDate(date: Date | null | undefined): boolean {
  if (!date) return false;
  const d = new Date(date);
  return !isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 3000;
}

// Swagger Schemas
const rentalResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    client_name: { type: 'string' },
    client_cpf: { type: 'string' },
    client_email: { type: 'string', format: 'email', nullable: true },
    client_phone: { type: 'string' },
    client_address: { type: 'string', nullable: true },
    client_address_street: { type: 'string', nullable: true },
    client_address_number: { type: 'string', nullable: true },
    client_address_city: { type: 'string', nullable: true },
    client_address_state: { type: 'string', nullable: true },
    client_address_zip_code: { type: 'string', nullable: true },
    driver_id: { type: 'string', format: 'uuid', nullable: true },
    driver_name: { type: 'string', nullable: true },
    driver_cpf: { type: 'string', nullable: true },
    driver_phone: { type: 'string', nullable: true },
    driver_cnh: { type: 'string', nullable: true },
    motorcycle_id: { type: 'string', format: 'uuid' },
    motorcycle_plate: { type: 'string', nullable: true },
    franchisee_id: { type: 'string', format: 'uuid' },
    city_id: { type: 'string', format: 'uuid', nullable: true },
    plan_id: { type: 'string', format: 'uuid', nullable: true },
    attendant_id: { type: 'string', format: 'uuid', nullable: true },
    start_date: { type: ['string', 'null'], format: 'date-time', nullable: true },
    end_date: { type: ['string', 'null'], format: 'date-time', nullable: true },
    actual_return_date: { type: ['string', 'null'], format: 'date-time', nullable: true },
    km_inicial: { type: 'number', nullable: true },
    km_final: { type: 'number', nullable: true },
    daily_rate: { type: 'number' },
    deposit_amount: { type: 'number', nullable: true },
    total_days: { type: 'number', nullable: true },
    total_amount: { type: 'number', nullable: true },
    lead_source: { type: 'string', enum: ['instagram_proprio', 'indicacao', 'espontaneo', 'google'], nullable: true },
    payment_status: { type: 'string', nullable: true },
    notes: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'completed', 'cancelled', 'paused'] },
    created_by: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: ['string', 'null'], format: 'date-time', nullable: true },
    updated_at: { type: ['string', 'null'], format: 'date-time', nullable: true },
    motorcycle: { type: 'object', nullable: true, additionalProperties: true },
    franchisee: { type: 'object', nullable: true, additionalProperties: true },
    city: { type: 'object', nullable: true, additionalProperties: true },
    attendant: { type: 'object', nullable: true, additionalProperties: true },
    creator: { type: 'object', nullable: true, additionalProperties: true },
    plan: { type: 'object', nullable: true, additionalProperties: true },
    driver: { type: 'object', nullable: true, additionalProperties: true },
    secondaryVehicles: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        additionalProperties: true
      }
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
const createRentalSchema = z.object({
  client_name: z.string().min(2, 'Nome do cliente é obrigatório'),
  client_cpf: z.string().min(11, 'CPF é obrigatório'),
  client_email: z.string().email().optional().nullable(),
  client_phone: z.string().min(8, 'Telefone é obrigatório'),
  client_address: z.string().optional().nullable(),
  client_address_street: z.string().optional().nullable(),
  client_address_number: z.string().optional().nullable(),
  client_address_city: z.string().optional().nullable(),
  client_address_state: z.string().optional().nullable(),
  client_address_zip_code: z.string().optional().nullable(),
  driver_id: z.string().uuid().optional().nullable(),
  driver_name: z.string().optional().nullable(),
  driver_cpf: z.string().optional().nullable(),
  driver_phone: z.string().optional().nullable(),
  driver_cnh: z.string().optional().nullable(),
  driver_address_street: z.string().optional().nullable(),
  driver_address_number: z.string().optional().nullable(),
  driver_address_city: z.string().optional().nullable(),
  driver_address_state: z.string().optional().nullable(),
  driver_address_zip_code: z.string().optional().nullable(),
  motorcycle_id: z.string().uuid('ID da moto inválido'),
  franchisee_id: z.string().uuid('ID do franqueado inválido'),
  city_id: z.string().uuid().optional().nullable(),
  plan_id: z.string().uuid().optional().nullable(),
  start_date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  end_date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().nullable(),
  km_inicial: z.number().int().min(0).optional().nullable(),
  daily_rate: z.number().positive('Valor da diária deve ser positivo'),
  deposit_amount: z.number().min(0).optional().nullable(),
  total_days: z.number().int().min(0).optional().nullable(),
  total_amount: z.number().min(0).optional().nullable(),
  lead_source: z.enum(['instagram_proprio', 'indicacao', 'espontaneo', 'google']).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateRentalSchema = createRentalSchema.partial().extend({
  status: z.enum(['active', 'completed', 'cancelled', 'paused']).optional(),
  km_final: z.number().int().min(0).optional().nullable(),
  total_days: z.number().int().min(0).optional().nullable(),
  total_amount: z.number().min(0).optional().nullable(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['active', 'completed', 'cancelled', 'paused']).optional(),
  franchisee_id: z.string().uuid().optional(),
  city_id: z.string().uuid().optional(),
  motorcycle_id: z.string().uuid().optional(),
  motorcycle_plate: z.string().optional(),
  client_cpf: z.string().optional(),
  start_date_from: z.string().optional(),
  start_date_to: z.string().optional(),
  orderBy: z.enum(['start_date', 'created_at', 'client_name', 'daily_rate']).default('created_at'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
});

const rentalsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/rentals
   * Listar locações com filtros e paginação
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar locações com filtros e paginação',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1, description: 'Página atual' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Itens por página' },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled', 'paused'], description: 'Status da locação' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade' },
          motorcycle_id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
          motorcycle_plate: { type: 'string', description: 'Placa da motocicleta' },
          client_cpf: { type: 'string', description: 'CPF do cliente' },
          start_date_from: { type: 'string', format: 'date', description: 'Data início (de)' },
          start_date_to: { type: 'string', format: 'date', description: 'Data início (até)' },
          orderBy: { type: 'string', enum: ['start_date', 'created_at', 'client_name', 'daily_rate'], default: 'created_at' },
          orderDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: rentalResponseSchema },
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
      page, limit, status, franchisee_id, city_id,
      motorcycle_id, motorcycle_plate, client_cpf, start_date_from, start_date_to,
      orderBy, orderDir
    } = query.data;

    const context = getContext(request);

    // Construir filtros
    const where: any = {};

    // Aplicar filtro baseado no role do usuário
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    // Filtros adicionais
    if (status) where.status = status;
    if (franchisee_id) where.franchisee_id = franchisee_id;
    if (city_id) where.city_id = city_id;
    if (motorcycle_id) where.motorcycle_id = motorcycle_id;
    if (motorcycle_plate) where.motorcycle_plate = motorcycle_plate;
    if (client_cpf) where.client_cpf = { contains: client_cpf };

    if (start_date_from || start_date_to) {
      where.start_date = {};
      if (start_date_from) where.start_date.gte = new Date(start_date_from);
      if (start_date_to) where.start_date.lte = new Date(start_date_to);
    }

    const [rentals, total] = await Promise.all([
      prisma.rental.findMany({
        where,
        include: {
          motorcycle: true,
          franchisee: true,
          city: true,
          attendant: {
            select: { id: true, name: true, email: true },
          },
          plan: true,
          driver: true,
          secondaryVehicles: {
            include: {
              motorcycle: {
                select: { id: true, placa: true, modelo: true, marca: true },
              },
            },
            orderBy: { created_at: 'desc' },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderBy]: orderDir },
      }),
      prisma.rental.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      data: rentals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/rentals/:id
   * Obter locação por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter locação por ID',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da locação' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rentalResponseSchema,
          },
        },
        404: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = getContext(request);

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: {
        motorcycle: true,
        franchisee: true,
        city: true,
        attendant: {
          select: { id: true, name: true, email: true },
        },
        plan: true,
        driver: true,
        vistorias: true,
        contracts: true,
        secondaryVehicles: {
          include: {
            motorcycle: {
              select: { id: true, placa: true, modelo: true, marca: true },
            },
          },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!rental) {
      throw new NotFoundError('Locação não encontrada');
    }

    // Verificar permissão de acesso
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && rental.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para acessar esta locação');
      }
      if (context.isFranchisee() && rental.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para acessar esta locação');
      }
    }

    return reply.status(200).send({
      success: true,
      data: rental,
    });
  });

  /**
   * POST /api/rentals
   * Criar nova locação
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar nova locação',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['client_name', 'client_phone', 'client_cpf', 'motorcycle_id', 'franchisee_id', 'start_date', 'daily_rate'],
        properties: {
          client_name: { type: 'string', minLength: 2, description: 'Nome do cliente' },
          client_cpf: { type: 'string', minLength: 11, description: 'CPF do cliente' },
          client_email: { type: ['string', 'null'], format: 'email', description: 'Email do cliente' },
          client_phone: { type: 'string', minLength: 8, description: 'Telefone do cliente' },
          client_address: { type: ['string', 'null'], description: 'Endereço completo' },
          client_address_street: { type: ['string', 'null'], description: 'Rua' },
          client_address_number: { type: ['string', 'null'], description: 'Número' },
          client_address_city: { type: ['string', 'null'], description: 'Cidade' },
          client_address_state: { type: ['string', 'null'], description: 'Estado' },
          client_address_zip_code: { type: ['string', 'null'], description: 'CEP' },
          driver_id: { type: ['string', 'null'], format: 'uuid', description: 'ID do motorista' },
          driver_name: { type: ['string', 'null'], description: 'Nome do motorista (se diferente)' },
          driver_cpf: { type: ['string', 'null'], description: 'CPF do motorista' },
          driver_phone: { type: ['string', 'null'], description: 'Telefone do motorista' },
          driver_cnh: { type: ['string', 'null'], description: 'CNH do motorista' },
          driver_address_street: { type: ['string', 'null'], description: 'Rua do motorista' },
          driver_address_number: { type: ['string', 'null'], description: 'Número do motorista' },
          driver_address_city: { type: ['string', 'null'], description: 'Cidade do motorista' },
          driver_address_state: { type: ['string', 'null'], description: 'Estado do motorista' },
          driver_address_zip_code: { type: ['string', 'null'], description: 'CEP do motorista' },
          motorcycle_id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          city_id: { type: ['string', 'null'], format: 'uuid', description: 'ID da cidade' },
          plan_id: { type: ['string', 'null'], format: 'uuid', description: 'ID do plano' },
          start_date: { type: 'string', description: 'Data de início' },
          end_date: { type: ['string', 'null'], description: 'Data de término prevista' },
          km_inicial: { type: ['number', 'null'], minimum: 0, description: 'Quilometragem inicial' },
          daily_rate: { type: 'number', minimum: 0, description: 'Valor da diária' },
          deposit_amount: { type: ['number', 'null'], minimum: 0, description: 'Valor do depósito' },
          total_days: { type: ['number', 'null'], minimum: 0, description: 'Total de dias' },
          total_amount: { type: ['number', 'null'], minimum: 0, description: 'Valor total' },
          lead_source: { type: ['string', 'null'], enum: ['instagram_proprio', 'indicacao', 'espontaneo', 'google', null], description: 'Origem do lead' },
          notes: { type: ['string', 'null'], description: 'Observações' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rentalResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createRentalSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;
    const context = getContext(request);

    // Se for franqueado, forçar franchisee_id e city_id
    if (context.isFranchisee()) {
      if (!context.franchiseeId) {
        throw new ForbiddenError('Usuário não está vinculado a um franqueado');
      }
      data.franchisee_id = context.franchiseeId;
      data.city_id = context.cityId;
    }

    // Verificar se a moto existe e está disponível
    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id: data.motorcycle_id },
    });

    if (!motorcycle) {
      throw new NotFoundError('Motocicleta não encontrada');
    }

    if (motorcycle.status !== 'active') {
      throw new BadRequestError(`Motocicleta não disponível. Status atual: ${motorcycle.status}`);
    }

    // Verificar se o franqueado existe
    const franchisee = await prisma.franchisee.findUnique({
      where: { id: data.franchisee_id },
    });

    if (!franchisee) {
      throw new NotFoundError('Franqueado não encontrado');
    }

    // Criar locação em transação
    const rental = await prisma.$transaction(async (tx) => {
      // Criar a locação
      const newRental = await tx.rental.create({
        data: {
          client_name: data.client_name,
          client_cpf: data.client_cpf,
          client_email: data.client_email,
          client_phone: data.client_phone,
          client_address: data.client_address,
          client_address_street: data.client_address_street,
          client_address_number: data.client_address_number,
          client_address_city: data.client_address_city,
          client_address_state: data.client_address_state,
          client_address_zip_code: data.client_address_zip_code,
          driver_id: data.driver_id || null,
          driver_name: data.driver_name || null,
          driver_cpf: data.driver_cpf || null,
          driver_phone: data.driver_phone || null,
          driver_cnh: data.driver_cnh || null,
          driver_address_street: data.driver_address_street || null,
          driver_address_number: data.driver_address_number || null,
          driver_address_city: data.driver_address_city || null,
          driver_address_state: data.driver_address_state || null,
          driver_address_zip_code: data.driver_address_zip_code || null,
          motorcycle_id: data.motorcycle_id,
          motorcycle_plate: motorcycle.placa,
          franchisee_id: data.franchisee_id,
          city_id: data.city_id || franchisee.city_id,
          plan_id: data.plan_id,
          attendant_id: context.userId,
          created_by: context.userId,
          start_date: new Date(data.start_date),
          end_date: data.end_date ? new Date(data.end_date) : null,
          km_inicial: data.km_inicial,
          daily_rate: data.daily_rate,
          deposit_amount: data.deposit_amount,
          total_days: data.total_days,
          total_amount: data.total_amount,
          lead_source: data.lead_source,
          notes: data.notes,
          status: 'active',
        } as any,
        include: {
          motorcycle: true,
          franchisee: true,
          city: true,
          driver: true,
        },
      });

      // Atualizar status da moto
      await tx.motorcycle.update({
        where: { id: data.motorcycle_id },
        data: {
          status: 'alugada',
          data_ultima_mov: new Date(),
        },
      });

      return newRental;
    });

    await auditService.logFromRequest(
      request,
      AuditActions.RENTAL_CREATE,
      'rental',
      rental.id,
      undefined,
      { client_name: rental.client_name, motorcycle_plate: rental.motorcycle_plate }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitRentalChange(rental.franchisee_id, rental.city_id, {
        type: 'INSERT',
        data: rental,
      });
    }

    return reply.status(201).send({
      success: true,
      data: rental,
    });
  });

  /**
   * PUT /api/rentals/:id
   * Atualizar locação
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar locação',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da locação' },
        },
      },
      body: {
        type: 'object',
        properties: {
          client_name: { type: ['string', 'null'], minLength: 2 },
          client_cpf: { type: ['string', 'null'], minLength: 11 },
          client_email: { type: ['string', 'null'], format: 'email' },
          client_phone: { type: ['string', 'null'], minLength: 8 },
          client_address: { type: ['string', 'null'] },
          client_address_street: { type: ['string', 'null'] },
          client_address_number: { type: ['string', 'null'] },
          client_address_city: { type: ['string', 'null'] },
          client_address_state: { type: ['string', 'null'] },
          client_address_zip_code: { type: ['string', 'null'] },
          driver_id: { type: ['string', 'null'], format: 'uuid' },
          driver_name: { type: ['string', 'null'] },
          driver_cpf: { type: ['string', 'null'] },
          driver_phone: { type: ['string', 'null'] },
          driver_cnh: { type: ['string', 'null'] },
          driver_address_street: { type: ['string', 'null'] },
          driver_address_number: { type: ['string', 'null'] },
          driver_address_city: { type: ['string', 'null'] },
          driver_address_state: { type: ['string', 'null'] },
          driver_address_zip_code: { type: ['string', 'null'] },
          motorcycle_id: { type: ['string', 'null'], format: 'uuid' },
          franchisee_id: { type: ['string', 'null'], format: 'uuid' },
          city_id: { type: ['string', 'null'], format: 'uuid' },
          plan_id: { type: ['string', 'null'], format: 'uuid' },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          km_inicial: { type: ['number', 'null'], minimum: 0 },
          km_final: { type: ['number', 'null'], minimum: 0 },
          daily_rate: { type: ['number', 'null'], minimum: 0 },
          deposit_amount: { type: ['number', 'null'], minimum: 0 },
          total_days: { type: ['number', 'null'], minimum: 0 },
          total_amount: { type: ['number', 'null'], minimum: 0 },
          lead_source: { type: ['string', 'null'], enum: ['instagram_proprio', 'indicacao', 'espontaneo', 'google', null] },
          notes: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled', 'paused'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rentalResponseSchema,
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
    const body = updateRentalSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const context = getContext(request);

    const existingRental = await prisma.rental.findUnique({
      where: { id },
      include: { motorcycle: true },
    });

    if (!existingRental) {
      throw new NotFoundError('Locação não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && existingRental.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar esta locação');
      }
    }

    const data = body.data;

    // Se estiver mudando de moto
    if (data.motorcycle_id && data.motorcycle_id !== existingRental.motorcycle_id) {
      const newMotorcycle = await prisma.motorcycle.findUnique({
        where: { id: data.motorcycle_id },
      });

      if (!newMotorcycle || newMotorcycle.status !== 'active') {
        throw new BadRequestError('Nova motocicleta não disponível');
      }
    }

    const rental = await prisma.rental.update({
      where: { id },
      data: {
        ...data,
        start_date: data.start_date ? new Date(data.start_date) : undefined,
        end_date: data.end_date ? new Date(data.end_date) : undefined,
      },
      include: {
        motorcycle: true,
        franchisee: true,
        city: true,
        driver: true,
      },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.RENTAL_UPDATE,
      'rental',
      id,
      existingRental,
      data
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitRentalChange(rental.franchisee_id, rental.city_id, {
        type: 'UPDATE',
        data: rental,
      });
    }

    return reply.status(200).send({
      success: true,
      data: rental,
    });
  });

  /**
   * DELETE /api/rentals/:id
   * Excluir locação
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br', 'regional'] })],
    schema: {
      description: 'Excluir locação',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da locação' },
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

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { motorcycle: true },
    });

    if (!rental) {
      throw new NotFoundError('Locação não encontrada');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && rental.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para excluir esta locação');
      }
    }

    // Se a locação está ativa, liberar a moto
    if (rental.status === 'active' && rental.motorcycle) {
      await prisma.motorcycle.update({
        where: { id: rental.motorcycle_id },
        data: {
          status: 'active',
          data_ultima_mov: new Date(),
        },
      });
    }

    // Excluir registros relacionados e a locação em uma transação
    await prisma.$transaction(async (tx) => {
      // Excluir vistorias relacionadas
      await tx.vistoria.deleteMany({
        where: { rental_id: id },
      });

      // Excluir distratos relacionados
      await tx.distrato.deleteMany({
        where: { rental_id: id },
      });

      // Excluir veículos secundários relacionados
      await tx.rentalSecondaryVehicle.deleteMany({
        where: { rental_id: id },
      });

      // Desassociar contratos gerados (não excluir, apenas remover a referência)
      await tx.generatedContract.updateMany({
        where: { rental_id: id },
        data: { rental_id: null },
      });

      // Excluir a locação
      await tx.rental.delete({
        where: { id },
      });
    });

    await auditService.logFromRequest(
      request,
      AuditActions.RENTAL_DELETE,
      'rental',
      id,
      { client_name: rental.client_name, motorcycle_plate: rental.motorcycle_plate },
      undefined
    );

    return reply.status(200).send({
      success: true,
      message: 'Locação excluída com sucesso',
    });
  });

  /**
   * POST /api/rentals/:id/complete
   * Finalizar locação
   */
  app.post('/:id/complete', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Finalizar locação',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da locação' },
        },
      },
      body: {
        type: 'object',
        properties: {
          km_final: { type: 'number', minimum: 0, description: 'Quilometragem final' },
          notes: { type: 'string', description: 'Observações finais' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rentalResponseSchema,
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
    const { km_final, notes } = request.body as { km_final?: number; notes?: string };
    const context = getContext(request);

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { motorcycle: true },
    });

    if (!rental) {
      throw new NotFoundError('Locação não encontrada');
    }

    if (rental.status !== 'active') {
      throw new BadRequestError('Apenas locações ativas podem ser finalizadas');
    }

    // Verificar se há veículo secundário ativo
    const activeSecondary = await prisma.rentalSecondaryVehicle.findFirst({
      where: { rental_id: id, status: 'active' },
      include: { motorcycle: { select: { placa: true } } },
    });

    if (activeSecondary) {
      throw new BadRequestError(
        `Não é possível finalizar a locação. Há um veículo secundário ativo (${activeSecondary.motorcycle?.placa}). Finalize-o primeiro.`
      );
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && rental.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para finalizar esta locação');
      }
    }

    // Calcular dias e valor total
    const startDate = new Date(rental.start_date);
    const endDate = new Date();
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const totalAmount = totalDays * Number(rental.daily_rate);

    const updatedRental = await prisma.$transaction(async (tx) => {
      // Atualizar locação
      const updated = await tx.rental.update({
        where: { id },
        data: {
          status: 'completed',
          end_date: endDate,
          km_final,
          total_days: totalDays,
          total_amount: totalAmount,
          notes: notes || rental.notes,
        },
        include: {
          motorcycle: true,
          franchisee: true,
          driver: true,
        },
      });

      // Liberar a moto
      await tx.motorcycle.update({
        where: { id: rental.motorcycle_id },
        data: {
          status: 'active',
          data_ultima_mov: new Date(),
          quilometragem: km_final || rental.motorcycle.quilometragem,
        },
      });

      return updated;
    });

    await auditService.logFromRequest(
      request,
      AuditActions.RENTAL_COMPLETE,
      'rental',
      id
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitRentalChange(updatedRental.franchisee_id, updatedRental.city_id, {
        type: 'UPDATE',
        data: updatedRental,
      });
    }

    return reply.status(200).send({
      success: true,
      data: updatedRental,
    });
  });

  /**
   * POST /api/rentals/:id/cancel
   * Cancelar locação
   */
  app.post('/:id/cancel', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Cancelar locação (apenas administradores)',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID da locação' },
        },
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Motivo do cancelamento' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: rentalResponseSchema,
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
    const { reason } = request.body as { reason?: string };
    const context = getContext(request);

    const rental = await prisma.rental.findUnique({
      where: { id },
      include: { motorcycle: true },
    });

    if (!rental) {
      throw new NotFoundError('Locação não encontrada');
    }

    if (rental.status !== 'active') {
      throw new BadRequestError('Apenas locações ativas podem ser canceladas');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      throw new ForbiddenError('Apenas administradores podem cancelar locações');
    }

    const updatedRental = await prisma.$transaction(async (tx) => {
      // Atualizar locação
      const updated = await tx.rental.update({
        where: { id },
        data: {
          status: 'cancelled',
          notes: reason ? `CANCELADO: ${reason}\n${rental.notes || ''}` : rental.notes,
        },
        include: {
          motorcycle: true,
          franchisee: true,
          driver: true,
        },
      });

      // Liberar a moto
      await tx.motorcycle.update({
        where: { id: rental.motorcycle_id },
        data: {
          status: 'active',
          data_ultima_mov: new Date(),
        },
      });

      return updated;
    });

    await auditService.logFromRequest(
      request,
      AuditActions.RENTAL_CANCEL,
      'rental',
      id,
      undefined,
      { reason }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitRentalChange(updatedRental.franchisee_id, updatedRental.city_id, {
        type: 'UPDATE',
        data: updatedRental,
      });
    }

    return reply.status(200).send({
      success: true,
      data: updatedRental,
    });
  });

  /**
   * GET /api/rentals/all
   * Listar todas as locações sem paginação (para Dashboard)
   */
  app.get('/all', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todas as locações sem paginação (para Dashboard)',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade para filtrar' },
          slim: { type: 'string', enum: ['true', 'false'], description: 'Se true, retorna apenas campos essenciais (para Dashboard)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: rentalResponseSchema },
            total: { type: 'number' },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { city_id, slim } = request.query as { city_id?: string; slim?: string };
    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    // Se master_br com city_id selecionada, buscar franqueados da cidade
    if (city_id && context.isMasterOrAdmin()) {
      const franchisees = await prisma.franchisee.findMany({
        where: { city_id },
        select: { id: true },
      });

      if (franchisees.length > 0) {
        where.franchisee_id = { in: franchisees.map(f => f.id) };
      } else {
        // Nenhum franqueado na cidade, retornar vazio
        return reply.status(200).send({
          success: true,
          data: [],
          total: 0,
        });
      }
    }

    // Modo slim: retorna apenas campos essenciais (para Dashboard - reduz payload ~80%)
    if (slim === 'true') {
      const rentals = await prisma.rental.findMany({
        where,
        select: {
          id: true,
          start_date: true,
          status: true,
          daily_rate: true,
          motorcycle_plate: true,
          motorcycle_id: true,
          franchisee_id: true,
          motorcycle: {
            select: { id: true, placa: true, tipo: true },
          },
        },
        orderBy: { start_date: 'desc' },
      });

      return reply.status(200).send({
        success: true,
        data: rentals,
        total: rentals.length,
      });
    }

    const rentals = await prisma.rental.findMany({
      where,
      include: {
        motorcycle: {
          select: {
            id: true,
            placa: true,
            modelo: true,
            marca: true,
            ano: true,
            cor: true,
            chassi: true,
            renavam: true,
            status: true,
            quilometragem: true,
            city_id: true,
            franchisee_id: true,
            valor_semanal: true,
          },
        },
        franchisee: {
          select: {
            id: true,
            fantasy_name: true,
            company_name: true,
            cnpj: true,
            cpf: true,
            nome_responsavel: true,
            email: true,
            whatsapp_01: true,
            city_id: true,
            status: true,
          },
        },
        city: {
          select: { id: true, name: true, slug: true },
        },
        driver: true,
        attendant: {
          select: { id: true, name: true, email: true },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
        plan: {
          select: { id: true, name: true, daily_rate: true, weekly_rate: true, monthly_rate: true, deposit_amount: true },
        },
        secondaryVehicles: {
          include: {
            motorcycle: {
              select: { id: true, placa: true, modelo: true, marca: true },
            },
          },
          orderBy: { created_at: 'desc' },
        },
      },
      orderBy: { start_date: 'desc' },
    });

    // Sanitizar datas inválidas para evitar erro de serialização
    const sanitizedRentals = rentals.map(rental => ({
      ...rental,
      start_date: isValidDate(rental.start_date) ? rental.start_date : null,
      end_date: isValidDate(rental.end_date) ? rental.end_date : null,
      actual_return_date: isValidDate(rental.actual_return_date) ? rental.actual_return_date : null,
      created_at: isValidDate(rental.created_at) ? rental.created_at : null,
      updated_at: isValidDate(rental.updated_at) ? rental.updated_at : null,
    }));

    return reply.status(200).send({
      success: true,
      data: sanitizedRentals,
      total: sanitizedRentals.length,
    });
  });

  /**
   * GET /api/rentals/stats
   * Estatísticas de locações
   */
  app.get('/stats', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Estatísticas de locações',
      tags: ['Locações'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                total: { type: 'number', description: 'Total de locações' },
                active: { type: 'number', description: 'Locações ativas' },
                completed: { type: 'number', description: 'Locações finalizadas' },
                cancelled: { type: 'number', description: 'Locações canceladas' },
                totalRevenue: { type: 'number', description: 'Receita total' },
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

    const [total, active, completed, cancelled] = await Promise.all([
      prisma.rental.count({ where: filter }),
      prisma.rental.count({ where: { ...filter, status: 'active' } }),
      prisma.rental.count({ where: { ...filter, status: 'completed' } }),
      prisma.rental.count({ where: { ...filter, status: 'cancelled' } }),
    ]);

    // Receita total (locações finalizadas)
    const revenue = await prisma.rental.aggregate({
      where: { ...filter, status: 'completed' },
      _sum: { total_amount: true },
    });

    return reply.status(200).send({
      success: true,
      data: {
        total,
        active,
        completed,
        cancelled,
        totalRevenue: revenue._sum.total_amount || 0,
      },
    });
  });
};

export default rentalsRoutes;
