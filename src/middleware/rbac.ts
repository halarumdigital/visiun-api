import { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { UserRole, AuthContext } from '../types/index.js';

interface RBACOptions {
  /**
   * Roles permitidos para acessar o recurso
   */
  allowedRoles?: UserRole[];

  /**
   * Se true, permite acesso apenas ao próprio recurso
   */
  selfOnly?: boolean;

  /**
   * Campo que contém o ID do recurso para verificação selfOnly
   */
  resourceIdParam?: string;
}

/**
 * Middleware RBAC (Role-Based Access Control)
 * Verifica permissões baseadas em role e injeta contexto de autorização
 */
export function rbac(options: RBACOptions = {}) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    if (!user) {
      throw new UnauthorizedError('Usuário não autenticado');
    }

    // Verificar se o role do usuário está na lista de permitidos
    if (options.allowedRoles && options.allowedRoles.length > 0) {
      if (!options.allowedRoles.includes(user.role)) {
        throw new ForbiddenError(
          `Acesso negado. Roles permitidos: ${options.allowedRoles.join(', ')}`
        );
      }
    }

    // Criar contexto de autorização
    const context: AuthContext = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      regionalType: user.regionalType,
      masterType: user.masterType,
      cityId: user.cityId,
      franchiseeId: user.franchiseeId,

      // Helper: verifica se é master_br ou admin
      isMasterOrAdmin: () => ['master_br', 'admin'].includes(user.role),

      // Helper: verifica se é regional
      isRegional: () => user.role === 'regional',

      // Helper: verifica se é franqueado
      isFranchisee: () => user.role === 'franchisee',

      // Helper: retorna filtro de cidade para queries
      getCityFilter: () => {
        // Master e Admin veem tudo
        if (['master_br', 'admin'].includes(user.role)) {
          return {};
        }
        // Regional e Franchisee veem apenas sua cidade
        if (user.cityId) {
          return { city_id: user.cityId };
        }
        return {};
      },

      // Helper: retorna filtro de franqueado para queries
      getFranchiseeFilter: () => {
        // Master e Admin veem tudo
        if (['master_br', 'admin'].includes(user.role)) {
          return {};
        }
        // Regional vê dados da sua cidade
        if (user.role === 'regional' && user.cityId) {
          return { city_id: user.cityId };
        }
        // Franchisee vê apenas seus próprios dados
        if (user.role === 'franchisee' && user.franchiseeId) {
          return { franchisee_id: user.franchiseeId };
        }
        return {};
      },
    };

    // Injetar contexto na request
    request.authContext = context;
  };
}

/**
 * Middleware para verificar se usuário é Master ou Admin
 */
export function requireMasterOrAdmin() {
  return rbac({ allowedRoles: ['master_br', 'admin'] });
}

/**
 * Middleware para verificar se usuário é Master
 */
export function requireMaster() {
  return rbac({ allowedRoles: ['master_br'] });
}

/**
 * Middleware para verificar se usuário é Admin ou superior
 */
export function requireAdmin() {
  return rbac({ allowedRoles: ['master_br', 'admin'] });
}

/**
 * Middleware para verificar se usuário é Regional ou superior
 */
export function requireRegionalOrAbove() {
  return rbac({ allowedRoles: ['master_br', 'admin', 'regional'] });
}

/**
 * Verifica se o usuário pode acessar um recurso específico de franqueado
 */
export function canAccessFranchisee(
  userRole: UserRole,
  userFranchiseeId: string | null | undefined,
  userCityId: string | null | undefined,
  resourceFranchiseeId: string,
  resourceCityId?: string
): boolean {
  // Master e Admin podem acessar qualquer franqueado
  if (['master_br', 'admin'].includes(userRole)) {
    return true;
  }

  // Regional pode acessar franqueados da sua cidade
  if (userRole === 'regional' && userCityId && resourceCityId) {
    return userCityId === resourceCityId;
  }

  // Franchisee só pode acessar seu próprio franqueado
  if (userRole === 'franchisee' && userFranchiseeId) {
    return userFranchiseeId === resourceFranchiseeId;
  }

  return false;
}

/**
 * Verifica se o usuário pode acessar um recurso específico de cidade
 */
export function canAccessCity(
  userRole: UserRole,
  userCityId: string | null | undefined,
  resourceCityId: string
): boolean {
  // Master e Admin podem acessar qualquer cidade
  if (['master_br', 'admin'].includes(userRole)) {
    return true;
  }

  // Regional e Franchisee só podem acessar sua própria cidade
  if (userCityId) {
    return userCityId === resourceCityId;
  }

  return false;
}

/**
 * Verifica se o usuário pode modificar outro usuário
 */
export function canModifyUser(
  actorRole: UserRole,
  actorUserId: string,
  targetRole: UserRole,
  targetUserId: string
): boolean {
  // Pode sempre modificar a si mesmo (exceto role)
  if (actorUserId === targetUserId) {
    return true;
  }

  // Hierarquia de roles
  const roleHierarchy: Record<UserRole, number> = {
    master_br: 4,
    admin: 3,
    regional: 2,
    franchisee: 1,
  };

  // Só pode modificar usuários com role inferior
  return roleHierarchy[actorRole] > roleHierarchy[targetRole];
}
