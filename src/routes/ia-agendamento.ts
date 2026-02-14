import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const iaAgendamentoRoutes: FastifyPluginAsync = async (app) => {

  // ========================
  // CONFIGURAÇÃO IA
  // ========================

  /**
   * GET /api/ia-agendamento/config
   * Buscar configuração do IA Agendamento
   */
  app.get('/config', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
  }, async (request, reply) => {
    const config = await prisma.iaAgendamentoConfig.findFirst();

    return reply.status(200).send({
      success: true,
      data: config,
    });
  });

  /**
   * PUT /api/ia-agendamento/config
   * Criar ou atualizar configuração
   */
  app.put('/config', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
  }, async (request, reply) => {
    const body = request.body as {
      production_url: string;
      evolution_url: string;
      evolution_token: string;
      openai_token: string;
      ai_model: string;
      agent_prompt: string;
      temperature?: number;
      max_tokens?: number;
    };

    const context = getContext(request);

    const existing = await prisma.iaAgendamentoConfig.findFirst();

    let config;
    if (existing) {
      config = await prisma.iaAgendamentoConfig.update({
        where: { id: existing.id },
        data: {
          production_url: body.production_url,
          evolution_url: body.evolution_url,
          evolution_token: body.evolution_token,
          openai_token: body.openai_token,
          ai_model: body.ai_model,
          agent_prompt: body.agent_prompt,
          temperature: body.temperature ?? existing.temperature,
          max_tokens: body.max_tokens ?? existing.max_tokens,
          updated_by: context.userId,
          updated_at: new Date(),
        },
      });
    } else {
      config = await prisma.iaAgendamentoConfig.create({
        data: {
          production_url: body.production_url,
          evolution_url: body.evolution_url,
          evolution_token: body.evolution_token,
          openai_token: body.openai_token,
          ai_model: body.ai_model,
          agent_prompt: body.agent_prompt,
          temperature: body.temperature ?? 0.7,
          max_tokens: body.max_tokens ?? 1000,
          created_by: context.userId,
        },
      });
    }

    return reply.status(200).send({
      success: true,
      data: config,
    });
  });

  // ========================
  // INSTÂNCIAS EVOLUTION
  // ========================

  /**
   * GET /api/ia-agendamento/instances
   * Listar instâncias do usuário
   */
  app.get('/instances', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const instances = await prisma.evolutionInstance.findMany({
      orderBy: { created_at: 'desc' },
    });

    return reply.status(200).send({
      success: true,
      data: instances,
    });
  });

  /**
   * POST /api/ia-agendamento/instances
   * Criar nova instância
   */
  app.post('/instances', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const body = request.body as {
      instance_name: string;
      phone_number: string;
      qr_code?: string;
      instance_id?: string;
      apikey?: string;
    };

    const context = getContext(request);

    // Buscar city_id do usuário
    const appUser = await prisma.appUser.findUnique({
      where: { id: context.userId },
      select: { city_id: true },
    });

    const instance = await prisma.evolutionInstance.create({
      data: {
        instance_name: body.instance_name,
        phone_number: body.phone_number,
        user_id: context.userId,
        city_id: appUser?.city_id || null,
        status: 'pending',
        qr_code: body.qr_code || null,
        instance_id: body.instance_id || body.instance_name,
        apikey: body.apikey || null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: instance,
    });
  });

  /**
   * PUT /api/ia-agendamento/instances/:id/status
   * Atualizar status da instância
   */
  app.put<{ Params: { id: string } }>('/instances/:id/status', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body as {
      status: 'pending' | 'connected' | 'disconnected' | 'error';
      qr_code?: string;
    };

    const updateData: Record<string, unknown> = { status: body.status };

    if (body.qr_code) {
      updateData.qr_code = body.qr_code;
    }

    if (body.status === 'connected') {
      updateData.last_connected_at = new Date();
    }

    const instance = await prisma.evolutionInstance.update({
      where: { id },
      data: updateData,
    });

    return reply.status(200).send({
      success: true,
      data: instance,
    });
  });

  /**
   * DELETE /api/ia-agendamento/instances/:id
   * Deletar instância
   */
  app.delete<{ Params: { id: string } }>('/instances/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const { id } = request.params;

    // Buscar dados da instância
    const instance = await prisma.evolutionInstance.findUnique({
      where: { id },
      select: { instance_name: true },
    });

    if (!instance) {
      return reply.status(404).send({
        success: false,
        error: 'Instância não encontrada',
      });
    }

    await prisma.evolutionInstance.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
      data: { instance_name: instance.instance_name },
      message: 'Instância deletada com sucesso',
    });
  });

  /**
   * GET /api/ia-agendamento/evolution-config
   * Buscar config da Evolution API (URL e token) para chamadas externas
   */
  app.get('/evolution-config', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const config = await prisma.iaAgendamentoConfig.findFirst({
      select: {
        evolution_url: true,
        evolution_token: true,
        production_url: true,
      },
    });

    if (!config) {
      return reply.status(404).send({
        success: false,
        error: 'Configuração da Evolution API não encontrada',
      });
    }

    return reply.status(200).send({
      success: true,
      data: config,
    });
  });

  // ========================
  // AGENTES IA
  // ========================

  /**
   * GET /api/ia-agendamento/agents
   * Listar agentes
   */
  app.get('/agents', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const agents = await prisma.iaAgent.findMany({
      orderBy: { created_at: 'desc' },
    });

    // Extrair instance_id do config para cada agente
    const mapped = agents.map(agent => ({
      ...agent,
      instance_id: (agent.config as Record<string, unknown>)?.instance_id || null,
    }));

    return reply.status(200).send({
      success: true,
      data: mapped,
    });
  });

  /**
   * POST /api/ia-agendamento/agents
   * Criar agente
   */
  app.post('/agents', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const body = request.body as {
      name: string;
      description?: string;
      prompt: string;
      active?: boolean;
      instance_id?: string | null;
    };

    const agentConfig: any = {};
    if (body.instance_id) {
      agentConfig.instance_id = body.instance_id;
    }

    const agent = await prisma.iaAgent.create({
      data: {
        name: body.name,
        description: body.description || null,
        prompt: body.prompt,
        active: body.active !== undefined ? body.active : true,
        config: agentConfig,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        ...agent,
        instance_id: (agent.config as Record<string, unknown>)?.instance_id || null,
      },
    });
  });

  /**
   * PUT /api/ia-agendamento/agents/:id
   * Atualizar agente
   */
  app.put<{ Params: { id: string } }>('/agents/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body as {
      name?: string;
      description?: string;
      prompt?: string;
      active?: boolean;
      instance_id?: string | null;
    };

    // Buscar config atual
    const current = await prisma.iaAgent.findUnique({
      where: { id },
      select: { config: true },
    });

    if (!current) {
      return reply.status(404).send({
        success: false,
        error: 'Agente não encontrado',
      });
    }

    const currentConfig = (current.config as any) || {};
    const newConfig = { ...currentConfig };

    if ('instance_id' in body) {
      if (body.instance_id) {
        newConfig.instance_id = body.instance_id;
      } else {
        delete newConfig.instance_id;
      }
    }

    const updateData: any = { config: newConfig, updated_at: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.prompt !== undefined) updateData.prompt = body.prompt;
    if (body.active !== undefined) updateData.active = body.active;

    const agent = await prisma.iaAgent.update({
      where: { id },
      data: updateData,
    });

    return reply.status(200).send({
      success: true,
      data: {
        ...agent,
        instance_id: (agent.config as Record<string, unknown>)?.instance_id || null,
      },
    });
  });

  /**
   * DELETE /api/ia-agendamento/agents/:id
   * Deletar agente
   */
  app.delete<{ Params: { id: string } }>('/agents/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
  }, async (request, reply) => {
    const { id } = request.params;

    const agent = await prisma.iaAgent.findUnique({ where: { id } });

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: 'Agente não encontrado',
      });
    }

    await prisma.iaAgent.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
      message: 'Agente deletado com sucesso',
    });
  });
};

export default iaAgendamentoRoutes;
