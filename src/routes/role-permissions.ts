import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/errors.js';

// Schemas de validação
const roleSchema = z.enum(['master_br', 'admin', 'regional', 'regional_admin', 'franchisee']);

const permissionSchema = z.object({
  screen_id: z.string(),
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_edit: z.boolean(),
  can_delete: z.boolean(),
  can_export: z.boolean(),
});

const updateRolePermissionsSchema = z.object({
  permissions: z.array(permissionSchema),
});

const rolePermissionsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/role-permissions
   * Listar todas as permissões por perfil
   * Apenas admin pode acessar
   */
  app.get('/', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Listar todas as permissões por perfil',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    screen_id: { type: 'string' },
                    screen_name: { type: 'string' },
                    can_view: { type: 'boolean' },
                    can_create: { type: 'boolean' },
                    can_edit: { type: 'boolean' },
                    can_delete: { type: 'boolean' },
                    can_export: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;

    // Apenas admin pode acessar
    if (user.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem gerenciar permissões de perfil');
    }

    // Buscar todas as permissões agrupadas por role
    const permissions = await prisma.$queryRaw<Array<{
      role: string;
      screen_id: string;
      screen_name: string;
      can_view: boolean;
      can_create: boolean;
      can_edit: boolean;
      can_delete: boolean;
      can_export: boolean;
    }>>`
      SELECT
        rp.role,
        rp.screen_id,
        s.name_pt as screen_name,
        rp.can_view,
        rp.can_create,
        rp.can_edit,
        rp.can_delete,
        rp.can_export
      FROM role_permissions rp
      JOIN screens s ON s.id = rp.screen_id
      WHERE s.is_active = true
      ORDER BY rp.role, s.order_index
    `;

    // Agrupar por role
    const grouped: Record<string, typeof permissions> = {};
    for (const perm of permissions) {
      if (!grouped[perm.role]) {
        grouped[perm.role] = [];
      }
      grouped[perm.role].push(perm);
    }

    return reply.status(200).send({
      success: true,
      data: grouped,
    });
  });

  /**
   * GET /api/role-permissions/:role
   * Listar permissões de um perfil específico
   * Apenas admin pode acessar
   */
  app.get('/:role', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Listar permissões de um perfil específico',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'regional_admin', 'franchisee'] },
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
                role: { type: 'string' },
                permissions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      screen_id: { type: 'string' },
                      screen_name: { type: 'string' },
                      screen_category: { type: 'string' },
                      can_view: { type: 'boolean' },
                      can_create: { type: 'boolean' },
                      can_edit: { type: 'boolean' },
                      can_delete: { type: 'boolean' },
                      can_export: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { role } = request.params as { role: string };

    // Apenas admin pode acessar
    if (user.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem gerenciar permissões de perfil');
    }

    // Validar role
    const validRole = roleSchema.safeParse(role);
    if (!validRole.success) {
      throw new BadRequestError('Perfil inválido');
    }

    // Buscar permissões do role
    const permissions = await prisma.$queryRaw<Array<{
      screen_id: string;
      screen_name: string;
      screen_category: string;
      can_view: boolean;
      can_create: boolean;
      can_edit: boolean;
      can_delete: boolean;
      can_export: boolean;
    }>>`
      SELECT
        s.id as screen_id,
        s.name_pt as screen_name,
        s.category as screen_category,
        COALESCE(rp.can_view, false) as can_view,
        COALESCE(rp.can_create, false) as can_create,
        COALESCE(rp.can_edit, false) as can_edit,
        COALESCE(rp.can_delete, false) as can_delete,
        COALESCE(rp.can_export, false) as can_export
      FROM screens s
      LEFT JOIN role_permissions rp ON s.id = rp.screen_id AND rp.role = ${role}
      WHERE s.is_active = true
      ORDER BY s.order_index
    `;

    return reply.status(200).send({
      success: true,
      data: {
        role,
        permissions,
      },
    });
  });

  /**
   * PUT /api/role-permissions/:role
   * Atualizar permissões de um perfil
   * Apenas admin pode acessar
   */
  app.put('/:role', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Atualizar permissões de um perfil',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'regional_admin', 'franchisee'] },
        },
      },
      body: {
        type: 'object',
        required: ['permissions'],
        properties: {
          permissions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['screen_id', 'can_view', 'can_create', 'can_edit', 'can_delete', 'can_export'],
              properties: {
                screen_id: { type: 'string' },
                can_view: { type: 'boolean' },
                can_create: { type: 'boolean' },
                can_edit: { type: 'boolean' },
                can_delete: { type: 'boolean' },
                can_export: { type: 'boolean' },
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
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { role } = request.params as { role: string };

    // Apenas admin pode acessar
    if (user.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem gerenciar permissões de perfil');
    }

    // Validar role
    const validRole = roleSchema.safeParse(role);
    if (!validRole.success) {
      throw new BadRequestError('Perfil inválido');
    }

    // Validar body
    const body = updateRolePermissionsSchema.safeParse(request.body);
    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { permissions } = body.data;

    // Atualizar permissões em transação
    await prisma.$transaction(async (tx) => {
      for (const perm of permissions) {
        await tx.$executeRaw`
          INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export, updated_at)
          VALUES (${role}, ${perm.screen_id}, ${perm.can_view}, ${perm.can_create}, ${perm.can_edit}, ${perm.can_delete}, ${perm.can_export}, NOW())
          ON CONFLICT (role, screen_id) DO UPDATE SET
            can_view = ${perm.can_view},
            can_create = ${perm.can_create},
            can_edit = ${perm.can_edit},
            can_delete = ${perm.can_delete},
            can_export = ${perm.can_export},
            updated_at = NOW()
        `;
      }
    });

    return reply.status(200).send({
      success: true,
      message: `Permissões do perfil ${role} atualizadas com sucesso`,
    });
  });

  /**
   * GET /api/role-permissions/user/:userId/computed
   * Obter permissões calculadas de um usuário (role + overrides)
   */
  app.get('/user/:userId/computed', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Obter permissões calculadas de um usuário',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', format: 'uuid' },
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
                user_id: { type: 'string' },
                role: { type: 'string' },
                permissions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      screen_id: { type: 'string' },
                      screen_name: { type: 'string' },
                      screen_path: { type: 'string' },
                      screen_category: { type: 'string' },
                      can_view: { type: 'boolean' },
                      can_create: { type: 'boolean' },
                      can_edit: { type: 'boolean' },
                      can_delete: { type: 'boolean' },
                      can_export: { type: 'boolean' },
                      is_override: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const currentUser = request.user!;
    const { userId } = request.params as { userId: string };

    // Verificar se o usuário pode ver as permissões
    // Admin pode ver de qualquer um, outros só podem ver suas próprias
    if (currentUser.role !== 'admin' && currentUser.userId !== userId) {
      throw new ForbiddenError('Sem permissão para visualizar estas permissões');
    }

    // Buscar usuário alvo
    const targetUser = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Usar a função SQL para obter permissões calculadas
    const permissions = await prisma.$queryRaw<Array<{
      screen_id: string;
      screen_name: string;
      screen_path: string;
      screen_category: string;
      can_view: boolean;
      can_create: boolean;
      can_edit: boolean;
      can_delete: boolean;
      can_export: boolean;
      is_override: boolean;
    }>>`SELECT * FROM get_user_computed_permissions(${userId}::uuid)`;

    return reply.status(200).send({
      success: true,
      data: {
        user_id: userId,
        role: targetUser.role,
        permissions,
      },
    });
  });

  /**
   * GET /api/role-permissions/my-permissions
   * Obter permissões calculadas do usuário logado
   */
  app.get('/my-permissions', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Obter minhas permissões calculadas',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                user_id: { type: 'string' },
                role: { type: 'string' },
                permissions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      screen_id: { type: 'string' },
                      screen_name: { type: 'string' },
                      screen_path: { type: 'string' },
                      screen_category: { type: 'string' },
                      can_view: { type: 'boolean' },
                      can_create: { type: 'boolean' },
                      can_edit: { type: 'boolean' },
                      can_delete: { type: 'boolean' },
                      can_export: { type: 'boolean' },
                      is_override: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;

    // Usar a função SQL para obter permissões calculadas
    const permissions = await prisma.$queryRaw<Array<{
      screen_id: string;
      screen_name: string;
      screen_path: string;
      screen_category: string;
      can_view: boolean;
      can_create: boolean;
      can_edit: boolean;
      can_delete: boolean;
      can_export: boolean;
      is_override: boolean;
    }>>`SELECT * FROM get_user_computed_permissions(${user.userId}::uuid)`;

    return reply.status(200).send({
      success: true,
      data: {
        user_id: user.userId,
        role: user.role,
        permissions,
      },
    });
  });

  /**
   * PUT /api/role-permissions/user/:userId/overrides
   * Definir permissões personalizadas para um usuário específico
   * Apenas admin pode acessar
   */
  app.put('/user/:userId/overrides', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Definir permissões personalizadas para um usuário',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['overrides'],
        properties: {
          overrides: {
            type: 'array',
            items: {
              type: 'object',
              required: ['screen_id'],
              properties: {
                screen_id: { type: 'string' },
                can_view: { type: 'boolean', nullable: true },
                can_create: { type: 'boolean', nullable: true },
                can_edit: { type: 'boolean', nullable: true },
                can_delete: { type: 'boolean', nullable: true },
                can_export: { type: 'boolean', nullable: true },
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
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const currentUser = request.user!;
    const { userId } = request.params as { userId: string };

    // Apenas admin pode definir overrides
    if (currentUser.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem definir permissões personalizadas');
    }

    const body = request.body as {
      overrides: Array<{
        screen_id: string;
        can_view?: boolean | null;
        can_create?: boolean | null;
        can_edit?: boolean | null;
        can_delete?: boolean | null;
        can_export?: boolean | null;
      }>;
    };

    // Verificar se usuário existe
    const targetUser = await prisma.appUser.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      throw new NotFoundError('Usuário não encontrado');
    }

    // Atualizar overrides em transação
    await prisma.$transaction(async (tx) => {
      for (const override of body.overrides) {
        // Se todas as permissões são null, remover o override
        if (
          override.can_view === null &&
          override.can_create === null &&
          override.can_edit === null &&
          override.can_delete === null &&
          override.can_export === null
        ) {
          await tx.$executeRaw`
            DELETE FROM user_permission_overrides
            WHERE user_id = ${userId}::uuid AND screen_id = ${override.screen_id}
          `;
        } else {
          await tx.$executeRaw`
            INSERT INTO user_permission_overrides (user_id, screen_id, can_view, can_create, can_edit, can_delete, can_export, granted_by, updated_at)
            VALUES (${userId}::uuid, ${override.screen_id}, ${override.can_view}, ${override.can_create}, ${override.can_edit}, ${override.can_delete}, ${override.can_export}, ${currentUser.userId}::uuid, NOW())
            ON CONFLICT (user_id, screen_id) DO UPDATE SET
              can_view = ${override.can_view},
              can_create = ${override.can_create},
              can_edit = ${override.can_edit},
              can_delete = ${override.can_delete},
              can_export = ${override.can_export},
              granted_by = ${currentUser.userId}::uuid,
              updated_at = NOW()
          `;
        }
      }
    });

    return reply.status(200).send({
      success: true,
      message: 'Permissões personalizadas atualizadas com sucesso',
    });
  });

  /**
   * DELETE /api/role-permissions/user/:userId/overrides
   * Remover todas as permissões personalizadas de um usuário (voltar ao padrão do perfil)
   * Apenas admin pode acessar
   */
  app.delete('/user/:userId/overrides', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Remover permissões personalizadas de um usuário',
      tags: ['Permissões'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', format: 'uuid' },
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
    const currentUser = request.user!;
    const { userId } = request.params as { userId: string };

    // Apenas admin pode remover overrides
    if (currentUser.role !== 'admin') {
      throw new ForbiddenError('Apenas administradores podem remover permissões personalizadas');
    }

    await prisma.$executeRaw`
      DELETE FROM user_permission_overrides WHERE user_id = ${userId}::uuid
    `;

    return reply.status(200).send({
      success: true,
      message: 'Permissões personalizadas removidas com sucesso',
    });
  });
};

export default rolePermissionsRoutes;
