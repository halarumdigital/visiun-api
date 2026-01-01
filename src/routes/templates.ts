import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';

const templatesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/templates/types
   * Listar todos os tipos de contrato
   */
  app.get('/types', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os tipos de contrato',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
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
    let contractTypes = await prisma.contractType.findMany({
      where: {
        is_active: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Se não existir nenhum tipo, criar os padrões
    if (contractTypes.length === 0) {
      console.log('📋 [TEMPLATES] Criando tipos de contrato padrão...');

      const defaultTypes = [
        { name: 'Locação', description: 'Contrato de locação de motocicleta', category: 'rental' },
        { name: 'Anexo', description: 'Anexos do contrato de locação', category: 'annex' },
        { name: 'Responsabilidade', description: 'Termo de responsabilidade', category: 'responsibility' },
      ];

      for (const type of defaultTypes) {
        await prisma.contractType.create({
          data: {
            name: type.name,
            description: type.description,
            category: type.category,
            is_active: true,
          },
        });
      }

      contractTypes = await prisma.contractType.findMany({
        where: {
          is_active: true,
        },
        orderBy: {
          name: 'asc',
        },
      });
    }

    console.log('📋 [TEMPLATES] Tipos de contrato:', contractTypes.map(t => t.name));

    return reply.send({
      success: true,
      data: contractTypes,
    });
  });

  /**
   * POST /api/templates
   * Criar novo template
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac(['master_br', 'regional'])],
    schema: {
      description: 'Criar novo template',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          contract_type_id: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'object', additionalProperties: true },
          variables: { type: 'array', items: { type: 'string' } },
          is_active: { type: 'boolean' },
          is_default: { type: 'boolean' },
        },
        required: ['name', 'title'],
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
    const body = request.body as any;

    console.log('📋 [TEMPLATES] Criando template:', body.name);

    // Buscar ou criar tipo de contrato padrão se não fornecido
    let contractTypeId = body.contract_type_id;
    if (!contractTypeId || contractTypeId.includes('default')) {
      const defaultType = await prisma.contractType.findFirst({
        where: { is_active: true },
      });

      if (!defaultType) {
        // Criar tipo padrão
        const newType = await prisma.contractType.create({
          data: {
            name: 'Locação',
            description: 'Contrato de locação de motocicleta',
            category: 'rental',
            is_active: true,
          },
        });
        contractTypeId = newType.id;
      } else {
        contractTypeId = defaultType.id;
      }
    }

    const template = await prisma.contractTemplate.create({
      data: {
        contract_type_id: contractTypeId,
        name: body.name,
        version: body.version || '1.0',
        title: body.title,
        content: body.content || {},
        variables: body.variables || [],
        is_active: body.is_active ?? true,
        is_default: body.is_default ?? false,
      },
      include: {
        contract_type: true,
      },
    });

    console.log('✅ [TEMPLATES] Template criado:', template.id, template.name);

    return reply.send({
      success: true,
      data: template,
    });
  });

  /**
   * POST /api/templates/:id/clauses
   * Criar cláusula para um template
   */
  app.post('/:id/clauses', {
    preHandler: [authMiddleware, rbac(['master_br', 'regional'])],
    schema: {
      description: 'Criar cláusula para um template',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do template' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          clause_number: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          order_index: { type: 'number' },
          is_required: { type: 'boolean' },
          variables: { type: 'array', items: { type: 'string' } },
        },
        required: ['clause_number', 'content', 'order_index'],
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
    const body = request.body as any;

    console.log('📋 [TEMPLATES] Criando cláusula para template:', id, body.clause_number);

    const clause = await prisma.contractClause.create({
      data: {
        template_id: id,
        clause_number: body.clause_number,
        title: body.title || '',
        content: body.content,
        order_index: body.order_index,
        is_required: body.is_required ?? true,
        variables: body.variables || [],
      },
    });

    console.log('✅ [TEMPLATES] Cláusula criada:', clause.id);

    return reply.send({
      success: true,
      data: clause,
    });
  });

  /**
   * GET /api/templates
   * Listar todos os templates ativos
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os templates ativos',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
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
    const templates = await prisma.contractTemplate.findMany({
      where: {
        is_active: true,
      },
      include: {
        contract_type: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log('📋 [TEMPLATES] Todos os templates ativos:', templates.map(t => t.name));

    return reply.send({
      success: true,
      data: templates,
    });
  });

  /**
   * GET /api/templates/by-name/:name
   * Buscar template por nome exato
   */
  app.get('/by-name/:name', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar template por nome exato',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome do template' },
        },
        required: ['name'],
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
    const { name } = request.params as { name: string };

    const template = await prisma.contractTemplate.findFirst({
      where: {
        name: name,
        is_active: true,
      },
      include: {
        contract_type: true,
      },
    });

    return reply.send({
      success: true,
      data: template,
    });
  });

  /**
   * GET /api/templates/search/:query
   * Buscar templates que contenham o texto no nome
   */
  app.get('/search/:query', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar templates que contenham o texto no nome',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto para buscar no nome' },
        },
        required: ['query'],
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
    const { query } = request.params as { query: string };

    console.log(`🔍 [TEMPLATES] Buscando templates com query: "${query}"`);

    const templates = await prisma.contractTemplate.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive',
        },
        is_active: true,
      },
      include: {
        contract_type: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log(`🔍 [TEMPLATES] Encontrados ${templates.length} templates:`, templates.map(t => t.name));

    return reply.send({
      success: true,
      data: templates,
    });
  });

  /**
   * GET /api/templates/:id
   * Buscar template por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar template por ID',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do template' },
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

    const template = await prisma.contractTemplate.findUnique({
      where: { id },
      include: {
        contract_type: true,
      },
    });

    return reply.send({
      success: true,
      data: template,
    });
  });

  /**
   * GET /api/templates/:id/clauses
   * Buscar cláusulas de um template
   */
  app.get('/:id/clauses', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar cláusulas de um template',
      tags: ['Templates'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID do template' },
        },
        required: ['id'],
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
    const { id } = request.params as { id: string };

    const clauses = await prisma.contractClause.findMany({
      where: {
        template_id: id,
      },
      orderBy: {
        order_index: 'asc',
      },
    });

    return reply.send({
      success: true,
      data: clauses,
    });
  });
};

export default templatesRoutes;
