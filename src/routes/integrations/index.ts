import { FastifyPluginAsync } from 'fastify';
import axios, { AxiosError } from 'axios';
import { authMiddleware } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { auditService, AuditActions } from '../../middleware/audit.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { BadRequestError, ServiceUnavailableError } from '../../utils/errors.js';

/**
 * Helper para buscar token PlugSign do banco de dados
 * O token SEMPRE vem da tabela cities:
 * - master_br: usa cityId passado no request
 * - regional: usa city_id do próprio usuário
 */
async function getPlugSignToken(
  prisma: any,
  userId: string,
  userRole: string,
  cityId?: string
): Promise<string | null> {
  try {
    // 1. Se cityId foi passado (master_br selecionando cidade), usar direto
    if (cityId) {
      const city = await prisma.city.findUnique({
        where: { id: cityId },
        select: { plugsign_token: true, name: true }
      });

      if (city?.plugsign_token && city.plugsign_token.length >= 50) {
        logger.info({ cidade: city.name }, 'PlugSign: usando token da cidade (cityId passado)');
        return city.plugsign_token;
      }
    }

    // 2. Buscar city_id do usuário logado
    const user = await prisma.appUser.findUnique({
      where: { id: userId },
      select: { city_id: true, email: true }
    });

    if (user?.city_id) {
      const city = await prisma.city.findUnique({
        where: { id: user.city_id },
        select: { plugsign_token: true, name: true }
      });

      if (city?.plugsign_token && city.plugsign_token.length >= 50) {
        logger.info({ cidade: city.name, email: user.email }, 'PlugSign: usando token da cidade do usuário');
        return city.plugsign_token;
      }
    }

    logger.warn({ userId, userRole, cityId }, 'PlugSign: nenhum token encontrado na cidade');
    return null;
  } catch (error) {
    logger.error({ error }, 'Erro ao buscar token PlugSign do banco');
    return null;
  }
}

const integrationsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Proxy para PlugSign API
   * ALL /api/integrations/plugsign/*
   *
   * Lógica de token:
   * - Regional: usa token da tabela app_users
   * - Master BR: usa token da tabela cities (baseado no cityId no body)
   * - Fallback: usa token do .env
   */
  app.all('/plugsign/*', {
    preHandler: [authMiddleware, rbac()],
  }, async (request, reply) => {
    if (!env.PLUGSIGN_API_URL) {
      throw new ServiceUnavailableError('PlugSign API URL não configurada');
    }

    const path = (request.params as { '*': string })['*'];
    const url = `${env.PLUGSIGN_API_URL}/${path}`;

    // Buscar token do banco baseado no role do usuário
    const user = request.user;
    const body = request.body as any;
    const cityId = body?.cityId || (request.query as any)?.cityId;

    logger.info({
      userId: user.userId,
      userRole: user.role,
      cityIdFromBody: body?.cityId,
      cityIdFromQuery: (request.query as any)?.cityId,
      cityIdFinal: cityId,
      bodyKeys: body ? Object.keys(body) : []
    }, 'PlugSign: buscando token');

    let apiToken = await getPlugSignToken(app.prisma, user.userId, user.role, cityId);

    // Fallback para token do .env
    if (!apiToken) {
      if (env.PLUGSIGN_API_KEY && env.PLUGSIGN_API_KEY.length >= 50) {
        logger.info('PlugSign: usando token do .env (fallback)');
        apiToken = env.PLUGSIGN_API_KEY;
      } else {
        throw new ServiceUnavailableError('Token PlugSign não encontrado (banco ou .env)');
      }
    }

    try {
      // Remover campos internos do body antes de enviar para PlugSign
      // cityId é usado apenas para buscar o token correto, não deve ser enviado para API externa
      let bodyToSend = request.body;
      if (bodyToSend && typeof bodyToSend === 'object') {
        const { cityId, ...cleanBody } = bodyToSend as Record<string, any>;
        bodyToSend = cleanBody;
      }

      logger.info({
        method: request.method,
        url,
        bodyKeys: bodyToSend ? Object.keys(bodyToSend) : [],
        hasFiles: Array.isArray((bodyToSend as any)?.file),
        fileCount: Array.isArray((bodyToSend as any)?.file) ? (bodyToSend as any).file.length : 0
      }, 'PlugSign: enviando requisição');

      const response = await axios({
        method: request.method as string,
        url,
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        data: bodyToSend,
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

      // Envolver resposta no formato esperado pelo frontend
      return reply.status(response.status).send({
        success: true,
        data: response.data
      });
    } catch (error) {
      const axiosError = error as AxiosError;
      logger.error({
        error: axiosError.message,
        path,
        status: axiosError.response?.status,
        responseData: axiosError.response?.data,
        requestUrl: url,
        requestMethod: request.method
      }, 'PlugSign API error');

      if (axiosError.response) {
        return reply.status(axiosError.response.status).send({
          success: false,
          error: (axiosError.response.data as any)?.message || (axiosError.response.data as any)?.error || `Erro ${axiosError.response.status} na API PlugSign`,
          data: axiosError.response.data
        });
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
   *
   * NOTA: Devido a problemas de encoding/fontes onde '1' (número) e 'l' (letra L)
   * podem ser confundidos, esta rota tenta múltiplas variações do document_key
   */
  app.get('/plugsign-download/:documentKey', {
    preHandler: [authMiddleware, rbac()],
  }, async (request, reply) => {
    const { documentKey } = request.params as { documentKey: string };

    // Buscar token do banco baseado no role do usuário
    const user = request.user;
    const cityId = (request.query as any)?.cityId;

    let apiToken = await getPlugSignToken(app.prisma, user.userId, user.role, cityId);

    // Fallback para token do .env
    if (!apiToken) {
      if (env.PLUGSIGN_API_KEY && env.PLUGSIGN_API_KEY.length >= 50) {
        logger.info('PlugSign Download: usando token do .env (fallback)');
        apiToken = env.PLUGSIGN_API_KEY;
      } else {
        throw new ServiceUnavailableError('Token PlugSign não encontrado (banco ou .env)');
      }
    }

    /**
     * Gera variações do document_key trocando caracteres confusos:
     * - '1' (número um) <-> 'l' (letra L minúscula)
     * - 'I' (letra I maiúscula) <-> 'l' (letra L minúscula)
     * - 'O' (letra O) <-> '0' (número zero)
     */
    const generateKeyVariations = (key: string): string[] => {
      const variations: Set<string> = new Set([key]);

      // Trocar todos os '1' por 'l' e vice-versa
      variations.add(key.replace(/1/g, 'l'));
      variations.add(key.replace(/l/g, '1'));

      // Trocar todos os 'I' por 'l' e vice-versa
      variations.add(key.replace(/I/g, 'l'));
      variations.add(key.replace(/l/g, 'I'));

      // Trocar todos os 'O' por '0' e vice-versa
      variations.add(key.replace(/O/g, '0'));
      variations.add(key.replace(/0/g, 'O'));

      return Array.from(variations);
    };

    const keyVariations = generateKeyVariations(documentKey);
    logger.info({ documentKey, variationsCount: keyVariations.length, variations: keyVariations }, 'PlugSign: tentando variações do document_key');

    let lastError: any = null;

    for (const keyToTry of keyVariations) {
      try {
        const downloadUrl = `https://app.plugsign.com.br/api/files/download/${keyToTry}`;

        logger.info({ keyToTry, downloadUrl }, 'PlugSign: tentando download');

        const response = await axios.get(downloadUrl, {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/pdf'
          },
          responseType: 'arraybuffer',
          timeout: 60000,
        });

        // Se chegou aqui, deu certo!
        logger.info({ originalKey: documentKey, usedKey: keyToTry }, 'PlugSign: download bem-sucedido');

        await auditService.logFromRequest(
          request,
          AuditActions.PLUGSIGN_API_CALL,
          'document',
          keyToTry,
          undefined,
          { action: 'download', originalKey: documentKey, usedKey: keyToTry }
        );

        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="documento-${keyToTry}.pdf"`);

        return reply.send(Buffer.from(response.data));

      } catch (error) {
        const axiosError = error as AxiosError;
        lastError = axiosError;

        // Se for 404, tentar próxima variação
        if (axiosError.response?.status === 404 || axiosError.response?.status === 400) {
          logger.info({ keyToTry, status: axiosError.response?.status }, 'PlugSign: documento não encontrado com esta chave, tentando próxima');
          continue;
        }

        // Outros erros, logar e parar
        logger.error({ error: axiosError.message, keyToTry }, 'PlugSign download error');
        throw new ServiceUnavailableError('Erro ao baixar documento');
      }
    }

    // Se chegou aqui, nenhuma variação funcionou
    logger.error({ documentKey, triedVariations: keyVariations }, 'PlugSign: documento não encontrado em nenhuma variação');
    throw new BadRequestError('Documento não encontrado');
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
