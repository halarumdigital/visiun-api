import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

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
  rental_id: z.string().uuid().optional().nullable(),
  termo_url: z.string().optional().nullable(),
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
  rental_id: z.string().uuid().optional().nullable(),
  pdf_url: z.string().optional().nullable(),
  termo_url: z.string().optional().nullable(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  city_id: z.string().uuid().optional(),
  franchisee_id: z.string().uuid().optional(),
  rental_id: z.string().uuid().optional(),
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
    rental_id: { type: 'string', format: 'uuid', nullable: true },
    pdf_url: { type: 'string', nullable: true },
    termo_url: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time', nullable: true },
    updated_at: { type: 'string', format: 'date-time', nullable: true },
    franchisee: { type: 'object', nullable: true, additionalProperties: true },
    city: { type: 'object', nullable: true, additionalProperties: true },
    rental: { type: 'object', nullable: true, additionalProperties: true },
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
          rental_id: { type: 'string', format: 'uuid' },
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

    const { page, limit, city_id, franchisee_id, rental_id, placa } = query.data;
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

    // Filtro por rental_id (locacao especifica)
    if (rental_id) {
      where.rental_id = rental_id;
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
          rental_id: { type: 'string', format: 'uuid' },
          termo_url: { type: 'string' },
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

    // Criar distrato e atualizar moto para recolhida em uma transação
    const distrato = await prisma.$transaction(async (tx) => {
      // 1. Criar o distrato
      const novoDistrato = await tx.distrato.create({
        data: {
          placa: data.placa,
          franqueado: data.franqueado,
          inicio_ctt: new Date(data.inicio_ctt),
          fim_ctt: new Date(data.fim_ctt),
          motivo: data.motivo,
          causa: data.causa,
          termo_url: data.termo_url,
          franchisee: data.franchisee_id ? { connect: { id: data.franchisee_id } } : undefined,
          city: data.city_id ? { connect: { id: data.city_id } } : undefined,
          rental: data.rental_id ? { connect: { id: data.rental_id } } : undefined,
        },
        include: {
          franchisee: {
            select: { id: true, fantasy_name: true },
          },
          city: {
            select: { id: true, name: true },
          },
          rental: {
            select: { id: true, client_name: true, motorcycle_plate: true },
          },
        },
      });

      // 2. Buscar a moto pela placa e CRIAR um novo registro com status recolhida
      // Busca case-insensitive para garantir que encontre a moto
      const placaBusca = data.placa.trim();
      logger.info(`[Distrato] Buscando moto com placa: "${placaBusca}"`);

      const moto = await tx.motorcycle.findFirst({
        where: {
          placa: {
            equals: placaBusca,
            mode: 'insensitive'
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      logger.info(`[Distrato] Resultado da busca: ${moto ? `Encontrada ID ${moto.id}` : 'NÃO ENCONTRADA'}`);

      if (moto) {
        // CRIAR um novo registro de movimento para aparecer na aba "Gestão de Motos"
        // Estratégia: data_criacao é uma data antiga (para não ser o mais recente da placa)
        // data_ultima_mov é a data atual (para ordenação correta)
        // O registro existente NÃO é alterado
        
        // Usar data_criacao anterior ao data_ultima_mov da moto existente
        // Isso garante que o registro NÃO será o mais recente da placa
        const dataCriacaoAntiga = moto.data_ultima_mov
          ? new Date(new Date(moto.data_ultima_mov).getTime() - 86400000) // 1 dia antes
          : new Date(new Date().getTime() - 86400000); // 1 dia antes de hoje
        
        await tx.motorcycle.create({
          data: {
            placa: moto.placa,
            chassi: moto.chassi,
            renavam: moto.renavam,
            modelo: moto.modelo,
            marca: moto.marca,
            ano: moto.ano,
            cor: moto.cor,
            quilometragem: moto.quilometragem,
            status: 'recolhida',
            codigo_cs: moto.codigo_cs,
            tipo: moto.tipo,
            valor_semanal: moto.valor_semanal,
            data_ultima_mov: new Date(), // Data atual para ordenação
            data_criacao: dataCriacaoAntiga, // Data antiga para não ser o mais recente da placa
            city_id: moto.city_id,
            franchisee_id: moto.franchisee_id,
            franqueado: moto.franqueado,
            observacoes: `Distrato - Causa: ${data.causa}. Motivo: ${data.motivo}`,
          },
        });

        logger.info(`[Distrato] Novo registro de movimento criado para moto ${moto.placa} com status 'recolhida' (apenas na aba Gestão de Motos).`);
      } else {
        logger.warn(`[Distrato] Moto com placa "${placaBusca}" não encontrada para criar movimento`);
      }

      return novoDistrato;
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

    // PROTECAO 1: Verificar se ja existe distrato para esta locacao (rental_id)
    // Se rental_id foi fornecido, verificar especificamente por ele
    // Caso contrario, verificar por placa
    const existingDistrato = await prisma.distrato.findFirst({
      where: rental_id ? { rental_id } : { placa },
      include: {
        franchisee: { select: { id: true, fantasy_name: true } },
        city: { select: { id: true, name: true } },
        vistorias: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (existingDistrato) {
      logger.warn({ placa, rental_id, existingId: existingDistrato.id }, 'Distrato ja existe para esta locacao - retornando existente');
      return reply.status(200).send({
        success: true,
        data: {
          distrato: existingDistrato,
          vistoria: existingDistrato.vistorias[0] || null,
        },
        message: 'Termo de encerramento ja existe para esta locacao. Retornando existente.',
        existing: true,
      });
    }

    // PROTECAO 2: Verificar se ja existe vistoria de saida para esta locacao/moto
    const existingVistoriaSaida = await prisma.vistoria.findFirst({
      where: {
        motorcycle_id,
        inspection_type: 'saida',
        // Se rental_id foi fornecido, filtrar por ele tambem
        ...(rental_id ? { rental_id } : {}),
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
      logger.warn({ motorcycle_id, rental_id, existingId: existingVistoriaSaida.distrato.id }, 'Vistoria de saida ja existe para esta locacao - retornando distrato existente');
      return reply.status(200).send({
        success: true,
        data: {
          distrato: existingVistoriaSaida.distrato,
          vistoria: existingVistoriaSaida,
        },
        message: 'Vistoria de saida ja existe para esta locacao. Retornando existente.',
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

      // 3. Buscar dados completos da moto para criar o registro de movimento
      const motoExistente = await tx.motorcycle.findUnique({
        where: { id: motorcycle_id },
      });

      if (motoExistente) {
        // CRIAR um novo registro de movimento para aparecer na aba "Gestão de Motos"
        // Estratégia: data_criacao é uma data antiga (para não ser o mais recente da placa)
        // data_ultima_mov é a data atual (para ordenação correta)
        // O registro existente NÃO é alterado
        
        // Usar data_criacao anterior ao data_ultima_mov da moto existente
        // Isso garante que o registro NÃO será o mais recente da placa
        const dataCriacaoAntiga = motoExistente.data_ultima_mov
          ? new Date(new Date(motoExistente.data_ultima_mov).getTime() - 86400000) // 1 dia antes
          : new Date(new Date().getTime() - 86400000); // 1 dia antes de hoje
        
        await tx.motorcycle.create({
          data: {
            placa: motoExistente.placa,
            chassi: motoExistente.chassi,
            renavam: motoExistente.renavam,
            modelo: motoExistente.modelo,
            marca: motoExistente.marca,
            ano: motoExistente.ano,
            cor: motoExistente.cor,
            quilometragem: motoExistente.quilometragem,
            status: 'recolhida',
            codigo_cs: motoExistente.codigo_cs,
            tipo: motoExistente.tipo,
            valor_semanal: motoExistente.valor_semanal,
            data_ultima_mov: new Date(), // Data atual para ordenação
            data_criacao: dataCriacaoAntiga, // Data antiga para não ser o mais recente da placa
            city_id: motoExistente.city_id,
            franchisee_id: motoExistente.franchisee_id,
            franqueado: motoExistente.franqueado,
            observacoes: `Distrato - Causa: ${causa}. Motivo: ${motivo}`,
          },
        });

        logger.info(`[Distrato] Novo registro de movimento criado para moto ${motoExistente.placa} com status 'recolhida' via generate-term (apenas na aba Gestão de Motos).`);
      }

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

    // Criar vistoria de saida e atualizar moto em transação
    const result = await prisma.$transaction(async (tx) => {
      // 1. Criar a vistoria de saida
      const vistoria = await tx.vistoria.create({
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

      // 2. Buscar dados completos da moto para criar o registro de movimento
      const motoExistente = await tx.motorcycle.findUnique({
        where: { id: finalMotorcycleId },
      });

      if (motoExistente) {
        // CRIAR um novo registro de movimento para aparecer na aba "Gestão de Motos"
        // Estratégia: data_criacao é uma data antiga (para não ser o mais recente da placa)
        // data_ultima_mov é a data atual (para ordenação correta)
        // O registro existente NÃO é alterado
        
        // Usar data_criacao anterior ao data_ultima_mov da moto existente
        // Isso garante que o registro NÃO será o mais recente da placa
        const dataCriacaoAntiga = motoExistente.data_ultima_mov
          ? new Date(new Date(motoExistente.data_ultima_mov).getTime() - 86400000) // 1 dia antes
          : new Date(new Date().getTime() - 86400000); // 1 dia antes de hoje
        
        await tx.motorcycle.create({
          data: {
            placa: motoExistente.placa,
            chassi: motoExistente.chassi,
            renavam: motoExistente.renavam,
            modelo: motoExistente.modelo,
            marca: motoExistente.marca,
            ano: motoExistente.ano,
            cor: motoExistente.cor,
            quilometragem: motoExistente.quilometragem,
            status: 'recolhida',
            codigo_cs: motoExistente.codigo_cs,
            tipo: motoExistente.tipo,
            valor_semanal: motoExistente.valor_semanal,
            data_ultima_mov: new Date(), // Data atual para ordenação
            data_criacao: dataCriacaoAntiga, // Data antiga para não ser o mais recente da placa
            city_id: motoExistente.city_id,
            franchisee_id: motoExistente.franchisee_id,
            franqueado: motoExistente.franqueado,
            observacoes: `Distrato - Causa: ${distrato.causa}. Motivo: ${distrato.motivo}`,
          },
        });

        logger.info(`[Distrato] Novo registro de movimento criado para moto ${motoExistente.placa} com status 'recolhida' via /:id/generate-term (apenas na aba Gestão de Motos).`);
      }

      return vistoria;
    });

    return reply.status(200).send({
      success: true,
      data: {
        distrato,
        vistoria: result,
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
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br', 'regional'] })],
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
    const context = getContext(request);

    const distrato = await prisma.distrato.findUnique({
      where: { id },
      include: { vistorias: true },
    });

    if (!distrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    // Regional só pode excluir distratos da sua cidade
    if (context.isRegional() && distrato.city_id !== context.cityId) {
      throw new BadRequestError('Voce nao tem permissao para excluir este distrato');
    }

    logger.info({
      distratoId: id,
      placa: distrato.placa,
      rental_id: distrato.rental_id,
      vistoriasCount: distrato.vistorias.length,
    }, 'Iniciando exclusao de distrato');

    // Excluir em transacao - primeiro vistorias relacionadas, depois o distrato
    await prisma.$transaction(async (tx) => {
      // Excluir vistorias relacionadas por distrato_id
      if (distrato.vistorias.length > 0) {
        const deletedVistorias = await tx.vistoria.deleteMany({
          where: { distrato_id: id },
        });
        logger.info({ deletedCount: deletedVistorias.count }, 'Vistorias excluidas por distrato_id');
      }

      // Se o distrato tem rental_id, excluir também vistorias de saída órfãs dessa locação
      if (distrato.rental_id) {
        const deletedOrphanVistorias = await tx.vistoria.deleteMany({
          where: {
            rental_id: distrato.rental_id,
            inspection_type: 'saida',
            distrato_id: null, // Apenas vistorias órfãs (sem distrato vinculado)
          },
        });
        if (deletedOrphanVistorias.count > 0) {
          logger.info({ deletedCount: deletedOrphanVistorias.count, rental_id: distrato.rental_id }, 'Vistorias orfas de saida excluidas');
        }
      }

      // Excluir o distrato
      await tx.distrato.delete({
        where: { id },
      });

      logger.info({ distratoId: id }, 'Distrato excluido com sucesso');
    });

    return reply.status(200).send({
      success: true,
      message: 'Distrato e vistorias relacionadas excluidos com sucesso',
    });
  });

  /**
   * POST /api/distratos/:id/send-for-signature
   * Enviar termo de encerramento para assinatura via PlugSign
   */
  app.post('/:id/send-for-signature', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Enviar termo de encerramento para assinatura via PlugSign',
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
        required: ['signers'],
        properties: {
          signers: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'email'],
              properties: {
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
                cpf: { type: 'string' },
                phone: { type: 'string' },
                sign_as: { type: 'string', enum: ['party', 'witness', 'approver'] },
              },
            },
          },
          message: { type: 'string' },
          deadline_at: { type: 'string' },
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
                signature_request_id: { type: 'string' },
                plugsign_response: { type: 'object', additionalProperties: true },
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
    const { signers, message, deadline_at } = request.body as {
      signers: Array<{
        name: string;
        email: string;
        cpf?: string;
        phone?: string;
        sign_as?: 'party' | 'witness' | 'approver';
      }>;
      message?: string;
      deadline_at?: string;
    };

    const context = getContext(request);
    const user = request.user;

    // Buscar o distrato
    const distrato = await prisma.distrato.findUnique({
      where: { id },
      include: {
        franchisee: true,
        city: true,
      },
    });

    if (!distrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    // Verificar se tem PDF gerado (pode estar em pdf_url ou termo_url)
    const pdfUrl = distrato.pdf_url || distrato.termo_url;
    if (!pdfUrl) {
      throw new BadRequestError('O termo de encerramento precisa ter um PDF gerado antes de enviar para assinatura');
    }

    // Verificar se já foi enviado para assinatura
    if (distrato.signature_request_id) {
      throw new BadRequestError('Este termo de encerramento ja foi enviado para assinatura. ID: ' + distrato.signature_request_id);
    }

    // Buscar token do PlugSign - usar token do .env primeiro (mais confiável)
    let apiToken: string | null = null;

    // Primeiro: token do .env
    if (env.PLUGSIGN_API_KEY && env.PLUGSIGN_API_KEY.length >= 50) {
      apiToken = env.PLUGSIGN_API_KEY;
      logger.info('PlugSign (Distrato): usando token do .env');
    }

    // Fallback: tentar buscar token da cidade
    if (!apiToken && distrato.city_id) {
      const city = await prisma.city.findUnique({
        where: { id: distrato.city_id },
        select: { plugsign_token: true, name: true },
      });

      if (city?.plugsign_token && city.plugsign_token.length >= 50) {
        apiToken = city.plugsign_token;
        logger.info({ cidade: city.name }, 'PlugSign (Distrato): usando token da cidade');
      }
    }

    // Fallback: tentar buscar token do usuário
    if (!apiToken) {
      const appUser = await prisma.appUser.findUnique({
        where: { id: user.userId },
        select: { city_id: true },
      });

      if (appUser?.city_id) {
        const userCity = await prisma.city.findUnique({
          where: { id: appUser.city_id },
          select: { plugsign_token: true, name: true },
        });

        if (userCity?.plugsign_token && userCity.plugsign_token.length >= 50) {
          apiToken = userCity.plugsign_token;
          logger.info({ cidade: userCity.name }, 'PlugSign (Distrato): usando token da cidade do usuario');
        }
      }
    }

    if (!apiToken) {
      throw new ServiceUnavailableError('Token PlugSign nao encontrado');
    }

    if (!env.PLUGSIGN_API_URL) {
      throw new ServiceUnavailableError('PlugSign API URL nao configurada');
    }

    try {
      // Baixar o PDF e converter para BASE64
      logger.info({ pdfUrl }, 'Baixando PDF do termo de encerramento');

      const pdfResponse = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const pdfBase64 = Buffer.from(pdfResponse.data).toString('base64');

      // Preparar payload para o PlugSign - endpoint files/upload/requests
      // Formato correto baseado na documentação:
      // - file: data:application/pdf;name=filename.pdf;base64,BASE64_CONTENT
      // - name: nome do documento (string)
      // - email: array de emails dos signatários
      const filename = `termo_encerramento_${distrato.placa}.pdf`;
      const plugSignPayload: Record<string, any> = {
        file: `data:application/pdf;name=${filename};base64,${pdfBase64}`,
        name: `Termo de Encerramento - ${distrato.placa}`,
        email: signers.map(s => s.email),
        message: message || `Por favor, assine o Termo de Encerramento do contrato de locação da moto ${distrato.placa}.`,
      };

      // Adicionar deadline se fornecido
      if (deadline_at) {
        plugSignPayload.deadline_at = deadline_at;
      }

      logger.info({ distratoId: id, signersCount: signers.length }, 'Enviando termo de encerramento para PlugSign');

      // Fazer requisição para o PlugSign - endpoint correto: /api/files/upload/requests
      // Construir URL base correta (adiciona /api se necessário)
      const baseUrl = env.PLUGSIGN_API_URL!.endsWith('/api')
        ? env.PLUGSIGN_API_URL
        : `${env.PLUGSIGN_API_URL}/api`;
      const uploadUrl = `${baseUrl}/files/upload/requests`;

      logger.info({
        url: uploadUrl,
        tokenLength: apiToken?.length,
        tokenPrefix: apiToken?.substring(0, 10),
        payloadKeys: Object.keys(plugSignPayload),
        fileSize: pdfBase64.length,
      }, 'PlugSign: detalhes da requisicao');

      const response = await axios.post(
        uploadUrl,
        plugSignPayload,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 60000, // Timeout maior para upload de arquivo
        }
      );

      const plugSignResponse = response.data;

      // Log completo da resposta do PlugSign para debug
      logger.info({
        plugSignResponse: JSON.stringify(plugSignResponse),
        dataKeys: plugSignResponse.data ? Object.keys(plugSignResponse.data) : [],
        rootKeys: Object.keys(plugSignResponse),
        // Log campos específicos para identificar o document_key
        possibleDocKeys: {
          'data.document': plugSignResponse.data?.document, // CAMPO PRINCIPAL!
          'document': plugSignResponse.document,
          'data.document_key': plugSignResponse.data?.document_key,
          'data.file_key': plugSignResponse.data?.file_key,
          'data.file?.key': plugSignResponse.data?.file?.key,
          'data.file?.document_key': plugSignResponse.data?.file?.document_key,
          'data.files[0]?.key': plugSignResponse.data?.files?.[0]?.key,
          'data.files[0]?.document_key': plugSignResponse.data?.files?.[0]?.document_key,
          'document_key': plugSignResponse.document_key,
          'file_key': plugSignResponse.file_key,
          'data.key': plugSignResponse.data?.key,
          'data.id': plugSignResponse.data?.id,
        }
      }, 'PlugSign: resposta completa');

      // Extrair IDs da resposta - PlugSign pode retornar em diferentes formatos
      const requestId = plugSignResponse.data?.request_key ||
                        plugSignResponse.data?.request_id ||
                        plugSignResponse.data?.id ||
                        plugSignResponse.request_key ||
                        plugSignResponse.key ||
                        plugSignResponse.id;

      // A chave do documento para download - CRITICAL: buscar em todos os locais possíveis
      // IMPORTANTE: O PlugSign usa o campo 'document' para a chave de download do arquivo!
      const documentKey = plugSignResponse.data?.document || // Campo principal!
                          plugSignResponse.document ||
                          plugSignResponse.data?.document_key ||
                          plugSignResponse.data?.file_key ||
                          plugSignResponse.data?.file?.key ||
                          plugSignResponse.data?.file?.document_key ||
                          plugSignResponse.data?.files?.[0]?.key ||
                          plugSignResponse.data?.files?.[0]?.document_key ||
                          plugSignResponse.document_key ||
                          plugSignResponse.file_key ||
                          plugSignResponse.data?.key ||
                          null; // NAO usar fallback para requestId - queremos saber se está undefined

      if (!requestId) {
        logger.error({ response: plugSignResponse }, 'PlugSign nao retornou um ID de documento');
        throw new BadRequestError('PlugSign nao retornou um ID de documento valido');
      }

      // Converter para string (PlugSign pode retornar número ou string)
      const signatureRequestIdStr = String(requestId);
      const documentKeyStr = documentKey ? String(documentKey) : signatureRequestIdStr;

      // IMPORTANTE: Logar se não encontrou document_key separado
      if (!documentKey) {
        logger.warn({
          requestId: signatureRequestIdStr,
          message: 'PlugSign NAO retornou document_key separado! Usando requestId como fallback.',
          response: JSON.stringify(plugSignResponse),
        }, 'PlugSign: document_key nao encontrado na resposta');
      }

      logger.info({
        requestId: signatureRequestIdStr,
        documentKey: documentKeyStr,
        documentKeyFound: !!documentKey,
      }, 'PlugSign: IDs extraidos');

      // Atualizar o distrato com o signature_request_id, document_key e status
      const updatedDistrato = await prisma.distrato.update({
        where: { id },
        data: {
          signature_request_id: signatureRequestIdStr,
          document_key: documentKeyStr,
          status: 'pending_signature',
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

      logger.info({
        distratoId: id,
        signatureRequestId: signatureRequestIdStr,
      }, 'Termo de encerramento enviado para assinatura com sucesso');

      return reply.status(200).send({
        success: true,
        data: {
          distrato: updatedDistrato,
          signature_request_id: signatureRequestIdStr,
          plugsign_response: plugSignResponse,
        },
        message: 'Termo de encerramento enviado para assinatura com sucesso',
      });
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        logger.error({
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        }, 'Erro ao enviar termo de encerramento para PlugSign');

        const errorMessage = error.response?.data?.message ||
                            error.response?.data?.error ||
                            'Erro ao comunicar com o PlugSign';

        throw new BadRequestError(`Erro PlugSign: ${errorMessage}`);
      }

      logger.error({ error }, 'Erro inesperado ao enviar termo de encerramento para assinatura');
      throw error;
    }
  });

  /**
   * GET /api/distratos/:id/download-signed
   * Baixar o termo de encerramento assinado do PlugSign
   */
  app.get('/:id/download-signed', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Baixar o termo de encerramento assinado do PlugSign',
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
          type: 'string',
          format: 'binary',
          description: 'PDF do documento assinado',
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user;

    // Buscar o distrato
    const distrato = await prisma.distrato.findUnique({
      where: { id },
      include: {
        city: true,
      },
    });

    if (!distrato) {
      throw new NotFoundError('Distrato nao encontrado');
    }

    if (!distrato.signature_request_id) {
      throw new BadRequestError('Este termo de encerramento ainda nao foi enviado para assinatura');
    }

    // Verificar se tem documento ja assinado armazenado
    if (distrato.signed_file_url) {
      logger.info({ id, url: distrato.signed_file_url }, 'Redirecionando para URL do documento assinado');
      return reply.redirect(distrato.signed_file_url);
    }

    // Buscar token do PlugSign
    let apiToken: string | null = null;

    if (env.PLUGSIGN_API_KEY && env.PLUGSIGN_API_KEY.length >= 50) {
      apiToken = env.PLUGSIGN_API_KEY;
    } else if (distrato.city_id) {
      const city = await prisma.city.findUnique({
        where: { id: distrato.city_id },
        select: { plugsign_token: true },
      });
      if (city?.plugsign_token && city.plugsign_token.length >= 50) {
        apiToken = city.plugsign_token;
      }
    }

    if (!apiToken) {
      throw new ServiceUnavailableError('Token PlugSign nao encontrado');
    }

    const requestId = distrato.signature_request_id;
    const documentKey = distrato.document_key || requestId;

    logger.info({
      distratoId: id,
      requestId,
      documentKey,
    }, 'Iniciando download do documento assinado');

    // Lista de endpoints para tentar download
    const downloadEndpoints: string[] = [];
    let fileKeyFromList: string | null = null;

    // ESTRATEGIA 1: Listar ARQUIVOS (files) para encontrar o document_key correto
    try {
      const filesUrl = 'https://app.plugsign.com.br/api/files';
      logger.info({ filesUrl }, 'PlugSign: listando arquivos');

      const filesResponse = await axios.get(filesUrl, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      const files = filesResponse.data?.data || filesResponse.data || [];

      // Log detalhado da resposta para debug
      logger.info({
        totalFiles: files.length,
        firstFewFiles: JSON.stringify(files.slice(0, 5)),
        responseKeys: Object.keys(filesResponse.data || {}),
      }, 'PlugSign: lista de arquivos obtida');

      // Se ha arquivos, logar os campos disponiveis do primeiro
      if (files.length > 0) {
        logger.info({
          sampleFileKeys: Object.keys(files[0] || {}),
          sampleFile: JSON.stringify(files[0]),
        }, 'PlugSign: exemplo de arquivo na lista');
      }

      // Procurar pelo arquivo correspondente ao documento
      for (const file of files) {
        const fileId = String(file.id || '');
        const fileKey = file.key || file.document_key || file.file_key || '';
        const fileName = file.name || file.document_name || file.file_name || '';
        const fileRequestId = String(file.request_id || file.requestId || '');

        // Verificar se e o arquivo correto (por request_id, nome ou placa)
        if (fileRequestId === requestId ||
            fileId === requestId ||
            fileName.toLowerCase().includes(distrato.placa.toLowerCase()) ||
            fileName.toLowerCase().includes('termo de encerramento') ||
            fileName.toLowerCase().includes('termo_encerramento')) {

          logger.info({
            foundFile: JSON.stringify(file),
            matchedBy: fileRequestId === requestId ? 'request_id' : fileName.toLowerCase().includes(distrato.placa.toLowerCase()) ? 'placa' : 'name',
          }, 'PlugSign: arquivo encontrado na lista');

          // Usar o document_key ou key do arquivo
          if (fileKey) {
            fileKeyFromList = String(fileKey);
            // Adicionar no inicio da lista de endpoints (prioridade)
            downloadEndpoints.unshift(`https://app.plugsign.com.br/api/files/download/${fileKeyFromList}`);
            logger.info({ documentKey: fileKeyFromList }, 'PlugSign: document_key extraido do arquivo');
          }

          // Extrair URL de download se existir
          const downloadUrl = file.download_url || file.signed_url || file.url;
          if (downloadUrl) {
            downloadEndpoints.unshift(downloadUrl);
          }

          break;
        }
      }

      // Se nao encontrou, logar os nomes de todos os arquivos para debug
      if (!fileKeyFromList && files.length > 0) {
        const fileNames = files.map((f: any) => ({
          id: f.id,
          key: f.key || f.document_key,
          name: f.name || f.document_name,
          request_id: f.request_id,
        }));
        logger.info({ fileNames, searchingFor: { requestId, placa: distrato.placa } }, 'PlugSign: arquivos disponiveis (nenhum correspondente)');
      }
    } catch (filesError) {
      logger.warn({ error: (filesError as any).message }, 'PlugSign: nao foi possivel listar arquivos');
    }

    // ESTRATEGIA 1b: Listar REQUESTS para encontrar o file_key
    if (!fileKeyFromList) {
      try {
        const listUrl = 'https://app.plugsign.com.br/api/requests';
        logger.info({ listUrl }, 'PlugSign: listando requests');

        const listResponse = await axios.get(listUrl, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json',
          },
          timeout: 30000,
        });

        const requests = listResponse.data?.data || listResponse.data || [];

        logger.info({
          totalRequests: requests.length,
          firstFewRequests: JSON.stringify(requests.slice(0, 3)),
        }, 'PlugSign: lista de requests obtida');

        for (const req of requests) {
          const reqId = String(req.id || req.key || req.request_key || '');
          const reqName = req.name || req.document_name || '';

          if (reqId === requestId ||
              reqName.toLowerCase().includes(distrato.placa.toLowerCase())) {

            logger.info({ foundRequest: JSON.stringify(req) }, 'PlugSign: request encontrado');

            // IMPORTANTE: O campo 'document' contém a chave do arquivo para download!
            // Também tentar file_key, document_key como fallbacks
            const fk = req.document || req.file_key || req.document_key || req.files?.[0]?.key || req.files?.[0]?.document_key;
            if (fk) {
              fileKeyFromList = String(fk);
              downloadEndpoints.unshift(`https://app.plugsign.com.br/api/files/download/${fileKeyFromList}`);
              logger.info({ documentKey: fileKeyFromList }, 'PlugSign: document_key extraido do request (campo document)');

              // Atualizar o document_key no banco para não precisar buscar na lista novamente
              if (fileKeyFromList !== documentKey) {
                await prisma.distrato.update({
                  where: { id },
                  data: { document_key: fileKeyFromList },
                });
                logger.info({ id, oldKey: documentKey, newKey: fileKeyFromList }, 'PlugSign: document_key atualizado no banco');
              }
            }
            break;
          }
        }
      } catch (listError) {
        logger.warn({ error: (listError as any).message }, 'PlugSign: nao foi possivel listar requests');
      }
    }

    // ESTRATEGIA 2: Adicionar endpoints padrao com o requestId e documentKey
    downloadEndpoints.push(
      `https://app.plugsign.com.br/api/requests/${requestId}/file/signed`,
      `https://app.plugsign.com.br/api/requests/${requestId}/files/signed`,
      `https://app.plugsign.com.br/api/requests/${requestId}/download`,
      `https://app.plugsign.com.br/api/requests/${requestId}/pdf`,
      `https://app.plugsign.com.br/api/files/download/${documentKey}`,
      `https://app.plugsign.com.br/api/files/${documentKey}/download`,
      `https://app.plugsign.com.br/api/files/${documentKey}/signed`,
      `https://app.plugsign.com.br/api/documents/${requestId}/download`,
      `https://app.plugsign.com.br/api/documents/${requestId}/pdf`,
      // Tentar com sufixo -signed
      `https://app.plugsign.com.br/api/files/download/${requestId}-signed`,
      `https://app.plugsign.com.br/api/files/${requestId}-signed/download`,
    );

    // ESTRATEGIA 3: Tentar obter info do request especifico
    try {
      const infoUrl = `https://app.plugsign.com.br/api/requests/${requestId}`;
      logger.info({ infoUrl }, 'Buscando informacoes do request no PlugSign');

      const infoResponse = await axios.get(infoUrl, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      logger.info({
        response: JSON.stringify(infoResponse.data),
      }, 'PlugSign: informacoes do request');

      // Extrair URL de download da resposta se existir
      const data = infoResponse.data?.data || infoResponse.data;
      const signedFileUrl = data?.signed_file_url ||
                            data?.signed_url ||
                            data?.download_url ||
                            data?.file_url;

      if (signedFileUrl) {
        logger.info({ signedFileUrl }, 'PlugSign: URL do arquivo assinado encontrada');
        downloadEndpoints.unshift(signedFileUrl);
      }

      // Extrair file_key se existir
      const fileKey = data?.file_key || data?.files?.[0]?.key || data?.files?.[0]?.file_key;
      if (fileKey && fileKey !== documentKey) {
        downloadEndpoints.unshift(`https://app.plugsign.com.br/api/files/download/${fileKey}`);
        downloadEndpoints.unshift(`https://app.plugsign.com.br/api/files/${fileKey}/download`);
      }
    } catch (infoError) {
      logger.warn({ error: (infoError as any).message }, 'Nao foi possivel obter informacoes do request, tentando download direto');
    }

    // Tentar cada endpoint de download
    for (const endpoint of downloadEndpoints) {
      try {
        logger.info({ endpoint }, 'PlugSign: tentando download');

        const response = await axios.get(endpoint, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/pdf, application/octet-stream',
          },
          responseType: 'arraybuffer',
          timeout: 60000,
        });

        // Verificar se e um PDF valido (comeca com %PDF)
        const buffer = Buffer.from(response.data);
        if (buffer.length > 4 && buffer.toString('utf8', 0, 4) === '%PDF') {
          logger.info({ endpoint, size: buffer.length }, 'PlugSign: download bem-sucedido');

          reply.header('Content-Type', 'application/pdf');
          reply.header('Content-Disposition', `attachment; filename="termo_encerramento_assinado_${distrato.placa}.pdf"`);

          return reply.send(buffer);
        }

        // Se nao e PDF, pode ser JSON com URL de download
        try {
          const jsonResponse = JSON.parse(buffer.toString());
          const downloadUrl = jsonResponse.url || jsonResponse.download_url || jsonResponse.file_url;
          if (downloadUrl) {
            logger.info({ downloadUrl }, 'PlugSign: encontrou URL de download no JSON');
            downloadEndpoints.push(downloadUrl);
          }
        } catch {
          // Nao e JSON, ignorar
        }

        logger.warn({ endpoint }, 'PlugSign: resposta nao e um PDF valido');
      } catch (error) {
        const axiosError = error as any;
        logger.info({
          endpoint,
          status: axiosError.response?.status,
          message: axiosError.message,
        }, 'PlugSign: endpoint falhou');
      }
    }

    // Se chegou aqui, nenhum endpoint funcionou
    logger.error({
      distratoId: id,
      requestId,
      documentKey,
      endpointsTriados: downloadEndpoints.length,
    }, 'PlugSign: nao foi possivel baixar o documento assinado');

    throw new BadRequestError('Nao foi possivel baixar o documento assinado. Verifique se o documento foi assinado.');
  });
};

export default distratosRoutes;
