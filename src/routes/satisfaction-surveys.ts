import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
  },
};

const surveyResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    evaluation_period: { type: 'string' },
    start_date: { type: 'string', format: 'date-time' },
    end_date: { type: 'string', format: 'date-time' },
    status: { type: 'string' },
    created_by: { type: 'string', format: 'uuid' },
    created_at: { type: 'string', format: 'date-time', nullable: true },
    updated_at: { type: 'string', format: 'date-time', nullable: true },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          order_index: { type: 'number' },
        },
      },
    },
  },
};

const satisfactionSurveysRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/satisfaction-surveys
   * Listar pesquisas de satisfação
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar pesquisas de satisfação',
      tags: ['Pesquisa de Satisfação'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filtrar por status (draft, active, closed)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: surveyResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { status } = request.query as { status?: string };
    const context = getContext(request);

    // Apenas Master BR e Admin podem ver pesquisas
    if (!context.isMasterOrAdmin()) {
      return reply.status(403).send({
        success: false,
        error: 'Acesso negado',
      });
    }

    const surveys = await prisma.satisfactionSurvey.findMany({
      where: status ? { status } : {},
      include: {
        criteria: {
          orderBy: { order_index: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return reply.status(200).send({
      success: true,
      data: surveys,
    });
  });

  /**
   * GET /api/satisfaction-surveys/:id
   * Obter detalhes de uma pesquisa
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter detalhes de uma pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
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
            data: surveyResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const survey = await prisma.satisfactionSurvey.findUnique({
      where: { id },
      include: {
        criteria: {
          orderBy: { order_index: 'asc' },
        },
      },
    });

    if (!survey) {
      return reply.status(404).send({
        success: false,
        error: 'Pesquisa não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: survey,
    });
  });

  /**
   * POST /api/satisfaction-surveys
   * Criar nova pesquisa de satisfação
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Criar nova pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'evaluation_period', 'start_date', 'end_date', 'criteria'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          evaluation_period: { type: 'string' },
          start_date: { type: 'string', format: 'date-time' },
          end_date: { type: 'string', format: 'date-time' },
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: surveyResponseSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { name, description, evaluation_period, start_date, end_date, criteria } = request.body as {
      name: string;
      description?: string;
      evaluation_period: string;
      start_date: string;
      end_date: string;
      criteria: { name: string; description?: string }[];
    };
    const context = getContext(request);

    const survey = await prisma.satisfactionSurvey.create({
      data: {
        name,
        description,
        evaluation_period,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        status: 'draft',
        created_by: context.userId!,
        criteria: {
          create: criteria.map((c, index) => ({
            name: c.name,
            description: c.description,
            order_index: index,
          })),
        },
      },
      include: {
        criteria: {
          orderBy: { order_index: 'asc' },
        },
      },
    });

    return reply.status(201).send({
      success: true,
      data: survey,
    });
  });

  /**
   * PUT /api/satisfaction-surveys/:id
   * Atualizar pesquisa de satisfação
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
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
          name: { type: 'string' },
          description: { type: 'string' },
          evaluation_period: { type: 'string' },
          start_date: { type: 'string', format: 'date-time' },
          end_date: { type: 'string', format: 'date-time' },
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: surveyResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, description, evaluation_period, start_date, end_date, criteria } = request.body as {
      name?: string;
      description?: string;
      evaluation_period?: string;
      start_date?: string;
      end_date?: string;
      criteria?: { name: string; description?: string }[];
    };

    // Verificar se existe
    const existing = await prisma.satisfactionSurvey.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Pesquisa não encontrada',
      });
    }

    // Atualizar critérios se fornecidos
    if (criteria) {
      // Deletar critérios antigos
      await prisma.surveyCriteria.deleteMany({ where: { survey_id: id } });

      // Criar novos critérios
      await prisma.surveyCriteria.createMany({
        data: criteria.map((c, index) => ({
          survey_id: id,
          name: c.name,
          description: c.description,
          order_index: index,
        })),
      });
    }

    // Atualizar pesquisa
    const survey = await prisma.satisfactionSurvey.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(evaluation_period && { evaluation_period }),
        ...(start_date && { start_date: new Date(start_date) }),
        ...(end_date && { end_date: new Date(end_date) }),
      },
      include: {
        criteria: {
          orderBy: { order_index: 'asc' },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: survey,
    });
  });

  /**
   * POST /api/satisfaction-surveys/:id/activate
   * Ativar pesquisa de satisfação
   */
  app.post('/:id/activate', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Ativar pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
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
            data: surveyResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const survey = await prisma.satisfactionSurvey.update({
      where: { id },
      data: { status: 'active' },
      include: {
        criteria: {
          orderBy: { order_index: 'asc' },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: survey,
    });
  });

  /**
   * POST /api/satisfaction-surveys/:id/close
   * Encerrar pesquisa de satisfação
   */
  app.post('/:id/close', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Encerrar pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
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
            data: surveyResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Atualizar status da pesquisa
    const survey = await prisma.satisfactionSurvey.update({
      where: { id },
      data: { status: 'closed' },
      include: {
        criteria: {
          orderBy: { order_index: 'asc' },
        },
      },
    });

    // Cancelar respostas pendentes
    await prisma.surveyResponse.updateMany({
      where: {
        survey_id: id,
        status: 'pending',
      },
      data: { status: 'cancelled' },
    });

    return reply.status(200).send({
      success: true,
      data: survey,
    });
  });

  /**
   * DELETE /api/satisfaction-surveys/:id
   * Excluir pesquisa de satisfação
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Excluir pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
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
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await prisma.satisfactionSurvey.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
    });
  });

  /**
   * GET /api/satisfaction-surveys/:id/results
   * Obter resultados de uma pesquisa
   */
  app.get('/:id/results', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter resultados de uma pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid', description: 'Filtrar por cidade' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { city_id } = request.query as { city_id?: string };
    const context = getContext(request);

    // Para regional, filtrar apenas pela sua cidade
    const filterCityId = context.isMasterOrAdmin() ? city_id : context.cityId;

    // Buscar respostas completas
    const responses = await prisma.surveyResponse.findMany({
      where: {
        survey_id: id,
        status: 'completed',
        ...(filterCityId && { city_id: filterCityId }),
      },
      include: {
        ratings: {
          include: {
            criteria: true,
          },
        },
        franchisee: {
          select: {
            company_name: true,
            fantasy_name: true,
            city_id: true,
          },
        },
        regionalUser: {
          select: {
            name: true,
            email: true,
          },
        },
        city: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { completed_at: 'desc' },
    });

    // Calcular estatísticas
    const allRatings = responses.flatMap(r => r.ratings.map(rt => rt.rating));
    const averageRating = allRatings.length > 0
      ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
      : 0;

    // NPS (0-6 detractors, 7-8 passive, 9-10 promoters)
    const promoters = allRatings.filter(r => r >= 9).length;
    const detractors = allRatings.filter(r => r <= 6).length;
    const nps = allRatings.length > 0
      ? Math.round(((promoters - detractors) / allRatings.length) * 100)
      : 0;

    // Resultados por critério
    const criteriaResults = await prisma.surveyCriteria.findMany({
      where: { survey_id: id },
      orderBy: { order_index: 'asc' },
    });

    const resultsByCriteria = criteriaResults.map(criteria => {
      const criteriaRatings = responses.flatMap(r =>
        r.ratings.filter(rt => rt.criteria_id === criteria.id).map(rt => rt.rating)
      );
      return {
        criteria_id: criteria.id,
        criteria_name: criteria.name,
        average_rating: criteriaRatings.length > 0
          ? criteriaRatings.reduce((a, b) => a + b, 0) / criteriaRatings.length
          : 0,
        total_responses: criteriaRatings.length,
      };
    });

    // Resultados por regional
    const regionalMap = new Map<string, { name: string; ratings: number[] }>();
    responses.forEach(response => {
      if (response.regionalUser) {
        const key = response.regional_user_id!;
        if (!regionalMap.has(key)) {
          regionalMap.set(key, {
            name: response.regionalUser.name || 'Sem nome',
            ratings: [],
          });
        }
        response.ratings.forEach(r => {
          regionalMap.get(key)!.ratings.push(r.rating);
        });
      }
    });

    const resultsByRegional = Array.from(regionalMap.entries()).map(([id, data]) => ({
      regional_user_id: id,
      regional_name: data.name,
      average_rating: data.ratings.length > 0
        ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length
        : 0,
      total_responses: data.ratings.length,
    }));

    return reply.status(200).send({
      success: true,
      data: {
        statistics: {
          totalResponses: responses.length,
          averageRating: Math.round(averageRating * 100) / 100,
          nps,
        },
        resultsByCriteria,
        resultsByRegional,
        responses,
      },
    });
  });

  /**
   * GET /api/satisfaction-surveys/pending
   * Obter pesquisas pendentes para franqueado
   */
  app.get('/pending/franchisee', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['franchisee'] })],
    schema: {
      description: 'Obter pesquisas pendentes para o franqueado',
      tags: ['Pesquisa de Satisfação'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);

    if (!context.franchiseeId) {
      return reply.status(400).send({
        success: false,
        error: 'Franqueado não encontrado',
      });
    }

    const pendingResponses = await prisma.surveyResponse.findMany({
      where: {
        franchisee_id: context.franchiseeId,
        status: 'pending',
        survey: {
          status: 'active',
        },
      },
      include: {
        survey: {
          include: {
            criteria: {
              orderBy: { order_index: 'asc' },
            },
          },
        },
        regionalUser: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: pendingResponses,
    });
  });

  /**
   * GET /api/satisfaction-surveys/responses/:responseId
   * Obter detalhes de uma resposta específica
   */
  app.get('/responses/:responseId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter detalhes de uma resposta de pesquisa',
      tags: ['Pesquisa de Satisfação'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          responseId: { type: 'string', format: 'uuid' },
        },
        required: ['responseId'],
      },
    },
  }, async (request, reply) => {
    const { responseId } = request.params as { responseId: string };
    const context = getContext(request);

    const response = await prisma.surveyResponse.findUnique({
      where: { id: responseId },
      include: {
        survey: {
          include: {
            criteria: {
              orderBy: { order_index: 'asc' },
            },
          },
        },
        ratings: true,
        regionalUser: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!response) {
      return reply.status(404).send({
        success: false,
        error: 'Resposta não encontrada',
      });
    }

    // Verificar permissão - franqueado só pode ver suas próprias respostas
    if (context.role === 'franchisee' && response.franchisee_id !== context.franchiseeId) {
      return reply.status(403).send({
        success: false,
        error: 'Acesso negado',
      });
    }

    return reply.status(200).send({
      success: true,
      data: response,
    });
  });

  /**
   * POST /api/satisfaction-surveys/responses/:responseId/submit
   * Submeter resposta de pesquisa
   */
  app.post('/responses/:responseId/submit', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['franchisee'] })],
    schema: {
      description: 'Submeter resposta de pesquisa de satisfação',
      tags: ['Pesquisa de Satisfação'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          responseId: { type: 'string', format: 'uuid' },
        },
        required: ['responseId'],
      },
      body: {
        type: 'object',
        required: ['ratings'],
        properties: {
          ratings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['criteria_id', 'rating'],
              properties: {
                criteria_id: { type: 'string', format: 'uuid' },
                rating: { type: 'number', minimum: 0, maximum: 10 },
                specific_comment: { type: 'string' },
              },
            },
          },
          general_comments: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { responseId } = request.params as { responseId: string };
    const { ratings, general_comments } = request.body as {
      ratings: { criteria_id: string; rating: number; specific_comment?: string }[];
      general_comments?: string;
    };
    const context = getContext(request);

    // Verificar se a resposta pertence ao franqueado
    const response = await prisma.surveyResponse.findUnique({
      where: { id: responseId },
    });

    if (!response) {
      return reply.status(404).send({
        success: false,
        error: 'Resposta não encontrada',
      });
    }

    if (response.franchisee_id !== context.franchiseeId) {
      return reply.status(403).send({
        success: false,
        error: 'Acesso negado',
      });
    }

    if (response.status !== 'pending') {
      return reply.status(400).send({
        success: false,
        error: 'Esta pesquisa já foi respondida',
      });
    }

    // Inserir/atualizar ratings
    for (const r of ratings) {
      await prisma.surveyRating.upsert({
        where: {
          response_id_criteria_id: {
            response_id: responseId,
            criteria_id: r.criteria_id,
          },
        },
        create: {
          response_id: responseId,
          criteria_id: r.criteria_id,
          rating: r.rating,
          specific_comment: r.specific_comment,
        },
        update: {
          rating: r.rating,
          specific_comment: r.specific_comment,
        },
      });
    }

    // Atualizar resposta como completa
    const updatedResponse = await prisma.surveyResponse.update({
      where: { id: responseId },
      data: {
        status: 'completed',
        general_comments,
        completed_at: new Date(),
      },
    });

    return reply.status(200).send({
      success: true,
      data: updatedResponse,
    });
  });
};

export default satisfactionSurveysRoutes;
