import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';

import { NotFoundError } from '../utils/errors.js';

const contractsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/contracts
   * Listar todos os contratos (com filtros por role do usuário)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os contratos',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', description: 'Filtrar por cidade' },
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
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { city_id } = request.query as { city_id?: string };
    const user = request.user!;

    // Construir filtro baseado no role do usuário
    const where: any = {};

    if (user.role === 'franchisee' && user.franchiseeId) {
      // Franqueado: buscar contratos das locações da sua franquia
      const rentals = await prisma.rental.findMany({
        where: { franchisee_id: user.franchiseeId },
        select: { id: true },
      });
      const rentalIds = rentals.map(r => r.id);
      where.rental_id = { in: rentalIds.length > 0 ? rentalIds : ['00000000-0000-0000-0000-000000000000'] };
    } else if (user.role === 'regional' && user.cityId) {
      where.city_id = user.cityId;
    } else if (user.role === 'admin' && city_id) {
      where.city_id = city_id;
    }
    // master_br vê todos os contratos

    const contracts = await prisma.generatedContract.findMany({
      where,
      include: {
        template: true,
        rental: {
          include: {
            franchisee: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return reply.send({
      success: true,
      data: contracts,
    });
  });

  /**
   * GET /api/contracts/check-existing
   * Verificar se já existe contrato para uma locação e template
   */
  app.get('/check-existing', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Verificar se já existe contrato para uma locação e template',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          rental_id: { type: 'string', description: 'ID da locação' },
          template_id: { type: 'string', description: 'ID do template' },
        },
        required: ['rental_id', 'template_id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                exists: { type: 'boolean' },
                contracts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { rental_id, template_id } = request.query as { rental_id: string; template_id: string };

    const contracts = await prisma.generatedContract.findMany({
      where: {
        rental_id,
        template_id,
      },
      select: {
        id: true,
        template_id: true,
        contract_number: true,
        status: true,
        pdf_url: true,
        created_at: true,
      },
    });

    return reply.send({
      success: true,
      data: {
        exists: contracts.length > 0,
        contracts,
      },
    });
  });

  /**
   * GET /api/contracts/by-rental/:rentalId
   * Buscar todos os contratos de uma locação
   */
  app.get('/by-rental/:rentalId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar todos os contratos de uma locação',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          rentalId: { type: 'string', description: 'ID da locação' },
        },
        required: ['rentalId'],
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
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };

    const contracts = await prisma.generatedContract.findMany({
      where: {
        rental_id: rentalId,
      },
      include: {
        template: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return reply.send({
      success: true,
      data: contracts,
    });
  });

  /**
   * POST /api/contracts/generate
   * Gerar um novo contrato
   */
  app.post('/generate', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Gerar um novo contrato',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          template_id: { type: 'string', description: 'ID do template' },
          rental_id: { type: 'string', description: 'ID da locação' },
          city_id: { type: 'string', description: 'ID da cidade' },
          contract_data: { type: 'object', additionalProperties: true, description: 'Dados do contrato' },
        },
        required: ['template_id', 'rental_id', 'city_id', 'contract_data'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { template_id, rental_id, city_id, contract_data } = request.body as {
      template_id: string;
      rental_id: string;
      city_id: string;
      contract_data: any;
    };

    const user = (request as any).user;

    // Gerar número do contrato
    const contract_number = `CT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const contract = await prisma.generatedContract.create({
      data: {
        template_id,
        rental_id,
        city_id,
        contract_number,
        contract_data: contract_data as any,
        status: 'draft',
        created_by: user?.id || null,
      },
      include: {
        template: true,
      },
    });

    return reply.send({
      success: true,
      data: contract,
    });
  });

  /**
   * PATCH /api/contracts/:id
   * Atualizar contrato (ex: adicionar PDF URL, status, batch_id)
   */
  app.patch('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar contrato',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do contrato' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          pdf_url: { type: 'string', nullable: true },
          status: { type: 'string', nullable: true },
          batch_id: { type: 'string', nullable: true },
          signature_request_id: { type: 'string', nullable: true },
          signed_at: { type: 'string', format: 'date-time', nullable: true },
          document_key: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updateData = request.body as {
      pdf_url?: string;
      status?: string;
      batch_id?: string;
      signature_request_id?: string;
      signed_at?: string;
      document_key?: string;
    };

    const contract = await prisma.generatedContract.update({
      where: { id },
      data: {
        ...updateData,
        signed_at: updateData.signed_at ? new Date(updateData.signed_at) : undefined,
      },
    });

    return reply.send({
      success: true,
      data: contract,
    });
  });

  /**
   * GET /api/contracts/:id
   * Buscar contrato por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar contrato por ID',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do contrato' },
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
              nullable: true,
              additionalProperties: true,
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const contract = await prisma.generatedContract.findUnique({
      where: { id },
      include: {
        template: true,
        rental: true,
        city: true,
      },
    });

    return reply.send({
      success: true,
      data: contract,
    });
  });

  /**
   * DELETE /api/contracts/:id
   * Excluir um contrato gerado
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br'] })],
    schema: {
      description: 'Excluir um contrato gerado',
      tags: ['Contratos'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do contrato' },
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
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Verificar se o contrato existe
    const contract = await prisma.generatedContract.findUnique({
      where: { id },
    });

    if (!contract) {
      throw new NotFoundError('Contrato não encontrado');
    }

    // Excluir o contrato
    await prisma.generatedContract.delete({
      where: { id },
    });

    return reply.send({
      success: true,
      message: 'Contrato excluído com sucesso',
    });
  });
};

export default contractsRoutes;
