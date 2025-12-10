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
   * Registrar log de auditoria
   */
  async log(data: AuditLogData): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          user_id: data.userId,
          action: data.action,
          entity_type: data.entityType,
          entity_id: data.entityId,
          old_data: data.oldData ? JSON.parse(JSON.stringify(data.oldData)) : null,
          new_data: data.newData ? JSON.parse(JSON.stringify(data.newData)) : null,
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
   */
  async logFromRequest(
    request: FastifyRequest,
    action: string,
    entityType?: string,
    entityId?: string,
    oldData?: unknown,
    newData?: unknown
  ): Promise<void> {
    await this.log({
      userId: request.user?.userId,
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
