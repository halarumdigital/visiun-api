import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
  },
};

const driverSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    client_id: { type: 'string', format: 'uuid' },
    full_name: { type: 'string' },
    rg: { type: 'string', nullable: true },
    cpf: { type: 'string' },
    birth_date: { type: 'string', nullable: true },
    email: { type: 'string', nullable: true },
    phone: { type: 'string', nullable: true },
    address_street: { type: 'string', nullable: true },
    address_number: { type: 'string', nullable: true },
    address_complement: { type: 'string', nullable: true },
    address_neighborhood: { type: 'string', nullable: true },
    address_city: { type: 'string', nullable: true },
    address_state: { type: 'string', nullable: true },
    address_zip_code: { type: 'string', nullable: true },
    cnh_number: { type: 'string', nullable: true },
    cnh_category: { type: 'string', nullable: true },
    cnh_expiry_date: { type: 'string', nullable: true },
    cnh_document_url: { type: 'string', nullable: true },
    residence_proof_url: { type: 'string', nullable: true },
    status: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
};

const driversRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/drivers
   * Listar condutores de um cliente
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar condutores de um cliente',
      tags: ['Condutores'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          client_id: { type: 'string', format: 'uuid', description: 'ID do cliente' },
        },
        required: ['client_id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: driverSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { client_id } = request.query as { client_id: string };

    const drivers = await prisma.clientDriver.findMany({
      where: { client_id },
      orderBy: { created_at: 'desc' },
    });

    return reply.send({
      success: true,
      data: drivers,
    });
  });

  /**
   * GET /api/drivers/:id
   * Buscar condutor por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar condutor por ID',
      tags: ['Condutores'],
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
            data: driverSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const driver = await prisma.clientDriver.findUnique({
      where: { id },
    });

    if (!driver) {
      throw new NotFoundError('Condutor não encontrado');
    }

    return reply.send({
      success: true,
      data: driver,
    });
  });

  /**
   * POST /api/drivers
   * Criar novo condutor
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar novo condutor',
      tags: ['Condutores'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['client_id', 'full_name', 'cpf'],
        properties: {
          client_id: { type: 'string', format: 'uuid' },
          full_name: { type: 'string' },
          rg: { type: 'string', nullable: true },
          cpf: { type: 'string' },
          birth_date: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          address_street: { type: 'string', nullable: true },
          address_number: { type: 'string', nullable: true },
          address_complement: { type: 'string', nullable: true },
          address_neighborhood: { type: 'string', nullable: true },
          address_city: { type: 'string', nullable: true },
          address_state: { type: 'string', nullable: true },
          address_zip_code: { type: 'string', nullable: true },
          cnh_number: { type: 'string', nullable: true },
          cnh_category: { type: 'string', nullable: true },
          cnh_expiry_date: { type: 'string', nullable: true },
          cnh_document_url: { type: 'string', nullable: true },
          residence_proof_url: { type: 'string', nullable: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: driverSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = request.body as any;

    // Verificar se o cliente existe
    const client = await prisma.client.findUnique({
      where: { id: data.client_id },
    });

    if (!client) {
      throw new BadRequestError('Cliente não encontrado');
    }

    // Limpar CPF
    const cleanCpf = data.cpf.replace(/\D/g, '');

    const driver = await prisma.clientDriver.create({
      data: {
        client_id: data.client_id,
        full_name: data.full_name,
        rg: data.rg || null,
        cpf: cleanCpf,
        birth_date: data.birth_date ? new Date(data.birth_date) : null,
        email: data.email || null,
        phone: data.phone || null,
        address_street: data.address_street || null,
        address_number: data.address_number || null,
        address_complement: data.address_complement || null,
        address_neighborhood: data.address_neighborhood || null,
        address_city: data.address_city || null,
        address_state: data.address_state || null,
        address_zip_code: data.address_zip_code || null,
        cnh_number: data.cnh_number || null,
        cnh_category: data.cnh_category || null,
        cnh_expiry_date: data.cnh_expiry_date ? new Date(data.cnh_expiry_date) : null,
        cnh_document_url: data.cnh_document_url || null,
        residence_proof_url: data.residence_proof_url || null,
        status: 'active',
      },
    });

    return reply.status(201).send({
      success: true,
      data: driver,
    });
  });

  /**
   * PUT /api/drivers/:id
   * Atualizar condutor
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar condutor',
      tags: ['Condutores'],
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
          full_name: { type: 'string' },
          rg: { type: 'string', nullable: true },
          cpf: { type: 'string' },
          birth_date: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          address_street: { type: 'string', nullable: true },
          address_number: { type: 'string', nullable: true },
          address_complement: { type: 'string', nullable: true },
          address_neighborhood: { type: 'string', nullable: true },
          address_city: { type: 'string', nullable: true },
          address_state: { type: 'string', nullable: true },
          address_zip_code: { type: 'string', nullable: true },
          cnh_number: { type: 'string', nullable: true },
          cnh_category: { type: 'string', nullable: true },
          cnh_expiry_date: { type: 'string', nullable: true },
          cnh_document_url: { type: 'string', nullable: true },
          residence_proof_url: { type: 'string', nullable: true },
          status: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: driverSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as any;

    // Verificar se o condutor existe
    const existingDriver = await prisma.clientDriver.findUnique({
      where: { id },
    });

    if (!existingDriver) {
      throw new NotFoundError('Condutor não encontrado');
    }

    // Limpar CPF se fornecido
    const cleanCpf = data.cpf ? data.cpf.replace(/\D/g, '') : undefined;

    const driver = await prisma.clientDriver.update({
      where: { id },
      data: {
        full_name: data.full_name,
        rg: data.rg ?? null,
        cpf: cleanCpf,
        birth_date: data.birth_date ? new Date(data.birth_date) : null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address_street: data.address_street ?? null,
        address_number: data.address_number ?? null,
        address_complement: data.address_complement ?? null,
        address_neighborhood: data.address_neighborhood ?? null,
        address_city: data.address_city ?? null,
        address_state: data.address_state ?? null,
        address_zip_code: data.address_zip_code ?? null,
        cnh_number: data.cnh_number ?? null,
        cnh_category: data.cnh_category ?? null,
        cnh_expiry_date: data.cnh_expiry_date ? new Date(data.cnh_expiry_date) : null,
        cnh_document_url: data.cnh_document_url ?? null,
        residence_proof_url: data.residence_proof_url ?? null,
        status: data.status,
      },
    });

    return reply.send({
      success: true,
      data: driver,
    });
  });

  /**
   * DELETE /api/drivers/:id
   * Excluir condutor
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir condutor',
      tags: ['Condutores'],
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

    // Verificar se o condutor existe
    const existingDriver = await prisma.clientDriver.findUnique({
      where: { id },
    });

    if (!existingDriver) {
      throw new NotFoundError('Condutor não encontrado');
    }

    await prisma.clientDriver.delete({
      where: { id },
    });

    return reply.send({
      success: true,
      message: 'Condutor excluído com sucesso',
    });
  });
};

export default driversRoutes;
