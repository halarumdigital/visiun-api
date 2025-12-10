import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/authService.js';
import { UnauthorizedError } from '../utils/errors.js';
import { TokenPayload } from '../types/index.js';

/**
 * Middleware de autenticação JWT
 * Verifica se o token de acesso é válido e injeta o usuário na request
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError('Token de autenticação não fornecido');
  }

  const [type, token] = authHeader.split(' ');

  if (type !== 'Bearer' || !token) {
    throw new UnauthorizedError('Formato de token inválido. Use: Bearer <token>');
  }

  try {
    const payload = authService.verifyAccessToken(token);
    request.user = payload;
  } catch (error) {
    throw new UnauthorizedError('Token inválido ou expirado');
  }
}

/**
 * Middleware opcional de autenticação
 * Não falha se não houver token, mas injeta o usuário se houver
 */
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return;
  }

  const [type, token] = authHeader.split(' ');

  if (type !== 'Bearer' || !token) {
    return;
  }

  try {
    const payload = authService.verifyAccessToken(token);
    request.user = payload;
  } catch {
    // Ignora erros de token inválido em auth opcional
  }
}

/**
 * Helper para extrair o token do header
 */
export function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const [type, token] = authHeader.split(' ');

  if (type !== 'Bearer' || !token) {
    return null;
  }

  return token;
}
