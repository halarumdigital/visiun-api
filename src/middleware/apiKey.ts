import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { env } from '../config/env.js';

// Rotas que não precisam de API Key
const EXEMPT_PATHS = [
  '/health',
  '/api/webhooks',
  '/docs',
];

function isExemptPath(url: string): boolean {
  return EXEMPT_PATHS.some(path => url === path || url.startsWith(path + '/') || url.startsWith(path + '?'));
}

/**
 * Middleware global de API Key
 * Valida o header X-API-Key em todas as requisições (exceto rotas isentas)
 * Usa comparação em tempo constante para evitar timing attacks
 */
export async function apiKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const url = request.url;

  // Pular validação para rotas isentas
  if (isExemptPath(url)) {
    return;
  }

  // Bloquear Swagger em produção
  if (env.NODE_ENV === 'production' && (url === '/docs' || url.startsWith('/docs/'))) {
    return reply.status(404).send({
      success: false,
      error: 'Rota não encontrada',
      code: 'NOT_FOUND',
    });
  }

  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return reply.status(403).send({
      success: false,
      error: 'Acesso não autorizado',
      code: 'FORBIDDEN',
    });
  }

  // Comparação em tempo constante para evitar timing attacks
  const expectedKey = Buffer.from(env.API_KEY, 'utf-8');
  const receivedKey = Buffer.from(apiKey, 'utf-8');

  if (expectedKey.length !== receivedKey.length || !crypto.timingSafeEqual(expectedKey, receivedKey)) {
    return reply.status(403).send({
      success: false,
      error: 'Acesso não autorizado',
      code: 'FORBIDDEN',
    });
  }
}
