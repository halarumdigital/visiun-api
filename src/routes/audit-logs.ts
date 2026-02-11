import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';
import { Prisma } from '@prisma/client';

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
  },
};

const auditLogsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/audit-logs
   * Listar logs de auditoria com filtros e paginação
   * Usa raw SQL para JOIN inteligente: tenta user_id, depois entity_id quando entity_type='user'
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
    schema: {
      description: 'Listar logs de auditoria com filtros',
      tags: ['Audit Logs'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          user_id: { type: 'string', format: 'uuid' },
          action: { type: 'string' },
          entity_type: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            count: { type: 'number' },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const {
      limit = 50,
      offset = 0,
      start_date,
      end_date,
      user_id,
      action,
      entity_type,
    } = request.query as {
      limit?: number;
      offset?: number;
      start_date?: string;
      end_date?: string;
      user_id?: string;
      action?: string;
      entity_type?: string;
    };

    const context = getContext(request);

    // Construir cláusulas WHERE dinâmicas
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    // Default: últimos 7 dias se não tiver filtro de data
    if (start_date) {
      conditions.push(`al.created_at >= $${paramIdx++}`);
      params.push(new Date(start_date));
    } else {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      conditions.push(`al.created_at >= $${paramIdx++}`);
      params.push(sevenDaysAgo);
    }

    if (end_date) {
      conditions.push(`al.created_at <= $${paramIdx++}`);
      params.push(new Date(end_date));
    }

    if (user_id) {
      conditions.push(`al.user_id = $${paramIdx++}::uuid`);
      params.push(user_id);
    }

    if (action) {
      conditions.push(`al.action = $${paramIdx++}`);
      params.push(action);
    }

    if (entity_type) {
      conditions.push(`al.entity_type = $${paramIdx++}`);
      params.push(entity_type);
    }

    // Regional só vê logs da sua cidade
    if (context.role === 'regional' && context.cityId) {
      conditions.push(`(al.city_id = $${paramIdx}::uuid OR au_direct.city_id = $${paramIdx}::uuid OR au_entity.city_id = $${paramIdx}::uuid)`);
      params.push(context.cityId);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeTake = Math.min(limit, 200);

    // Mapeamento de entity_type para label em português
    const entityLabel = `CASE al.entity_type
      WHEN 'app_users' THEN 'Usuários'
      WHEN 'motorcycles' THEN 'Motocicletas'
      WHEN 'rentals' THEN 'Locações'
      WHEN 'clients' THEN 'Clientes'
      WHEN 'franchisees' THEN 'Franqueados'
      WHEN 'vistorias' THEN 'Vistorias'
      WHEN 'ordens_servico' THEN 'Ordens de Serviço'
      WHEN 'vendas' THEN 'Vendas'
      WHEN 'financeiro' THEN 'Financeiro'
      WHEN 'cities' THEN 'Cidades'
      WHEN 'contract_templates' THEN 'Modelos de Contrato'
      WHEN 'generated_contracts' THEN 'Contratos'
      WHEN 'leads' THEN 'Leads'
      WHEN 'deals' THEN 'Negócios'
      WHEN 'activities' THEN 'Atividades'
      WHEN 'rastreadores' THEN 'Rastreadores'
      WHEN 'rental_addendums' THEN 'Aditivos'
      WHEN 'user_menu_permissions' THEN 'Permissões'
      WHEN 'user' THEN 'Usuários'
      WHEN 'file' THEN 'Arquivo'
      ELSE al.entity_type
    END`;

    // Query com JOIN inteligente
    const dataQuery = `
      SELECT
        al.id,
        al.created_at,
        al.user_id,
        COALESCE(al.user_email, au_direct.email, au_entity.email) as user_email,
        COALESCE(al.user_name, au_direct.name, au_entity.name) as user_name,
        COALESCE(al.user_role, au_direct.role, au_entity.role) as user_role,
        COALESCE(al.city_id, au_direct.city_id, au_entity.city_id) as city_id,
        COALESCE(al.city_name, c_direct.name, c_entity.name) as city_name,
        al.action,
        COALESCE(al.action_label, CASE
          WHEN al.action IN ('INSERT', 'CREATE', 'create') THEN 'Adição'
          WHEN al.action IN ('UPDATE', 'update') THEN 'Edição'
          WHEN al.action IN ('DELETE', 'delete') THEN 'Exclusão'
          WHEN al.action = 'AUTH_LOGIN' THEN 'Login'
          WHEN al.action = 'AUTH_LOGOUT' THEN 'Logout'
          WHEN al.action = 'AUTH_LOGIN_FAILED' THEN 'Login falhou'
          WHEN al.action = 'AUTH_PASSWORD_CHANGE' THEN 'Alterou senha'
          WHEN al.action = 'AUTH_PASSWORD_RESET' THEN 'Resetou senha'
          WHEN al.action = 'FILE_UPLOAD' THEN 'Upload'
          ELSE al.action
        END) as action_label,
        al.entity_type,
        al.entity_id,
        COALESCE(al.description, CASE
          WHEN al.action IN ('INSERT', 'CREATE', 'create') THEN
            'Adicionou ' || ${entityLabel} ||
            CASE WHEN al.entity_id IS NOT NULL THEN ' "' || al.entity_id || '"' ELSE '' END
          WHEN al.action IN ('UPDATE', 'update') THEN
            'Editou ' || ${entityLabel} ||
            CASE WHEN al.entity_id IS NOT NULL THEN ' "' || al.entity_id || '"' ELSE '' END
          WHEN al.action IN ('DELETE', 'delete') THEN
            'Removeu ' || ${entityLabel} ||
            CASE WHEN al.entity_id IS NOT NULL THEN ' "' || al.entity_id || '"' ELSE '' END
          WHEN al.action = 'AUTH_LOGIN' THEN 'Realizou login'
          WHEN al.action = 'AUTH_LOGOUT' THEN 'Realizou logout'
          WHEN al.action = 'AUTH_LOGIN_FAILED' THEN 'Tentativa de login falhou'
          WHEN al.action = 'AUTH_PASSWORD_CHANGE' THEN 'Alterou a senha'
          WHEN al.action = 'AUTH_PASSWORD_RESET' THEN 'Resetou a senha'
          WHEN al.action = 'FILE_UPLOAD' THEN 'Realizou upload de arquivo'
          ELSE al.action || CASE WHEN al.entity_type IS NOT NULL THEN ' em ' || ${entityLabel} ELSE '' END
        END) as description,
        al.changed_fields
      FROM audit_logs al
      LEFT JOIN app_users au_direct ON al.user_id = au_direct.id
      LEFT JOIN cities c_direct ON au_direct.city_id = c_direct.id
      LEFT JOIN app_users au_entity ON al.user_id IS NULL
        AND al.entity_id IS NOT NULL
        AND al.entity_id = au_entity.id::text
      LEFT JOIN cities c_entity ON au_entity.city_id = c_entity.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ${safeTake} OFFSET ${offset}
    `;

    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM audit_logs al
      LEFT JOIN app_users au_direct ON al.user_id = au_direct.id
      LEFT JOIN app_users au_entity ON al.user_id IS NULL
        AND al.entity_id IS NOT NULL
        AND al.entity_id = au_entity.id::text
      ${whereClause}
    `;

    try {
      const [data, countResult] = await Promise.all([
        prisma.$queryRawUnsafe(dataQuery, ...params) as Promise<any[]>,
        prisma.$queryRawUnsafe(countQuery, ...params) as Promise<{ total: number }[]>,
      ]);

      // BigInt safety: Prisma $queryRawUnsafe pode retornar BigInt para COUNT
      const count = Number(countResult[0]?.total ?? 0);

      return reply.status(200).send({
        success: true,
        data,
        count,
      });
    } catch (error: any) {
      request.log.error({ error: error.message, role: context.role, cityId: context.cityId }, 'Erro ao buscar audit logs');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao buscar logs de auditoria',
      });
    }
  });

  /**
   * GET /api/audit-logs/:id
   * Buscar detalhes completos de um log
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin', 'regional'] })],
    schema: {
      description: 'Buscar detalhes de um log de auditoria',
      tags: ['Audit Logs'],
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
            data: { type: 'object' },
          },
        },
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const rows = await prisma.$queryRaw`
      SELECT
        al.*,
        COALESCE(al.user_email, au_direct.email, au_entity.email) as user_email,
        COALESCE(al.user_name, au_direct.name, au_entity.name) as user_name,
        COALESCE(al.user_role, au_direct.role, au_entity.role) as user_role,
        COALESCE(al.city_id, au_direct.city_id, au_entity.city_id) as city_id,
        COALESCE(al.city_name, c_direct.name, c_entity.name) as city_name
      FROM audit_logs al
      LEFT JOIN app_users au_direct ON al.user_id = au_direct.id
      LEFT JOIN cities c_direct ON au_direct.city_id = c_direct.id
      LEFT JOIN app_users au_entity ON al.user_id IS NULL
        AND al.entity_id IS NOT NULL
        AND al.entity_id = au_entity.id::text
      LEFT JOIN cities c_entity ON au_entity.city_id = c_entity.id
      WHERE al.id = ${id}::uuid
      LIMIT 1
    ` as any[];

    if (!rows || rows.length === 0) {
      return reply.status(404).send({
        success: false,
        error: 'Log não encontrado',
      });
    }

    return reply.status(200).send({
      success: true,
      data: rows[0],
    });
  });

  /**
   * POST /api/audit-logs
   * Criar um registro de log de auditoria
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar registro de auditoria',
      tags: ['Audit Logs'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string' },
          entity_type: { type: 'string' },
          entity_id: { type: 'string' },
          details: { type: 'object' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { action, entity_type, entity_id, details } = request.body as {
      action: string;
      entity_type?: string;
      entity_id?: string;
      details?: Record<string, unknown>;
    };

    const context = getContext(request);

    // Buscar dados do usuário para enriquecer o log
    const user = await prisma.appUser.findUnique({
      where: { id: context.userId! },
      select: {
        email: true,
        name: true,
        role: true,
        city_id: true,
        city: { select: { name: true } },
        franchisee_id: true,
        franchisee: { select: { fantasy_name: true, company_name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        user_id: context.userId,
        user_email: user?.email,
        user_name: user?.name,
        user_role: user?.role,
        city_id: user?.city_id,
        city_name: user?.city?.name,
        franchisee_id: user?.franchisee_id,
        franchisee_name: user?.franchisee?.fantasy_name || user?.franchisee?.company_name,
        action,
        entity_type,
        entity_id,
        details: details ? (details as Prisma.InputJsonValue) : undefined,
        ip_address: request.ip,
        user_agent: request.headers['user-agent'],
      },
    });

    return reply.status(201).send({ success: true });
  });
};

export default auditLogsRoutes;
