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

const campaignResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    campaign_details: { type: 'string', nullable: true },
    launch_period: { type: 'string' },
    start_date: { type: 'string', format: 'date-time' },
    end_date: { type: 'string', format: 'date-time' },
    status: { type: 'string' },
    created_by: { type: 'string', format: 'uuid' },
    created_at: { type: 'string', format: 'date-time', nullable: true },
    updated_at: { type: 'string', format: 'date-time', nullable: true },
  },
};

const campaignSurveysRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/campaign-surveys
   * Listar campanhas
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar campanhas de votação',
      tags: ['Campanhas'],
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
            data: { type: 'array', items: campaignResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { status } = request.query as { status?: string };
    const context = getContext(request);

    // Franqueado só vê campanhas ativas
    const filterStatus = context.role === 'franchisee' ? 'active' : status;

    const campaigns = await prisma.campaignSurvey.findMany({
      where: filterStatus ? { status: filterStatus } : {},
      orderBy: { created_at: 'desc' },
    });

    return reply.status(200).send({
      success: true,
      data: campaigns,
    });
  });

  /**
   * GET /api/campaign-surveys/:id
   * Obter detalhes de uma campanha
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter detalhes de uma campanha',
      tags: ['Campanhas'],
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
            data: campaignResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const campaign = await prisma.campaignSurvey.findUnique({
      where: { id },
    });

    if (!campaign) {
      return reply.status(404).send({
        success: false,
        error: 'Campanha não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: campaign,
    });
  });

  /**
   * POST /api/campaign-surveys
   * Criar nova campanha
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Criar nova campanha',
      tags: ['Campanhas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'launch_period', 'start_date', 'end_date'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          campaign_details: { type: 'string' },
          launch_period: { type: 'string' },
          start_date: { type: 'string', format: 'date-time' },
          end_date: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: campaignResponseSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { name, description, campaign_details, launch_period, start_date, end_date } = request.body as {
      name: string;
      description?: string;
      campaign_details?: string;
      launch_period: string;
      start_date: string;
      end_date: string;
    };
    const context = getContext(request);

    // Criar campanha já ativa
    const campaign = await prisma.campaignSurvey.create({
      data: {
        name,
        description,
        campaign_details,
        launch_period,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        status: 'active',
        created_by: context.userId!,
      },
    });

    // Criar respostas para todos os franqueados ativos com city_id
    const allFranchisees = await prisma.franchisee.findMany({
      where: { status: 'active' },
      select: { id: true, city_id: true },
    });

    // Filtrar apenas os que têm city_id definido
    const franchisees = allFranchisees.filter(f => f.city_id !== null && f.city_id !== undefined);

    if (franchisees.length > 0) {
      await prisma.campaignResponse.createMany({
        data: franchisees.map(f => ({
          campaign_id: campaign.id,
          franchisee_id: f.id,
          city_id: f.city_id as string,
          vote: 'accepted',
          status: 'pending',
        })),
        skipDuplicates: true,
      });
    }

    return reply.status(201).send({
      success: true,
      data: campaign,
    });
  });

  /**
   * PUT /api/campaign-surveys/:id
   * Atualizar campanha
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar campanha',
      tags: ['Campanhas'],
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
          campaign_details: { type: 'string' },
          launch_period: { type: 'string' },
          start_date: { type: 'string', format: 'date-time' },
          end_date: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: campaignResponseSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name, description, campaign_details, launch_period, start_date, end_date } = request.body as {
      name?: string;
      description?: string;
      campaign_details?: string;
      launch_period?: string;
      start_date?: string;
      end_date?: string;
    };

    const existing = await prisma.campaignSurvey.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Campanha não encontrada',
      });
    }

    const campaign = await prisma.campaignSurvey.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(campaign_details !== undefined && { campaign_details }),
        ...(launch_period && { launch_period }),
        ...(start_date && { start_date: new Date(start_date) }),
        ...(end_date && { end_date: new Date(end_date) }),
      },
    });

    return reply.status(200).send({
      success: true,
      data: campaign,
    });
  });

  /**
   * POST /api/campaign-surveys/:id/activate
   * Ativar campanha
   */
  app.post('/:id/activate', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Ativar campanha',
      tags: ['Campanhas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const campaign = await prisma.campaignSurvey.update({
      where: { id },
      data: { status: 'active' },
    });

    // Criar respostas para franqueados que ainda não têm
    const allFranchiseesActivate = await prisma.franchisee.findMany({
      where: { status: 'active' },
      select: { id: true, city_id: true },
    });

    const franchiseesWithCity = allFranchiseesActivate.filter(f => f.city_id !== null && f.city_id !== undefined);

    if (franchiseesWithCity.length > 0) {
      await prisma.campaignResponse.createMany({
        data: franchiseesWithCity.map(f => ({
          campaign_id: id,
          franchisee_id: f.id,
          city_id: f.city_id as string,
          vote: 'accepted',
          status: 'pending',
        })),
        skipDuplicates: true,
      });
    }

    return reply.status(200).send({
      success: true,
      data: campaign,
    });
  });

  /**
   * POST /api/campaign-surveys/:id/close
   * Encerrar campanha
   */
  app.post('/:id/close', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Encerrar campanha',
      tags: ['Campanhas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const campaign = await prisma.campaignSurvey.update({
      where: { id },
      data: { status: 'closed' },
    });

    // Cancelar respostas pendentes
    await prisma.campaignResponse.updateMany({
      where: {
        campaign_id: id,
        status: 'pending',
      },
      data: { status: 'cancelled' },
    });

    return reply.status(200).send({
      success: true,
      data: campaign,
    });
  });

  /**
   * DELETE /api/campaign-surveys/:id
   * Excluir campanha
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Excluir campanha',
      tags: ['Campanhas'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await prisma.campaignSurvey.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
    });
  });

  /**
   * GET /api/campaign-surveys/:id/results
   * Obter resultados de uma campanha
   */
  app.get('/:id/results', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter resultados de uma campanha',
      tags: ['Campanhas'],
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

    // Buscar campanha
    const campaign = await prisma.campaignSurvey.findUnique({
      where: { id },
    });

    if (!campaign) {
      return reply.status(404).send({
        success: false,
        error: 'Campanha não encontrada',
      });
    }

    // Buscar respostas
    const responses = await prisma.campaignResponse.findMany({
      where: {
        campaign_id: id,
        ...(filterCityId && { city_id: filterCityId }),
      },
      include: {
        franchisee: {
          select: {
            id: true,
            company_name: true,
            fantasy_name: true,
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
    const totalResponses = responses.length;
    const completedResponses = responses.filter(r => r.status === 'completed').length;
    const pendingResponses = responses.filter(r => r.status === 'pending').length;
    const cancelledResponses = responses.filter(r => r.status === 'cancelled').length;
    const totalAccepted = responses.filter(r => r.status === 'completed' && r.vote === 'accepted').length;
    const totalRejected = responses.filter(r => r.status === 'completed' && r.vote === 'rejected').length;

    const responseRate = totalResponses > 0 ? Math.round((completedResponses / totalResponses) * 100) : 0;
    const acceptanceRate = completedResponses > 0 ? Math.round((totalAccepted / completedResponses) * 100) : 0;

    // Resultados individuais por cidade (cada resposta como registro separado)
    const resultsByCity = responses.map(r => ({
      response_id: r.id,
      campaign_id: r.campaign_id,
      city_id: r.city_id,
      city_name: r.city?.name || '',
      city_slug: r.city?.slug || '',
      regional_user_id: r.franchisee_id,
      regional_name: r.franchisee?.fantasy_name || r.franchisee?.company_name || '',
      regional_email: r.franchisee?.email || '',
      vote: r.status === 'completed' ? r.vote : null,
      observations: r.observations,
      status: r.status,
      voted_at: r.completed_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    // Agregação por cidade (para compatibilidade)
    const cityAggregation = responses.reduce((acc, r) => {
      const cityId = r.city_id;
      if (!acc[cityId]) {
        acc[cityId] = {
          city_id: cityId,
          city_name: r.city?.name || '',
          city_slug: r.city?.slug || '',
          total: 0,
          completed: 0,
          accepted: 0,
          rejected: 0,
        };
      }
      acc[cityId].total++;
      if (r.status === 'completed') {
        acc[cityId].completed++;
        if (r.vote === 'accepted') acc[cityId].accepted++;
        if (r.vote === 'rejected') acc[cityId].rejected++;
      }
      return acc;
    }, {} as Record<string, any>);

    return reply.status(200).send({
      success: true,
      data: {
        campaign,
        summary: {
          campaign_id: id,
          name: campaign.name,
          description: campaign.description,
          campaign_details: campaign.campaign_details,
          launch_period: campaign.launch_period,
          start_date: campaign.start_date,
          end_date: campaign.end_date,
          status: campaign.status,
          created_at: campaign.created_at,
          total_responses: totalResponses,
          completed_responses: completedResponses,
          pending_responses: pendingResponses,
          cancelled_responses: cancelledResponses,
          total_accepted: totalAccepted,
          total_rejected: totalRejected,
          acceptance_rate: acceptanceRate,
          response_rate: responseRate,
        },
        resultsByCity,
        cityAggregation: Object.values(cityAggregation),
        responses: responses.map(r => ({
          response_id: r.id,
          campaign_id: r.campaign_id,
          city_id: r.city_id,
          city_name: r.city?.name,
          city_slug: r.city?.slug,
          franchisee_id: r.franchisee_id,
          franchisee_name: r.franchisee?.fantasy_name || r.franchisee?.company_name,
          vote: r.vote,
          observations: r.observations,
          status: r.status,
          voted_at: r.completed_at,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      },
    });
  });

  /**
   * GET /api/campaign-surveys/pending/franchisee
   * Obter campanhas pendentes para o franqueado
   */
  app.get('/pending/franchisee', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['franchisee'] })],
    schema: {
      description: 'Obter campanhas pendentes para o franqueado',
      tags: ['Campanhas'],
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

    // Buscar respostas do franqueado
    const responses = await prisma.campaignResponse.findMany({
      where: {
        franchisee_id: context.franchiseeId,
        campaign: {
          status: 'active',
        },
      },
      include: {
        campaign: true,
        city: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: responses,
    });
  });

  /**
   * GET /api/campaign-surveys/responses/:responseId
   * Obter detalhes de uma resposta específica
   */
  app.get('/responses/:responseId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter detalhes de uma resposta de campanha',
      tags: ['Campanhas'],
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

    const response = await prisma.campaignResponse.findUnique({
      where: { id: responseId },
      include: {
        campaign: true,
        franchisee: {
          select: {
            id: true,
            company_name: true,
            fantasy_name: true,
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
      data: {
        ...response,
        franchisee: response.franchisee ? {
          id: response.franchisee.id,
          name: response.franchisee.fantasy_name || response.franchisee.company_name,
          email: response.franchisee.email,
        } : undefined,
      },
    });
  });

  /**
   * POST /api/campaign-surveys/responses/:responseId/submit
   * Submeter voto da campanha
   */
  app.post('/responses/:responseId/submit', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['franchisee'] })],
    schema: {
      description: 'Submeter voto da campanha',
      tags: ['Campanhas'],
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
        required: ['vote'],
        properties: {
          vote: { type: 'string', enum: ['accepted', 'rejected'] },
          observations: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { responseId } = request.params as { responseId: string };
    const { vote, observations } = request.body as {
      vote: 'accepted' | 'rejected';
      observations?: string;
    };
    const context = getContext(request);

    // Verificar se a resposta pertence ao franqueado
    const response = await prisma.campaignResponse.findUnique({
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
        error: 'Esta campanha já foi votada',
      });
    }

    // Atualizar resposta
    const updatedResponse = await prisma.campaignResponse.update({
      where: { id: responseId },
      data: {
        vote,
        observations: observations?.trim() || null,
        status: 'completed',
        completed_at: new Date(),
      },
    });

    // Cancelar outras respostas pendentes da mesma cidade e campanha
    await prisma.campaignResponse.updateMany({
      where: {
        campaign_id: response.campaign_id,
        city_id: response.city_id,
        status: 'pending',
        id: { not: responseId },
      },
      data: { status: 'cancelled' },
    });

    return reply.status(200).send({
      success: true,
      data: updatedResponse,
    });
  });

  /**
   * POST /api/campaign-surveys/sync
   * Sincronizar campanhas para todos os franqueados
   */
  app.post('/sync', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Sincronizar campanhas para todos os franqueados',
      tags: ['Campanhas'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    // Buscar campanhas ativas
    const activeCampaigns = await prisma.campaignSurvey.findMany({
      where: { status: 'active' },
      select: { id: true },
    });

    // Buscar franqueados ativos
    const allFranchiseesSync = await prisma.franchisee.findMany({
      where: { status: 'active' },
      select: { id: true, city_id: true },
    });

    const franchiseesSync = allFranchiseesSync.filter(f => f.city_id !== null && f.city_id !== undefined);

    let totalCreated = 0;

    // Criar respostas para todas as combinações
    for (const campaign of activeCampaigns) {
      const result = await prisma.campaignResponse.createMany({
        data: franchiseesSync.map(f => ({
          campaign_id: campaign.id,
          franchisee_id: f.id,
          city_id: f.city_id as string,
          vote: 'accepted',
          status: 'pending',
        })),
        skipDuplicates: true,
      });
      totalCreated += result.count;
    }

    return reply.status(200).send({
      success: true,
      data: [
        { action: 'Campanhas criadas', count: totalCreated },
        { action: 'Franquias atualizadas', count: franchisees.length },
      ],
    });
  });
};

export default campaignSurveysRoutes;
