import { FastifyRequest, FastifyReply } from 'fastify';
import { RateLimitError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Store em memória para rate limiting (sem Redis)
// Em produção com múltiplas instâncias, considerar Redis
const rateLimitStore = new Map<string, RateLimitEntry>();

// Limpar entradas expiradas periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Limpa a cada minuto

interface RateLimitOptions {
  /**
   * Máximo de requisições permitidas
   */
  max?: number;

  /**
   * Janela de tempo em milissegundos
   */
  windowMs?: number;

  /**
   * Função para gerar a chave de identificação
   * Por padrão usa IP + rota
   */
  keyGenerator?: (request: FastifyRequest) => string;

  /**
   * Função para pular o rate limit
   */
  skip?: (request: FastifyRequest) => boolean;

  /**
   * Mensagem de erro customizada
   */
  message?: string;
}

/**
 * Middleware de Rate Limiting em memória
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const {
    max = 100,
    windowMs = 60000,
    keyGenerator = defaultKeyGenerator,
    skip,
    message = 'Muitas requisições. Tente novamente mais tarde.',
  } = options;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Verificar se deve pular o rate limit
    if (skip && skip(request)) {
      return;
    }

    const key = keyGenerator(request);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      // Nova entrada ou entrada expirada
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    } else {
      // Incrementar contador
      entry.count++;
    }

    // Adicionar headers de rate limit
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

    reply.header('X-RateLimit-Limit', max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', resetSeconds);

    // Verificar se excedeu o limite
    if (entry.count > max) {
      reply.header('Retry-After', resetSeconds);
      logger.warn({ key, count: entry.count, max }, 'Rate limit exceeded');
      throw new RateLimitError(message);
    }
  };
}

/**
 * Gerador de chave padrão: IP + rota
 */
function defaultKeyGenerator(request: FastifyRequest): string {
  const ip = request.ip || 'unknown';
  const route = request.routeOptions?.url || request.url;
  return `${ip}:${route}`;
}

/**
 * Rate limit específico para login (mais restritivo)
 */
export const loginRateLimit = rateLimit({
  max: 5,
  windowMs: 15 * 60 * 1000, // 15 minutos
  keyGenerator: (request) => {
    const ip = request.ip || 'unknown';
    return `login:${ip}`;
  },
  message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
});

/**
 * Rate limit para requisições de API gerais
 */
export const apiRateLimit = rateLimit({
  max: 100,
  windowMs: 60 * 1000, // 1 minuto
});

/**
 * Rate limit para uploads (mais restritivo)
 */
export const uploadRateLimit = rateLimit({
  max: 10,
  windowMs: 60 * 1000, // 1 minuto
  keyGenerator: (request) => {
    const ip = request.ip || 'unknown';
    const userId = request.user?.userId || 'anonymous';
    return `upload:${ip}:${userId}`;
  },
  message: 'Muitos uploads. Aguarde um momento.',
});

/**
 * Rate limit para webhooks (mais permissivo)
 */
export const webhookRateLimit = rateLimit({
  max: 1000,
  windowMs: 60 * 1000, // 1 minuto
  keyGenerator: (request) => {
    const ip = request.ip || 'unknown';
    return `webhook:${ip}`;
  },
});

/**
 * Rate limit para reset de senha
 */
export const passwordResetRateLimit = rateLimit({
  max: 3,
  windowMs: 60 * 60 * 1000, // 1 hora
  keyGenerator: (request) => {
    const ip = request.ip || 'unknown';
    const email = (request.body as { email?: string })?.email || 'unknown';
    return `password-reset:${ip}:${email}`;
  },
  message: 'Muitas solicitações de reset de senha. Tente novamente em 1 hora.',
});
