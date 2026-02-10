import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const asaasPaymentsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/asaas-payments/boletos
   * Retorna pagamentos agrupados por locação com dados de rental, motorcycle e franchisee
   * Usado pela página /boletos
   */
  app.get('/boletos', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar boletos com dados de locação, moto e franqueado',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const ctx = getContext(request);
    const { franchisee_id, city_id } = request.query as { franchisee_id?: string; city_id?: string };

    // Construir filtro de pagamentos baseado no role
    const paymentWhere: any = {};

    if (ctx.isFranchisee() && ctx.franchiseeId) {
      // Franqueado vê apenas seus próprios pagamentos
      paymentWhere.franchisee_id = ctx.franchiseeId;
    } else if (franchisee_id && franchisee_id !== 'all') {
      // Filtro explícito por franqueado
      paymentWhere.franchisee_id = franchisee_id;
    } else {
      // Para regional ou master_br com cidade, filtrar por franqueados da cidade
      const effectiveCityId = ctx.isRegional() ? ctx.cityId : city_id;
      if (effectiveCityId) {
        const cityFranchisees = await prisma.franchisee.findMany({
          where: { city_id: effectiveCityId },
          select: { id: true },
        });
        const ids = cityFranchisees.map(f => f.id);
        if (ids.length === 0) {
          return reply.status(200).send({ success: true, data: [] });
        }
        paymentWhere.franchisee_id = { in: ids };
      }
    }

    // Buscar pagamentos
    const payments = await prisma.asaasPayment.findMany({
      where: paymentWhere,
      orderBy: { installment_number: 'asc' },
    });

    if (payments.length === 0) {
      return reply.status(200).send({ success: true, data: [] });
    }

    // Agrupar pagamentos por rental_id
    const paymentsByRental: Record<string, typeof payments> = {};
    for (const p of payments) {
      if (!paymentsByRental[p.rental_id]) paymentsByRental[p.rental_id] = [];
      paymentsByRental[p.rental_id].push(p);
    }

    // Buscar rentals
    const rentalIds = Object.keys(paymentsByRental);
    const rentals = await prisma.rental.findMany({
      where: { id: { in: rentalIds } },
      select: {
        id: true,
        start_date: true,
        end_date: true,
        daily_rate: true,
        client_name: true,
        client_cpf: true,
        franchisee_id: true,
        motorcycle_id: true,
      },
    });

    // Buscar motorcycles
    const motorcycleIds = [...new Set(rentals.map(r => r.motorcycle_id).filter(Boolean))];
    const motorcycles = motorcycleIds.length > 0
      ? await prisma.motorcycle.findMany({
          where: { id: { in: motorcycleIds } },
          select: { id: true, placa: true, modelo: true },
        })
      : [];
    const motorcycleMap = new Map(motorcycles.map(m => [m.id, m]));

    // Buscar franchisees
    const franchiseeIds = [...new Set(rentals.map(r => r.franchisee_id).filter(Boolean) as string[])];
    const franchisees = franchiseeIds.length > 0
      ? await prisma.franchisee.findMany({
          where: { id: { in: franchiseeIds } },
          select: { id: true, fantasy_name: true, company_name: true },
        })
      : [];
    const franchiseeMap = new Map(franchisees.map(f => [f.id, f.fantasy_name || f.company_name || 'N/A']));

    // Combinar dados
    const result = rentals.map(rental => {
      const rentalPayments = paymentsByRental[rental.id] || [];
      const motorcycle = rental.motorcycle_id ? motorcycleMap.get(rental.motorcycle_id) : null;
      const paidCount = rentalPayments.filter(p => p.status === 'RECEIVED').length;
      const pendingCount = rentalPayments.filter(p => ['PENDING', 'CONFIRMED'].includes(p.status)).length;
      const overdueCount = rentalPayments.filter(p => p.status === 'OVERDUE').length;

      return {
        id: rental.id,
        start_date: rental.start_date,
        end_date: rental.end_date,
        daily_rate: rental.daily_rate || 0,
        client_name: rental.client_name,
        client_cpf: rental.client_cpf,
        motorcycle_plate: motorcycle?.placa || 'N/A',
        motorcycle_model: motorcycle?.modelo || 'N/A',
        franchisee_id: rental.franchisee_id,
        franchisee_name: rental.franchisee_id ? franchiseeMap.get(rental.franchisee_id) || 'N/A' : 'N/A',
        total_payments: rentalPayments.length,
        paid_payments: paidCount,
        pending_payments: pendingCount,
        overdue_payments: overdueCount,
        payments: rentalPayments.map(p => ({
          id: p.id,
          asaas_payment_id: p.asaas_payment_id,
          installment_number: p.installment_number,
          due_date: p.due_date,
          valor: p.valor,
          valor_royalties: p.valor_royalties,
          status: p.status,
          boleto_url: p.boleto_url,
          boleto_barcode: p.boleto_barcode,
          pix_qrcode: p.pix_qrcode,
          pix_copia_cola: p.pix_copia_cola,
          paid_at: p.paid_at,
          paid_value: p.paid_value,
        })),
      };
    });

    // Ordenar por data de início (mais recentes primeiro)
    result.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

    return reply.status(200).send({ success: true, data: result });
  });

  /**
   * POST /api/asaas-payments
   * Criar um pagamento Asaas
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar pagamento Asaas',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const body = request.body as any;

    const payment = await prisma.asaasPayment.create({
      data: {
        rental_id: body.rental_id,
        franchisee_id: body.franchisee_id,
        financeiro_id: body.financeiro_id || null,
        asaas_payment_id: body.asaas_payment_id,
        asaas_customer_id: body.asaas_customer_id || null,
        installment_number: body.installment_number,
        due_date: new Date(body.due_date),
        valor: body.valor,
        valor_royalties: body.valor_royalties,
        status: body.status || 'PENDING',
        boleto_url: body.boleto_url || null,
        boleto_barcode: body.boleto_barcode || null,
        pix_qrcode: body.pix_qrcode || null,
        pix_copia_cola: body.pix_copia_cola || null,
      },
    });

    return reply.status(201).send({
      success: true,
      data: payment,
    });
  });

  /**
   * GET /api/asaas-payments/rental/:rentalId
   * Buscar pagamentos de uma locação
   */
  app.get('/rental/:rentalId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar pagamentos de uma locação',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };

    const payments = await prisma.asaasPayment.findMany({
      where: { rental_id: rentalId },
      orderBy: { installment_number: 'asc' },
    });

    return reply.status(200).send({
      success: true,
      data: payments,
    });
  });

  /**
   * GET /api/asaas-payments/pending
   * Buscar pagamentos pendentes com vencimento até uma data
   */
  app.get('/pending', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar pagamentos pendentes para sincronização',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { due_date_until } = request.query as { due_date_until?: string };

    const where: any = {
      status: { in: ['PENDING', 'OVERDUE', 'CONFIRMED'] },
      asaas_payment_id: { not: null },
    };

    if (due_date_until) {
      where.due_date = { lte: new Date(due_date_until) };
    }

    const payments = await prisma.asaasPayment.findMany({
      where,
      select: {
        id: true,
        asaas_payment_id: true,
        franchisee_id: true,
        status: true,
        due_date: true,
      },
    });

    return reply.status(200).send({
      success: true,
      data: payments,
    });
  });

  /**
   * PATCH /api/asaas-payments/:id
   * Atualizar um pagamento por ID interno
   */
  app.patch('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar pagamento Asaas',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updateData: any = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.paid_at !== undefined) updateData.paid_at = body.paid_at ? new Date(body.paid_at) : null;
    if (body.paid_value !== undefined) updateData.paid_value = body.paid_value;
    if (body.error_message !== undefined) updateData.error_message = body.error_message;
    if (body.boleto_url !== undefined) updateData.boleto_url = body.boleto_url;

    const payment = await prisma.asaasPayment.update({
      where: { id },
      data: updateData,
    });

    return reply.status(200).send({
      success: true,
      data: payment,
    });
  });

  /**
   * PATCH /api/asaas-payments/by-asaas-id/:asaasPaymentId
   * Atualizar por asaas_payment_id (usado pelo webhook)
   */
  app.patch('/by-asaas-id/:asaasPaymentId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar pagamento por asaas_payment_id',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { asaasPaymentId } = request.params as { asaasPaymentId: string };
    const body = request.body as any;

    const updateData: any = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.paid_at !== undefined) updateData.paid_at = body.paid_at ? new Date(body.paid_at) : null;
    if (body.paid_value !== undefined) updateData.paid_value = body.paid_value;

    // Encontrar e atualizar pelo asaas_payment_id
    const existing = await prisma.asaasPayment.findFirst({
      where: { asaas_payment_id: asaasPaymentId },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: 'Pagamento não encontrado',
      });
    }

    const payment = await prisma.asaasPayment.update({
      where: { id: existing.id },
      data: updateData,
    });

    return reply.status(200).send({
      success: true,
      data: payment,
    });
  });

  /**
   * DELETE /api/asaas-payments/rental/:rentalId
   * Excluir todos os pagamentos de uma locação
   */
  app.delete('/rental/:rentalId', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir pagamentos de uma locação',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { rentalId } = request.params as { rentalId: string };

    // Excluir eventos relacionados primeiro
    const payments = await prisma.asaasPayment.findMany({
      where: { rental_id: rentalId },
      select: { id: true },
    });
    const paymentIds = payments.map(p => p.id);

    if (paymentIds.length > 0) {
      await prisma.asaasPaymentEvent.deleteMany({
        where: { asaas_payment_id: { in: paymentIds } },
      });
    }

    const result = await prisma.asaasPayment.deleteMany({
      where: { rental_id: rentalId },
    });

    return reply.status(200).send({
      success: true,
      data: { deleted: result.count },
    });
  });

  /**
   * DELETE /api/asaas-payments/batch
   * Excluir pagamentos por lista de IDs
   */
  app.delete('/batch', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Excluir pagamentos por lista de IDs',
      tags: ['Asaas Payments'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };

    if (!ids || ids.length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Lista de IDs é obrigatória',
      });
    }

    // Excluir eventos relacionados primeiro
    await prisma.asaasPaymentEvent.deleteMany({
      where: { asaas_payment_id: { in: ids } },
    });

    const result = await prisma.asaasPayment.deleteMany({
      where: { id: { in: ids } },
    });

    return reply.status(200).send({
      success: true,
      data: { deleted: result.count },
    });
  });
};

export default asaasPaymentsRoutes;
