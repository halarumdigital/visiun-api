import { FastifyRequest } from 'fastify';
import { AuthContext, TokenPayload, UserRole } from '../types/index.js';

// Interface estendida para o request com context tipado
export interface AuthenticatedRequest extends FastifyRequest {
  user: TokenPayload;
  authContext: AuthContext;
}

/**
 * Obter contexto de autorização da request
 * Usa type assertion para garantir que o contexto existe
 */
export function getContext(request: FastifyRequest): AuthContext {
  const ctx = request.authContext;
  if (!ctx) {
    throw new Error('AuthContext não disponível. Verifique se o middleware RBAC foi aplicado.');
  }
  return ctx;
}

/**
 * Obter usuário autenticado da request
 */
export function getUser(request: FastifyRequest): TokenPayload {
  const user = (request as any).user;
  if (!user) {
    throw new Error('Usuário não autenticado. Verifique se o middleware de auth foi aplicado.');
  }
  return user as TokenPayload;
}

/**
 * Criar contexto de autorização a partir do usuário
 */
export function createAuthContext(user: TokenPayload): AuthContext {
  return {
    userId: user.userId,
    email: user.email,
    role: user.role,
    regionalType: user.regionalType,
    masterType: user.masterType,
    cityId: user.cityId,
    franchiseeId: user.franchiseeId,

    isMasterOrAdmin: () => ['master_br', 'admin'].includes(user.role),
    isRegional: () => user.role === 'regional',
    isFranchisee: () => user.role === 'franchisee',

    getCityFilter: () => {
      if (['master_br', 'admin'].includes(user.role)) {
        return {};
      }
      if (user.cityId) {
        return { city_id: user.cityId };
      }
      return {};
    },

    getFranchiseeFilter: () => {
      if (['master_br', 'admin'].includes(user.role)) {
        return {};
      }
      if (user.role === 'regional' && user.cityId) {
        return { city_id: user.cityId };
      }
      if (user.role === 'franchisee' && user.franchiseeId) {
        return { franchisee_id: user.franchiseeId };
      }
      return {};
    },
  };
}
