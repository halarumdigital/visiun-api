import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { webhookRateLimit } from '../middleware/rateLimit.js';
import { auditService, AuditActions } from '../middleware/audit.js';
import { logger } from '../utils/logger.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';
import { realtimeService } from '../websocket/index.js';

// Swagger Schemas
const webhookResponseSchema = {
  type: 'object',
  properties: {
    received: { type: 'boolean' },
  },
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: { type: 'string' },
    code: { type: 'string' },
  },
};

const webhooksRoutes: FastifyPluginAsync = async (app) => {
  // Configurar raw body para validação de HMAC
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      const json = JSON.parse(body.toString());
      (req as any).rawBody = body;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  /**
   * POST /api/webhooks/signature
   * Webhook para assinaturas digitais (BeSign/PlugSign)
   */
  app.post('/signature', {
    preHandler: [webhookRateLimit],
    schema: {
      description: 'Webhook para receber eventos de assinatura digital (BeSign/PlugSign)',
      tags: ['Webhooks'],
      headers: {
        type: 'object',
        properties: {
          'x-webhook-signature': { type: 'string', description: 'HMAC signature para validação' },
        },
      },
      body: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Tipo do evento (document.signed, document.refused, document.expired, document.viewed)' },
          data: {
            type: 'object',
            properties: {
              document_key: { type: 'string', description: 'ID do documento' },
              batch_id: { type: 'string', description: 'ID do lote' },
              signed_at: { type: 'string', format: 'date-time', description: 'Data da assinatura' },
              reason: { type: 'string', description: 'Motivo (para recusa)' },
            },
          },
        },
      },
      response: {
        200: webhookResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const payload = request.body as any;

    // Validar HMAC se configurado
    if (env.WEBHOOK_SECRET) {
      const signature = request.headers['x-webhook-signature'] as string;
      const rawBody = (request as any).rawBody;

      if (rawBody && signature) {
        const expectedSignature = crypto
          .createHmac('sha256', env.WEBHOOK_SECRET)
          .update(rawBody)
          .digest('hex');

        if (signature !== expectedSignature) {
          logger.warn('Invalid webhook signature');
          throw new UnauthorizedError('Assinatura inválida');
        }
      }
    }

    logger.info({ event: payload.event, data: payload.data }, 'Signature webhook received');

    await auditService.log({
      action: AuditActions.SIGNATURE_WEBHOOK,
      entityType: 'webhook',
      newData: payload,
      ipAddress: request.ip,
    });

    // Processar evento baseado no tipo
    try {
      switch (payload.event) {
        case 'document.signed':
        case 'signed':
          await handleDocumentSigned(payload);
          break;

        case 'document.refused':
        case 'refused':
          await handleDocumentRefused(payload);
          break;

        case 'document.expired':
        case 'expired':
          await handleDocumentExpired(payload);
          break;

        case 'document.viewed':
        case 'viewed':
          // Apenas log, sem ação
          logger.info({ documentKey: payload.data?.document_key }, 'Document viewed');
          break;

        default:
          logger.warn({ event: payload.event }, 'Unknown webhook event');
      }
    } catch (error) {
      logger.error({ error, payload }, 'Error processing webhook');
      // Não retornar erro para o provider, apenas logar
    }

    return reply.status(200).send({ received: true });
  });

  /**
   * POST /api/webhooks/evolution
   * Webhook para Evolution API (WhatsApp)
   */
  app.post('/evolution', {
    preHandler: [webhookRateLimit],
    schema: {
      description: 'Webhook para receber eventos da Evolution API (WhatsApp)',
      tags: ['Webhooks'],
      body: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Tipo do evento (messages.upsert, connection.update, qr.updated)' },
          instance: { type: 'string', description: 'Nome da instância' },
          data: {
            type: 'object',
            properties: {
              message: { type: 'object', description: 'Dados da mensagem' },
              state: { type: 'string', description: 'Estado da conexão' },
              qr: { type: 'string', description: 'QR Code' },
            },
          },
        },
      },
      response: {
        200: webhookResponseSchema,
      },
    },
  }, async (request, reply) => {
    const payload = request.body as any;

    logger.info({ event: payload.event }, 'Evolution webhook received');

    await auditService.log({
      action: AuditActions.EVOLUTION_WEBHOOK,
      entityType: 'webhook',
      newData: payload,
      ipAddress: request.ip,
    });

    // Processar eventos do Evolution
    try {
      switch (payload.event) {
        case 'messages.upsert':
          // Nova mensagem recebida
          await handleEvolutionMessage(payload);
          break;

        case 'connection.update':
          // Atualização de conexão
          await handleEvolutionConnectionUpdate(payload);
          break;

        case 'qr.updated':
          // QR Code atualizado
          await handleEvolutionQRUpdate(payload);
          break;

        default:
          logger.debug({ event: payload.event }, 'Unhandled evolution event');
      }
    } catch (error) {
      logger.error({ error, payload }, 'Error processing evolution webhook');
    }

    return reply.status(200).send({ received: true });
  });

  /**
   * POST /api/webhooks/asaas
   * Webhook para eventos de pagamento do Asaas
   */
  app.post('/asaas', {
    preHandler: [webhookRateLimit],
    schema: {
      description: 'Webhook para receber eventos de pagamento do Asaas',
      tags: ['Webhooks'],
      body: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          event: { type: 'string' },
          payment: { type: 'object' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const payload = request.body as any;

    logger.info({ event: payload.event, paymentId: payload.payment?.id }, 'Asaas webhook received');

    const event = payload.event;
    const payment = payload.payment;

    if (!event || !payment) {
      logger.warn('Asaas webhook: invalid payload - missing event or payment');
      return reply.status(400).send({ success: false, message: 'Invalid payload' });
    }

    try {
      // Verificar se este webhook já foi processado (evitar duplicatas)
      if (payload.id) {
        const existingEvent = await prisma.asaasPaymentEvent.findFirst({
          where: { webhook_id: payload.id },
        });
        if (existingEvent) {
          logger.info({ webhookId: payload.id }, 'Asaas webhook already processed, skipping');
          return reply.status(200).send({ success: true, message: 'Event already processed' });
        }
      }

      // Buscar pagamento no banco pelo asaas_payment_id
      const asaasPayment = await prisma.asaasPayment.findFirst({
        where: { asaas_payment_id: payment.id },
      });

      if (!asaasPayment) {
        logger.warn({ paymentId: payment.id }, 'Asaas webhook: payment not found');
        // Logar evento mesmo assim
        await prisma.asaasPaymentEvent.create({
          data: {
            event_type: event,
            event_data: payload,
            asaas_payment_external_id: payment.id,
            webhook_id: payload.id || null,
            processed: false,
            error_message: 'Pagamento não encontrado no banco',
          },
        });
        return reply.status(200).send({ success: true, message: 'Payment not found, event logged' });
      }

      // Mapear status do Asaas para status interno
      const statusMap: Record<string, string> = {
        'PAYMENT_CREATED': 'PENDING',
        'PAYMENT_AWAITING_RISK_ANALYSIS': 'PENDING',
        'PAYMENT_APPROVED_BY_RISK_ANALYSIS': 'PENDING',
        'PAYMENT_PENDING': 'PENDING',
        'PAYMENT_CONFIRMED': 'CONFIRMED',
        'PAYMENT_RECEIVED': 'RECEIVED',
        'PAYMENT_OVERDUE': 'OVERDUE',
        'PAYMENT_REFUNDED': 'REFUNDED',
        'PAYMENT_DELETED': 'CANCELLED',
        'PAYMENT_RESTORED': 'PENDING',
        'PAYMENT_REFUND_IN_PROGRESS': 'REFUNDED',
        'PAYMENT_CHARGEBACK_REQUESTED': 'CANCELLED',
        'PAYMENT_CHARGEBACK_DISPUTE': 'CANCELLED',
        'PAYMENT_AWAITING_CHARGEBACK_REVERSAL': 'CANCELLED',
        'PAYMENT_DUNNING_RECEIVED': 'RECEIVED',
        'PAYMENT_DUNNING_REQUESTED': 'OVERDUE',
      };

      const newStatus = statusMap[event] || asaasPayment.status;

      // Preparar dados de atualização
      const updateData: any = { status: newStatus };

      // Se foi pago, registrar data e valor
      if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_DUNNING_RECEIVED') {
        updateData.paid_at = new Date();
        updateData.paid_value = payment.value;
      }

      // Atualizar pagamento no banco
      await prisma.asaasPayment.update({
        where: { id: asaasPayment.id },
        data: updateData,
      });

      logger.info({ paymentId: asaasPayment.id, newStatus }, 'Asaas payment updated');

      // Emitir evento realtime para atualizar frontend automaticamente
      if (realtimeService && asaasPayment.franchisee_id) {
        realtimeService.emitFinanceiroChange(asaasPayment.franchisee_id, {
          type: 'UPDATE',
          table: 'asaas_payments',
          data: { ...asaasPayment, status: newStatus },
          timestamp: new Date().toISOString(),
        });
      }

      // Se foi pago, atualizar financeiro (se existir vínculo)
      if ((event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_DUNNING_RECEIVED') && asaasPayment.financeiro_id) {
        await prisma.financeiro.update({
          where: { id: asaasPayment.financeiro_id },
          data: { pago: true },
        });
        logger.info({ financeiroId: asaasPayment.financeiro_id }, 'Financeiro marked as paid');
      }

      // Logar evento
      await prisma.asaasPaymentEvent.create({
        data: {
          asaas_payment_id: asaasPayment.id,
          event_type: event,
          event_data: payload,
          asaas_payment_external_id: payment.id,
          webhook_id: payload.id || null,
          processed: true,
        },
      });

      logger.info({ event, paymentId: payment.id }, 'Asaas webhook processed successfully');

      return reply.status(200).send({ success: true, message: 'Event processed' });
    } catch (error: any) {
      logger.error({ error: error.message, event, paymentId: payment.id }, 'Asaas webhook processing error');
      return reply.status(500).send({ success: false, message: error.message });
    }
  });

  /**
   * POST /api/webhooks/csp-report
   * Endpoint para CSP violation reports
   */
  app.post('/csp-report', {
    schema: {
      description: 'Endpoint para receber relatórios de violação CSP (Content Security Policy)',
      tags: ['Webhooks'],
      body: {
        type: 'object',
        properties: {
          'csp-report': {
            type: 'object',
            description: 'Detalhes da violação CSP',
          },
        },
      },
      response: {
        204: {
          type: 'null',
          description: 'Relatório recebido com sucesso',
        },
      },
    },
  }, async (request, reply) => {
    const report = request.body as any;

    logger.warn({ report }, 'CSP violation report received');

    // Apenas logar violações CSP
    return reply.status(204).send();
  });
};

/**
 * Handler para documento assinado
 */
async function handleDocumentSigned(payload: any): Promise<void> {
  const documentKey = payload.data?.document_key ||
                      payload.document_key ||
                      payload.data?.batch_id;

  if (!documentKey) {
    logger.warn('Document signed webhook without document_key');
    return;
  }

  const signedAt = payload.data?.signed_at ? new Date(payload.data.signed_at) : new Date();

  // Tentar atualizar em generated_contracts
  const contract = await prisma.generatedContract.updateMany({
    where: {
      OR: [
        { signature_request_id: documentKey },
        { batch_id: documentKey },
      ],
    },
    data: {
      status: 'signed',
      signed_at: signedAt,
    },
  });

  if (contract.count > 0) {
    logger.info({ documentKey, count: contract.count }, 'Contract(s) marked as signed');

    // Emitir evento realtime
    if (realtimeService) {
      const updatedContract = await prisma.generatedContract.findFirst({
        where: {
          OR: [
            { signature_request_id: documentKey },
            { batch_id: documentKey },
          ],
        },
        include: { rental: { include: { franchisee: true } } },
      });

      if (updatedContract?.rental?.franchisee_id) {
        realtimeService.emitContractChange(updatedContract.rental.franchisee_id, {
          type: 'UPDATE',
          table: 'generated_contracts',
          data: updatedContract,
          timestamp: new Date().toISOString(),
        });
      }
    }
    return;
  }

  // Tentar atualizar em deposit_receipts
  const receipt = await prisma.depositReceipt.updateMany({
    where: { signature_request_id: documentKey },
    data: { status: 'signed' },
  });

  if (receipt.count > 0) {
    logger.info({ documentKey, count: receipt.count }, 'Deposit receipt(s) marked as signed');
    return;
  }

  // Tentar atualizar em distratos
  const distrato = await prisma.distrato.updateMany({
    where: { signature_request_id: documentKey },
    data: {
      status: 'signed',
      signed_at: signedAt,
    },
  });

  if (distrato.count > 0) {
    logger.info({ documentKey, count: distrato.count }, 'Distrato(s) marked as signed');
  }
}

/**
 * Handler para documento recusado
 */
async function handleDocumentRefused(payload: any): Promise<void> {
  const documentKey = payload.data?.document_key || payload.document_key;
  const reason = payload.data?.reason || 'Não informado';

  if (!documentKey) {
    logger.warn('Document refused webhook without document_key');
    return;
  }

  // Atualizar status para cancelled
  await prisma.generatedContract.updateMany({
    where: {
      OR: [
        { signature_request_id: documentKey },
        { batch_id: documentKey },
      ],
    },
    data: { status: 'cancelled' },
  });

  await prisma.depositReceipt.updateMany({
    where: { signature_request_id: documentKey },
    data: { status: 'cancelled' },
  });

  await prisma.distrato.updateMany({
    where: { signature_request_id: documentKey },
    data: { status: 'cancelled' },
  });

  logger.info({ documentKey, reason }, 'Document marked as refused/cancelled');
}

/**
 * Handler para documento expirado
 */
async function handleDocumentExpired(payload: any): Promise<void> {
  const documentKey = payload.data?.document_key || payload.document_key;

  if (!documentKey) {
    logger.warn('Document expired webhook without document_key');
    return;
  }

  // Não alterar status, apenas logar
  // Documentos expirados podem ser re-enviados
  logger.info({ documentKey }, 'Document expired');
}

/**
 * Handler para mensagens do Evolution
 */
async function handleEvolutionMessage(payload: any): Promise<void> {
  const message = payload.data?.message;
  const instance = payload.instance;

  if (!message) return;

  logger.info({
    instance,
    from: message.from,
    type: message.type,
  }, 'WhatsApp message received');

  // Aqui você pode implementar lógica de processamento de mensagens
  // Por exemplo, salvar em uma tabela de mensagens, disparar automações, etc.
}

/**
 * Handler para atualização de conexão do Evolution
 */
async function handleEvolutionConnectionUpdate(payload: any): Promise<void> {
  const instance = payload.instance;
  const state = payload.data?.state;

  if (!instance) return;

  // Atualizar status da instância no banco
  await prisma.evolutionInstance.updateMany({
    where: { instance_name: instance },
    data: { status: state || 'unknown' },
  });

  logger.info({ instance, state }, 'Evolution connection updated');
}

/**
 * Handler para atualização de QR Code do Evolution
 */
async function handleEvolutionQRUpdate(payload: any): Promise<void> {
  const instance = payload.instance;
  const qrCode = payload.data?.qr;

  if (!instance || !qrCode) return;

  // Atualizar QR code da instância no banco
  await prisma.evolutionInstance.updateMany({
    where: { instance_name: instance },
    data: { qr_code: qrCode },
  });

  // Emitir evento realtime para admin ver o QR
  if (realtimeService) {
    realtimeService.emitAdminNotification({
      type: 'info',
      title: 'WhatsApp',
      message: `QR Code atualizado para instância ${instance}`,
      data: { instance, qrCode },
    });
  }

  logger.info({ instance }, 'Evolution QR code updated');
}

export default webhooksRoutes;
