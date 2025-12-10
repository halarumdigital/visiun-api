import { FastifyPluginAsync } from 'fastify';
import axios, { AxiosError } from 'axios';
import { authMiddleware } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { auditService, AuditActions } from '../../middleware/audit.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { BadRequestError, ServiceUnavailableError } from '../../utils/errors.js';

const integrationsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Proxy para PlugSign API
   * ALL /api/integrations/plugsign/*
   */
  app.all('/plugsign/*', {
    preHandler: [authMiddleware, rbac()],
  }, async (request, reply) => {
    if (!env.PLUGSIGN_API_URL || !env.PLUGSIGN_API_KEY) {
      throw new ServiceUnavailableError('PlugSign API não configurada');
    }

    const path = (request.params as { '*': string })['*'];
    const url = `${env.PLUGSIGN_API_URL}/${path}`;

    try {
      const response = await axios({
        method: request.method as string,
        url,
        headers: {
          'Authorization': `Bearer ${env.PLUGSIGN_API_KEY}`,
          'Content-Type': 'application/json',
        },
        data: request.body,
        params: request.query,
        timeout: 30000,
      });

      await auditService.logFromRequest(
        request,
        AuditActions.PLUGSIGN_API_CALL,
        'integration',
        undefined,
        undefined,
        { method: request.method, path }
      );

      return reply.status(response.status).send(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error({ error: axiosError.message, path }, 'PlugSign API error');

      if (axiosError.response) {
        return reply.status(axiosError.response.status).send(axiosError.response.data);
      }

      throw new ServiceUnavailableError('Erro na comunicação com PlugSign API');
    }
  });

  /**
   * Proxy para BeSign API
   * ALL /api/integrations/besign/*
   */
  app.all('/besign/*', {
    preHandler: [authMiddleware, rbac()],
  }, async (request, reply) => {
    if (!env.BESIGN_API_URL || !env.BESIGN_API_KEY) {
      throw new ServiceUnavailableError('BeSign API não configurada');
    }

    const path = (request.params as { '*': string })['*'];
    const url = `${env.BESIGN_API_URL}/${path}`;

    try {
      const response = await axios({
        method: request.method as string,
        url,
        headers: {
          'Authorization': `Bearer ${env.BESIGN_API_KEY}`,
          'Content-Type': 'application/json',
        },
        data: request.body,
        params: request.query,
        timeout: 30000,
      });

      await auditService.logFromRequest(
        request,
        AuditActions.BESIGN_API_CALL,
        'integration',
        undefined,
        undefined,
        { method: request.method, path }
      );

      return reply.status(response.status).send(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error({ error: axiosError.message, path }, 'BeSign API error');

      if (axiosError.response) {
        return reply.status(axiosError.response.status).send(axiosError.response.data);
      }

      throw new ServiceUnavailableError('Erro na comunicação com BeSign API');
    }
  });

  /**
   * Download de documento assinado via PlugSign
   * GET /api/integrations/plugsign-download/:documentKey
   */
  app.get('/plugsign-download/:documentKey', {
    preHandler: [authMiddleware, rbac()],
  }, async (request, reply) => {
    if (!env.PLUGSIGN_API_URL || !env.PLUGSIGN_API_KEY) {
      throw new ServiceUnavailableError('PlugSign API não configurada');
    }

    const { documentKey } = request.params as { documentKey: string };

    try {
      // Obter URL de download do documento
      const response = await axios.get(
        `${env.PLUGSIGN_API_URL}/documents/${documentKey}/download`,
        {
          headers: {
            'Authorization': `Bearer ${env.PLUGSIGN_API_KEY}`,
          },
          responseType: 'arraybuffer',
          timeout: 60000,
        }
      );

      await auditService.logFromRequest(
        request,
        AuditActions.PLUGSIGN_API_CALL,
        'document',
        documentKey,
        undefined,
        { action: 'download' }
      );

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="documento-${documentKey}.pdf"`);

      return reply.send(Buffer.from(response.data));
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error({ error: axiosError.message, documentKey }, 'PlugSign download error');

      if (axiosError.response?.status === 404) {
        throw new BadRequestError('Documento não encontrado');
      }

      throw new ServiceUnavailableError('Erro ao baixar documento');
    }
  });

  /**
   * Verificar status do documento
   * GET /api/integrations/document-status/:documentKey
   */
  app.get('/document-status/:documentKey', {
    preHandler: [authMiddleware, rbac()],
  }, async (request, reply) => {
    const { documentKey } = request.params as { documentKey: string };

    // Tentar buscar em todas as tabelas de documentos
    const [contract, receipt, distrato] = await Promise.all([
      app.prisma.generatedContract.findFirst({
        where: {
          OR: [
            { signature_request_id: documentKey },
            { batch_id: documentKey },
          ],
        },
      }),
      app.prisma.depositReceipt.findFirst({
        where: { signature_request_id: documentKey },
      }),
      app.prisma.distrato.findFirst({
        where: { signature_request_id: documentKey },
      }),
    ]);

    const document = contract || receipt || distrato;

    if (!document) {
      throw new BadRequestError('Documento não encontrado');
    }

    return reply.status(200).send({
      success: true,
      data: {
        documentKey,
        status: document.status,
        type: contract ? 'contract' : receipt ? 'deposit_receipt' : 'distrato',
        signedAt: (document as any).signed_at || null,
      },
    });
  });
};

export default integrationsRoutes;
