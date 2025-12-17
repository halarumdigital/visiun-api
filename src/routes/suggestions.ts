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

const suggestionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    user_id: { type: 'string', format: 'uuid', nullable: true },
    title: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    user: {
      type: 'object',
      nullable: true,
      properties: {
        name: { type: 'string', nullable: true },
        role: { type: 'string' },
        city_name: { type: 'string', nullable: true },
      },
    },
    like_count: { type: 'number' },
    dislike_count: { type: 'number' },
    user_reaction: { type: 'string', nullable: true },
  },
};

const roadmapItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string' },
    priority: { type: 'string' },
    estimated_date: { type: 'string', format: 'date', nullable: true },
    completed_date: { type: 'string', format: 'date-time', nullable: true },
    order_index: { type: 'number' },
    created_by: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    creator: {
      type: 'object',
      nullable: true,
      properties: {
        name: { type: 'string', nullable: true },
        role: { type: 'string' },
      },
    },
  },
};

const suggestionsRoutes: FastifyPluginAsync = async (app) => {
  // ========== SUGESTÕES ==========

  /**
   * GET /api/suggestions
   * Listar todas as sugestões com contagem de reações
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todas as sugestões',
      tags: ['Sugestões'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          user_id: { type: 'string', format: 'uuid', description: 'ID do usuário para buscar reação' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: suggestionSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { user_id } = request.query as { user_id?: string };
    const context = getContext(request);
    const currentUserId = user_id || context.userId;

    // Buscar sugestões com informações do usuário
    const suggestions = await prisma.suggestion.findMany({
      include: {
        user: {
          select: {
            name: true,
            role: true,
            city: {
              select: {
                name: true,
              },
            },
          },
        },
        reactions: true,
      },
      orderBy: { created_at: 'desc' },
    });

    // Formatar dados com contagem de reações
    const formattedSuggestions = suggestions.map((suggestion) => {
      const likeCount = suggestion.reactions.filter(r => r.reaction_type === 'like').length;
      const dislikeCount = suggestion.reactions.filter(r => r.reaction_type === 'dislike').length;
      const userReaction = currentUserId
        ? suggestion.reactions.find(r => r.user_id === currentUserId)?.reaction_type || null
        : null;

      return {
        id: suggestion.id,
        user_id: suggestion.user_id,
        title: suggestion.title,
        description: suggestion.description,
        status: suggestion.status,
        created_at: suggestion.created_at,
        updated_at: suggestion.updated_at,
        user: suggestion.user ? {
          name: suggestion.user.name,
          role: suggestion.user.role,
          city_name: suggestion.user.city?.name || null,
        } : null,
        like_count: likeCount,
        dislike_count: dislikeCount,
        user_reaction: userReaction,
      };
    });

    return reply.status(200).send({
      success: true,
      data: formattedSuggestions,
    });
  });

  /**
   * GET /api/suggestions/monthly
   * Listar sugestões do mês atual ordenadas por likes
   */
  app.get('/monthly', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar sugestões do mês atual ordenadas por likes',
      tags: ['Sugestões'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          user_id: { type: 'string', format: 'uuid', description: 'ID do usuário para buscar reação' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: suggestionSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { user_id } = request.query as { user_id?: string };
    const context = getContext(request);
    const currentUserId = user_id || context.userId;

    // Calcular primeiro e último dia do mês
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Buscar sugestões do mês
    const suggestions = await prisma.suggestion.findMany({
      where: {
        created_at: {
          gte: firstDayOfMonth,
          lte: lastDayOfMonth,
        },
      },
      include: {
        user: {
          select: {
            name: true,
            role: true,
            city: {
              select: {
                name: true,
              },
            },
          },
        },
        reactions: true,
      },
    });

    // Formatar e ordenar por número de likes
    const formattedSuggestions = suggestions.map((suggestion) => {
      const likeCount = suggestion.reactions.filter(r => r.reaction_type === 'like').length;
      const dislikeCount = suggestion.reactions.filter(r => r.reaction_type === 'dislike').length;
      const userReaction = currentUserId
        ? suggestion.reactions.find(r => r.user_id === currentUserId)?.reaction_type || null
        : null;

      return {
        id: suggestion.id,
        user_id: suggestion.user_id,
        title: suggestion.title,
        description: suggestion.description,
        status: suggestion.status,
        created_at: suggestion.created_at,
        updated_at: suggestion.updated_at,
        user: suggestion.user ? {
          name: suggestion.user.name,
          role: suggestion.user.role,
          city_name: suggestion.user.city?.name || null,
        } : null,
        like_count: likeCount,
        dislike_count: dislikeCount,
        user_reaction: userReaction,
      };
    });

    // Ordenar por likes (maior para menor)
    formattedSuggestions.sort((a, b) => b.like_count - a.like_count);

    return reply.status(200).send({
      success: true,
      data: formattedSuggestions,
    });
  });

  /**
   * POST /api/suggestions
   * Criar nova sugestão
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar nova sugestão',
      tags: ['Sugestões'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['title', 'description'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: suggestionSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { title, description } = request.body as { title: string; description: string };
    const context = getContext(request);

    const suggestion = await prisma.suggestion.create({
      data: {
        user_id: context.userId,
        title,
        description,
        status: 'open',
      },
      include: {
        user: {
          select: {
            name: true,
            role: true,
            city: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        ...suggestion,
        user: suggestion.user ? {
          name: suggestion.user.name,
          role: suggestion.user.role,
          city_name: suggestion.user.city?.name || null,
        } : null,
        like_count: 0,
        dislike_count: 0,
        user_reaction: null,
      },
    });
  });

  /**
   * POST /api/suggestions/:id/react
   * Reagir a uma sugestão (like/dislike)
   */
  app.post('/:id/react', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Reagir a uma sugestão (like/dislike)',
      tags: ['Sugestões'],
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
        required: ['reaction_type'],
        properties: {
          reaction_type: { type: 'string', enum: ['like', 'dislike'] },
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
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reaction_type } = request.body as { reaction_type: 'like' | 'dislike' };
    const context = getContext(request);

    // Verificar se sugestão existe
    const suggestion = await prisma.suggestion.findUnique({ where: { id } });
    if (!suggestion) {
      return reply.status(404).send({
        success: false,
        error: 'Sugestão não encontrada',
      });
    }

    // Verificar se já existe reação do usuário
    const existingReaction = await prisma.suggestionReaction.findUnique({
      where: {
        suggestion_id_user_id: {
          suggestion_id: id,
          user_id: context.userId!,
        },
      },
    });

    if (existingReaction) {
      if (existingReaction.reaction_type === reaction_type) {
        // Remover reação (toggle)
        await prisma.suggestionReaction.delete({
          where: { id: existingReaction.id },
        });
        return reply.status(200).send({
          success: true,
          message: 'Reação removida',
        });
      } else {
        // Atualizar reação
        await prisma.suggestionReaction.update({
          where: { id: existingReaction.id },
          data: { reaction_type },
        });
        return reply.status(200).send({
          success: true,
          message: 'Reação atualizada',
        });
      }
    } else {
      // Criar nova reação
      await prisma.suggestionReaction.create({
        data: {
          suggestion_id: id,
          user_id: context.userId!,
          reaction_type,
        },
      });
      return reply.status(200).send({
        success: true,
        message: 'Reação adicionada',
      });
    }
  });

  /**
   * PATCH /api/suggestions/:id/status
   * Atualizar status da sugestão (apenas admin/master_br)
   */
  app.patch('/:id/status', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar status da sugestão',
      tags: ['Sugestões'],
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
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'rejected'] },
        },
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
    const { status } = request.body as { status: string };

    await prisma.suggestion.update({
      where: { id },
      data: { status },
    });

    return reply.status(200).send({
      success: true,
    });
  });

  /**
   * DELETE /api/suggestions/:id
   * Deletar sugestão
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar sugestão',
      tags: ['Sugestões'],
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
        403: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = getContext(request);

    const suggestion = await prisma.suggestion.findUnique({ where: { id } });
    if (!suggestion) {
      return reply.status(404).send({
        success: false,
        error: 'Sugestão não encontrada',
      });
    }

    // Apenas o autor ou admin/master_br pode deletar
    if (suggestion.user_id !== context.userId && !context.isMasterOrAdmin()) {
      return reply.status(403).send({
        success: false,
        error: 'Sem permissão para deletar esta sugestão',
      });
    }

    await prisma.suggestion.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
    });
  });

  // ========== ROADMAP ==========

  /**
   * GET /api/suggestions/roadmap
   * Listar todos os itens do roadmap
   */
  app.get('/roadmap', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar todos os itens do roadmap',
      tags: ['Roadmap'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: roadmapItemSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const items = await prisma.roadmapItem.findMany({
      include: {
        creator: {
          select: {
            name: true,
            role: true,
          },
        },
      },
      orderBy: [
        { order_index: 'asc' },
        { estimated_date: 'asc' },
      ],
    });

    const formattedItems = items.map(item => ({
      ...item,
      creator: item.creator ? {
        name: item.creator.name,
        role: item.creator.role,
      } : null,
    }));

    return reply.status(200).send({
      success: true,
      data: formattedItems,
    });
  });

  /**
   * POST /api/suggestions/roadmap
   * Criar item do roadmap (apenas admin)
   */
  app.post('/roadmap', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Criar item do roadmap',
      tags: ['Roadmap'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['title', 'description'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          status: { type: 'string', enum: ['planned', 'in_progress', 'completed', 'cancelled'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          estimated_date: { type: 'string', format: 'date' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: roadmapItemSchema,
          },
        },
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { title, description, status, priority, estimated_date } = request.body as {
      title: string;
      description: string;
      status?: string;
      priority?: string;
      estimated_date?: string;
    };
    const context = getContext(request);

    // Buscar próximo order_index
    const maxOrder = await prisma.roadmapItem.findFirst({
      orderBy: { order_index: 'desc' },
      select: { order_index: true },
    });
    const nextOrderIndex = (maxOrder?.order_index ?? -1) + 1;

    const item = await prisma.roadmapItem.create({
      data: {
        title,
        description,
        status: status || 'planned',
        priority: priority || 'medium',
        estimated_date: estimated_date ? new Date(estimated_date) : null,
        order_index: nextOrderIndex,
        created_by: context.userId,
      },
      include: {
        creator: {
          select: {
            name: true,
            role: true,
          },
        },
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        ...item,
        creator: item.creator ? {
          name: item.creator.name,
          role: item.creator.role,
        } : null,
      },
    });
  });

  /**
   * PUT /api/suggestions/roadmap/:id
   * Atualizar item do roadmap (apenas admin)
   */
  app.put('/roadmap/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar item do roadmap',
      tags: ['Roadmap'],
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
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['planned', 'in_progress', 'completed', 'cancelled'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          estimated_date: { type: 'string', format: 'date', nullable: true },
          completed_date: { type: 'string', format: 'date-time', nullable: true },
          order_index: { type: 'number' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: roadmapItemSchema,
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      estimated_date?: string | null;
      completed_date?: string | null;
      order_index?: number;
    };

    // Verificar se existe
    const existing = await prisma.roadmapItem.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Item não encontrado',
      });
    }

    // Se status mudou para completed, definir completed_date
    const dataToUpdate: Record<string, unknown> = {};
    if (updates.title !== undefined) dataToUpdate.title = updates.title;
    if (updates.description !== undefined) dataToUpdate.description = updates.description;
    if (updates.status !== undefined) dataToUpdate.status = updates.status;
    if (updates.priority !== undefined) dataToUpdate.priority = updates.priority;
    if (updates.order_index !== undefined) dataToUpdate.order_index = updates.order_index;

    if (updates.estimated_date !== undefined) {
      dataToUpdate.estimated_date = updates.estimated_date ? new Date(updates.estimated_date) : null;
    }

    if (updates.completed_date !== undefined) {
      dataToUpdate.completed_date = updates.completed_date ? new Date(updates.completed_date) : null;
    } else if (updates.status === 'completed' && !existing.completed_date) {
      dataToUpdate.completed_date = new Date();
    }

    const item = await prisma.roadmapItem.update({
      where: { id },
      data: dataToUpdate,
      include: {
        creator: {
          select: {
            name: true,
            role: true,
          },
        },
      },
    });

    return reply.status(200).send({
      success: true,
      data: {
        ...item,
        creator: item.creator ? {
          name: item.creator.name,
          role: item.creator.role,
        } : null,
      },
    });
  });

  /**
   * DELETE /api/suggestions/roadmap/:id
   * Deletar item do roadmap (apenas admin)
   */
  app.delete('/roadmap/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Deletar item do roadmap',
      tags: ['Roadmap'],
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

    await prisma.roadmapItem.delete({ where: { id } });

    return reply.status(200).send({
      success: true,
    });
  });
};

export default suggestionsRoutes;
