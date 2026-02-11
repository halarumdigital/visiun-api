import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/authService.js';
import { authMiddleware } from '../middleware/auth.js';
import { loginRateLimit, passwordResetRateLimit } from '../middleware/rateLimit.js';
import { auditService, AuditActions } from '../middleware/audit.js';
import { BadRequestError } from '../utils/errors.js';

// Schemas de validação
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token é obrigatório'),
});

const requestResetSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  newPassword: z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
});

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').optional(),
});

const loginCnpjSchema = z.object({
  cnpj: z.string().min(1, 'CNPJ é obrigatório'),
});

const franchiseeSetupSchema = z.object({
  franchiseeId: z.string().min(1, 'ID do franqueado é obrigatório'),
  email: z.string().trim().toLowerCase().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
});

const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/auth/register
   * Registro de novo usuário (público - aguarda aprovação)
   */
  app.post('/register', {
    schema: {
      description: 'Registrar novo usuário (aguardando aprovação do admin)',
      tags: ['Autenticação'],
    },
  }, async (request, reply) => {
    const body = registerSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: body.error.errors[0].message,
        code: 'VALIDATION_ERROR',
      });
    }

    const { email, password, name } = body.data;

    try {
      const result = await authService.register(email, password, name);

      await auditService.logFromRequest(
        request,
        AuditActions.USER_CREATE,
        'user',
        result.id,
        undefined,
        { email, status: 'pending' }
      );

      return reply.status(201).send({
        success: true,
        message: 'Conta criada com sucesso! Aguarde a aprovação do administrador.',
        data: result,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      return reply.status(statusCode).send({
        success: false,
        error: error.message || 'Erro ao criar conta',
        code: error.code || 'ERROR',
      });
    }
  });

  /**
   * POST /api/auth/login
   * Login do usuário
   */
  app.post('/login', {
    preHandler: [loginRateLimit],
    schema: {
      description: 'Autenticação de usuário',
      tags: ['Autenticação'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', description: 'Email do usuário' },
          password: { type: 'string', minLength: 1, description: 'Senha do usuário' },
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
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    name: { type: 'string', nullable: true },
                    role: { type: 'string', enum: ['master_br', 'admin', 'regional', 'franchisee'] },
                    regionalType: { type: 'string', nullable: true },
                    masterType: { type: 'string', nullable: true },
                    cityId: { type: 'string', nullable: true },
                    franchiseeId: { type: 'string', nullable: true },
                    status: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = loginSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { email, password } = body.data;

    try {
      const result = await authService.login(email, password);

      await auditService.logFromRequest(
        request,
        AuditActions.LOGIN,
        'user',
        result.user.id,
        undefined,
        undefined,
        result.user.id
      );

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (error) {
      await auditService.logFromRequest(
        request,
        AuditActions.LOGIN_FAILED,
        'user',
        undefined,
        undefined,
        { email }
      );
      throw error;
    }
  });

  /**
   * POST /api/auth/refresh
   * Refresh do token de acesso
   */
  app.post('/refresh', {
    schema: {
      description: 'Atualizar token de acesso usando refresh token',
      tags: ['Autenticação'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', description: 'Refresh token válido' },
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
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = refreshTokenSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { refreshToken } = body.data;
    const result = await authService.refreshAccessToken(refreshToken);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });

  /**
   * POST /api/auth/logout
   * Logout do usuário
   */
  app.post('/logout', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Logout do usuário (invalida refresh token)',
      tags: ['Autenticação'],
      security: [{ bearerAuth: [] }],
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
    const userId = request.user!.userId;

    await authService.logout(userId);

    await auditService.logFromRequest(
      request,
      AuditActions.LOGOUT,
      'user',
      userId
    );

    return reply.status(200).send({
      success: true,
      message: 'Logout realizado com sucesso',
    });
  });

  /**
   * GET /api/auth/me
   * Obter dados do usuário atual
   */
  app.get('/me', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Obter dados do usuário autenticado',
      tags: ['Autenticação'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string', nullable: true },
                role: { type: 'string' },
                regionalType: { type: 'string', nullable: true },
                masterType: { type: 'string', nullable: true },
                cityId: { type: 'string', nullable: true },
                franchiseeId: { type: 'string', nullable: true },
                status: { type: 'string' },
                avatarUrl: { type: 'string', nullable: true },
                city: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                franchisee: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                  },
                },
                createdAt: { type: 'string', format: 'date-time' },
                lastLogin: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const userId = request.user!.userId;
    const user = await authService.getCurrentUser(userId);

    return reply.status(200).send({
      success: true,
      data: user,
    });
  });

  /**
   * POST /api/auth/request-reset
   * Solicitar reset de senha
   */
  app.post('/request-reset', {
    preHandler: [passwordResetRateLimit],
    schema: {
      description: 'Solicitar token para redefinição de senha',
      tags: ['Autenticação'],
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', description: 'Email do usuário' },
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
    const body = requestResetSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { email } = body.data;
    const token = await authService.requestPasswordReset(email);

    await auditService.logFromRequest(
      request,
      AuditActions.PASSWORD_RESET_REQUEST,
      'user',
      undefined,
      undefined,
      { email }
    );

    return reply.status(200).send({
      success: true,
      message: 'Se o email existir, você receberá instruções para redefinir sua senha.',
    });
  });

  /**
   * POST /api/auth/reset-password
   * Resetar senha com token
   */
  app.post('/reset-password', {
    schema: {
      description: 'Redefinir senha usando token recebido',
      tags: ['Autenticação'],
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', description: 'Token de redefinição' },
          password: { type: 'string', minLength: 8, description: 'Nova senha (mínimo 8 caracteres)' },
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
    const body = resetPasswordSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { token, password } = body.data;
    await authService.resetPasswordWithToken(token, password);

    await auditService.logFromRequest(
      request,
      AuditActions.PASSWORD_RESET,
      'user'
    );

    return reply.status(200).send({
      success: true,
      message: 'Senha alterada com sucesso',
    });
  });

  /**
   * POST /api/auth/login-cnpj
   * Buscar franqueado pelo CNPJ (público)
   */
  app.post('/login-cnpj', {
    preHandler: [loginRateLimit],
    schema: {
      description: 'Buscar franqueado pelo CNPJ para login',
      tags: ['Autenticação'],
    },
  }, async (request, reply) => {
    const body = loginCnpjSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const { cnpj } = body.data;

    try {
      const franchisee = await authService.findFranchiseeByCnpj(cnpj);

      return reply.status(200).send({
        success: true,
        data: franchisee,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      return reply.status(statusCode).send({
        success: false,
        error: error.message || 'Erro ao buscar franqueado',
        code: error.code || 'ERROR',
      });
    }
  });

  /**
   * POST /api/auth/franchisee-setup
   * Criar conta para franqueado (primeira senha)
   */
  app.post('/franchisee-setup', {
    schema: {
      description: 'Criar conta de acesso para franqueado (primeira senha)',
      tags: ['Autenticação'],
    },
  }, async (request, reply) => {
    const body = franchiseeSetupSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: body.error.errors[0].message,
        code: 'VALIDATION_ERROR',
      });
    }

    const { franchiseeId, email, password } = body.data;

    try {
      const result = await authService.franchiseeSetup(franchiseeId, email, password);

      await auditService.logFromRequest(
        request,
        AuditActions.USER_CREATE,
        'user',
        result.user.id,
        undefined,
        { email, franchiseeId, type: 'franchisee_setup' }
      );

      return reply.status(201).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      return reply.status(statusCode).send({
        success: false,
        error: error.message || 'Erro ao criar conta',
        code: error.code || 'ERROR',
      });
    }
  });

  /**
   * POST /api/auth/change-password
   * Alterar senha (usuário logado)
   */
  app.post('/change-password', {
    preHandler: [authMiddleware],
    schema: {
      description: 'Alterar senha do usuário autenticado',
      tags: ['Autenticação'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', description: 'Senha atual' },
          newPassword: { type: 'string', minLength: 8, description: 'Nova senha (mínimo 8 caracteres)' },
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
    const body = changePasswordSchema.safeParse(request.body);

    if (!body.success) {
      throw new BadRequestError(body.error.errors[0].message);
    }

    const userId = request.user!.userId;
    const { currentPassword, newPassword } = body.data;

    await authService.changePassword(userId, currentPassword, newPassword);

    await auditService.logFromRequest(
      request,
      AuditActions.PASSWORD_CHANGE,
      'user',
      userId
    );

    return reply.status(200).send({
      success: true,
      message: 'Senha alterada com sucesso',
    });
  });
};

export default authRoutes;
