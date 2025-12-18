import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';
import { logger } from '../utils/logger.js';

// Schemas de validacao
const createDistratoSchema = z.object({
  placa: z.string().min(1, 'Placa e obrigatoria'),
  franqueado: z.string().min(1, 'Franqueado e obrigatorio'),
  inicio_ctt: z.string(),
  fim_ctt: z.string(),
  motivo: z.string().min(1, 'Motivo e obrigatorio'),
  causa: z.string().min(1, 'Causa e obrigatoria'),
  franchisee_id: z.string().uuid().optional().nullable(),
  city_id: z.string().uuid().optional().nullable(),
});

const updateDistratoSchema = z.object({
  placa: z.string().min(1).optional(),
  franqueado: z.string().min(1).optional(),
  inicio_ctt: z.string().optional(),
  fim_ctt: z.string().optional(),
  motivo: z.string().min(1).optional(),
  causa: z.string().min(1).optional(),
  franchisee_id: z.string().uuid().optional().nullable(),
  city_id: z.string().uuid().optional().nullable(),
  pdf_url: z.string().optional().nullable(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  city_id: z.string().uuid().optional(),
  franchisee_id: z.string().uuid().optional(),
  placa: z.string().optional(),
});

// Schema de resposta para Swagger
const distratoResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    placa: { type: 'string' },
    franqueado: { type: 'string' },
    inicio_ctt: { type: 'string', format: 'date' },
    fim_ctt: { type: 'string', format: 'date' },
    motivo: { type: 'string' },
    causa: { type: 'string' },
    franchisee_id: { type: 'string', format: 'uuid', nullable: true },
    city_id: { type: 'string', format: 'uuid', nullable: true },
    pdf_url: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time', nullable: true },
    updated_at: { type: 'string', format: 'date-time', nullable: true },
    franchisee: { type: 'object', nullable: true, additionalProperties: true },
    city: { type: 'object', nullable: true, additionalProperties: true },
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

const distratosRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/distratos
   * Listar distratos com filtros e paginacao
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar distratos (termos de encerramento) com filtros e paginacao',
      tags: ['Distratos'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          city_id: { type: 'string', format: 'uuid' },
          franchisee_id: { type: 'string', format: 'uuid' },
          placa: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: distratoResponseSchema },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                page: { type: 'number' },
                limit: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
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

    const { page, limit, city_id, franchisee_id, placa } = query.data;
    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    if (context.isFranchisee()) {
      where.franchisee_id = context.franchiseeId;
    } else if (context.isRegional()) {
      where.city_id = context.cityId;
    } else if (context.isMasterOrAdmin()) {
      if (city_id) where.city_id = city_id;
      if (franchisee_id) where.franchisee_id = franchisee_id;
    }

    // Filtro por placa
    if (placa) {
      where.placa = { contains: placa, mode: 'insensitive' };
    }

    const [distratos, total] = await Promise.all([
      prisma.distrato.findMany({
        where,
        include: {
          franchisee: {
            select: { id: true, fantasy_name: true },
          },
          city: {
            select: { id: true, name: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      prisma.distrato.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      data: distratos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/distratos/:id
   * Obter distrato por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter distrato por ID',
      tags: ['Distratos'],
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
            data: distratoResponseSchema,
          },
        },
        404: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const distrato = await prisma.distrato.findUnique({
      where: { id },
      include: {
        franchisee: {
          select: { id: true, fantasy_name: true },
        },
        city: {
          select: { id: true, name: true },
        },
        vistorias: true,
      },
    });

    if (!distrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    return reply.status(200).send({
      success: true,
      data: distrato,
    });
  });

  /**
   * GET /api/distratos/:id/view
   * Obter dados completos do termo de encerramento para visualizacao
   */
  app.get('/:id/view', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter dados completos do termo de encerramento para visualizacao',
      tags: ['Distratos'],
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
            data: {
              type: 'object',
              properties: {
                distrato: distratoResponseSchema,
                motorcycle: { type: 'object', nullable: true, additionalProperties: true },
                vistoria: { type: 'object', nullable: true, additionalProperties: true },
                termo: {
                  type: 'object',
                  properties: {
                    titulo: { type: 'string' },
                    placa: { type: 'string' },
                    franqueado: { type: 'string' },
                    marca: { type: 'string', nullable: true },
                    modelo: { type: 'string', nullable: true },
                    inicio_contrato: { type: 'string' },
                    fim_contrato: { type: 'string' },
                    motivo: { type: 'string' },
                    causa: { type: 'string' },
                    cidade: { type: 'string', nullable: true },
                    data_geracao: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        404: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const distratoData = await prisma.distrato.findUnique({
      where: { id },
      include: {
        franchisee: {
          select: { id: true, fantasy_name: true, cnpj: true, endereco: true },
        },
        city: {
          select: { id: true, name: true },
        },
        vistorias: {
          include: {
            motorcycle: true,
          },
        },
      },
    });

    if (!distratoData) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    // Buscar dados da moto pela placa
    let motorcycle = null;
    if (distratoData.placa) {
      motorcycle = await prisma.motorcycle.findFirst({
        where: { placa: distratoData.placa },
        select: {
          id: true,
          placa: true,
          marca: true,
          modelo: true,
          ano: true,
          cor: true,
          chassi: true,
          renavam: true,
          quilometragem: true,
        },
      });
    }

    // Formatar dados do termo para exibicao
    const termo = {
      titulo: 'TERMO DE ENCERRAMENTO DE CONTRATO DE LOCACAO',
      placa: distratoData.placa,
      franqueado: distratoData.franqueado,
      marca: motorcycle?.marca || null,
      modelo: motorcycle?.modelo || null,
      ano: motorcycle?.ano || null,
      cor: motorcycle?.cor || null,
      chassi: motorcycle?.chassi || null,
      renavam: motorcycle?.renavam || null,
      inicio_contrato: distratoData.inicio_ctt.toISOString().split('T')[0],
      fim_contrato: distratoData.fim_ctt.toISOString().split('T')[0],
      motivo: distratoData.motivo,
      causa: distratoData.causa,
      cidade: distratoData.city?.name || null,
      franqueado_cnpj: distratoData.franchisee?.cnpj || null,
      franqueado_endereco: distratoData.franchisee?.endereco || null,
      data_geracao: new Date().toISOString(),
      pdf_url: distratoData.pdf_url,
    };

    return reply.status(200).send({
      success: true,
      data: {
        distrato: distratoData,
        motorcycle,
        vistoria: distratoData.vistorias[0] || null,
        termo,
      },
    });
  });

  /**
   * POST /api/distratos
   * Criar novo distrato (termo de encerramento)
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar novo distrato (termo de encerramento)',
      tags: ['Distratos'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['placa', 'franqueado', 'inicio_ctt', 'fim_ctt', 'motivo', 'causa'],
        properties: {
          placa: { type: 'string', minLength: 1 },
          franqueado: { type: 'string', minLength: 1 },
          inicio_ctt: { type: 'string' },
          fim_ctt: { type: 'string' },
          motivo: { type: 'string', minLength: 1 },
          causa: { type: 'string', minLength: 1 },
          franchisee_id: { type: 'string', format: 'uuid' },
          city_id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: distratoResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createDistratoSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;
    const context = getContext(request);

    // Se for franqueado, forcar franchisee_id e city_id
    if (context.isFranchisee()) {
      data.franchisee_id = context.franchiseeId;
      data.city_id = context.cityId;
    } else if (context.isRegional()) {
      data.city_id = context.cityId;
    }

    const distrato = await prisma.distrato.create({
      data: {
        placa: data.placa,
        franqueado: data.franqueado,
        inicio_ctt: new Date(data.inicio_ctt),
        fim_ctt: new Date(data.fim_ctt),
        motivo: data.motivo,
        causa: data.causa,
        franchisee_id: data.franchisee_id,
        city_id: data.city_id,
      },
      include: {
        franchisee: {
          select: { id: true, fantasy_name: true },
        },
        city: {
          select: { id: true, name: true },
        },
      },
    });

    return reply.status(201).send({
      success: true,
      data: distrato,
    });
  });

  /**
   * POST /api/distratos/generate-term
   * Gerar termo de encerramento e criar vistoria de saida
   */
  app.post('/generate-term', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Gerar termo de encerramento e criar vistoria de saida automaticamente',
      tags: ['Distratos'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['placa', 'franqueado', 'inicio_ctt', 'fim_ctt', 'motivo', 'causa', 'motorcycle_id'],
        properties: {
          placa: { type: 'string', minLength: 1 },
          franqueado: { type: 'string', minLength: 1 },
          inicio_ctt: { type: 'string' },
          fim_ctt: { type: 'string' },
          motivo: { type: 'string', minLength: 1 },
          causa: { type: 'string', minLength: 1 },
          franchisee_id: { type: 'string', format: 'uuid' },
          city_id: { type: 'string', format: 'uuid' },
          motorcycle_id: { type: 'string', format: 'uuid' },
          rental_id: { type: 'string', format: 'uuid' },
          locatario: { type: 'string' },
          observations: { type: 'string' },
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
                distrato: distratoResponseSchema,
                vistoria: { type: 'object', additionalProperties: true },
              },
            },
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const {
      placa,
      franqueado,
      inicio_ctt,
      fim_ctt,
      motivo,
      causa,
      franchisee_id,
      city_id,
      motorcycle_id,
      rental_id,
      locatario,
      observations,
    } = request.body as {
      placa: string;
      franqueado: string;
      inicio_ctt: string;
      fim_ctt: string;
      motivo: string;
      causa: string;
      franchisee_id?: string;
      city_id?: string;
      motorcycle_id: string;
      rental_id?: string;
      locatario?: string;
      observations?: string;
    };

    const context = getContext(request);

    // Determinar franchisee_id e city_id baseado no contexto
    let finalFranchiseeId = franchisee_id;
    let finalCityId = city_id;

    if (context.isFranchisee()) {
      finalFranchiseeId = context.franchiseeId;
      finalCityId = context.cityId;
    } else if (context.isRegional()) {
      finalCityId = context.cityId;
    }

    // Log da requisicao para debug
    logger.info({ placa, motorcycle_id, rental_id, franchisee_id }, 'Requisicao para gerar termo de encerramento');

    // PROTECAO 1: Verificar se ja existe distrato para esta placa
    const existingDistrato = await prisma.distrato.findFirst({
      where: { placa },
      include: {
        franchisee: { select: { id: true, fantasy_name: true } },
        city: { select: { id: true, name: true } },
        vistorias: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (existingDistrato) {
      logger.warn({ placa, existingId: existingDistrato.id }, 'Distrato ja existe para esta placa - retornando existente');
      return reply.status(200).send({
        success: true,
        data: {
          distrato: existingDistrato,
          vistoria: existingDistrato.vistorias[0] || null,
        },
        message: 'Termo de encerramento ja existe para esta placa. Retornando existente.',
        existing: true,
      });
    }

    // PROTECAO 2: Verificar se ja existe vistoria de saida para esta moto
    const existingVistoriaSaida = await prisma.vistoria.findFirst({
      where: {
        motorcycle_id,
        inspection_type: 'saida',
      },
      include: {
        distrato: {
          include: {
            franchisee: { select: { id: true, fantasy_name: true } },
            city: { select: { id: true, name: true } },
            vistorias: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (existingVistoriaSaida && existingVistoriaSaida.distrato) {
      logger.warn({ motorcycle_id, existingId: existingVistoriaSaida.distrato.id }, 'Vistoria de saida ja existe para esta moto - retornando distrato existente');
      return reply.status(200).send({
        success: true,
        data: {
          distrato: existingVistoriaSaida.distrato,
          vistoria: existingVistoriaSaida,
        },
        message: 'Vistoria de saida ja existe para esta moto. Retornando existente.',
        existing: true,
      });
    }

    // Criar distrato e vistoria em transacao
    const result = await prisma.$transaction(async (tx) => {
      // 1. Criar o distrato
      const distrato = await tx.distrato.create({
        data: {
          placa,
          franqueado,
          inicio_ctt: new Date(inicio_ctt),
          fim_ctt: new Date(fim_ctt),
          motivo,
          causa,
          franchisee_id: finalFranchiseeId,
          city_id: finalCityId,
        },
        include: {
          franchisee: {
            select: { id: true, fantasy_name: true },
          },
          city: {
            select: { id: true, name: true },
          },
        },
      });

      // 2. Criar a vistoria de saida
      const vistoria = await tx.vistoria.create({
        data: {
          rental_id: rental_id || null,
          distrato_id: distrato.id,
          motorcycle_id,
          city_id: finalCityId,
          franchisee_id: finalFranchiseeId,
          inspection_type: 'saida',
          inspection_date: new Date(),
          status: 'pendente',
          placa,
          locadora: franqueado,
          locatario: locatario || null,
          observations: observations || `Vistoria de saida - Encerramento. Motivo: ${motivo}. Causa: ${causa}`,
          data_hora: new Date(),
          created_by: context.userId,
        },
        include: {
          motorcycle: {
            select: { placa: true, marca: true, modelo: true },
          },
          franchisee: {
            select: { fantasy_name: true },
          },
        },
      });

      return { distrato, vistoria };
    });

    return reply.status(201).send({
      success: true,
      data: result,
      message: 'Termo de encerramento gerado e vistoria de saida criada com sucesso.',
    });
  });

  /**
   * POST /api/distratos/:id/generate-term
   * Gerar termo de encerramento para distrato existente e criar vistoria de saida
   */
  app.post('/:id/generate-term', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Gerar termo de encerramento para distrato existente e criar vistoria de saida',
      tags: ['Distratos'],
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
          motorcycle_id: { type: 'string', format: 'uuid' },
          rental_id: { type: 'string', format: 'uuid' },
          locatario: { type: 'string' },
          observations: { type: 'string' },
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
                distrato: distratoResponseSchema,
                vistoria: { type: 'object', additionalProperties: true },
              },
            },
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { motorcycle_id, rental_id, locatario, observations } = request.body as {
      motorcycle_id?: string;
      rental_id?: string;
      locatario?: string;
      observations?: string;
    };

    const context = getContext(request);

    // Buscar o distrato existente
    const distrato = await prisma.distrato.findUnique({
      where: { id },
      include: {
        franchisee: {
          select: { id: true, fantasy_name: true },
        },
        city: {
          select: { id: true, name: true },
        },
        vistorias: true,
      },
    });

    if (!distrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    // Verificar se ja existe vistoria de saida para este distrato
    const existingVistoria = distrato.vistorias.find(v => v.inspection_type === 'saida');

    if (existingVistoria) {
      return reply.status(200).send({
        success: true,
        data: {
          distrato,
          vistoria: existingVistoria,
        },
        message: 'Vistoria de saida ja existe para este distrato.',
      });
    }

    // Buscar motorcycle_id se nao foi fornecido (tentar pela placa)
    let finalMotorcycleId = motorcycle_id;
    if (!finalMotorcycleId && distrato.placa) {
      const motorcycle = await prisma.motorcycle.findFirst({
        where: { placa: distrato.placa },
      });
      if (motorcycle) {
        finalMotorcycleId = motorcycle.id;
      }
    }

    if (!finalMotorcycleId) {
      throw new BadRequestError('motorcycle_id e obrigatorio ou a placa do distrato deve corresponder a uma moto existente');
    }

    // Criar a vistoria de saida
    const vistoria = await prisma.vistoria.create({
      data: {
        rental_id: rental_id || null,
        distrato_id: distrato.id,
        motorcycle_id: finalMotorcycleId,
        city_id: distrato.city_id,
        franchisee_id: distrato.franchisee_id,
        inspection_type: 'saida',
        inspection_date: new Date(),
        status: 'pendente',
        placa: distrato.placa,
        locadora: distrato.franqueado,
        locatario: locatario || null,
        observations: observations || `Vistoria de saida - Encerramento. Motivo: ${distrato.motivo}. Causa: ${distrato.causa}`,
        data_hora: new Date(),
        created_by: context.userId,
      },
      include: {
        motorcycle: {
          select: { placa: true, marca: true, modelo: true },
        },
        franchisee: {
          select: { fantasy_name: true },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: {
        distrato,
        vistoria,
      },
      message: 'Vistoria de saida criada com sucesso.',
    });
  });

  /**
   * PUT /api/distratos/:id
   * Atualizar distrato
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar distrato',
      tags: ['Distratos'],
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
          placa: { type: 'string' },
          franqueado: { type: 'string' },
          inicio_ctt: { type: 'string' },
          fim_ctt: { type: 'string' },
          motivo: { type: 'string' },
          causa: { type: 'string' },
          franchisee_id: { type: 'string', format: 'uuid' },
          city_id: { type: 'string', format: 'uuid' },
          pdf_url: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: distratoResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateDistratoSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const existingDistrato = await prisma.distrato.findUnique({
      where: { id },
    });

    if (!existingDistrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    const data = body.data;

    const distrato = await prisma.distrato.update({
      where: { id },
      data: {
        ...data,
        inicio_ctt: data.inicio_ctt ? new Date(data.inicio_ctt) : undefined,
        fim_ctt: data.fim_ctt ? new Date(data.fim_ctt) : undefined,
      },
      include: {
        franchisee: {
          select: { id: true, fantasy_name: true },
        },
        city: {
          select: { id: true, name: true },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: distrato,
    });
  });

  /**
   * DELETE /api/distratos/:id
   * Excluir distrato
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Excluir distrato',
      tags: ['Distratos'],
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

    const distrato = await prisma.distrato.findUnique({
      where: { id },
      include: { vistorias: true },
    });

    if (!distrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    // Excluir em transacao - primeiro vistorias relacionadas, depois o distrato
    await prisma.$transaction(async (tx) => {
      // Excluir vistorias relacionadas
      if (distrato.vistorias.length > 0) {
        await tx.vistoria.deleteMany({
          where: { distrato_id: id },
        });
      }

      // Excluir o distrato
      await tx.distrato.delete({
        where: { id },
      });
    });

    return reply.status(200).send({
      success: true,
      message: 'Distrato e vistorias relacionadas excluidos com sucesso',
    });
  });
};

export default distratosRoutes;
