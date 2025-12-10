import { createServer } from 'http';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { initializeRealtime } from './websocket/index.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    // Conectar ao banco de dados
    await connectDatabase();

    // Construir aplicação Fastify
    const app = await buildApp();

    // Criar servidor HTTP para compartilhar com Socket.io
    const httpServer = createServer(app.server);

    // Inicializar WebSocket
    initializeRealtime(httpServer);

    // Iniciar servidor
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    logger.info(`Server running on http://${env.HOST}:${env.PORT}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`Documentation: http://${env.HOST}:${env.PORT}/docs`);

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.info(`Received ${signal}, shutting down gracefully...`);

        try {
          await app.close();
          await disconnectDatabase();
          logger.info('Server shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error({ error }, 'Error during shutdown');
          process.exit(1);
        }
      });
    });

  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
