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
const recorrenteResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    franchisee_id: { type: 'string', format: 'uuid' },
    tipo: { type: 'string' },
    placa: { type: 'string', nullable: true },
    motorcycle_id: { type: 'string', format: 'uuid', nullable: true },
    categoria_id: { type: 'string', format: 'uuid', nullable: true },
    locatario: { type: 'string', nullable: true },
    valor: { type: 'number' },
    descricao: { type: 'string' },
    frequencia: { type: 'string', enum: ['semanal', 'quinzenal', 'mensal'] },
    dia_vencimento: { type: 'number', nullable: true },
    data_inicio: { type: 'string', format: 'date' },
    data_fim: { type: 'string', format: 'date', nullable: true },
    ativo: { type: 'boolean' },
    created_by: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    franchisee: { type: 'object', nullable: true },
    motorcycle: { type: 'object', nullable: true },
    categoria: { type: 'object', nullable: true },
    creator: { type: 'object', nullable: true },
    historico: { type: 'array', items: { type: 'object' } },
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

// Schemas de validacao
const createRecorrenteSchema = z.object({
  franchisee_id: z.string().uuid('ID do franqueado invalido'),
  tipo: z.string().min(1, 'Tipo e obrigatorio'),
  placa: z.string().optional().nullable(),
  motorcycle_id: z.string().uuid().optional().nullable(),
  categoria_id: z.string().uuid().optional().nullable(),
  locatario: z.string().optional().nullable(),
  valor: z.number().positive('Valor deve ser positivo'),
  descricao: z.string().min(1, 'Descricao e obrigatoria'),
  frequencia: z.enum(['semanal', 'quinzenal', 'mensal'], {
    errorMap: () => ({ message: 'Frequencia deve ser semanal, quinzenal ou mensal' }),
  }),
  dia_vencimento: z.number().int().min(1).max(31).optional().nullable(),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicio invalida (YYYY-MM-DD)'),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data fim invalida (YYYY-MM-DD)').optional().nullable(),
  ativo: z.boolean().default(true),
});

const updateRecorrenteSchema = createRecorrenteSchema.partial();

const recorrentesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/recorrentes
   * Listar lancamentos recorrentes
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar lancamentos recorrentes com filtros RBAC',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: recorrenteResponseSchema },
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

    const recorrentes = await prisma.lancamentoRecorrente.findMany({
      where,
      include: {
        franchisee: true,
        motorcycle: true,
        categoria: true,
        creator: {
          select: { id: true, name: true, email: true },
        },
        historico: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return reply.status(200).send({
      success: true,
      data: recorrentes,
    });
  });

  /**
   * GET /api/recorrentes/:id
   * Obter lancamento recorrente por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter lancamento recorrente por ID',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: recorrenteResponseSchema,
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

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
      include: {
        franchisee: true,
        motorcycle: true,
        categoria: true,
        creator: {
          select: { id: true, name: true, email: true },
        },
        historico: true,
      },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para acessar este lancamento recorrente');
      }
    }

    return reply.status(200).send({
      success: true,
      data: recorrente,
    });
  });

  /**
   * POST /api/recorrentes
   * Criar lancamento recorrente
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar novo lancamento recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['franchisee_id', 'tipo', 'valor', 'descricao', 'frequencia', 'data_inicio'],
        properties: {
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          tipo: { type: 'string', description: 'Tipo de lancamento' },
          placa: { type: 'string', description: 'Placa da motocicleta' },
          motorcycle_id: { type: 'string', format: 'uuid', description: 'ID da motocicleta' },
          categoria_id: { type: 'string', format: 'uuid', description: 'ID da categoria' },
          locatario: { type: 'string', description: 'Nome do locatario' },
          valor: { type: 'number', minimum: 0, description: 'Valor do lancamento' },
          descricao: { type: 'string', minLength: 1, description: 'Descricao do lancamento' },
          frequencia: { type: 'string', enum: ['semanal', 'quinzenal', 'mensal'], description: 'Frequencia de geracao' },
          dia_vencimento: { type: 'number', minimum: 1, maximum: 31, description: 'Dia do vencimento' },
          data_inicio: { type: 'string', format: 'date', description: 'Data de inicio (YYYY-MM-DD)' },
          data_fim: { type: 'string', format: 'date', description: 'Data de fim (YYYY-MM-DD)' },
          ativo: { type: 'boolean', default: true, description: 'Status ativo' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: recorrenteResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const body = createRecorrenteSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;
    const context = getContext(request);

    // Se for franqueado, forcar franchisee_id
    if (context.isFranchisee()) {
      if (!context.franchiseeId) {
        throw new ForbiddenError('Usuario nao esta vinculado a um franqueado');
      }
      data.franchisee_id = context.franchiseeId;
    }

    // Verificar se franqueado existe
    const franchisee = await prisma.franchisee.findUnique({
      where: { id: data.franchisee_id },
    });

    if (!franchisee) {
      throw new NotFoundError('Franqueado nao encontrado');
    }

    const recorrente = await prisma.lancamentoRecorrente.create({
      data: {
        franchisee_id: data.franchisee_id,
        tipo: data.tipo,
        placa: data.placa,
        motorcycle_id: data.motorcycle_id,
        categoria_id: data.categoria_id,
        locatario: data.locatario,
        valor: data.valor,
        descricao: data.descricao,
        frequencia: data.frequencia,
        dia_vencimento: data.dia_vencimento,
        data_inicio: new Date(data.data_inicio),
        data_fim: data.data_fim ? new Date(data.data_fim) : null,
        ativo: data.ativo ?? true,
        created_by: context.userId,
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
      'lancamentos_recorrentes',
      recorrente.id,
      undefined,
      { tipo: recorrente.tipo, valor: recorrente.valor, frequencia: recorrente.frequencia }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'INSERT',
        data: recorrente,
      });
    }

    return reply.status(201).send({
      success: true,
      data: recorrente,
    });
  });

  /**
   * PUT /api/recorrentes/:id
   * Atualizar lancamento recorrente
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar lancamento recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      body: {
        type: 'object',
        properties: {
          franchisee_id: { type: 'string', format: 'uuid' },
          tipo: { type: 'string' },
          placa: { type: 'string' },
          motorcycle_id: { type: 'string', format: 'uuid' },
          categoria_id: { type: 'string', format: 'uuid' },
          locatario: { type: 'string' },
          valor: { type: 'number', minimum: 0 },
          descricao: { type: 'string', minLength: 1 },
          frequencia: { type: 'string', enum: ['semanal', 'quinzenal', 'mensal'] },
          dia_vencimento: { type: 'number', minimum: 1, maximum: 31 },
          data_inicio: { type: 'string', format: 'date' },
          data_fim: { type: 'string', format: 'date' },
          ativo: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: recorrenteResponseSchema,
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
    const body = updateRecorrenteSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const context = getContext(request);

    const existingRecorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!existingRecorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && existingRecorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para modificar este lancamento recorrente');
      }
    }

    const data = body.data;

    const recorrente = await prisma.lancamentoRecorrente.update({
      where: { id },
      data: {
        ...data,
        data_inicio: data.data_inicio ? new Date(data.data_inicio) : undefined,
        data_fim: data.data_fim !== undefined ? (data.data_fim ? new Date(data.data_fim) : null) : undefined,
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
      'lancamentos_recorrentes',
      id,
      existingRecorrente,
      data
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'UPDATE',
        data: recorrente,
      });
    }

    return reply.status(200).send({
      success: true,
      data: recorrente,
    });
  });

  /**
   * DELETE /api/recorrentes/:id
   * Deletar lancamento recorrente
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar lancamento recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
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

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para deletar este lancamento recorrente');
      }
    }

    await prisma.lancamentoRecorrente.delete({
      where: { id },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_DELETE,
      'lancamentos_recorrentes',
      id
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'DELETE',
        data: { id },
      });
    }

    return reply.status(200).send({
      success: true,
      message: 'Lancamento recorrente deletado com sucesso',
    });
  });

  /**
   * PATCH /api/recorrentes/:id/toggle
   * Ativar/desativar lancamento recorrente
   */
  app.patch('/:id/toggle', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Ativar ou desativar lancamento recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      body: {
        type: 'object',
        required: ['ativo'],
        properties: {
          ativo: { type: 'boolean', description: 'Status ativo' },
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
                ativo: { type: 'boolean' },
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
    const { ativo } = request.body as { ativo: boolean };
    const context = getContext(request);

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para modificar este lancamento recorrente');
      }
    }

    const updated = await prisma.lancamentoRecorrente.update({
      where: { id },
      data: { ativo },
    });

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'UPDATE',
        data: updated,
      });
    }

    return reply.status(200).send({
      success: true,
      data: { id, ativo: updated.ativo },
    });
  });

  /**
   * POST /api/recorrentes/:id/gerar
   * Gerar lancamentos financeiros a partir de um recorrente
   */
  app.post('/:id/gerar', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Gerar lancamentos financeiros a partir de um template recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      body: {
        type: 'object',
        required: ['data_ate'],
        properties: {
          data_ate: { type: 'string', format: 'date', description: 'Data limite para geracao (YYYY-MM-DD)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            count: { type: 'number' },
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
    const { data_ate } = request.body as { data_ate: string };
    const context = getContext(request);

    if (!data_ate || !/^\d{4}-\d{2}-\d{2}$/.test(data_ate)) {
      throw new BadRequestError('data_ate e obrigatoria no formato YYYY-MM-DD');
    }

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para gerar lancamentos deste recorrente');
      }
    }

    const result: { gerar_lancamentos_recorrentes: number }[] = await prisma.$queryRaw`
      SELECT gerar_lancamentos_recorrentes(${id}::uuid, ${data_ate}::date)
    `;

    const count = result[0]?.gerar_lancamentos_recorrentes ?? 0;

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_CREATE,
      'lancamentos_recorrentes',
      id,
      undefined,
      { action: 'gerar', data_ate, count }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'INSERT',
        data: { recorrente_id: id, count },
      });
    }

    return reply.status(200).send({
      success: true,
      message: `${count} lancamento(s) gerado(s) com sucesso`,
      count,
    });
  });

  /**
   * POST /api/recorrentes/gerar-todos
   * Gerar lancamentos de todos os recorrentes ativos
   */
  app.post('/gerar-todos', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Gerar lancamentos financeiros de todos os recorrentes ativos',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          data_ate: { type: 'string', format: 'date', description: 'Data limite para geracao (YYYY-MM-DD). Se nao informada, usa data atual.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            count: { type: 'number' },
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { data_ate } = (request.body as { data_ate?: string }) || {};
    const context = getContext(request);

    const dataParam = data_ate || new Date().toISOString().split('T')[0];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataParam)) {
      throw new BadRequestError('data_ate deve estar no formato YYYY-MM-DD');
    }

    const result: { gerar_todos_lancamentos_recorrentes: number }[] = await prisma.$queryRaw`
      SELECT gerar_todos_lancamentos_recorrentes(${dataParam}::date)
    `;

    const count = result[0]?.gerar_todos_lancamentos_recorrentes ?? 0;

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_CREATE,
      'lancamentos_recorrentes',
      undefined,
      undefined,
      { action: 'gerar_todos', data_ate: dataParam, count }
    );

    return reply.status(200).send({
      success: true,
      message: `${count} lancamento(s) gerado(s) com sucesso`,
      count,
    });
  });

  /**
   * DELETE /api/recorrentes/:id/lancamentos
   * Deletar todos os lancamentos gerados de um recorrente
   */
  app.delete('/:id/lancamentos', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar todos os lancamentos financeiros gerados a partir de um recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            count: { type: 'number' },
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

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para deletar lancamentos deste recorrente');
      }
    }

    // Buscar todos os historicos para obter os financeiro_ids
    const historicos = await prisma.lancamentoRecorrenteHistorico.findMany({
      where: { recorrente_id: id },
      select: { financeiro_id: true },
    });

    const financeiroIds = historicos.map(h => h.financeiro_id);

    if (financeiroIds.length === 0) {
      return reply.status(200).send({
        success: true,
        message: 'Nenhum lancamento encontrado para deletar',
        count: 0,
      });
    }

    // Deletar os registros financeiros (historico sera deletado em cascata)
    const deleteResult = await prisma.financeiro.deleteMany({
      where: { id: { in: financeiroIds } },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_DELETE,
      'lancamentos_recorrentes',
      id,
      undefined,
      { action: 'deletar_lancamentos', count: deleteResult.count }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'DELETE',
        data: { recorrente_id: id, count: deleteResult.count },
      });
    }

    return reply.status(200).send({
      success: true,
      message: `${deleteResult.count} lancamento(s) deletado(s) com sucesso`,
      count: deleteResult.count,
    });
  });

  /**
   * DELETE /api/recorrentes/:id/lancamentos-futuros
   * Deletar lancamentos futuros de um recorrente
   */
  app.delete('/:id/lancamentos-futuros', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar lancamentos financeiros futuros gerados a partir de um recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      body: {
        type: 'object',
        required: ['data_inicial'],
        properties: {
          data_inicial: { type: 'string', format: 'date', description: 'Data a partir da qual deletar (YYYY-MM-DD)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            count: { type: 'number' },
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
    const { data_inicial } = request.body as { data_inicial: string };
    const context = getContext(request);

    if (!data_inicial || !/^\d{4}-\d{2}-\d{2}$/.test(data_inicial)) {
      throw new BadRequestError('data_inicial e obrigatoria no formato YYYY-MM-DD');
    }

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para deletar lancamentos deste recorrente');
      }
    }

    // Buscar historicos com join no financeiro para filtrar por data
    const historicos = await prisma.lancamentoRecorrenteHistorico.findMany({
      where: { recorrente_id: id },
      include: {
        financeiro: {
          select: { id: true, data: true },
        },
      },
    });

    const dataLimite = new Date(data_inicial);
    const financeiroIds = historicos
      .filter(h => h.financeiro.data >= dataLimite)
      .map(h => h.financeiro_id);

    if (financeiroIds.length === 0) {
      return reply.status(200).send({
        success: true,
        message: 'Nenhum lancamento futuro encontrado para deletar',
        count: 0,
      });
    }

    // Deletar os registros financeiros (historico sera deletado em cascata)
    const deleteResult = await prisma.financeiro.deleteMany({
      where: { id: { in: financeiroIds } },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_DELETE,
      'lancamentos_recorrentes',
      id,
      undefined,
      { action: 'deletar_lancamentos_futuros', data_inicial, count: deleteResult.count }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'DELETE',
        data: { recorrente_id: id, count: deleteResult.count },
      });
    }

    return reply.status(200).send({
      success: true,
      message: `${deleteResult.count} lancamento(s) futuro(s) deletado(s) com sucesso`,
      count: deleteResult.count,
    });
  });

  /**
   * PUT /api/recorrentes/:id/lancamentos-futuros
   * Atualizar lancamentos futuros de um recorrente
   */
  app.put('/:id/lancamentos-futuros', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar lancamentos financeiros futuros gerados a partir de um recorrente',
      tags: ['Recorrentes'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do lancamento recorrente' },
        },
      },
      body: {
        type: 'object',
        required: ['data_inicial', 'dados'],
        properties: {
          data_inicial: { type: 'string', format: 'date', description: 'Data a partir da qual atualizar (YYYY-MM-DD)' },
          dados: {
            type: 'object',
            properties: {
              tipo: { type: 'string' },
              placa: { type: 'string' },
              motorcycle_id: { type: 'string', format: 'uuid' },
              categoria_id: { type: 'string', format: 'uuid' },
              locatario: { type: 'string' },
              valor: { type: 'number', minimum: 0 },
              descricao: { type: 'string' },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            count: { type: 'number' },
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
    const { data_inicial, dados } = request.body as {
      data_inicial: string;
      dados: {
        tipo?: string;
        placa?: string;
        motorcycle_id?: string;
        categoria_id?: string;
        locatario?: string;
        valor?: number;
        descricao?: string;
      };
    };
    const context = getContext(request);

    if (!data_inicial || !/^\d{4}-\d{2}-\d{2}$/.test(data_inicial)) {
      throw new BadRequestError('data_inicial e obrigatoria no formato YYYY-MM-DD');
    }

    if (!dados || Object.keys(dados).length === 0) {
      throw new BadRequestError('dados e obrigatorio e deve conter ao menos um campo para atualizar');
    }

    const recorrente = await prisma.lancamentoRecorrente.findUnique({
      where: { id },
    });

    if (!recorrente) {
      throw new NotFoundError('Lancamento recorrente nao encontrado');
    }

    // Verificar permissao
    if (!context.isMasterOrAdmin()) {
      if (context.isFranchisee() && recorrente.franchisee_id !== context.franchiseeId) {
        throw new ForbiddenError('Sem permissao para modificar lancamentos deste recorrente');
      }
    }

    // Buscar historicos com join no financeiro para filtrar por data
    const historicos = await prisma.lancamentoRecorrenteHistorico.findMany({
      where: { recorrente_id: id },
      include: {
        financeiro: {
          select: { id: true, data: true },
        },
      },
    });

    const dataLimite = new Date(data_inicial);
    const financeiroIds = historicos
      .filter(h => h.financeiro.data >= dataLimite)
      .map(h => h.financeiro_id);

    if (financeiroIds.length === 0) {
      return reply.status(200).send({
        success: true,
        message: 'Nenhum lancamento futuro encontrado para atualizar',
        count: 0,
      });
    }

    // Montar dados de atualizacao
    const updateData: any = {};
    if (dados.tipo !== undefined) updateData.tipo = dados.tipo;
    if (dados.placa !== undefined) updateData.placa = dados.placa;
    if (dados.motorcycle_id !== undefined) updateData.motorcycle_id = dados.motorcycle_id;
    if (dados.categoria_id !== undefined) updateData.categoria_id = dados.categoria_id;
    if (dados.locatario !== undefined) updateData.locatario = dados.locatario;
    if (dados.valor !== undefined) updateData.valor = dados.valor;
    if (dados.descricao !== undefined) updateData.descricao = dados.descricao + ' (Recorrente)';

    const updateResult = await prisma.financeiro.updateMany({
      where: { id: { in: financeiroIds } },
      data: updateData,
    });

    await auditService.logFromRequest(
      request,
      AuditActions.FINANCE_UPDATE,
      'lancamentos_recorrentes',
      id,
      undefined,
      { action: 'atualizar_lancamentos_futuros', data_inicial, dados, count: updateResult.count }
    );

    // Emitir evento realtime
    if (realtimeService) {
      realtimeService.emitFinanceiroChange(recorrente.franchisee_id, {
        type: 'UPDATE',
        data: { recorrente_id: id, count: updateResult.count },
      });
    }

    return reply.status(200).send({
      success: true,
      message: `${updateResult.count} lancamento(s) futuro(s) atualizado(s) com sucesso`,
      count: updateResult.count,
    });
  });
};

export default recorrentesRoutes;
