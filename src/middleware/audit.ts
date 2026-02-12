import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';

interface AuditLogData {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldData?: unknown;
  newData?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Serviço de Audit Log
 */
export class AuditService {
  /**
   * Registrar log de auditoria (enriquece com dados do usuário)
   */
  async log(data: AuditLogData): Promise<void> {
    try {
      // Buscar dados do usuário para enriquecer o log
      let userInfo: { email: string; name: string | null; role: string; city_id: string | null; city_name: string | null } | null = null;
      if (data.userId) {
        try {
          const user = await prisma.appUser.findUnique({
            where: { id: data.userId },
            select: {
              email: true,
              name: true,
              role: true,
              city_id: true,
              city: { select: { name: true } },
            },
          });
          if (user) {
            userInfo = {
              email: user.email,
              name: user.name,
              role: user.role,
              city_id: user.city_id,
              city_name: user.city?.name || null,
            };
          }
        } catch {
          // Ignorar erro ao buscar usuário
        }
      }

      const oldDataSafe = data.oldData ? JSON.parse(JSON.stringify(data.oldData)) : null;
      const newDataSafe = data.newData ? JSON.parse(JSON.stringify(data.newData)) : null;

      // Auto-computar changed_fields quando ambos old e new existem
      let changedFields: string[] = [];
      if (oldDataSafe && newDataSafe && typeof oldDataSafe === 'object' && typeof newDataSafe === 'object') {
        const allKeys = new Set([...Object.keys(oldDataSafe), ...Object.keys(newDataSafe)]);
        const sensitiveFields = ['password_hash', 'refresh_token', 'plugsign_token', 'asaas_token'];
        changedFields = [...allKeys].filter(k => {
          if (sensitiveFields.includes(k)) return false;
          return JSON.stringify(oldDataSafe[k]) !== JSON.stringify(newDataSafe[k]);
        });
      }

      await prisma.auditLog.create({
        data: {
          user_id: data.userId,
          user_email: userInfo?.email,
          user_name: userInfo?.name,
          user_role: userInfo?.role,
          city_id: userInfo?.city_id,
          city_name: userInfo?.city_name,
          action: data.action,
          entity_type: data.entityType,
          entity_id: data.entityId,
          old_data: oldDataSafe,
          new_data: newDataSafe,
          changed_fields: changedFields.length > 0 ? changedFields : [],
          ip_address: data.ipAddress,
          user_agent: data.userAgent,
        },
      });
    } catch (error) {
      // Não falhar a requisição principal por erro no audit log
      logger.error({ error, data }, 'Failed to create audit log');
    }
  }

  /**
   * Registrar log de auditoria a partir da request
   * @param explicitUserId - Usar quando request.user não está disponível (ex: login)
   */
  async logFromRequest(
    request: FastifyRequest,
    action: string,
    entityType?: string,
    entityId?: string,
    oldData?: unknown,
    newData?: unknown,
    explicitUserId?: string
  ): Promise<void> {
    await this.log({
      userId: request.user?.userId || explicitUserId,
      action,
      entityType,
      entityId,
      oldData,
      newData,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}

export const auditService = new AuditService();

/**
 * Hook para registrar audit log automaticamente em operações de escrita
 */
export function auditHook(entityType: string) {
  return {
    onResponse: async (request: FastifyRequest, reply: FastifyReply) => {
      // Só logar operações de escrita bem-sucedidas
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        return;
      }

      if (reply.statusCode >= 400) {
        return;
      }

      const action = getActionFromMethod(request.method);
      const entityId = (request.params as { id?: string })?.id;

      await auditService.logFromRequest(
        request,
        action,
        entityType,
        entityId,
        undefined,
        request.body
      );
    },
  };
}

function getActionFromMethod(method: string): string {
  switch (method) {
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Ações de auditoria predefinidas
 */
export const AuditActions = {
  // Auth
  LOGIN: 'AUTH_LOGIN',
  LOGOUT: 'AUTH_LOGOUT',
  LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  PASSWORD_RESET_REQUEST: 'AUTH_PASSWORD_RESET_REQUEST',
  PASSWORD_RESET: 'AUTH_PASSWORD_RESET',
  PASSWORD_CHANGE: 'AUTH_PASSWORD_CHANGE',

  // User
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  USER_STATUS_CHANGE: 'USER_STATUS_CHANGE',
  USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',

  // Rental
  RENTAL_CREATE: 'RENTAL_CREATE',
  RENTAL_UPDATE: 'RENTAL_UPDATE',
  RENTAL_DELETE: 'RENTAL_DELETE',
  RENTAL_COMPLETE: 'RENTAL_COMPLETE',
  RENTAL_CANCEL: 'RENTAL_CANCEL',

  // Motorcycle
  MOTORCYCLE_CREATE: 'MOTORCYCLE_CREATE',
  MOTORCYCLE_UPDATE: 'MOTORCYCLE_UPDATE',
  MOTORCYCLE_STATUS_CHANGE: 'MOTORCYCLE_STATUS_CHANGE',

  // Contract
  CONTRACT_GENERATE: 'CONTRACT_GENERATE',
  CONTRACT_SEND: 'CONTRACT_SEND',
  CONTRACT_SIGN: 'CONTRACT_SIGN',
  CONTRACT_CANCEL: 'CONTRACT_CANCEL',

  // Finance
  FINANCE_CREATE: 'FINANCE_CREATE',
  FINANCE_UPDATE: 'FINANCE_UPDATE',
  FINANCE_DELETE: 'FINANCE_DELETE',

  // Integration
  PLUGSIGN_API_CALL: 'PLUGSIGN_API_CALL',
  BESIGN_API_CALL: 'BESIGN_API_CALL',
  EVOLUTION_WEBHOOK: 'EVOLUTION_WEBHOOK',
  SIGNATURE_WEBHOOK: 'SIGNATURE_WEBHOOK',

  // Upload
  FILE_UPLOAD: 'FILE_UPLOAD',
  FILE_DELETE: 'FILE_DELETE',
} as const;
