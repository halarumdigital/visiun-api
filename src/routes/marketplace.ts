import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';

// ============================================================
// Helper: chamadas à API do Asaas
// ============================================================

async function asaasFetch<T>(endpoint: string, method = 'GET', body?: unknown): Promise<T> {
  if (!env.ASAAS_API_URL || !env.ASAAS_API_KEY) {
    throw new Error('Configuração do Asaas não encontrada (ASAAS_API_URL / ASAAS_API_KEY)');
  }

  const url = `${env.ASAAS_API_URL}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: env.ASAAS_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg =
      (data as any)?.errors?.map((e: any) => e.description).join(', ') ||
      'Erro desconhecido na API do Asaas';
    throw new Error(errMsg);
  }

  return data as T;
}

// ============================================================
// Routes
// ============================================================

const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  // ──────────────────────────────────────────────────
  // ROTAS ADMIN (autenticadas)
  // ──────────────────────────────────────────────────

  /**
   * GET /api/marketplace/services
   * Listar todos os serviços do marketplace
   */
  app.get('/services', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Listar serviços do marketplace',
      tags: ['Marketplace'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    const services = await prisma.marketplaceService.findMany({
      orderBy: { created_at: 'asc' },
    });

    return reply.status(200).send({ success: true, data: services });
  });

  /**
   * PUT /api/marketplace/services/:id
   * Atualizar preço de um serviço
   */
  app.put<{ Params: { id: string } }>('/services/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar preço de um serviço do marketplace',
      tags: ['Marketplace'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['unit_price'],
        properties: { unit_price: { type: 'number' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { unit_price } = request.body as { unit_price: number };

    const updated = await prisma.marketplaceService.update({
      where: { id },
      data: { unit_price, updated_at: new Date() },
    });

    return reply.status(200).send({ success: true, data: updated });
  });

  /**
   * DELETE /api/marketplace/services/:id
   * Excluir serviço (se não houver assinaturas vinculadas)
   */
  app.delete<{ Params: { id: string } }>('/services/:id', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Excluir serviço do marketplace',
      tags: ['Marketplace'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const subsCount = await prisma.franchiseeSubscription.count({
      where: { service_id: id },
    });

    if (subsCount > 0) {
      return reply.status(400).send({
        success: false,
        error: `Este serviço possui ${subsCount} assinatura(s) vinculada(s). Exclua as assinaturas primeiro.`,
      });
    }

    await prisma.marketplaceService.delete({ where: { id } });

    return reply.status(200).send({ success: true, message: 'Serviço excluído com sucesso.' });
  });

  /**
   * GET /api/marketplace/subscriptions
   * Listar assinaturas com dados do franqueado
   */
  app.get('/subscriptions', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Listar assinaturas do marketplace',
      tags: ['Marketplace'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    const subs = await prisma.franchiseeSubscription.findMany({
      include: {
        franchisee: {
          select: { fantasy_name: true, company_name: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return reply.status(200).send({ success: true, data: subs });
  });

  /**
   * POST /api/marketplace/subscriptions/:id/cancel
   * Cancelar assinatura: Asaas + DB (beemon_vehicles, beemon_infractions_cache, franchisee_subscriptions)
   */
  app.post<{ Params: { id: string } }>('/subscriptions/:id/cancel', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Cancelar assinatura do marketplace',
      tags: ['Marketplace'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const warnings: string[] = [];

    const subscription = await prisma.franchiseeSubscription.findUnique({ where: { id } });
    if (!subscription) {
      return reply.status(404).send({ success: false, error: 'Assinatura não encontrada.' });
    }

    // 1. Cancelar assinatura no Asaas
    if (subscription.asaas_subscription_id) {
      try {
        await asaasFetch(`/subscriptions/${subscription.asaas_subscription_id}`, 'DELETE');
      } catch (err: any) {
        warnings.push('Assinatura não foi cancelada no Asaas (cancele manualmente)');
      }
    }

    // 2. Desativar veículos locais
    await prisma.beemonVehicle.updateMany({
      where: { subscription_id: id },
      data: { active: false },
    });

    // 3. Deletar infrações em cache
    await prisma.beemonInfractionCache.deleteMany({
      where: { subscription_id: id },
    });

    // 4. Marcar assinatura como cancelada
    await prisma.franchiseeSubscription.update({
      where: { id },
      data: { status: 'cancelled', cancelled_at: new Date() },
    });

    return reply.status(200).send({
      success: true,
      message: 'Assinatura cancelada com sucesso.',
      warnings,
    });
  });

  /**
   * PATCH /api/marketplace/subscriptions/:id/fleet
   * Atualizar dados de frota Beemon da assinatura + desativar veículos locais
   */
  app.patch<{ Params: { id: string } }>('/subscriptions/:id/fleet', {
    preHandler: [authMiddleware, rbac({ allowedRoles: ['master_br', 'admin'] })],
    schema: {
      description: 'Atualizar dados de frota e desativar veículos locais',
      tags: ['Marketplace'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          beemon_fleet_id: { type: 'string' },
          beemon_fleet_identifier: { type: 'string' },
          deactivate_vehicles: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body as {
      beemon_fleet_id?: string;
      beemon_fleet_identifier?: string;
      deactivate_vehicles?: boolean;
    };

    // Atualizar dados da frota na assinatura
    const updateData: Record<string, unknown> = {};
    if (body.beemon_fleet_id) updateData.beemon_fleet_id = body.beemon_fleet_id;
    if (body.beemon_fleet_identifier) updateData.beemon_fleet_identifier = body.beemon_fleet_identifier;

    if (Object.keys(updateData).length > 0) {
      await prisma.franchiseeSubscription.update({
        where: { id },
        data: updateData,
      });
    }

    // Desativar veículos locais
    if (body.deactivate_vehicles) {
      await prisma.beemonVehicle.updateMany({
        where: { subscription_id: id },
        data: { active: false },
      });
    }

    return reply.status(200).send({ success: true, message: 'Frota atualizada.' });
  });

  // ──────────────────────────────────────────────────
  // ROTAS PÚBLICAS (marketplace aberto)
  // ──────────────────────────────────────────────────

  /**
   * GET /api/marketplace/public/services
   * Listar serviços ativos (sem autenticação)
   */
  app.get('/public/services', {
    schema: {
      description: 'Listar serviços ativos do marketplace (público)',
      tags: ['Marketplace'],
    },
  }, async (_request, reply) => {
    const services = await prisma.marketplaceService.findMany({
      where: { status: 'active' },
      orderBy: { created_at: 'asc' },
    });

    return reply.status(200).send({ success: true, data: services });
  });

  /**
   * POST /api/marketplace/public/search-franchisee
   * Buscar franqueado por CNPJ + contar motos + verificar assinatura existente
   */
  app.post('/public/search-franchisee', {
    schema: {
      description: 'Buscar franqueado por CNPJ (público)',
      tags: ['Marketplace'],
      body: {
        type: 'object',
        required: ['cnpj'],
        properties: {
          cnpj: { type: 'string' },
          service_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { cnpj, service_id } = request.body as { cnpj: string; service_id?: string };
    const cleanCnpj = cnpj.replace(/\D/g, '');

    if (cleanCnpj.length !== 14) {
      return reply.status(400).send({ success: false, error: 'CNPJ inválido. Digite os 14 dígitos.' });
    }

    // Buscar franqueados ativos com esse CNPJ
    const franchisees = await prisma.franchisee.findMany({
      where: {
        status: 'active',
      },
      include: {
        city: { select: { name: true } },
      },
    });

    // Filtrar pelo CNPJ (removendo formatação)
    const matched = franchisees.filter(
      (f) => f.cnpj?.replace(/\D/g, '') === cleanCnpj
    );

    if (matched.length === 0) {
      return reply.status(404).send({ success: false, error: 'Franqueado não encontrado. Verifique o CNPJ informado.' });
    }

    const franchisee = matched[0];

    // Verificar assinatura existente
    if (service_id) {
      const existingSub = await prisma.franchiseeSubscription.findFirst({
        where: {
          franchisee_id: franchisee.id,
          service_id,
          status: 'active',
        },
      });

      if (existingSub) {
        return reply.status(400).send({
          success: false,
          error: 'Este franqueado já possui uma assinatura ativa para este serviço.',
        });
      }
    }

    // Contar motos ativas (placas únicas)
    const motos = await prisma.motorcycle.findMany({
      where: {
        franchisee_id: franchisee.id,
        status: { in: ['disponivel', 'alugada', 'manutencao'] },
      },
      select: { placa: true },
    });

    const uniquePlates = new Set(motos.map((m) => m.placa).filter(Boolean));
    const motorcycleCount = uniquePlates.size;

    return reply.status(200).send({
      success: true,
      data: {
        id: franchisee.id,
        cnpj: franchisee.cnpj,
        company_name: franchisee.company_name,
        fantasy_name: franchisee.fantasy_name,
        city_id: franchisee.city_id,
        city_name: franchisee.city?.name || '',
        motorcycleCount,
      },
    });
  });

  /**
   * POST /api/marketplace/public/subscribe
   * Fluxo completo de assinatura: Asaas + DB
   */
  app.post('/public/subscribe', {
    schema: {
      description: 'Criar assinatura completa (Asaas + DB)',
      tags: ['Marketplace'],
      body: {
        type: 'object',
        required: [
          'franchisee_id', 'service_id',
          'company_name', 'cnpj',
          'email', 'phone', 'postal_code', 'address_number',
          'card_holder', 'card_number', 'card_expiry_month', 'card_expiry_year', 'card_cvv',
          'motorcycle_count', 'total_value',
        ],
        properties: {
          franchisee_id: { type: 'string' },
          service_id: { type: 'string' },
          company_name: { type: 'string' },
          cnpj: { type: 'string' },
          customer_name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          postal_code: { type: 'string' },
          address_number: { type: 'string' },
          card_holder: { type: 'string' },
          card_number: { type: 'string' },
          card_expiry_month: { type: 'string' },
          card_expiry_year: { type: 'string' },
          card_cvv: { type: 'string' },
          motorcycle_count: { type: 'number' },
          total_value: { type: 'number' },
          unit_price: { type: 'number' },
          remote_ip: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      franchisee_id: string;
      service_id: string;
      company_name: string;
      cnpj: string;
      customer_name?: string;
      email: string;
      phone: string;
      postal_code: string;
      address_number: string;
      card_holder: string;
      card_number: string;
      card_expiry_month: string;
      card_expiry_year: string;
      card_cvv: string;
      motorcycle_count: number;
      total_value: number;
      unit_price?: number;
      remote_ip?: string;
    };

    const cleanCnpj = body.cnpj.replace(/\D/g, '');
    const customerName = body.customer_name || body.company_name;
    const remoteIp = body.remote_ip || request.ip || '127.0.0.1';

    // ── 1. Criar/buscar cliente no Asaas ──
    let customerId: string;

    // Buscar existente
    const searchRes = await asaasFetch<{ data: any[] }>(`/customers?cpfCnpj=${cleanCnpj}`);

    if (searchRes.data && searchRes.data.length > 0) {
      customerId = searchRes.data[0].id;
      // Atualizar dados
      try {
        await asaasFetch(`/customers/${customerId}`, 'PUT', {
          name: customerName,
          email: body.email,
          phone: body.phone.replace(/\D/g, ''),
          mobilePhone: body.phone.replace(/\D/g, ''),
          postalCode: body.postal_code.replace(/\D/g, ''),
          addressNumber: body.address_number,
        });
      } catch {
        // usa existente se falhar atualização
      }
    } else {
      const newCustomer = await asaasFetch<{ id: string }>('/customers', 'POST', {
        name: customerName,
        email: body.email,
        cpfCnpj: cleanCnpj,
        phone: body.phone.replace(/\D/g, ''),
        mobilePhone: body.phone.replace(/\D/g, ''),
        postalCode: body.postal_code.replace(/\D/g, ''),
        addressNumber: body.address_number,
      });
      customerId = newCustomer.id;
    }

    // ── 2. Criar assinatura no Asaas ──
    const nextDueDate = new Date().toISOString().split('T')[0];
    const description = `Monitoramento de Multas - ${body.motorcycle_count} placas - ${customerName}`;

    const asaasSub = await asaasFetch<{ id: string; nextDueDate: string; creditCard?: { creditCardToken?: string } }>(
      '/subscriptions',
      'POST',
      {
        customer: customerId,
        billingType: 'CREDIT_CARD',
        value: body.total_value,
        nextDueDate,
        cycle: 'MONTHLY',
        description,
        externalReference: body.franchisee_id,
        creditCard: {
          holderName: body.card_holder,
          number: body.card_number.replace(/\s/g, ''),
          expiryMonth: body.card_expiry_month,
          expiryYear: body.card_expiry_year,
          ccv: body.card_cvv,
        },
        creditCardHolderInfo: {
          name: customerName,
          email: body.email,
          cpfCnpj: cleanCnpj,
          postalCode: body.postal_code.replace(/\D/g, ''),
          addressNumber: body.address_number,
          phone: body.phone.replace(/\D/g, ''),
          mobilePhone: body.phone.replace(/\D/g, ''),
        },
        remoteIp,
      },
    );

    // ── 3. Salvar assinatura no banco ──
    // Verificar se existe uma cancelada para reativar
    const existingCancelled = await prisma.franchiseeSubscription.findFirst({
      where: {
        franchisee_id: body.franchisee_id,
        service_id: body.service_id,
        status: { in: ['cancelled', 'suspended'] },
      },
    });

    let subscription;
    if (existingCancelled) {
      subscription = await prisma.franchiseeSubscription.update({
        where: { id: existingCancelled.id },
        data: {
          asaas_customer_id: customerId,
          asaas_subscription_id: asaasSub.id,
          beemon_fleet_id: null,
          beemon_fleet_identifier: null,
          company_name_beemon: body.company_name,
          cnpj_beemon: cleanCnpj,
          status: 'active',
          activated_at: new Date(),
          cancelled_at: null,
          next_due_date: asaasSub.nextDueDate ? new Date(asaasSub.nextDueDate) : null,
          unit_count: body.motorcycle_count,
          unit_price_at_subscription: body.unit_price ?? null,
          total_value: body.total_value,
        },
      });
    } else {
      subscription = await prisma.franchiseeSubscription.create({
        data: {
          franchisee_id: body.franchisee_id,
          service_id: body.service_id,
          asaas_customer_id: customerId,
          asaas_subscription_id: asaasSub.id,
          company_name_beemon: body.company_name,
          cnpj_beemon: cleanCnpj,
          status: 'active',
          activated_at: new Date(),
          next_due_date: asaasSub.nextDueDate ? new Date(asaasSub.nextDueDate) : null,
          unit_count: body.motorcycle_count,
          unit_price_at_subscription: body.unit_price ?? null,
          total_value: body.total_value,
        },
      });
    }

    return reply.status(201).send({
      success: true,
      data: {
        subscriptionId: subscription.id,
        asaasCustomerId: customerId,
        asaasSubscriptionId: asaasSub.id,
        nextDueDate: asaasSub.nextDueDate,
        creditCardToken: asaasSub.creditCard?.creditCardToken,
      },
    });
  });
};

export default marketplaceRoutes;
