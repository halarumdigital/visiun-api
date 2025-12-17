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

const clientsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/clients
   * Listar todos os clientes (com filtro opcional por cidade)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os clientes',
      tags: ['Clientes'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid', description: 'Filtrar por cidade' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { city_id } = request.query as { city_id?: string };
    const user = request.user!;

    // Construir filtro baseado no role do usuário
    const where: any = {};

    if (user.role === 'master_br' || user.role === 'admin') {
      // Se city_id foi passado, filtrar por ele
      if (city_id) {
        where.city_id = city_id;
      }
    } else if (user.role === 'regional') {
      // Regional só vê clientes da sua cidade
      where.city_id = user.cityId;
    } else if (user.role === 'franchisee') {
      // Franqueado só vê clientes da sua cidade
      where.city_id = user.cityId;
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    return reply.send({
      success: true,
      data: clients,
    });
  });

  /**
   * GET /api/clients/:id
   * Buscar cliente por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar cliente por ID',
      tags: ['Clientes'],
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
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const client = await prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new NotFoundError('Cliente não encontrado');
    }

    return reply.send({
      success: true,
      data: client,
    });
  });

  /**
   * POST /api/clients
   * Criar novo cliente
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar novo cliente',
      tags: ['Clientes'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['full_name', 'phone', 'city_id'],
        additionalProperties: true,
        properties: {
          full_name: { type: 'string' },
          cpf: { type: 'string', nullable: true },
          rg: { type: 'string', nullable: true },
          birth_date: { type: 'string', nullable: true },
          phone: { type: 'string' },
          phone2: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          profession: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          number: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          state: { type: 'string', nullable: true },
          zip_code: { type: 'string', nullable: true },
          city_id: { type: 'string', format: 'uuid' },
          cnh_number: { type: 'string', nullable: true },
          cnh_category: { type: 'string', nullable: true },
          cnh_expiry_date: { type: 'string', nullable: true },
          cnh_photo_url: { type: 'string', nullable: true },
          cnh_document_url: { type: 'string', nullable: true },
          residence_proof_url: { type: 'string', nullable: true },
          is_pj: { type: 'boolean', nullable: true },
          cnpj: { type: 'string', nullable: true },
          razao_social: { type: 'string', nullable: true },
          cpf_responsavel: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['ativo', 'inativo', 'bloqueado'], nullable: true },
          franchisee_id: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const data = request.body as any;

    // Verificar se já existe cliente com o mesmo CPF (se CPF foi informado)
    if (data.cpf) {
      const existingClient = await prisma.client.findFirst({
        where: { cpf: data.cpf },
      });

      if (existingClient) {
        throw new BadRequestError('Já existe um cliente com este CPF');
      }
    }

    const client = await prisma.client.create({
      data: {
        full_name: data.full_name,
        cpf: data.cpf || '',
        rg: data.rg || null,
        birth_date: data.birth_date ? new Date(data.birth_date) : null,
        phone: data.phone,
        phone2: data.phone2 || null,
        email: data.email || null,
        profession: data.profession || null,
        address: data.address || null,
        number: data.number || null,
        city: data.city || null,
        state: data.state || null,
        zip_code: data.zip_code || null,
        city_id: data.city_id,
        cnh_number: data.cnh_number || null,
        cnh_category: data.cnh_category || null,
        cnh_expiry_date: data.cnh_expiry_date ? new Date(data.cnh_expiry_date) : null,
        cnh_photo_url: data.cnh_photo_url || null,
        cnh_document_url: data.cnh_document_url || null,
        residence_proof_url: data.residence_proof_url || null,
        is_pj: data.is_pj || false,
        cnpj: data.cnpj || null,
        razao_social: data.razao_social || null,
        cpf_responsavel: data.cpf_responsavel || null,
        status: data.status || 'ativo',
        franchisee_id: data.franchisee_id || null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: client,
    });
  });

  /**
   * PUT /api/clients/:id
   * Atualizar cliente
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar cliente',
      tags: ['Clientes'],
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
        additionalProperties: true,
        properties: {
          full_name: { type: 'string' },
          cpf: { type: 'string', nullable: true },
          rg: { type: 'string', nullable: true },
          birth_date: { type: 'string', nullable: true },
          phone: { type: 'string' },
          phone2: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          profession: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          number: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          state: { type: 'string', nullable: true },
          zip_code: { type: 'string', nullable: true },
          city_id: { type: 'string', format: 'uuid' },
          cnh_number: { type: 'string', nullable: true },
          cnh_category: { type: 'string', nullable: true },
          cnh_expiry_date: { type: 'string', nullable: true },
          cnh_photo_url: { type: 'string', nullable: true },
          cnh_document_url: { type: 'string', nullable: true },
          residence_proof_url: { type: 'string', nullable: true },
          is_pj: { type: 'boolean', nullable: true },
          cnpj: { type: 'string', nullable: true },
          razao_social: { type: 'string', nullable: true },
          cpf_responsavel: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['ativo', 'inativo', 'bloqueado'] },
          franchisee_id: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as any;

    // Verificar se o cliente existe
    const existingClient = await prisma.client.findUnique({
      where: { id },
    });

    if (!existingClient) {
      throw new NotFoundError('Cliente não encontrado');
    }

    // Preparar dados para atualização
    const updateData: any = {};

    if (data.full_name !== undefined) updateData.full_name = data.full_name;
    if (data.cpf !== undefined) updateData.cpf = data.cpf;
    if (data.rg !== undefined) updateData.rg = data.rg;
    if (data.birth_date !== undefined) updateData.birth_date = data.birth_date ? new Date(data.birth_date) : null;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.phone2 !== undefined) updateData.phone2 = data.phone2;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.profession !== undefined) updateData.profession = data.profession;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.number !== undefined) updateData.number = data.number;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.zip_code !== undefined) updateData.zip_code = data.zip_code;
    if (data.city_id !== undefined) updateData.city_id = data.city_id;
    if (data.cnh_number !== undefined) updateData.cnh_number = data.cnh_number;
    if (data.cnh_category !== undefined) updateData.cnh_category = data.cnh_category;
    if (data.cnh_expiry_date !== undefined) updateData.cnh_expiry_date = data.cnh_expiry_date ? new Date(data.cnh_expiry_date) : null;
    if (data.cnh_photo_url !== undefined) updateData.cnh_photo_url = data.cnh_photo_url;
    if (data.cnh_document_url !== undefined) updateData.cnh_document_url = data.cnh_document_url;
    if (data.residence_proof_url !== undefined) updateData.residence_proof_url = data.residence_proof_url;
    if (data.is_pj !== undefined) updateData.is_pj = data.is_pj;
    if (data.cnpj !== undefined) updateData.cnpj = data.cnpj;
    if (data.razao_social !== undefined) updateData.razao_social = data.razao_social;
    if (data.cpf_responsavel !== undefined) updateData.cpf_responsavel = data.cpf_responsavel;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.franchisee_id !== undefined) updateData.franchisee_id = data.franchisee_id;

    const client = await prisma.client.update({
      where: { id },
      data: updateData,
    });

    return reply.send({
      success: true,
      data: client,
    });
  });

  /**
   * DELETE /api/clients/:id
   * Excluir cliente
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['admin', 'master_br', 'regional'] })],
    schema: {
      description: 'Excluir cliente',
      tags: ['Clientes'],
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

    // Verificar se o cliente existe
    const existingClient = await prisma.client.findUnique({
      where: { id },
    });

    if (!existingClient) {
      throw new NotFoundError('Cliente não encontrado');
    }

    await prisma.client.delete({
      where: { id },
    });

    return reply.send({
      success: true,
      message: 'Cliente excluído com sucesso',
    });
  });

  /**
   * GET /api/clients/by-document/:document
   * Buscar cliente por CPF ou CNPJ
   */
  app.get('/by-document/:document', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar cliente por CPF ou CNPJ',
      tags: ['Clientes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          document: { type: 'string', description: 'CPF ou CNPJ (apenas números)' },
        },
        required: ['document'],
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
    const { document } = request.params as { document: string };

    // Limpar documento (remover caracteres não numéricos)
    const cleanDocument = document.replace(/\D/g, '');

    // Buscar cliente por CPF ou CNPJ usando query raw para evitar problemas de schema
    const clients = await prisma.$queryRaw<any[]>`
      SELECT * FROM clients
      WHERE cpf = ${cleanDocument}
         OR cpf = ${document}
         OR cnpj = ${cleanDocument}
         OR cnpj = ${document}
      LIMIT 1
    `;

    const client = clients.length > 0 ? clients[0] : null;

    return reply.send({
      success: true,
      data: client,
    });
  });
};

export default clientsRoutes;
