import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac, requireMasterOrAdmin, canModifyUser } from '../middleware/rbac.js';
import { authService } from '../services/authService.js';
import { auditService, AuditActions } from '../middleware/audit.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { PaginationParams } from '../types/index.js';
import { getContext } from '../utils/context.js';

// Schemas de validação
const createUserSchema = z.object({
  email: z.string().email('Email inválido'),
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').optional(),
  role: z.enum(['master_br', 'admin', 'regional', 'franchisee']),
  regional_type: z.enum(['admin', 'simples']).optional(),
  master_type: z.enum(['admin', 'simples']).optional(),
  city_id: z.string().uuid().optional().nullable(),
  franchisee_id: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'blocked', 'inactive', 'pending']).optional(),
});

const updateUserSchema = z.object({
  email: z.string().email('Email inválido').optional(),
  name: z.string().min(2).optional(),
  role: z.enum(['master_br', 'admin', 'regional', 'franchisee']).optional(),
  regional_type: z.enum(['admin', 'simples']).optional().nullable(),
  master_type: z.enum(['admin', 'simples']).optional().nullable(),
  city_id: z.string().uuid().optional().nullable(),
  franchisee_id: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'blocked', 'inactive', 'pending']).optional(),
  avatar_url: z.string().url().optional().nullable(),
  plugsign_token: z.string().optional().nullable(),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(5000).default(20),
  search: z.string().optional(),
  role: z.enum(['master_br', 'admin', 'regional', 'franchisee']).optional(),
  status: z.string().optional(), // Aceita um único status ou múltiplos separados por vírgula
  city_id: z.string().uuid().optional(),
  franchisee_id: z.string().uuid().optional(),
  orderBy: z.enum(['name', 'email', 'created_at', 'last_login']).default('created_at'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
  fields: z.enum(['full', 'minimal']).default('full'),
});

// Schemas para Swagger
const userResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string', nullable: true },
    role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'franchisee'] },
    regional_type: { type: 'string', enum: ['admin', 'simples'], nullable: true },
    master_type: { type: 'string', enum: ['admin', 'simples'], nullable: true },
    status: { type: 'string', enum: ['active', 'blocked', 'inactive', 'pending'] },
    city_id: { type: 'string', format: 'uuid', nullable: true },
    franchisee_id: { type: 'string', format: 'uuid', nullable: true },
    avatar_url: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    last_login: { type: 'string', format: 'date-time', nullable: true },
    city: { type: 'object', nullable: true },
    franchisee: { type: 'object', nullable: true },
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

const usersRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/users
   * Listar usuários com filtros e paginação
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar usuários com filtros e paginação',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1, description: 'Página atual' },
          limit: { type: 'number', default: 20, description: 'Itens por página (máx 5000)' },
          search: { type: 'string', description: 'Buscar por nome ou email' },
          role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'franchisee'], description: 'Filtrar por role' },
          status: { type: 'string', description: 'Filtrar por status (pode ser múltiplos separados por vírgula: pending,inactive)' },
          city_id: { type: 'string', format: 'uuid', description: 'Filtrar por cidade' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'Filtrar por franqueado' },
          orderBy: { type: 'string', enum: ['name', 'email', 'created_at', 'last_login'], default: 'created_at' },
          orderDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          fields: { type: 'string', enum: ['full', 'minimal'], default: 'full', description: 'Modo minimal retorna apenas id, name, city_id e city.name' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: userResponseSchema },
            pagination: paginationSchema,
          },
        },
      },
    },
  }, async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      throw new BadRequestError(query.error.errors[0].message);
    }

    const { page, limit, search, role, status, city_id, franchisee_id, orderBy, orderDir, fields } = query.data;
    const context = getContext(request);

    // Construir filtros
    const where: any = {};

    // Aplicar filtro baseado no role do usuário
    const roleFilter = context.getFranchiseeFilter();
    Object.assign(where, roleFilter);

    // Filtros adicionais
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;

    // Status pode ser um único valor ou múltiplos separados por vírgula
    if (status) {
      const statusList = status.split(',').map(s => s.trim()).filter(s => s);
      if (statusList.length === 1) {
        where.status = statusList[0];
      } else if (statusList.length > 1) {
        where.status = { in: statusList };
      }
    }

    if (city_id) where.city_id = city_id;
    if (franchisee_id) where.franchisee_id = franchisee_id;

    const isMinimal = fields === 'minimal';

    const [users, total] = await Promise.all([
      prisma.appUser.findMany({
        where,
        ...(isMinimal
          ? {
              select: {
                id: true,
                name: true,
                city_id: true,
                city: { select: { id: true, name: true } },
              },
            }
          : {
              include: {
                city: true,
                franchisee: true,
              },
            }),
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderBy]: orderDir },
      }),
      prisma.appUser.count({ where }),
    ]);

    // Remover campos sensíveis (não necessário no modo minimal)
    const sanitizedUsers = isMinimal
      ? users
      : users.map(user => ({
          ...user,
          password_hash: undefined,
          refresh_token: undefined,
          refresh_token_expires_at: undefined,
          password_reset_token: undefined,
          password_reset_expires: undefined,
        }));

    return reply.status(200).send({
      success: true,
      data: sanitizedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  /**
   * GET /api/users/:id
   * Obter usuário por ID
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Obter detalhes de um usuário por ID',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do usuário' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: userResponseSchema,
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

    const user = await prisma.appUser.findUnique({
      where: { id },
      include: {
        city: true,
        franchisee: true,
      },
    });

    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Verificar permissão de acesso
    const context = getContext(request);
    if (!context.isMasterOrAdmin()) {
      if (context.isRegional() && user.city_id !== context.cityId) {
        throw new ForbiddenError('Sem permissão para acessar este usuário');
      }
      if (context.isFranchisee() && user.id !== context.userId) {
        throw new ForbiddenError('Sem permissão para acessar este usuário');
      }
    }

    return reply.status(200).send({
      success: true,
      data: {
        ...user,
        password_hash: undefined,
        refresh_token: undefined,
        refresh_token_expires_at: undefined,
        password_reset_token: undefined,
        password_reset_expires: undefined,
      },
    });
  });

  /**
   * POST /api/users
   * Criar novo usuário
   */
  app.post('/', {
    preHandler: [authMiddleware, requireMasterOrAdmin()],
    schema: {
      description: 'Criar novo usuário (apenas Master/Admin)',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['email', 'role'],
        properties: {
          email: { type: 'string', format: 'email', description: 'Email do usuário' },
          name: { type: 'string', minLength: 2, description: 'Nome do usuário' },
          role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'franchisee'], description: 'Role do usuário' },
          regional_type: { type: 'string', enum: ['admin', 'simples'], description: 'Tipo regional (se role=regional)' },
          master_type: { type: 'string', enum: ['admin', 'simples'], description: 'Tipo master (se role=master_br)' },
          city_id: { type: 'string', format: 'uuid', description: 'ID da cidade' },
          franchisee_id: { type: 'string', format: 'uuid', description: 'ID do franqueado' },
          status: { type: 'string', enum: ['active', 'blocked', 'inactive', 'pending'], default: 'pending' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                ...userResponseSchema.properties,
                tempPassword: { type: 'string', description: 'Senha temporária gerada' },
              },
            },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = createUserSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const data = body.data;

    // Verificar se email já existe
    const existingUser = await prisma.appUser.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      throw new BadRequestError('Email já está em uso');
    }

    // Criar usuário com senha temporária
    const tempPassword = await authService.adminResetPassword(
      request.user!.userId,
      '' // Não precisa do target user id aqui, vamos gerar a senha
    ).catch(() => {
      // Gerar senha temporária manualmente se falhar
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      let password = '';
      for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return password;
    });

    const passwordHash = await authService.hashPassword(tempPassword);

    const user = await prisma.appUser.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        role: data.role,
        regional_type: data.regional_type,
        master_type: data.master_type,
        city_id: data.city_id,
        franchisee_id: data.franchisee_id,
        status: data.status || 'pending',
        password_hash: passwordHash,
      },
      include: {
        city: true,
        franchisee: true,
      },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.USER_CREATE,
      'user',
      user.id,
      undefined,
      { email: user.email, role: user.role }
    );

    return reply.status(201).send({
      success: true,
      data: {
        ...user,
        password_hash: undefined,
        refresh_token: undefined,
        tempPassword, // Retornar senha temporária para o admin
      },
      message: 'Usuário criado com sucesso. Senha temporária gerada.',
    });
  });

  /**
   * PUT /api/users/:id
   * Atualizar usuário
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar dados de um usuário',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do usuário' },
        },
      },
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 2 },
          role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'franchisee'] },
          regional_type: { type: 'string', enum: ['admin', 'simples'], nullable: true },
          master_type: { type: 'string', enum: ['admin', 'simples'], nullable: true },
          city_id: { type: 'string', format: 'uuid', nullable: true },
          franchisee_id: { type: 'string', format: 'uuid', nullable: true },
          status: { type: 'string', enum: ['active', 'blocked', 'inactive', 'pending'] },
          avatar_url: { type: 'string', format: 'uri', nullable: true },
          plugsign_token: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: userResponseSchema,
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    console.log('🔐 [PUT /users/:id] Body recebido:', JSON.stringify(request.body, null, 2));

    const body = updateUserSchema.safeParse(request.body);

    if (!body.success) {
      console.log('🔐 [PUT /users/:id] Erro de validação:', body.error.errors);
      throw new BadRequestError(body.error.errors[0].message);
    }

    console.log('🔐 [PUT /users/:id] Body validado:', JSON.stringify(body.data, null, 2));

    const existingUser = await prisma.appUser.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Verificar permissão de modificação
    const context = getContext(request);
    if (!canModifyUser(context.role, context.userId, existingUser.role as any, id)) {
      throw new ForbiddenError('Sem permissão para modificar este usuário');
    }

    // Se não for master/admin, não pode alterar role
    if (body.data.role && !context.isMasterOrAdmin()) {
      throw new ForbiddenError('Sem permissão para alterar role de usuário');
    }

    // Se estiver alterando email, verificar unicidade
    if (body.data.email && body.data.email.toLowerCase() !== existingUser.email) {
      const emailExists = await prisma.appUser.findUnique({
        where: { email: body.data.email.toLowerCase() },
      });
      if (emailExists) {
        throw new BadRequestError('Email já está em uso');
      }
    }

    const updateData = {
      ...body.data,
      email: body.data.email?.toLowerCase(),
    };

    console.log('🔐 [PUT /users/:id] Dados para update:', JSON.stringify(updateData, null, 2));

    const user = await prisma.appUser.update({
      where: { id },
      data: updateData,
      include: {
        city: true,
        franchisee: true,
      },
    });

    console.log('🔐 [PUT /users/:id] Usuário atualizado, plugsign_token:', user.plugsign_token);

    await auditService.logFromRequest(
      request,
      AuditActions.USER_UPDATE,
      'user',
      id,
      existingUser,
      body.data
    );

    return reply.status(200).send({
      success: true,
      data: {
        ...user,
        password_hash: undefined,
        refresh_token: undefined,
      },
    });
  });

  /**
   * DELETE /api/users/:id
   * Deletar usuário (soft delete - muda status para inactive)
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, requireMasterOrAdmin()],
    schema: {
      description: 'Desativar usuário (soft delete)',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do usuário' },
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
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existingUser = await prisma.appUser.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Não permitir deletar a si mesmo
    if (id === request.user!.userId) {
      throw new BadRequestError('Não é possível deletar seu próprio usuário');
    }

    // Soft delete
    await prisma.appUser.update({
      where: { id },
      data: {
        status: 'inactive',
        refresh_token: null,
        refresh_token_expires_at: null,
      },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.USER_DELETE,
      'user',
      id
    );

    return reply.status(200).send({
      success: true,
      message: 'Usuário desativado com sucesso',
    });
  });

  /**
   * POST /api/users/:id/reset-password
   * Reset de senha por admin
   */
  app.post('/:id/reset-password', {
    preHandler: [authMiddleware, requireMasterOrAdmin()],
    schema: {
      description: 'Resetar senha de um usuário (gera senha temporária)',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do usuário' },
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
                tempPassword: { type: 'string', description: 'Nova senha temporária' },
              },
            },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const tempPassword = await authService.adminResetPassword(
      request.user!.userId,
      id
    );

    await auditService.logFromRequest(
      request,
      AuditActions.PASSWORD_RESET,
      'user',
      id
    );

    return reply.status(200).send({
      success: true,
      data: { tempPassword },
      message: 'Senha resetada com sucesso',
    });
  });

  /**
   * POST /api/users/:id/set-password
   * Definir senha específica por admin
   */
  app.post('/:id/set-password', {
    preHandler: [authMiddleware, requireMasterOrAdmin()],
    schema: {
      description: 'Definir uma senha específica para um usuário (apenas Admin)',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do usuário' },
        },
      },
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          newPassword: { type: 'string', minLength: 6, description: 'Nova senha (mínimo 6 caracteres)' },
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
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { newPassword } = request.body as { newPassword: string };

    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestError('A senha deve ter pelo menos 6 caracteres');
    }

    const existingUser = await prisma.appUser.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Hash da nova senha
    const passwordHash = await authService.hashPassword(newPassword);

    await prisma.appUser.update({
      where: { id },
      data: { password_hash: passwordHash },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.PASSWORD_RESET,
      'user',
      id
    );

    return reply.status(200).send({
      success: true,
      message: 'Senha definida com sucesso',
    });
  });

  /**
   * PATCH /api/users/:id/status
   * Alterar status do usuário
   */
  app.patch('/:id/status', {
    preHandler: [authMiddleware, requireMasterOrAdmin()],
    schema: {
      description: 'Alterar status de um usuário',
      tags: ['Usuários'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'ID do usuário' },
        },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['active', 'blocked', 'inactive', 'pending'], description: 'Novo status' },
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
                id: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const validStatuses = ['active', 'blocked', 'inactive', 'pending'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestError('Status inválido');
    }

    const existingUser = await prisma.appUser.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    const user = await prisma.appUser.update({
      where: { id },
      data: { status: status as any },
    });

    await auditService.logFromRequest(
      request,
      AuditActions.USER_STATUS_CHANGE,
      'user',
      id,
      { status: existingUser.status },
      { status }
    );

    return reply.status(200).send({
      success: true,
      data: { id: user.id, status: user.status },
    });
  });

  /**
   * GET /api/users/attendants
   * Listar usuários para dropdown de atendentes (filtro por cidade)
   */
  app.get('/attendants', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar usuários para dropdown de atendentes',
      tags: ['Usuários'],
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
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string', nullable: true },
                  city_id: { type: 'string', nullable: true },
                  role: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { city_id } = request.query as { city_id?: string };
    const context = getContext(request);
    const user = request.user!;

    console.log('🔍 [ATTENDANTS DEBUG] city_id:', city_id);
    console.log('🔍 [ATTENDANTS DEBUG] user.role:', user.role);

    // Construir filtro baseado no role do usuário
    // Regra: mostrar todos os usuários da cidade selecionada/do usuário
    const where: any = {
      // Incluir apenas usuários com nome preenchido (exceto o próprio usuário logado)
      OR: [
        { name: { not: null } },
        { id: user.userId },
      ],
    };

    // Aplicar filtros de cidade de acordo com o role
    if (context.isMasterOrAdmin()) {
      // Master BR / Admin: mostrar TODOS os usuários da cidade selecionada
      if (city_id) {
        // Mostrar todos da cidade selecionada
        where.city_id = city_id;
      }
      // Se não tem city_id, mostrar todos os usuários (sem filtro de cidade)
    } else if (context.isRegional()) {
      // Regional: mostrar todos os usuários da SUA cidade
      const userCityId = context.cityId;
      if (userCityId) {
        where.city_id = userCityId;
      }
    } else if (context.isFranchisee()) {
      // Franchisee: mostrar todos os usuários da sua cidade
      const userCityId = context.cityId;
      if (userCityId) {
        where.city_id = userCityId;
      }
    }

    console.log('🔍 [ATTENDANTS DEBUG] Final where:', JSON.stringify(where, null, 2));

    const users = await prisma.appUser.findMany({
      where,
      select: {
        id: true,
        name: true,
        city_id: true,
        role: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log('🔍 [ATTENDANTS DEBUG] Users found:', users.length);

    return reply.status(200).send({
      success: true,
      data: users,
    });
  });

  // ==========================================
  // ENDPOINTS DE PERMISSÕES DE MENU
  // ==========================================

  // GET /users/:id/permissions - Buscar permissões de menu de um usuário
  app.get('/:id/permissions', {
    preHandler: [authMiddleware],
    schema: {
      tags: ['Usuários'],
      summary: 'Buscar permissões de menu de um usuário',
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
            data: {
              type: 'object',
              additionalProperties: { type: 'boolean' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.appUser.findUnique({
      where: { id },
      select: { menu_permissions: true },
    });

    if (!user) {
      throw new NotFoundError('Usuário não encontrado');
    }

    return reply.status(200).send({
      success: true,
      data: (user.menu_permissions as Record<string, boolean>) || {},
    });
  });

  // PUT /users/:id/permissions - Atualizar permissões de menu de um usuário
  // Permite: admin, master_br, ou regional admin (para usuários da mesma cidade)
  app.put('/:id/permissions', {
    preHandler: [authMiddleware],
    schema: {
      tags: ['Usuários'],
      summary: 'Atualizar permissões de menu de um usuário',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        additionalProperties: { type: 'boolean' },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              additionalProperties: { type: 'boolean' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const permissions = request.body as Record<string, boolean>;
    const currentUser = request.user;

    // Verificar permissões do usuário logado
    const loggedUser = await prisma.appUser.findUnique({
      where: { id: currentUser.userId },
      select: { role: true, regional_type: true, master_type: true, city_id: true },
    });

    if (!loggedUser) {
      throw new ForbiddenError('Usuário não autenticado');
    }

    // Admin e master_br podem editar qualquer usuário
    const isAdmin = loggedUser.role === 'admin';
    const isMasterBr = loggedUser.role === 'master_br';
    const isRegionalAdmin = loggedUser.role === 'regional' && loggedUser.regional_type === 'admin';

    if (!isAdmin && !isMasterBr && !isRegionalAdmin) {
      throw new ForbiddenError('Você não tem permissão para editar permissões');
    }

    const existingUser = await prisma.appUser.findUnique({
      where: { id },
    });

    if (!existingUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Regional admin só pode editar usuários da mesma cidade
    if (isRegionalAdmin && !isAdmin && !isMasterBr) {
      if (existingUser.city_id !== loggedUser.city_id) {
        throw new ForbiddenError('Você só pode editar permissões de usuários da sua cidade');
      }
    }

    // Atualizar permissões
    await prisma.appUser.update({
      where: { id },
      data: {
        menu_permissions: permissions,
      },
    });

    // Log de auditoria
    await auditService.logFromRequest(
      request,
      AuditActions.USER_UPDATE,
      'user',
      id,
      {
        action: 'update_permissions',
        permissions,
      }
    );

    return reply.status(200).send({
      success: true,
      message: 'Permissões atualizadas com sucesso',
      data: permissions,
    });
  });
};

export default usersRoutes;
