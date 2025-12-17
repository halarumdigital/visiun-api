import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { logger } from './utils/logger.js';
import { AppError, ValidationError } from './utils/errors.js';

// Routes
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import rentalsRoutes from './routes/rentals.js';
import motorcyclesRoutes from './routes/motorcycles.js';
import financeiroRoutes from './routes/financeiro.js';
import uploadRoutes from './routes/upload.js';
import webhooksRoutes from './routes/webhooks.js';
import integrationsRoutes from './routes/integrations/index.js';
import citiesRoutes from './routes/cities.js';
import franchiseesRoutes from './routes/franchisees.js';
import clientsRoutes from './routes/clients.js';
import templatesRoutes from './routes/templates.js';
import contractsRoutes from './routes/contracts.js';
import rentalPlansRoutes from './routes/rental-plans.js';
import vistoriasRoutes from './routes/vistorias.js';

// Adicionar Prisma à declaração do Fastify
declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    } : true,
    trustProxy: true,
    // Aumentar limite do body para uploads
    bodyLimit: 15 * 1024 * 1024, // 15MB
  });

  // Decorar app com Prisma
  app.decorate('prisma', prisma);

  // Plugins de segurança
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Customizar conforme necessário
  });

  // Rate limiting global
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () => ({
      success: false,
      error: 'Muitas requisições. Tente novamente mais tarde.',
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  });

  // Swagger/OpenAPI
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'City Scope CRM API',
        description: 'API Backend para sistema de gestão de franquias Master Brasil',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: 'Development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  }));

  // API info
  app.get('/api', async () => ({
    name: 'City Scope CRM API',
    version: '1.0.0',
    documentation: '/docs',
  }));

  // Registrar rotas
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(rentalsRoutes, { prefix: '/api/rentals' });
  await app.register(motorcyclesRoutes, { prefix: '/api/motorcycles' });
  await app.register(financeiroRoutes, { prefix: '/api/financeiro' });
  await app.register(uploadRoutes, { prefix: '/api/upload' });
  await app.register(webhooksRoutes, { prefix: '/api/webhooks' });
  await app.register(integrationsRoutes, { prefix: '/api/integrations' });
  await app.register(citiesRoutes, { prefix: '/api/cities' });
  await app.register(franchiseesRoutes, { prefix: '/api/franchisees' });
  await app.register(clientsRoutes, { prefix: '/api/clients' });
  await app.register(templatesRoutes, { prefix: '/api/templates' });
  await app.register(contractsRoutes, { prefix: '/api/contracts' });
  await app.register(rentalPlansRoutes, { prefix: '/api/rental-plans' });
  await app.register(vistoriasRoutes, { prefix: '/api/vistorias' });

  // Error handler global
  app.setErrorHandler((error, request, reply) => {
    // Log do erro
    if (error instanceof AppError && error.isOperational) {
      app.log.warn({
        err: error,
        url: request.url,
        method: request.method,
      });
    } else {
      app.log.error({
        err: error,
        url: request.url,
        method: request.method,
      });
    }

    // Erro de validação do Zod
    if (error instanceof ValidationError) {
      return reply.status(422).send({
        success: false,
        error: error.message,
        code: error.code,
        errors: error.errors,
      });
    }

    // Erro operacional (AppError)
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    // Erro de validação do Fastify
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: 'Erro de validação',
        code: 'VALIDATION_ERROR',
        details: error.validation,
      });
    }

    // Erro de rate limit do Fastify
    if (error.statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: 'Muitas requisições. Tente novamente mais tarde.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Erro interno desconhecido
    return reply.status(500).send({
      success: false,
      error: env.NODE_ENV === 'production'
        ? 'Erro interno do servidor'
        : error.message,
      code: 'INTERNAL_ERROR',
    });
  });

  // Not found handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      error: 'Rota não encontrada',
      code: 'NOT_FOUND',
    });
  });

  return app;
}
