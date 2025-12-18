import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import PDFDocument from 'pdfkit';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { BadRequestError, NotFoundError, ForbiddenError, ServiceUnavailableError } from '../utils/errors.js';
import { getContext } from '../utils/context.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { storageService } from '../services/storageService.js';

// Schemas de validacao
const createSecondaryVehicleSchema = z.object({
  motorcycle_id: z.string().uuid('ID da moto invalido'),
  motivo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

// Schema de resposta para Swagger
const secondaryVehicleResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    rental_id: { type: 'string', format: 'uuid' },
    motorcycle_id: { type: 'string', format: 'uuid' },
    start_date: { type: 'string', format: 'date' },
    end_date: { type: 'string', format: 'date', nullable: true },
    status: { type: 'string' },
    motivo: { type: 'string', nullable: true },
    notes: { type: 'string', nullable: true },
    termo_aditivo_url: { type: 'string', nullable: true },
    signature_request_id: { type: 'string', nullable: true },
    document_key: { type: 'string', nullable: true },
    signed_file_url: { type: 'string', nullable: true },
    signed_at: { type: 'string', format: 'date-time', nullable: true },
    termo_status: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    rental: { type: 'object', nullable: true, additionalProperties: true },
    motorcycle: { type: 'object', nullable: true, additionalProperties: true },
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

// Campos obrigatorios para cadastro completo da moto
const CAMPOS_OBRIGATORIOS_MOTO = ['placa', 'modelo', 'marca', 'chassi', 'renavam'];

const rentalSecondaryVehiclesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/rentals/:rentalId/secondary-vehicles
   * Listar veiculos secundarios de uma locacao
   */
  app.get('/:rentalId/secondary-vehicles', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar veiculos secundarios de uma locacao',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'completed', 'cancelled'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: secondaryVehicleResponseSchema },
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
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      throw new BadRequestError(query.error.errors[0].message);
    }

    const { page, limit, status } = query.data;
    const context = getContext(request);

    // Verificar se a locacao existe
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
    });

    if (!rental) {
      throw new NotFoundError('Locacao nao encontrada');
    }

    // Verificar permissao
    if (context.isFranchisee() && rental.franchisee_id !== context.franchiseeId) {
      throw new ForbiddenError('Sem permissao para acessar esta locacao');
    }
    if (context.isRegional() && rental.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para acessar esta locacao');
    }

    const where: any = { rental_id: rentalId };
    if (status) {
      where.status = status;
    }

    const [secondaryVehicles, total] = await Promise.all([
      prisma.rentalSecondaryVehicle.findMany({
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
            },
          },
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      prisma.rentalSecondaryVehicle.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      data: secondaryVehicles,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/rentals/:rentalId/secondary-vehicles/available-motorcycles
   * Listar motos disponiveis para vincular como veiculo secundario
   * Filtra pela cidade da locacao
   */
  app.get('/:rentalId/secondary-vehicles/available-motorcycles', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar motos disponiveis para vincular como veiculo secundario (mesma cidade da locacao)',
      tags: ['Veiculos Secundarios'],
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
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  placa: { type: 'string' },
                  modelo: { type: 'string' },
                  marca: { type: 'string' },
                  ano: { type: 'number', nullable: true },
                  cor: { type: 'string', nullable: true },
                  chassi: { type: 'string', nullable: true },
                  renavam: { type: 'string', nullable: true },
                  status: { type: 'string' },
                  city: { type: 'object', nullable: true, additionalProperties: true },
                  franchisee: { type: 'object', nullable: true, additionalProperties: true },
                },
              },
            },
            rental_city: { type: 'object', nullable: true, additionalProperties: true },
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };
    const context = getContext(request);

    // Buscar a locacao para obter o city_id
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: {
        city: true,
        motorcycle: { select: { id: true } }, // Para excluir a moto principal
      },
    });

    if (!rental) {
      throw new NotFoundError('Locacao nao encontrada');
    }

    if (rental.status !== 'active') {
      throw new BadRequestError('Locacao nao esta ativa');
    }

    // Verificar permissao
    if (context.isFranchisee() && rental.franchisee_id !== context.franchiseeId) {
      throw new ForbiddenError('Sem permissao para acessar esta locacao');
    }
    if (context.isRegional() && rental.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para acessar esta locacao');
    }

    if (!rental.city_id) {
      throw new BadRequestError('Locacao nao possui cidade definida');
    }

    // Buscar motos disponiveis da mesma cidade
    const motorcycles = await prisma.motorcycle.findMany({
      where: {
        city_id: rental.city_id, // Mesma cidade da locacao
        status: 'active', // Apenas motos disponiveis
        id: { not: rental.motorcycle_id }, // Excluir a moto principal da locacao
        // Verificar campos obrigatorios preenchidos
        placa: { not: null },
        modelo: { not: null },
        marca: { not: null },
        chassi: { not: null },
        renavam: { not: null },
      },
      include: {
        city: { select: { id: true, name: true } },
        franchisee: { select: { id: true, fantasy_name: true } },
      },
      orderBy: [
        { marca: 'asc' },
        { modelo: 'asc' },
        { placa: 'asc' },
      ],
    });

    // Filtrar motos com cadastro completo (double-check)
    const motosComCadastroCompleto = motorcycles.filter(moto =>
      moto.placa && moto.modelo && moto.marca && moto.chassi && moto.renavam
    );

    return reply.status(200).send({
      success: true,
      data: motosComCadastroCompleto,
      rental_city: rental.city,
      message: `${motosComCadastroCompleto.length} moto(s) disponivel(is) na cidade ${rental.city?.name || rental.city_id}`,
    });
  });

  /**
   * GET /api/rentals/:rentalId/secondary-vehicles/:id
   * Obter veiculo secundario especifico
   */
  app.get('/:rentalId/secondary-vehicles/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter veiculo secundario por ID',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: secondaryVehicleResponseSchema,
          },
        },
        404: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId, id } = request.params as { rentalId: string; id: string };
    const context = getContext(request);

    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: {
          select: {
            id: true,
            client_name: true,
            client_cpf: true,
            client_email: true,
            client_phone: true,
            motorcycle_plate: true,
            franchisee_id: true,
            city_id: true,
            start_date: true,
            status: true,
          },
        },
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
            quilometragem: true,
          },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    // Verificar permissao
    if (context.isFranchisee() && secondaryVehicle.rental?.franchisee_id !== context.franchiseeId) {
      throw new ForbiddenError('Sem permissao para acessar este veiculo secundario');
    }
    if (context.isRegional() && secondaryVehicle.rental?.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para acessar este veiculo secundario');
    }

    return reply.status(200).send({
      success: true,
      data: secondaryVehicle,
    });
  });

  /**
   * POST /api/rentals/:rentalId/secondary-vehicles
   * Vincular veiculo secundario a uma locacao
   */
  app.post('/:rentalId/secondary-vehicles', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Vincular veiculo secundario a uma locacao ativa',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['motorcycle_id'],
        properties: {
          motorcycle_id: { type: 'string', format: 'uuid' },
          motivo: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: secondaryVehicleResponseSchema,
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };
    const body = createSecondaryVehicleSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { motorcycle_id, motivo, notes } = body.data;
    const context = getContext(request);

    // 1. Verificar se locacao existe e esta ativa
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: {
        city: { select: { id: true, name: true } },
        franchisee: { select: { id: true, fantasy_name: true } },
      },
    });

    if (!rental) {
      throw new NotFoundError('Locacao nao encontrada');
    }

    if (rental.status !== 'active') {
      throw new BadRequestError(`Locacao nao esta ativa. Status atual: ${rental.status}`);
    }

    // Verificar permissao
    if (context.isFranchisee() && rental.franchisee_id !== context.franchiseeId) {
      throw new ForbiddenError('Sem permissao para modificar esta locacao');
    }
    if (context.isRegional() && rental.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para modificar esta locacao');
    }

    // 2. Verificar se moto existe
    const motorcycle = await prisma.motorcycle.findUnique({
      where: { id: motorcycle_id },
      include: {
        city: { select: { id: true, name: true } },
      },
    });

    if (!motorcycle) {
      throw new NotFoundError('Motocicleta nao encontrada');
    }

    // 3. Verificar se moto esta disponivel
    if (motorcycle.status !== 'active') {
      throw new BadRequestError(`Motocicleta nao disponivel. Status atual: ${motorcycle.status}`);
    }

    // 4. Verificar se moto e da mesma cidade
    if (motorcycle.city_id !== rental.city_id) {
      throw new BadRequestError(
        `Motocicleta deve ser da mesma cidade da locacao. ` +
        `Cidade da locacao: ${rental.city?.name || rental.city_id}. ` +
        `Cidade da moto: ${motorcycle.city?.name || motorcycle.city_id}.`
      );
    }

    // 5. Verificar cadastro completo
    for (const campo of CAMPOS_OBRIGATORIOS_MOTO) {
      if (!motorcycle[campo as keyof typeof motorcycle]) {
        throw new BadRequestError(`Cadastro da moto incompleto: campo '${campo}' e obrigatorio`);
      }
    }

    // 6. Verificar se ja existe veiculo secundario ativo nesta locacao (apenas 1 permitido)
    const existingActive = await prisma.rentalSecondaryVehicle.findFirst({
      where: { rental_id: rentalId, status: 'active' },
    });

    if (existingActive) {
      throw new BadRequestError(
        'Ja existe um veiculo secundario ativo nesta locacao. Finalize-o antes de vincular outro.'
      );
    }

    // 7. Verificar se esta moto ja nao esta vinculada a esta locacao
    const existingMoto = await prisma.rentalSecondaryVehicle.findFirst({
      where: { rental_id: rentalId, motorcycle_id, status: 'active' },
    });

    if (existingMoto) {
      throw new BadRequestError('Esta moto ja esta vinculada a esta locacao');
    }

    // Criar em transacao
    const result = await prisma.$transaction(async (tx) => {
      // 1. Criar registro do veiculo secundario
      const secondary = await tx.rentalSecondaryVehicle.create({
        data: {
          rental_id: rentalId,
          motorcycle_id,
          start_date: new Date(),
          motivo,
          notes,
          status: 'active',
          termo_status: 'draft',
          created_by: context.userId,
        },
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
            },
          },
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // 2. Atualizar status da moto para 'alugada'
      await tx.motorcycle.update({
        where: { id: motorcycle_id },
        data: {
          status: 'alugada',
          data_ultima_mov: new Date(),
        },
      });

      return secondary;
    });

    logger.info({
      rentalId,
      secondaryVehicleId: result.id,
      motorcycleId: motorcycle_id,
      placa: motorcycle.placa,
    }, 'Veiculo secundario vinculado com sucesso');

    return reply.status(201).send({
      success: true,
      data: result,
      message: `Veiculo ${motorcycle.placa} vinculado com sucesso. Gere o termo aditivo e envie para assinatura.`,
    });
  });

  /**
   * POST /api/rentals/:rentalId/secondary-vehicles/:id/complete
   * Finalizar uso do veiculo secundario
   */
  app.post('/:rentalId/secondary-vehicles/:id/complete', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Finalizar uso do veiculo secundario e liberar a moto',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          notes: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: secondaryVehicleResponseSchema,
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId, id } = request.params as { rentalId: string; id: string };
    const { notes } = (request.body as { notes?: string }) || {};
    const context = getContext(request);

    // Buscar veiculo secundario
    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: true,
        motorcycle: true,
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    if (secondaryVehicle.status !== 'active') {
      throw new BadRequestError(`Veiculo secundario nao esta ativo. Status atual: ${secondaryVehicle.status}`);
    }

    // Verificar permissao
    if (context.isFranchisee() && secondaryVehicle.rental?.franchisee_id !== context.franchiseeId) {
      throw new ForbiddenError('Sem permissao para modificar este veiculo secundario');
    }
    if (context.isRegional() && secondaryVehicle.rental?.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para modificar este veiculo secundario');
    }

    // Finalizar em transacao
    const result = await prisma.$transaction(async (tx) => {
      // 1. Atualizar registro do veiculo secundario
      const updated = await tx.rentalSecondaryVehicle.update({
        where: { id },
        data: {
          status: 'completed',
          end_date: new Date(),
          notes: notes || secondaryVehicle.notes,
        },
        include: {
          motorcycle: {
            select: {
              id: true,
              placa: true,
              modelo: true,
              marca: true,
            },
          },
        },
      });

      // 2. Liberar a moto (voltar para 'active')
      await tx.motorcycle.update({
        where: { id: secondaryVehicle.motorcycle_id },
        data: {
          status: 'active',
          data_ultima_mov: new Date(),
        },
      });

      return updated;
    });

    logger.info({
      rentalId,
      secondaryVehicleId: id,
      motorcycleId: secondaryVehicle.motorcycle_id,
      placa: secondaryVehicle.motorcycle?.placa,
    }, 'Veiculo secundario finalizado com sucesso');

    return reply.status(200).send({
      success: true,
      data: result,
      message: `Veiculo ${secondaryVehicle.motorcycle?.placa} desvinculado e liberado com sucesso.`,
    });
  });

  /**
   * POST /api/rentals/:rentalId/secondary-vehicles/:id/cancel
   * Cancelar veiculo secundario
   */
  app.post('/:rentalId/secondary-vehicles/:id/cancel', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br', 'regional'] })],
    schema: {
      description: 'Cancelar veiculo secundario e liberar a moto',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: secondaryVehicleResponseSchema,
            message: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId, id } = request.params as { rentalId: string; id: string };
    const { reason } = (request.body as { reason?: string }) || {};
    const context = getContext(request);

    // Buscar veiculo secundario
    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: true,
        motorcycle: true,
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    if (secondaryVehicle.status !== 'active') {
      throw new BadRequestError(`Veiculo secundario nao esta ativo. Status atual: ${secondaryVehicle.status}`);
    }

    // Regional so pode cancelar da sua cidade
    if (context.isRegional() && secondaryVehicle.rental?.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para cancelar este veiculo secundario');
    }

    // Cancelar em transacao
    const result = await prisma.$transaction(async (tx) => {
      // 1. Atualizar registro do veiculo secundario
      const updated = await tx.rentalSecondaryVehicle.update({
        where: { id },
        data: {
          status: 'cancelled',
          end_date: new Date(),
          notes: reason ? `CANCELADO: ${reason}` : 'CANCELADO',
        },
        include: {
          motorcycle: {
            select: {
              id: true,
              placa: true,
              modelo: true,
              marca: true,
            },
          },
        },
      });

      // 2. Liberar a moto (voltar para 'active')
      await tx.motorcycle.update({
        where: { id: secondaryVehicle.motorcycle_id },
        data: {
          status: 'active',
          data_ultima_mov: new Date(),
        },
      });

      return updated;
    });

    logger.info({
      rentalId,
      secondaryVehicleId: id,
      motorcycleId: secondaryVehicle.motorcycle_id,
      placa: secondaryVehicle.motorcycle?.placa,
      reason,
    }, 'Veiculo secundario cancelado');

    return reply.status(200).send({
      success: true,
      data: result,
      message: `Veiculo ${secondaryVehicle.motorcycle?.placa} cancelado e liberado.`,
    });
  });

  /**
   * GET /api/rentals/:rentalId/secondary-vehicles/:id/view-term
   * Visualizar dados do termo aditivo
   */
  app.get('/:rentalId/secondary-vehicles/:id/view-term', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Visualizar dados do termo aditivo para geracao de PDF',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
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
                termo: { type: 'object', additionalProperties: true },
                secondaryVehicle: secondaryVehicleResponseSchema,
                rental: { type: 'object', additionalProperties: true },
                motorcycle: { type: 'object', additionalProperties: true },
                primaryMotorcycle: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
        404: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId, id } = request.params as { rentalId: string; id: string };

    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: {
          include: {
            motorcycle: true,
            franchisee: true,
            city: true,
          },
        },
        motorcycle: true,
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    // Funcao para formatar data no padrao brasileiro
    const formatDateBR = (date: Date | null | undefined): string => {
      if (!date) return '___/___/______';
      return new Intl.DateTimeFormat('pt-BR').format(new Date(date));
    };

    // Funcao para formatar CPF
    const formatCPF = (cpf: string | null | undefined): string => {
      if (!cpf) return '___.___.___-__';
      const cleaned = cpf.replace(/\D/g, '');
      if (cleaned.length !== 11) return cpf;
      return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`;
    };

    // Funcao para formatar CNPJ
    const formatCNPJ = (cnpj: string | null | undefined): string => {
      if (!cnpj) return '__.___.___/____-__';
      const cleaned = cnpj.replace(/\D/g, '');
      if (cleaned.length !== 14) return cnpj;
      return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 5)}.${cleaned.slice(5, 8)}/${cleaned.slice(8, 12)}-${cleaned.slice(12)}`;
    };

    // Dados do franqueado (locador)
    const locadorNome = secondaryVehicle.rental?.franchisee?.fantasy_name || secondaryVehicle.rental?.franchisee?.company_name || '___________________________________';
    const locadorCNPJ = formatCNPJ(secondaryVehicle.rental?.franchisee?.cnpj);
    const locadorEndereco = secondaryVehicle.rental?.franchisee?.endereco || '___________________________________';
    const locadorBairro = '_______________'; // Campo nao existe no model
    const locadorCidade = secondaryVehicle.rental?.city?.name || '_______________';
    const locadorEstado = '__'; // Campo nao existe no model
    const locadorCEP = '_________'; // Campo nao existe no model

    // Dados do cliente (locatario)
    const locatarioNome = secondaryVehicle.rental?.client_name || '___________________________________';
    const locatarioCPF = formatCPF(secondaryVehicle.rental?.client_cpf);
    const locatarioCNH = secondaryVehicle.rental?.driver_cnh || '___________'; // Usando driver_cnh pois client_cnh nao existe
    const locatarioEndereco = secondaryVehicle.rental?.client_address || '___________________________________';

    // Data do contrato original
    const dataContratoOriginal = formatDateBR(secondaryVehicle.rental?.start_date);

    // Veiculo principal (original)
    const veiculoPrincipalMarcaModelo = `${secondaryVehicle.rental?.motorcycle?.marca || ''}/${secondaryVehicle.rental?.motorcycle?.modelo || ''}`.trim() || '________________________';
    const veiculoPrincipalPlaca = secondaryVehicle.rental?.motorcycle?.placa || '_________';

    // Veiculo secundario (reserva)
    const veiculoSecundarioMarcaModelo = `${secondaryVehicle.motorcycle?.marca || ''}/${secondaryVehicle.motorcycle?.modelo || ''}`.trim() || '________________________';
    const veiculoSecundarioAno = secondaryVehicle.motorcycle?.ano || '____';
    const veiculoSecundarioPlaca = secondaryVehicle.motorcycle?.placa || '_________';

    // Data atual formatada
    const dataAtual = formatDateBR(new Date());

    // Gerar texto completo do termo aditivo
    const termoTexto = `TERMO ADITIVO AO CONTRATO DE LOCAÇÃO DE VEÍCULOS

1° TERMO ADITIVO AO INSTRUMENTO PARTICULAR DE LOCAÇÃO DE VEÍCULOS

DAS PARTES

${locadorNome}, pessoa jurídica inscrita no CNPJ nº ${locadorCNPJ}, com endereço à ${locadorEndereco}. Bairro: ${locadorBairro}, ${locadorCidade} - ${locadorEstado}. CEP ${locadorCEP}, neste ato representado nos termos de seus atos constitutivos, doravante denominada simplesmente como LOCADORA, e,

${locatarioNome}, brasileiro, inscrito no CPF de n° ${locatarioCPF}, portador da CNH de nº ${locatarioCNH}, residente e domiciliado ${locatarioEndereco}, doravante denominado LOCATÁRIO.

CONSIDERANDO QUE, o LOCADOR firmou CONTRATO DE PARTICULAR DE LOCAÇÃO DE VEÍCULOS em ${dataContratoOriginal}, junto LOCADORA, locando a motocicleta de marca/modelo ${veiculoPrincipalMarcaModelo}, placa ${veiculoPrincipalPlaca}.

CONSIDERANDO QUE, a motocicleta locada precisou passar por reparos por períodos mais extensos que o previsto, impossibilitando seu uso regular pelo LOCATÁRIO

CONSIDERANDO QUE, a LOCADORA possui interesse em manter a satisfação do LOCATÁRIO, disponibilizando uma alternativa para que o mesmo não seja prejudicado durante o período de manutenção da motocicleta originalmente locada;

CONSIDERANDO a necessidade de formalizar os termos e condições para a substituição temporária da motocicleta locada por uma motocicleta reserva, as partes resolvem, de comum acordo, celebrar o presente Termo Aditivo, que se regerá pelas seguintes cláusulas e condições:

CLÁUSULA PRIMEIRA – DA DISPONIBILIZAÇÃO DA MOTOCICLETA RESERVA

1.1. O presente Termo Aditivo tem por objeto principal regulamentar a substituição da motocicleta ${veiculoPrincipalMarcaModelo}, placa ${veiculoPrincipalPlaca}, objeto do Contrato de Locação originário, por uma motocicleta reserva, considerando a necessidade de serviços de manutenção corretiva que demandará um período maior que o habitual para sua conclusão, garantindo a continuidade da mobilidade do LOCATÁRIO durante o período em que a Motocicleta Original estiver indisponível.

1.2. Acordam as partes que, em substituição reserva da motocicleta original do contrato, fica disponibilizada ao LOCATÁRIO a motocicleta ${veiculoSecundarioMarcaModelo}, ano ${veiculoSecundarioAno}, placa ${veiculoSecundarioPlaca}, de modelo e características similares ou equivalentes à Motocicleta Original, pelo período em que a motocicleta original do contrato de locação encontrar-se em manutenção.

1.3 – Durante o período em que estiver na posse da motocicleta reserva, o LOCATÁRIO será responsável por sua guarda e conservação, utilizando-a com a mesma diligência e cuidado exigidos para a Motocicleta Original, conforme estipulado no Contrato Original.

1.4 - Todas as obrigações, responsabilidades e penalidades previstas no Contrato Original relativas ao uso, conservação, multas de trânsito, danos, roubo, furto, colisão e outras ocorrências aplicam-se integralmente à motocicleta reserva enquanto estiver sob a posse do LOCATÁRIO.

CLÁUSULA SEGUNDA – DA DEVOLUÇÃO DA MOTOCICLETA RESERVA

2.1. A LOCADORA comunicará ao LOCATÁRIO, com antecedência razoável, a data em que a Motocicleta Original estará reparada e disponível para retirada. Após a referida comunicação, o LOCATÁRIO deverá devolver a motocicleta reserva à LOCADORA no prazo máximo de 24 (vinte e quatro) horas, no mesmo local onde a retirou ou em outro local designado pela LOCADORA, nas mesmas condições de conservação em que a recebeu, ressalvado o desgaste natural decorrente do uso normal.

2.2. Caso o LOCATÁRIO não devolva a motocicleta reserva no prazo estipulado, ficará sujeito ao pagamento de diárias adicionais, calculadas com base no valor de locação da motocicleta reserva ou da Motocicleta Original (o que for maior), além das penalidades contratuais cabíveis, sem prejuízo de eventuais perdas e danos.

O presente termo é incluso ao contrato originário, permanecendo as demais cláusulas inalteradas e, neste ato, RATIFICADAS.

E por estarem assim justos e contratados, firmam o termo, em duas vias de igual teor e forma, para que produza todos os seus efeitos legais.

${locadorCidade}/${locadorEstado}, ${dataAtual}.


___________________________________
LOCADORA
CNPJ: ${locadorCNPJ}


___________________________________
LOCATÁRIO
CPF: ${locatarioCPF}


___________________________________
Testemunha:
CPF:


___________________________________
Testemunha:
CPF:`;

    // Formatar dados do termo aditivo
    const termo = {
      titulo: 'TERMO ADITIVO DE CONTRATO DE LOCACAO',
      subtitulo: 'ADICAO DE VEICULO SECUNDARIO',
      texto: termoTexto,
      // Dados da locacao original
      locacao_id: secondaryVehicle.rental?.id,
      data_inicio_locacao: secondaryVehicle.rental?.start_date?.toISOString().split('T')[0],
      valor_diaria: Number(secondaryVehicle.rental?.daily_rate),
      // Dados do cliente (locatario)
      cliente_nome: locatarioNome,
      cliente_cpf: locatarioCPF,
      cliente_cnh: locatarioCNH,
      cliente_email: secondaryVehicle.rental?.client_email,
      cliente_telefone: secondaryVehicle.rental?.client_phone,
      cliente_endereco: locatarioEndereco,
      // Dados do franqueado (locador)
      locador_nome: locadorNome,
      locador_cnpj: locadorCNPJ,
      locador_endereco: locadorEndereco,
      locador_bairro: locadorBairro,
      locador_cidade: locadorCidade,
      locador_estado: locadorEstado,
      locador_cep: locadorCEP,
      // Veiculo principal
      veiculo_principal_placa: veiculoPrincipalPlaca,
      veiculo_principal_marca_modelo: veiculoPrincipalMarcaModelo,
      veiculo_principal_ano: secondaryVehicle.rental?.motorcycle?.ano,
      veiculo_principal_cor: secondaryVehicle.rental?.motorcycle?.cor,
      veiculo_principal_chassi: secondaryVehicle.rental?.motorcycle?.chassi,
      veiculo_principal_renavam: secondaryVehicle.rental?.motorcycle?.renavam,
      // Veiculo secundario (adicionado)
      veiculo_secundario_placa: veiculoSecundarioPlaca,
      veiculo_secundario_marca_modelo: veiculoSecundarioMarcaModelo,
      veiculo_secundario_ano: veiculoSecundarioAno,
      veiculo_secundario_cor: secondaryVehicle.motorcycle?.cor,
      veiculo_secundario_chassi: secondaryVehicle.motorcycle?.chassi,
      veiculo_secundario_renavam: secondaryVehicle.motorcycle?.renavam,
      // Dados do aditivo
      data_vinculacao: formatDateBR(secondaryVehicle.start_date),
      data_atual: dataAtual,
      motivo_adicao: secondaryVehicle.motivo,
      observacoes: secondaryVehicle.notes,
      // Metadados
      data_geracao: new Date().toISOString(),
      termo_aditivo_url: secondaryVehicle.termo_aditivo_url,
      status_assinatura: secondaryVehicle.termo_status,
    };

    return reply.status(200).send({
      success: true,
      data: {
        termo,
        secondaryVehicle,
        rental: secondaryVehicle.rental,
        motorcycle: secondaryVehicle.motorcycle,
        primaryMotorcycle: secondaryVehicle.rental?.motorcycle,
      },
    });
  });

  /**
   * POST /api/rentals/:rentalId/secondary-vehicles/:id/generate-pdf
   * Gerar PDF do termo aditivo
   */
  app.post('/:rentalId/secondary-vehicles/:id/generate-pdf', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Gerar PDF do termo aditivo e salvar no storage',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
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
                termo_aditivo_url: { type: 'string' },
                secondaryVehicle: secondaryVehicleResponseSchema,
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
    const { rentalId, id } = request.params as { rentalId: string; id: string };
    const context = getContext(request);

    // Buscar veiculo secundario com todos os dados necessarios
    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: {
          include: {
            motorcycle: true,
            franchisee: true,
            city: true,
          },
        },
        motorcycle: true,
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    // Verificar permissao
    if (context.isFranchisee() && secondaryVehicle.rental?.franchisee_id !== context.franchiseeId) {
      throw new ForbiddenError('Sem permissao para gerar PDF deste veiculo secundario');
    }
    if (context.isRegional() && secondaryVehicle.rental?.city_id !== context.cityId) {
      throw new ForbiddenError('Sem permissao para gerar PDF deste veiculo secundario');
    }

    // Funcoes de formatacao
    const formatDateBR = (date: Date | null | undefined): string => {
      if (!date) return '___/___/______';
      return new Intl.DateTimeFormat('pt-BR').format(new Date(date));
    };

    const formatCPF = (cpf: string | null | undefined): string => {
      if (!cpf) return '___.___.___-__';
      const cleaned = cpf.replace(/\D/g, '');
      if (cleaned.length !== 11) return cpf;
      return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`;
    };

    const formatCNPJ = (cnpj: string | null | undefined): string => {
      if (!cnpj) return '__.___.___/____-__';
      const cleaned = cnpj.replace(/\D/g, '');
      if (cleaned.length !== 14) return cnpj;
      return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 5)}.${cleaned.slice(5, 8)}/${cleaned.slice(8, 12)}-${cleaned.slice(12)}`;
    };

    // Dados do franqueado (locador)
    const locadorNome = secondaryVehicle.rental?.franchisee?.fantasy_name || secondaryVehicle.rental?.franchisee?.company_name || '___________________________________';
    const locadorCNPJ = formatCNPJ(secondaryVehicle.rental?.franchisee?.cnpj);
    const locadorEndereco = secondaryVehicle.rental?.franchisee?.endereco || '___________________________________';
    const locadorCidade = secondaryVehicle.rental?.city?.name || '_______________';

    // Buscar dados completos do cliente na tabela clients (para obter CNH e endereço)
    let clientData: {
      cnh_number?: string | null;
      address?: string | null;
      number?: string | null;
      city?: string | null;
      state?: string | null;
      zip_code?: string | null;
    } | null = null;
    if (secondaryVehicle.rental?.client_cpf) {
      // Limpar CPF para busca (remover formatação)
      const cpfLimpo = secondaryVehicle.rental.client_cpf.replace(/\D/g, '');
      const cpfFormatado = secondaryVehicle.rental.client_cpf;

      // Buscar pelo CPF (com ou sem formatação)
      clientData = await prisma.client.findFirst({
        where: {
          OR: [
            { cpf: cpfLimpo },
            { cpf: cpfFormatado },
            { cpf: { contains: cpfLimpo } },
          ],
        },
        select: {
          cnh_number: true,
          address: true,
          number: true,
          city: true,
          state: true,
          zip_code: true,
        },
      });
    }

    // Montar endereço completo do cliente
    const buildClientAddress = (): string => {
      // Primeiro tenta do rental (campos client_address_*)
      const rentalAddress = secondaryVehicle.rental as any;
      if (rentalAddress?.client_address_street) {
        const parts = [
          rentalAddress.client_address_street,
          rentalAddress.client_address_number && `nº ${rentalAddress.client_address_number}`,
          rentalAddress.client_address_city,
          rentalAddress.client_address_state,
        ].filter(Boolean);
        if (parts.length > 0) return parts.join(', ');
      }

      // Depois tenta da tabela clients
      if (clientData?.address) {
        const parts = [
          clientData.address,
          clientData.number && `nº ${clientData.number}`,
          clientData.city,
          clientData.state,
        ].filter(Boolean);
        if (parts.length > 0) return parts.join(', ');
      }

      return '___________________________________';
    };

    // Dados do cliente (locatario)
    const locatarioNome = secondaryVehicle.rental?.client_name || '___________________________________';
    const locatarioCPF = formatCPF(secondaryVehicle.rental?.client_cpf);
    // Prioridade: CNH do cliente PF (tabela clients) > CNH do motorista PJ (driver_cnh)
    const locatarioCNH = clientData?.cnh_number || secondaryVehicle.rental?.driver_cnh || '___________';
    const locatarioEndereco = buildClientAddress();

    // Data do contrato original
    const dataContratoOriginal = formatDateBR(secondaryVehicle.rental?.start_date);

    // Veiculo principal (original)
    const veiculoPrincipalMarcaModelo = `${secondaryVehicle.rental?.motorcycle?.marca || ''}/${secondaryVehicle.rental?.motorcycle?.modelo || ''}`.trim() || '________________________';
    const veiculoPrincipalPlaca = secondaryVehicle.rental?.motorcycle?.placa || '_________';

    // Veiculo secundario (reserva)
    const veiculoSecundarioMarcaModelo = `${secondaryVehicle.motorcycle?.marca || ''}/${secondaryVehicle.motorcycle?.modelo || ''}`.trim() || '________________________';
    const veiculoSecundarioAno = secondaryVehicle.motorcycle?.ano || '____';
    const veiculoSecundarioPlaca = secondaryVehicle.motorcycle?.placa || '_________';

    // Data atual formatada
    const dataAtual = formatDateBR(new Date());

    // Criar PDF
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    // Buffer para armazenar o PDF
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    // Promise para aguardar finalizacao do PDF
    const pdfPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Titulo
    doc.fontSize(14).font('Helvetica-Bold').text('TERMO ADITIVO AO CONTRATO DE LOCAÇÃO DE VEÍCULOS', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).text('1° TERMO ADITIVO AO INSTRUMENTO PARTICULAR DE LOCAÇÃO DE VEÍCULOS', { align: 'center' });
    doc.moveDown(1.5);

    // DAS PARTES
    doc.fontSize(11).font('Helvetica-Bold').text('DAS PARTES');
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(10);
    doc.text(`${locadorNome}, pessoa jurídica inscrita no CNPJ nº ${locadorCNPJ}, com endereço à ${locadorEndereco}, ${locadorCidade}, neste ato representado nos termos de seus atos constitutivos, doravante denominada simplesmente como LOCADORA, e,`, { align: 'justify' });
    doc.moveDown(0.5);

    doc.text(`${locatarioNome}, brasileiro, inscrito no CPF de n° ${locatarioCPF}, portador da CNH de nº ${locatarioCNH}, residente e domiciliado ${locatarioEndereco}, doravante denominado LOCATÁRIO.`, { align: 'justify' });
    doc.moveDown(1);

    // CONSIDERANDOS
    doc.text(`CONSIDERANDO QUE, o LOCADOR firmou CONTRATO DE PARTICULAR DE LOCAÇÃO DE VEÍCULOS em ${dataContratoOriginal}, junto LOCADORA, locando a motocicleta de marca/modelo ${veiculoPrincipalMarcaModelo}, placa ${veiculoPrincipalPlaca}.`, { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('CONSIDERANDO QUE, a motocicleta locada precisou passar por reparos por períodos mais extensos que o previsto, impossibilitando seu uso regular pelo LOCATÁRIO.', { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('CONSIDERANDO QUE, a LOCADORA possui interesse em manter a satisfação do LOCATÁRIO, disponibilizando uma alternativa para que o mesmo não seja prejudicado durante o período de manutenção da motocicleta originalmente locada;', { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('CONSIDERANDO a necessidade de formalizar os termos e condições para a substituição temporária da motocicleta locada por uma motocicleta reserva, as partes resolvem, de comum acordo, celebrar o presente Termo Aditivo, que se regerá pelas seguintes cláusulas e condições:', { align: 'justify' });
    doc.moveDown(1);

    // CLAUSULA PRIMEIRA
    doc.font('Helvetica-Bold').text('CLÁUSULA PRIMEIRA – DA DISPONIBILIZAÇÃO DA MOTOCICLETA RESERVA');
    doc.moveDown(0.5);

    doc.font('Helvetica');
    doc.text(`1.1. O presente Termo Aditivo tem por objeto principal regulamentar a substituição da motocicleta ${veiculoPrincipalMarcaModelo}, placa ${veiculoPrincipalPlaca}, objeto do Contrato de Locação originário, por uma motocicleta reserva, considerando a necessidade de serviços de manutenção corretiva que demandará um período maior que o habitual para sua conclusão, garantindo a continuidade da mobilidade do LOCATÁRIO durante o período em que a Motocicleta Original estiver indisponível.`, { align: 'justify' });
    doc.moveDown(0.5);

    doc.text(`1.2. Acordam as partes que, em substituição reserva da motocicleta original do contrato, fica disponibilizada ao LOCATÁRIO a motocicleta ${veiculoSecundarioMarcaModelo}, ano ${veiculoSecundarioAno}, placa ${veiculoSecundarioPlaca}, de modelo e características similares ou equivalentes à Motocicleta Original, pelo período em que a motocicleta original do contrato de locação encontrar-se em manutenção.`, { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('1.3 – Durante o período em que estiver na posse da motocicleta reserva, o LOCATÁRIO será responsável por sua guarda e conservação, utilizando-a com a mesma diligência e cuidado exigidos para a Motocicleta Original, conforme estipulado no Contrato Original.', { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('1.4 - Todas as obrigações, responsabilidades e penalidades previstas no Contrato Original relativas ao uso, conservação, multas de trânsito, danos, roubo, furto, colisão e outras ocorrências aplicam-se integralmente à motocicleta reserva enquanto estiver sob a posse do LOCATÁRIO.', { align: 'justify' });
    doc.moveDown(1);

    // CLAUSULA SEGUNDA
    doc.font('Helvetica-Bold').text('CLÁUSULA SEGUNDA – DA DEVOLUÇÃO DA MOTOCICLETA RESERVA');
    doc.moveDown(0.5);

    doc.font('Helvetica');
    doc.text('2.1. A LOCADORA comunicará ao LOCATÁRIO, com antecedência razoável, a data em que a Motocicleta Original estará reparada e disponível para retirada. Após a referida comunicação, o LOCATÁRIO deverá devolver a motocicleta reserva à LOCADORA no prazo máximo de 24 (vinte e quatro) horas, no mesmo local onde a retirou ou em outro local designado pela LOCADORA, nas mesmas condições de conservação em que a recebeu, ressalvado o desgaste natural decorrente do uso normal.', { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('2.2. Caso o LOCATÁRIO não devolva a motocicleta reserva no prazo estipulado, ficará sujeito ao pagamento de diárias adicionais, calculadas com base no valor de locação da motocicleta reserva ou da Motocicleta Original (o que for maior), além das penalidades contratuais cabíveis, sem prejuízo de eventuais perdas e danos.', { align: 'justify' });
    doc.moveDown(1);

    // ENCERRAMENTO
    doc.text('O presente termo é incluso ao contrato originário, permanecendo as demais cláusulas inalteradas e, neste ato, RATIFICADAS.', { align: 'justify' });
    doc.moveDown(0.5);

    doc.text('E por estarem assim justos e contratados, firmam o termo, em duas vias de igual teor e forma, para que produza todos os seus efeitos legais.', { align: 'justify' });
    doc.moveDown(1);

    // Local e data
    doc.text(`${locadorCidade}, ${dataAtual}.`, { align: 'right' });
    doc.moveDown(2);

    // Assinaturas
    doc.text('___________________________________', { align: 'center' });
    doc.text('LOCADORA', { align: 'center' });
    doc.text(`CNPJ: ${locadorCNPJ}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.text('___________________________________', { align: 'center' });
    doc.text('LOCATÁRIO', { align: 'center' });
    doc.text(`CPF: ${locatarioCPF}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.text('___________________________________', { align: 'center' });
    doc.text('Testemunha:', { align: 'center' });
    doc.text('CPF:', { align: 'center' });
    doc.moveDown(1.5);

    doc.text('___________________________________', { align: 'center' });
    doc.text('Testemunha:', { align: 'center' });
    doc.text('CPF:', { align: 'center' });

    // Finalizar documento
    doc.end();

    // Aguardar finalizacao do PDF
    const pdfBuffer = await pdfPromise;

    // Upload para storage
    const filename = `termo_aditivo_${secondaryVehicle.motorcycle?.placa || id}_${Date.now()}.pdf`;

    const uploadResult = await storageService.upload(
      pdfBuffer,
      'contratos',
      filename,
      'application/pdf'
    );

    // Atualizar registro com a URL do PDF
    const updated = await prisma.rentalSecondaryVehicle.update({
      where: { id },
      data: { termo_aditivo_url: uploadResult.url },
      include: {
        motorcycle: {
          select: {
            id: true,
            placa: true,
            modelo: true,
            marca: true,
          },
        },
      },
    });

    logger.info({
      rentalId,
      secondaryVehicleId: id,
      pdfUrl: uploadResult.url,
    }, 'PDF do termo aditivo gerado com sucesso');

    return reply.status(200).send({
      success: true,
      data: {
        termo_aditivo_url: uploadResult.url,
        secondaryVehicle: updated,
      },
      message: 'PDF do termo aditivo gerado com sucesso',
    });
  });

  /**
   * PUT /api/rentals/:rentalId/secondary-vehicles/:id/termo-url
   * Atualizar URL do termo aditivo
   */
  app.put('/:rentalId/secondary-vehicles/:id/termo-url', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar URL do termo aditivo gerado',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['termo_aditivo_url'],
        properties: {
          termo_aditivo_url: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: secondaryVehicleResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { rentalId, id } = request.params as { rentalId: string; id: string };
    const { termo_aditivo_url } = request.body as { termo_aditivo_url: string };

    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    const updated = await prisma.rentalSecondaryVehicle.update({
      where: { id },
      data: { termo_aditivo_url },
      include: {
        motorcycle: {
          select: {
            id: true,
            placa: true,
            modelo: true,
            marca: true,
          },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: updated,
    });
  });

  /**
   * POST /api/rentals/:rentalId/secondary-vehicles/:id/send-for-signature
   * Enviar termo aditivo para assinatura via PlugSign
   */
  app.post('/:rentalId/secondary-vehicles/:id/send-for-signature', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Enviar termo aditivo para assinatura via PlugSign (Cliente + Franqueado)',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
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
                secondaryVehicle: secondaryVehicleResponseSchema,
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
    const { rentalId, id } = request.params as { rentalId: string; id: string };
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

    const user = request.user;

    // Buscar veiculo secundario
    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: {
          include: {
            franchisee: true,
            city: true,
          },
        },
        motorcycle: true,
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    // Verificar se tem PDF gerado
    const pdfUrl = secondaryVehicle.termo_aditivo_url;
    if (!pdfUrl) {
      throw new BadRequestError('O termo aditivo precisa ter um PDF gerado antes de enviar para assinatura');
    }

    // Verificar se ja foi enviado para assinatura
    if (secondaryVehicle.signature_request_id) {
      throw new BadRequestError('Este termo aditivo ja foi enviado para assinatura. ID: ' + secondaryVehicle.signature_request_id);
    }

    // Buscar token do PlugSign
    let apiToken: string | null = null;

    if (env.PLUGSIGN_API_KEY && env.PLUGSIGN_API_KEY.length >= 50) {
      apiToken = env.PLUGSIGN_API_KEY;
      logger.info('PlugSign (Termo Aditivo): usando token do .env');
    }

    if (!apiToken && secondaryVehicle.rental?.city_id) {
      const city = await prisma.city.findUnique({
        where: { id: secondaryVehicle.rental.city_id },
        select: { plugsign_token: true, name: true },
      });

      if (city?.plugsign_token && city.plugsign_token.length >= 50) {
        apiToken = city.plugsign_token;
        logger.info({ cidade: city.name }, 'PlugSign (Termo Aditivo): usando token da cidade');
      }
    }

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
          logger.info({ cidade: userCity.name }, 'PlugSign (Termo Aditivo): usando token da cidade do usuario');
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
      logger.info({ pdfUrl }, 'Baixando PDF do termo aditivo');

      const pdfResponse = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const pdfBase64 = Buffer.from(pdfResponse.data).toString('base64');

      // Preparar payload para o PlugSign
      const filename = `termo_aditivo_${secondaryVehicle.motorcycle?.placa || id}.pdf`;
      const plugSignPayload: Record<string, any> = {
        file: `data:application/pdf;name=${filename};base64,${pdfBase64}`,
        name: `Termo Aditivo - ${secondaryVehicle.motorcycle?.placa || 'Veiculo Secundario'}`,
        email: signers.map(s => s.email),
        message: message || `Por favor, assine o Termo Aditivo de adicao de veiculo secundario (${secondaryVehicle.motorcycle?.placa}) a locacao.`,
      };

      if (deadline_at) {
        plugSignPayload.deadline_at = deadline_at;
      }

      logger.info({ id, signersCount: signers.length }, 'Enviando termo aditivo para PlugSign');

      const baseUrl = env.PLUGSIGN_API_URL!.endsWith('/api')
        ? env.PLUGSIGN_API_URL
        : `${env.PLUGSIGN_API_URL}/api`;
      const uploadUrl = `${baseUrl}/files/upload/requests`;

      const response = await axios.post(
        uploadUrl,
        plugSignPayload,
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          timeout: 60000,
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

      // Atualizar o veiculo secundario com os IDs do PlugSign
      const updatedSecondaryVehicle = await prisma.rentalSecondaryVehicle.update({
        where: { id },
        data: {
          signature_request_id: signatureRequestIdStr,
          document_key: documentKeyStr,
          termo_status: 'pending_signature',
        },
        include: {
          motorcycle: {
            select: {
              id: true,
              placa: true,
              modelo: true,
              marca: true,
            },
          },
        },
      });

      logger.info({
        id,
        signatureRequestId: signatureRequestIdStr,
      }, 'Termo aditivo enviado para assinatura com sucesso');

      return reply.status(200).send({
        success: true,
        data: {
          secondaryVehicle: updatedSecondaryVehicle,
          signature_request_id: signatureRequestIdStr,
          plugsign_response: plugSignResponse,
        },
        message: 'Termo aditivo enviado para assinatura com sucesso',
      });
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        logger.error({
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        }, 'Erro ao enviar termo aditivo para PlugSign');

        const errorMessage = error.response?.data?.message ||
                            error.response?.data?.error ||
                            'Erro ao comunicar com o PlugSign';

        throw new BadRequestError(`Erro PlugSign: ${errorMessage}`);
      }

      logger.error({ error }, 'Erro inesperado ao enviar termo aditivo para assinatura');
      throw error;
    }
  });

  /**
   * GET /api/rentals/:rentalId/secondary-vehicles/:id/download-signed
   * Baixar o termo aditivo assinado do PlugSign
   */
  app.get('/:rentalId/secondary-vehicles/:id/download-signed', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Baixar o termo aditivo assinado do PlugSign',
      tags: ['Veiculos Secundarios'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['rentalId', 'id'],
        properties: {
          rentalId: { type: 'string', format: 'uuid' },
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
    const { rentalId, id } = request.params as { rentalId: string; id: string };
    const user = request.user;

    // Buscar veiculo secundario
    const secondaryVehicle = await prisma.rentalSecondaryVehicle.findFirst({
      where: { id, rental_id: rentalId },
      include: {
        rental: {
          include: { city: true },
        },
        motorcycle: true,
      },
    });

    if (!secondaryVehicle) {
      throw new NotFoundError('Veiculo secundario nao encontrado');
    }

    if (!secondaryVehicle.signature_request_id) {
      throw new BadRequestError('Este termo aditivo ainda nao foi enviado para assinatura');
    }

    // Verificar se tem documento ja assinado armazenado
    if (secondaryVehicle.signed_file_url) {
      logger.info({ id, url: secondaryVehicle.signed_file_url }, 'Redirecionando para URL do documento assinado');
      return reply.redirect(secondaryVehicle.signed_file_url);
    }

    // Buscar token do PlugSign
    let apiToken: string | null = null;

    if (env.PLUGSIGN_API_KEY && env.PLUGSIGN_API_KEY.length >= 50) {
      apiToken = env.PLUGSIGN_API_KEY;
    } else if (secondaryVehicle.rental?.city_id) {
      const city = await prisma.city.findUnique({
        where: { id: secondaryVehicle.rental.city_id },
        select: { plugsign_token: true },
      });
      if (city?.plugsign_token && city.plugsign_token.length >= 50) {
        apiToken = city.plugsign_token;
      }
    }

    if (!apiToken) {
      throw new ServiceUnavailableError('Token PlugSign nao encontrado');
    }

    const requestId = secondaryVehicle.signature_request_id;
    const documentKey = secondaryVehicle.document_key || requestId;
    const placaMoto = secondaryVehicle.motorcycle?.placa || '';

    logger.info({
      secondaryVehicleId: id,
      requestId,
      documentKey,
      placaMoto,
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

      if (Array.isArray(files) && files.length > 0) {
        logger.info({ totalFiles: files.length }, 'PlugSign: arquivos listados');

        for (const file of files) {
          const fileId = String(file.id || '');
          const fileKey = file.key || file.document_key || file.file_key || '';
          const fileName = file.name || file.document_name || file.file_name || '';
          const fileRequestId = String(file.request_id || file.requestId || '');

          // Verificar se e o arquivo correto (por request_id, nome ou placa)
          if (fileRequestId === requestId ||
              fileId === requestId ||
              (placaMoto && fileName.toLowerCase().includes(placaMoto.toLowerCase())) ||
              fileName.toLowerCase().includes('termo aditivo') ||
              fileName.toLowerCase().includes('termo_aditivo')) {

            logger.info({
              foundFile: { id: fileId, key: fileKey, name: fileName, request_id: fileRequestId }
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

        if (!fileKeyFromList) {
          const fileNames = files.map((f: any) => ({
            id: f.id,
            key: f.key || f.document_key,
            name: f.name || f.document_name,
            request_id: f.request_id,
          }));
          logger.info({ fileNames, searchingFor: { requestId, placaMoto } }, 'PlugSign: arquivos disponiveis (nenhum correspondente)');
        }
      }
    } catch (filesError) {
      logger.warn({ error: (filesError as any).message }, 'PlugSign: nao foi possivel listar arquivos');
    }

    // ESTRATEGIA 2: Listar REQUESTS para encontrar o file_key
    if (!fileKeyFromList) {
      try {
        const requestsUrl = 'https://app.plugsign.com.br/api/requests';
        logger.info({ requestsUrl }, 'PlugSign: listando requests');

        const requestsResponse = await axios.get(requestsUrl, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json',
          },
          timeout: 30000,
        });

        const requests = requestsResponse.data?.data || requestsResponse.data || [];

        if (Array.isArray(requests) && requests.length > 0) {
          logger.info({ totalRequests: requests.length }, 'PlugSign: requests listados');

          for (const req of requests) {
            const reqId = String(req.id || req.key || req.request_key || '');
            const reqName = req.name || req.document_name || '';

            if (reqId === requestId ||
                (placaMoto && reqName.toLowerCase().includes(placaMoto.toLowerCase()))) {

              logger.info({ foundRequest: JSON.stringify(req) }, 'PlugSign: request encontrado');

              // IMPORTANTE: O campo 'document' contém a chave do arquivo para download!
              const fk = req.document || req.file_key || req.document_key || req.files?.[0]?.key || req.files?.[0]?.document_key;
              if (fk) {
                fileKeyFromList = String(fk);
                downloadEndpoints.unshift(`https://app.plugsign.com.br/api/files/download/${fileKeyFromList}`);
                logger.info({ documentKey: fileKeyFromList }, 'PlugSign: document_key extraido do request (campo document)');

                // Atualizar o document_key no banco para não precisar buscar na lista novamente
                if (fileKeyFromList !== documentKey) {
                  await prisma.rentalSecondaryVehicle.update({
                    where: { id },
                    data: { document_key: fileKeyFromList },
                  });
                  logger.info({ id, oldKey: documentKey, newKey: fileKeyFromList }, 'PlugSign: document_key atualizado no banco');
                }
              }
              break;
            }
          }
        }
      } catch (listError) {
        logger.warn({ error: (listError as any).message }, 'PlugSign: nao foi possivel listar requests');
      }
    }

    // ESTRATEGIA 3: Obter info do request especifico para encontrar URL do documento assinado
    let isDocumentSigned = false;
    try {
      const infoUrl = `https://app.plugsign.com.br/api/requests/${requestId}`;
      logger.info({ infoUrl }, 'PlugSign: obtendo info do request');

      const infoResponse = await axios.get(infoUrl, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      logger.info({
        status: infoResponse.status,
        data: JSON.stringify(infoResponse.data).substring(0, 500),
      }, 'PlugSign: info do request');

      // Extrair URL de download da resposta se existir
      const data = infoResponse.data?.data || infoResponse.data;

      // Verificar status da assinatura
      const signatureStatus = (data?.status || data?.signature_status || '').toLowerCase();
      logger.info({ signatureStatus }, 'PlugSign: status da assinatura');

      // Verificar se o documento foi assinado
      // PlugSign pode usar diferentes valores para indicar assinatura completa
      isDocumentSigned = ['signed', 'completed', 'finished', 'done', 'assinado', 'complete'].includes(signatureStatus);

      if (!isDocumentSigned && signatureStatus === 'pending') {
        logger.info({ signatureStatus }, 'PlugSign: documento ainda nao foi assinado');
        throw new BadRequestError('O documento ainda nao foi assinado. Aguarde a assinatura de todos os signatarios.');
      }

      // Procurar URL do documento assinado
      const signedFileUrl = data?.signed_file_url ||
                            data?.signed_url ||
                            data?.signed_document_url ||
                            data?.download_url ||
                            data?.file_url;

      if (signedFileUrl) {
        logger.info({ signedFileUrl }, 'PlugSign: URL do arquivo assinado encontrada');
        downloadEndpoints.unshift(signedFileUrl);
      }

      // Extrair file_key se existir
      const fileKey = data?.file_key || data?.document || data?.files?.[0]?.key || data?.files?.[0]?.document_key;
      if (fileKey && fileKey !== documentKey) {
        logger.info({ fileKey }, 'PlugSign: file_key encontrado no request');
        downloadEndpoints.unshift(`https://app.plugsign.com.br/api/files/download/${fileKey}`);

        // Atualizar o document_key no banco
        await prisma.rentalSecondaryVehicle.update({
          where: { id },
          data: { document_key: String(fileKey) },
        });
      }

      // Se documento foi assinado, atualizar status no banco
      if (isDocumentSigned && secondaryVehicle.termo_status !== 'signed') {
        await prisma.rentalSecondaryVehicle.update({
          where: { id },
          data: {
            termo_status: 'signed',
            signed_at: new Date(),
          },
        });
        logger.info({ id }, 'PlugSign: status atualizado para signed no banco');
      }
    } catch (infoError) {
      // Se for BadRequestError (documento não assinado), propagar o erro
      if (infoError instanceof BadRequestError) {
        throw infoError;
      }
      logger.warn({ error: (infoError as any).message }, 'PlugSign: nao foi possivel obter info do request');
    }

    // Adicionar endpoints padrão - PRIORIZAR os endpoints de documento ASSINADO
    downloadEndpoints.push(
      // Endpoints especificos para documento assinado (maior prioridade)
      `https://app.plugsign.com.br/api/requests/${requestId}/file/signed`,
      `https://app.plugsign.com.br/api/requests/${requestId}/files/signed`,
      `https://app.plugsign.com.br/api/files/${documentKey}/signed`,
      `https://app.plugsign.com.br/api/files/download/${documentKey}-signed`,
      `https://app.plugsign.com.br/api/files/${documentKey}-signed/download`,
      // Endpoints de download geral (fallback)
      `https://app.plugsign.com.br/api/requests/${requestId}/download`,
      `https://app.plugsign.com.br/api/requests/${requestId}/pdf`,
      `https://app.plugsign.com.br/api/files/download/${documentKey}`,
      `https://app.plugsign.com.br/api/files/${documentKey}/download`,
      `https://app.plugsign.com.br/api/documents/${requestId}/download`,
      `https://app.plugsign.com.br/api/documents/${requestId}/pdf`,
    );

    // Tentar cada endpoint de download
    for (const endpoint of downloadEndpoints) {
      try {
        logger.info({ endpoint }, 'PlugSign: tentando download do termo aditivo');

        const response = await axios.get(endpoint, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/pdf, application/octet-stream',
          },
          responseType: 'arraybuffer',
          timeout: 60000,
        });

        // Verificar se e um PDF valido
        const buffer = Buffer.from(response.data);
        if (buffer.length > 4 && buffer.toString('utf8', 0, 4) === '%PDF') {
          logger.info({ endpoint, size: buffer.length }, 'PlugSign: download do termo aditivo bem-sucedido');

          reply.header('Content-Type', 'application/pdf');
          reply.header('Content-Disposition', `attachment; filename="termo_aditivo_assinado_${secondaryVehicle.motorcycle?.placa || id}.pdf"`);

          return reply.send(buffer);
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

    throw new BadRequestError('Nao foi possivel baixar o documento assinado. Verifique se o documento foi assinado.');
  });
};

export default rentalSecondaryVehiclesRoutes;
