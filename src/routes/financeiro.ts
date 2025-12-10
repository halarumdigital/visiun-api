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
const financeiroResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    tipo: { type: 'string', enum: ['entrada', 'saida'] },
    valor: { type: 'number' },
    data: { type: 'string', format: 'date-time' },
    descricao: { type: 'string' },
    pago: { type: 'boolean' },
    placa: { type: 'string', nullable: true },
    locatario: { type: 'string', nullable: true },
    comprovante_url: { type: 'string', format: 'uri', nullable: true },
    comprovante_url_2: { type: 'string', format: 'uri', nullable: true },
    franchisee_id: { type: 'string', format: 'uuid' },
    motorcycle_id: { type: 'string', format: 'uuid', nullable: true },
    categoria_id: { type: 'string', format: 'uuid', nullable: true },
    created_by: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    franchisee: { type: 'object', nullable: true },
    motorcycle: { type: 'object', nullable: true },
    categoria: { type: 'object', nullable: true },
    creator: { type: 'object', nullable: true },
  },
};

const categoriaResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    nome: { type: 'string' },
    tipo: { type: 'string', enum: ['entrada', 'saida'] },
    ativo: { type: 'boolean' },
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
const createFinanceiroSchema = z.object({
  franchisee_id: z.string().uuid('ID do franqueado inválido'),
  tipo: z.enum(['entrada', 'saida']),
  placa: z.string().optional().nullable(),
  motorcycle_id: z.string().uuid().optional().nullable(),
  categoria_id: z.string().uuid().optional().nullable(),
  locatario: z.string().optional().nullable(),
  valor: z.number().positive('Valor deve ser positivo'),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  descricao: z.string().min(1, 'Descrição é obrigatória'),
  pago: z.boolean().default(false),
  comprovante_url: z.string().url().optional().nullable(),
  comprovante_url_2: z.string().url().optional().nullable(),
});

const updateFinanceiroSchema = createFinanceiroSchema.partial();

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  tipo: z.enum(['entrada', 'saida']).optional(),
  franchisee_id: z.string().uuid().optional(),
  categoria_id: z.string().uuid().optional(),
  pago: z.coerce.boolean().optional(),
  data_inicio: z.string().optional(),
  data_fim: z.string().optional(),
  placa: z.string().optional(),
  orderBy: z.enum(['data', 'valor', 'created_at']).default('data'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
});

const financeiroRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/financeiro
   * Listar lançamentos financeiros
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar lançamentos financeiros com filtros e paginação',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1, description: 'Página atual' },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Itens por página' },
          tipo: { type: 'string', enum: ['entrada', 'saida'], description: 'Tipo de lançamento' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          categoria_id: { type: 'string', format: 'uuid', description: 'ID da categoria' },
          pago: { type: 'boolean', description: 'Status de pagamento' },
          data_inicio: { type: 'string', format: 'date', description: 'Data inicial' },
          data_fim: { type: 'string', format: 'date', description: 'Data final' },
          placa: { type: 'string', description: 'Placa da motocicleta' },
          orderBy: { type: 'string', enum: ['data', 'valor', 'created_at'], default: 'data' },
          orderDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: financeiroResponseSchema },
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
      page, limit, tipo, franchisee_id, categoria_id,
      pago, data_inicio, data_fim, placa, orderBy, orderDir
    } = query.data;

    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    // Filtros adicionais
    if (tipo) where.tipo = tipo;
    if (franchisee_id) where.franchisee_id = franchisee_id;
    if (categoria_id) where.categoria_id = categoria_id;
    if (pago !== undefined) where.pago = pago;
    if (placa) where.placa = { contains: placa, mode: 'insensitive' };

    if (data_inicio || data_fim) {
      where.data = {};
      if (data_inicio) where.data.gte = new Date(data_inicio);
      if (data_fim) where.data.lte = new Date(data_fim);
    }

    const [lancamentos, total] = await Promise.all([
      prisma.financeiro.findMany({
        where,
        include: {
          franchisee: true,
          motorcycle: true,
          categoria: true,
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderBy]: orderDir },
      }),
      prisma.financeiro.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      data: lancamentos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/financeiro/:id
   * Obter lançamento por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter lançamento financeiro por ID',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lançamento' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: financeiroResponseSchema,
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

    const lancamento = await prisma.financeiro.findUnique({
      where: { id },
      include: {
        franchisee: true,
        motorcycle: true,
        categoria: true,
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!lancamento) {
      throw new NotFoundError('Lançamento não encontrado');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && lancamento.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para acessar este lançamento');
      }
    }

    return reply.status(200).send({
      success: true,
      data: lancamento,
    });
  });

  /**
   * POST /api/financeiro
   * Criar lançamento financeiro
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar novo lançamento financeiro',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['franchisee_id', 'tipo', 'valor', 'data', 'descricao'],
        properties: {
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          tipo: { type: 'string', enum: ['entrada', 'saida'], description: 'Tipo de lançamento' },
          placa: { type: 'string', description: 'Placa da motocicleta' },
          motorcycle_id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
          categoria_id: { type: 'string', format: 'uuid', description: 'ID da categoria' },
          locatario: { type: 'string', description: 'Nome do locatário' },
          valor: { type: 'number', minimum: 0, description: 'Valor do lançamento' },
          data: { type: 'string', format: 'date', description: 'Data do lançamento (YYYY-MM-DD)' },
          descricao: { type: 'string', minLength: 1, description: 'Descrição do lançamento' },
          pago: { type: 'boolean', default: false, description: 'Status de pagamento' },
          comprovante_url: { type: 'string', format: 'uri', description: 'URL do comprovante' },
          comprovante_url_2: { type: 'string', format: 'uri', description: 'URL do segundo comprovante' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: financeiroResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createFinanceiroSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;
    const context = getContext(request);

    // Se for franqueado, forçar franchisee_id
    if (context.isFranchisee()) {
      if (!context.franchiseeId) {
        throw new ForbiddenError('Usuário não está vinculado a um franqueado');
      }
      data.franchisee_id = context.franchiseeId;
    }

    // Verificar se franqueado existe
    const franchisee = await prisma.franchisee.findUnique({
      where: { id: data.franchisee_id },
    });

    if (!franchisee) {
      throw new NotFoundError('Franqueado não encontrado');
    }

    const lancamento = await prisma.financeiro.create({
      data: {
        tipo: data.tipo,
        valor: data.valor,
        data: new Date(data.data),
        descricao: data.descricao,
        pago: data.pago ?? false,
        placa: data.placa,
        locatario: data.locatario,
        comprovante_url: data.comprovante_url,
        comprovante_url_2: data.comprovante_url_2,
        created_by: context.userId,
        franchisee_id: data.franchisee_id,
        motorcycle_id: data.motorcycle_id,
        categoria_id: data.categoria_id,
      } as any,
      include: {
        franchisee: true,
        motorcycle: true,
        categoria: true,
      },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_CREATE,
      'financeiro',
      lancamento.id,
      undefined,
      { tipo: lancamento.tipo, valor: lancamento.valor }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(lancamento.franchisee_id, {
        type: 'INSERT',
        data: lancamento,
      });
    }

    return reply.status(201).send({
      success: true,
      data: lancamento,
    });
  });

  /**
   * PUT /api/financeiro/:id
   * Atualizar lançamento
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar lançamento financeiro',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lançamento' },
        },
      },
      body: {
        type: 'object',
        properties: {
          franchisee_id: { type: 'string', format: 'uuid' },
          tipo: { type: 'string', enum: ['entrada', 'saida'] },
          placa: { type: 'string' },
          motorcycle_id: { type: 'string', format: 'uuid' },
          categoria_id: { type: 'string', format: 'uuid' },
          locatario: { type: 'string' },
          valor: { type: 'number', minimum: 0 },
          data: { type: 'string', format: 'date' },
          descricao: { type: 'string', minLength: 1 },
          pago: { type: 'boolean' },
          comprovante_url: { type: 'string', format: 'uri' },
          comprovante_url_2: { type: 'string', format: 'uri' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: financeiroResponseSchema,
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
    const body = updateFinanceiroSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const context = getContext(request);

    const existingLancamento = await prisma.financeiro.findUnique({
      where: { id },
    });

    if (!existingLancamento) {
      throw new NotFoundError('Lançamento não encontrado');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && existingLancamento.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar este lançamento');
      }
    }

    const data = body.data;

    const lancamento = await prisma.financeiro.update({
      where: { id },
      data: {
        ...data,
        data: data.data ? new Date(data.data) : undefined,
      },
      include: {
        franchisee: true,
        motorcycle: true,
        categoria: true,
      },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_UPDATE,
      'financeiro',
      id,
      existingLancamento,
      data
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(lancamento.franchisee_id, {
        type: 'UPDATE',
        data: lancamento,
      });
    }

    return reply.status(200).send({
      success: true,
      data: lancamento,
    });
  });

  /**
   * DELETE /api/financeiro/:id
   * Deletar lançamento
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar lançamento financeiro',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lançamento' },
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

    const lancamento = await prisma.financeiro.findUnique({
      where: { id },
    });

    if (!lancamento) {
      throw new NotFoundError('Lançamento não encontrado');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && lancamento.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para deletar este lançamento');
      }
    }

    await prisma.financeiro.delete({
      where: { id },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_DELETE,
      'financeiro',
      id
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(lancamento.franchisee_id, {
        type: 'DELETE',
        data: { id },
      });
    }

    return reply.status(200).send({
      success: true,
      message: 'Lançamento deletado com sucesso',
    });
  });

  /**
   * PATCH /api/financeiro/:id/pago
   * Marcar como pago/não pago
   */
  app.patch('/:id/pago', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Marcar lançamento como pago ou não pago',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lançamento' },
        },
      },
      body: {
        type: 'object',
        required: ['pago'],
        properties: {
          pago: { type: 'boolean', description: 'Status de pagamento' },
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
                pago: { type: 'boolean' },
              },
            },
          },
        },
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { pago } = request.body as { pago: boolean };
    const context = getContext(request);

    const lancamento = await prisma.financeiro.findUnique({
      where: { id },
    });

    if (!lancamento) {
      throw new NotFoundError('Lançamento não encontrado');
    }

    // Verificar permissão
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && lancamento.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissão para modificar este lançamento');
      }
    }

    const updated = await prisma.financeiro.update({
      where: { id },
      data: { pago },
    });

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(lancamento.franchisee_id, {
        type: 'UPDATE',
        data: updated,
      });
    }

    return reply.status(200).send({
      success: true,
      data: { id, pago: updated.pago },
    });
  });

  /**
   * GET /api/financeiro/summary
   * Resumo financeiro
   */
  app.get('/summary', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Resumo financeiro com totais de entradas e saídas',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          data_inicio: { type: 'string', format: 'date', description: 'Data inicial' },
          data_fim: { type: 'string', format: 'date', description: 'Data final' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado (apenas admin)' },
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
                totalEntradas: { type: 'number', description: 'Total de entradas' },
                totalSaidas: { type: 'number', description: 'Total de saídas' },
                saldo: { type: 'number', description: 'Saldo (entradas - saídas)' },
                totalEntradasPagas: { type: 'number', description: 'Total de entradas pagas' },
                totalSaidasPagas: { type: 'number', description: 'Total de saídas pagas' },
                saldoPago: { type: 'number', description: 'Saldo pago' },
                entradasAPagar: { type: 'number', description: 'Entradas a receber' },
                saidasAPagar: { type: 'number', description: 'Saídas a pagar' },
                countEntradas: { type: 'number', description: 'Quantidade de entradas' },
                countSaidas: { type: 'number', description: 'Quantidade de saídas' },
              },
            },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { data_inicio, data_fim, franchisee_id } = request.query as {
      data_inicio?: string;
      data_fim?: string;
      franchisee_id?: string;
    };

    const context = getContext(request);
    const where: any = {};

    // Aplicar filtro baseado no role
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    if (franchisee_id && context.isMasterOrAdmin()) {
      where.franchisee_id = franchisee_id;
    }

    if (data_inicio || data_fim) {
      where.data = {};
      if (data_inicio) where.data.gte = new Date(data_inicio);
      if (data_fim) where.data.lte = new Date(data_fim);
    }

    const [entradas, saidas, entradasPagas, saidasPagas] = await Promise.all([
      prisma.financeiro.aggregate({
        where: { ...where, tipo: 'entrada' },
        _sum: { valor: true },
        _count: true,
      }),
      prisma.financeiro.aggregate({
        where: { ...where, tipo: 'saida' },
        _sum: { valor: true },
        _count: true,
      }),
      prisma.financeiro.aggregate({
        where: { ...where, tipo: 'entrada', pago: true },
        _sum: { valor: true },
      }),
      prisma.financeiro.aggregate({
        where: { ...where, tipo: 'saida', pago: true },
        _sum: { valor: true },
      }),
    ]);

    const totalEntradas = Number(entradas._sum.valor || 0);
    const totalSaidas = Number(saidas._sum.valor || 0);
    const totalEntradasPagas = Number(entradasPagas._sum.valor || 0);
    const totalSaidasPagas = Number(saidasPagas._sum.valor || 0);

    return reply.status(200).send({
      success: true,
      data: {
        totalEntradas,
        totalSaidas,
        saldo: totalEntradas - totalSaidas,
        totalEntradasPagas,
        totalSaidasPagas,
        saldoPago: totalEntradasPagas - totalSaidasPagas,
        entradasAPagar: totalEntradas - totalEntradasPagas,
        saidasAPagar: totalSaidas - totalSaidasPagas,
        countEntradas: entradas._count,
        countSaidas: saidas._count,
      },
    });
  });

  /**
   * GET /api/financeiro/categorias
   * Listar categorias financeiras
   */
  app.get('/categorias', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar categorias financeiras ativas',
      tags: ['Financeiro'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: categoriaResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const categorias = await prisma.categoriaFinanceiro.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
    });

    return reply.status(200).send({
      success: true,
      data: categorias,
    });
  });
};

export default financeiroRoutes;
