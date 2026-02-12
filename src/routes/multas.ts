/**
 * Rotas de Multas - Gestão de infrações via Beemon
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';
import {
  fetchAndCacheInfractions,
  setupFleetForFranchisee,
  syncFranchiseeVehicles,
  checkSyncPreview,
} from '../services/beemonService.js';

// Helper para obter city_id do franqueado para mapear UF
async function getCityNameForFranchisee(franchiseeId: string): Promise<string> {
  const franchisee = await prisma.franchisee.findUnique({
    where: { id: franchiseeId },
    select: { city: { select: { name: true } } },
  });
  return franchisee?.city?.name || '';
}

// Mapeamento simplificado de cidade → UF
function getCityUF(cityName: string): string {
  const cityUFMap: Record<string, string> = {
    'São Paulo': 'SP', 'Campinas': 'SP', 'Ribeirão Preto': 'SP', 'Santos': 'SP',
    'Rio de Janeiro': 'RJ', 'Niterói': 'RJ',
    'Belo Horizonte': 'MG', 'Uberlândia': 'MG',
    'Curitiba': 'PR', 'Londrina': 'PR', 'Maringá': 'PR',
    'Porto Alegre': 'RS',
    'Florianópolis': 'SC', 'Joinville': 'SC',
    'Goiânia': 'GO',
    'Brasília': 'DF',
    'Salvador': 'BA',
    'Recife': 'PE',
    'Fortaleza': 'CE',
    'Manaus': 'AM',
    'Belém': 'PA',
  };
  return cityUFMap[cityName] || 'SP';
}

const multasRoutes: FastifyPluginAsync = async (app) => {
  // ==========================================================================
  // GET /api/multas/subscriptions
  // Listar assinaturas ativas com dados de franqueado
  // ==========================================================================
  app.get('/subscriptions', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar assinaturas de multas ativas',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const ctx = getContext(request);

    // Construir filtro baseado no role
    const where: any = { status: 'active' };

    if (ctx.isFranchisee()) {
      let franchiseeId = ctx.franchiseeId;

      // Fallback: buscar franchisee pelo master_user_id ou user_id
      if (!franchiseeId) {
        const linkedFranchisee = await prisma.franchisee.findFirst({
          where: {
            OR: [
              { master_user_id: ctx.userId },
              { user_id: ctx.userId },
            ],
            status: 'active',
          },
          select: { id: true },
        });
        franchiseeId = linkedFranchisee?.id;
      }

      if (!franchiseeId) {
        return reply.status(200).send({ success: true, data: [] });
      }
      where.franchisee_id = franchiseeId;
    } else if (ctx.isRegional() && ctx.cityId) {
      const franchiseesInCity = await prisma.franchisee.findMany({
        where: { city_id: ctx.cityId, status: 'active' },
        select: { id: true },
      });
      const ids = franchiseesInCity.map(f => f.id);
      if (ids.length === 0) return reply.status(200).send({ success: true, data: [] });
      where.franchisee_id = { in: ids };
    }
    // master/admin: sem filtro adicional

    const subscriptions = await prisma.franchiseeSubscription.findMany({
      where,
      include: {
        franchisee: {
          select: { id: true, company_name: true, fantasy_name: true },
        },
      },
    });

    // Formatar resposta para manter compatibilidade com o frontend
    const data = subscriptions.map(sub => ({
      ...sub,
      // Converter Decimal para number
      unit_price_at_subscription: sub.unit_price_at_subscription ? Number(sub.unit_price_at_subscription) : null,
      total_value: sub.total_value ? Number(sub.total_value) : null,
    }));

    return reply.status(200).send({ success: true, data });
  });

  // ==========================================================================
  // GET /api/multas/infractions
  // Listar infrações do cache
  // ==========================================================================
  app.get('/infractions', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar infrações cacheadas',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          subscription_id: { type: 'string' },
          subscription_ids: { type: 'string', description: 'IDs separados por vírgula' },
        },
      },
    },
  }, async (request, reply) => {
    getContext(request); // Valida autenticação
    const { subscription_id, subscription_ids } = request.query as { subscription_id?: string; subscription_ids?: string };

    const where: any = {};

    if (subscription_id && subscription_id !== 'all') {
      where.subscription_id = subscription_id;
    } else if (subscription_ids) {
      where.subscription_id = { in: subscription_ids.split(',') };
    } else {
      return reply.status(200).send({ success: true, data: { data: [], stats: { total: 0, multas: 0, notificacoes: 0, pagas: 0, pendentes: 0, valorTotal: 0, valorPendente: 0 } } });
    }

    const infractions = await prisma.beemonInfractionCache.findMany({
      where,
      orderBy: { infraction_date: 'desc' },
    });

    // Converter para formato compatível
    const data = infractions.map(i => ({
      ...i,
      amount: i.amount ? Number(i.amount) : 0,
      infraction_hour: i.infraction_hour ? String(i.infraction_hour) : null,
      identification_date: i.identification_date ? i.identification_date.toISOString().split('T')[0] : null,
      infraction_due_date: i.infraction_due_date ? i.infraction_due_date.toISOString().split('T')[0] : null,
      infraction_date: i.infraction_date ? i.infraction_date.toISOString().split('T')[0] : null,
    }));

    // Calcular estatísticas
    const stats = {
      total: data.length,
      multas: data.filter(i => i.kind === 'MULTA').length,
      notificacoes: data.filter(i => i.kind === 'NOTIFICACAO').length,
      pagas: data.filter(i => i.paid).length,
      pendentes: data.filter(i => !i.paid).length,
      valorTotal: data.reduce((sum, i) => sum + (i.amount || 0), 0),
      valorPendente: data.filter(i => !i.paid).reduce((sum, i) => sum + (i.amount || 0), 0),
    };

    return reply.status(200).send({ success: true, data: { data, stats } });
  });

  // ==========================================================================
  // GET /api/multas/vehicles/count
  // Contar placas cadastradas no monitoramento
  // ==========================================================================
  app.get('/vehicles/count', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Contar veículos monitorados',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          subscription_id: { type: 'string' },
          subscription_ids: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    getContext(request);
    const { subscription_id, subscription_ids } = request.query as { subscription_id?: string; subscription_ids?: string };

    const where: any = { active: true };

    if (subscription_id && subscription_id !== 'all') {
      where.subscription_id = subscription_id;
    } else if (subscription_ids) {
      where.subscription_id = { in: subscription_ids.split(',') };
    } else {
      return reply.status(200).send({ success: true, data: { count: 0 } });
    }

    const count = await prisma.beemonVehicle.count({ where });
    return reply.status(200).send({ success: true, data: { count } });
  });

  // ==========================================================================
  // GET /api/multas/vehicles
  // Listar veículos sincronizados
  // ==========================================================================
  app.get('/vehicles', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar veículos sincronizados',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          subscription_id: { type: 'string' },
        },
        required: ['subscription_id'],
      },
    },
  }, async (request, reply) => {
    getContext(request);
    const { subscription_id } = request.query as { subscription_id: string };

    const vehicles = await prisma.beemonVehicle.findMany({
      where: { subscription_id, active: true },
      orderBy: { vehicle_plate: 'asc' },
    });

    // Buscar modelos das motos
    const motorcycleIds = vehicles.map(v => v.motorcycle_id).filter(Boolean);
    let modeloMap: Record<string, string> = {};

    if (motorcycleIds.length > 0) {
      const motos = await prisma.motorcycle.findMany({
        where: { id: { in: motorcycleIds } },
        select: { id: true, modelo: true },
      });
      modeloMap = Object.fromEntries(motos.map(m => [m.id, m.modelo || '-']));
    }

    const data = vehicles.map(v => ({
      vehicle_plate: v.vehicle_plate,
      renavam: v.renavam || '-',
      chassi_code: v.chassi_code || '-',
      active: v.active,
      modelo: modeloMap[v.motorcycle_id] || '-',
    }));

    return reply.status(200).send({ success: true, data });
  });

  // ==========================================================================
  // POST /api/multas/infractions/refresh
  // Atualizar infrações da API Beemon
  // ==========================================================================
  app.post('/infractions/refresh', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar infrações da API Beemon',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          subscriptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                beemon_fleet_id: { type: 'string' },
              },
              required: ['id', 'beemon_fleet_id'],
            },
          },
        },
        required: ['subscriptions'],
      },
    },
  }, async (request, reply) => {
    getContext(request);
    const { subscriptions } = request.body as { subscriptions: Array<{ id: string; beemon_fleet_id: string }> };

    let totalNew = 0;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      try {
        const result = await fetchAndCacheInfractions(sub.id, sub.beemon_fleet_id);
        totalNew += result.newInfractions;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Subscription ${sub.id}: ${msg}`);
      }
    }

    return reply.status(200).send({
      success: true,
      data: { totalNew, errors },
    });
  });

  // ==========================================================================
  // POST /api/multas/vehicles/check-sync
  // Preview de sincronização de veículos
  // ==========================================================================
  app.post('/vehicles/check-sync', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Preview de sincronização de veículos',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          subscription_id: { type: 'string' },
        },
        required: ['subscription_id'],
      },
    },
  }, async (request, reply) => {
    getContext(request);
    const { subscription_id } = request.body as { subscription_id: string };

    // Buscar subscription
    const subscription = await prisma.franchiseeSubscription.findUnique({
      where: { id: subscription_id },
      include: {
        franchisee: { select: { id: true, company_name: true, fantasy_name: true, cnpj: true, city: { select: { name: true } } } },
      },
    });

    if (!subscription) {
      return reply.status(404).send({ success: false, error: 'Assinatura não encontrada' });
    }

    let fleetId = subscription.beemon_fleet_id;
    let fleetIdentifier = subscription.beemon_fleet_identifier;
    let needsFleetSetup = false;

    // Se beemon_fleet_id está NULL, indicar que precisa setup
    if (!fleetId) {
      const franchisee = subscription.franchisee;
      if (franchisee) {
        const beemonResult = await setupFleetForFranchisee({
          franchiseeId: franchisee.id,
          companyName: franchisee.fantasy_name || franchisee.company_name || '',
          cnpj: franchisee.cnpj?.replace(/\D/g, '') || '',
        });

        if (!beemonResult.success || !beemonResult.fleetId) {
          return reply.status(400).send({
            success: false,
            error: beemonResult.error || 'Não foi possível criar a frota',
          });
        }

        fleetId = beemonResult.fleetId;
        fleetIdentifier = beemonResult.fleetIdentifier || null;

        // Atualizar subscription
        await prisma.franchiseeSubscription.update({
          where: { id: subscription_id },
          data: { beemon_fleet_id: fleetId, beemon_fleet_identifier: fleetIdentifier },
        });

        needsFleetSetup = true;
      }
    }

    const unitPrice = subscription.unit_price_at_subscription ? Number(subscription.unit_price_at_subscription) : 9.90;
    const currentTotalValue = subscription.total_value ? Number(subscription.total_value) : 0;

    const preview = await checkSyncPreview(
      subscription_id,
      subscription.franchisee_id,
      unitPrice,
      currentTotalValue
    );

    const cityName = subscription.franchisee?.city?.name || '';
    const state = getCityUF(cityName);

    return reply.status(200).send({
      success: true,
      data: {
        ...preview,
        needsFleetSetup,
        fleetId,
        fleetIdentifier,
        state,
      },
    });
  });

  // ==========================================================================
  // POST /api/multas/vehicles/sync
  // Executar sincronização de veículos
  // ==========================================================================
  app.post('/vehicles/sync', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Executar sincronização de veículos com Beemon',
      tags: ['Multas'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          subscription_id: { type: 'string' },
          fleet_id: { type: 'string' },
          fleet_identifier: { type: 'string' },
          state: { type: 'string' },
        },
        required: ['subscription_id', 'fleet_id', 'fleet_identifier', 'state'],
      },
    },
  }, async (request, reply) => {
    getContext(request);
    const { subscription_id, fleet_id, fleet_identifier, state } = request.body as {
      subscription_id: string;
      fleet_id: string;
      fleet_identifier: string;
      state: string;
    };

    // Buscar subscription
    const subscription = await prisma.franchiseeSubscription.findUnique({
      where: { id: subscription_id },
    });

    if (!subscription) {
      return reply.status(404).send({ success: false, error: 'Assinatura não encontrada' });
    }

    // Verificar se é a primeira sincronização (nenhum veículo cadastrado ainda)
    const existingVehiclesCount = await prisma.beemonVehicle.count({
      where: { subscription_id, active: true },
    });
    const isFirstSync = existingVehiclesCount === 0;

    const result = await syncFranchiseeVehicles(
      subscription_id,
      subscription.franchisee_id,
      fleet_id,
      fleet_identifier,
      state
    );

    // Atualizar contagem e valor se cadastrou novas placas
    if (result.success > 0) {
      const currentCount = subscription.unit_count || 0;
      const unitPrice = subscription.unit_price_at_subscription ? Number(subscription.unit_price_at_subscription) : 9.90;
      const newTotalPlates = currentCount + result.success;
      const newTotalValue = newTotalPlates * unitPrice;

      // Sempre atualizar contagem no banco local
      await prisma.franchiseeSubscription.update({
        where: { id: subscription_id },
        data: { unit_count: newTotalPlates, total_value: newTotalValue },
      });

      // Atualizar valor no Asaas SOMENTE se NÃO é a primeira sync
      // Na primeira sync a frota já foi paga pelo Marketplace
      if (!isFirstSync && subscription.asaas_subscription_id && env.ASAAS_API_URL && env.ASAAS_API_KEY) {
        try {
          await fetch(`${env.ASAAS_API_URL}/subscriptions/${subscription.asaas_subscription_id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'access_token': env.ASAAS_API_KEY,
            },
            body: JSON.stringify({
              value: newTotalValue,
              description: `Monitoramento de Multas - ${newTotalPlates} placas`,
            }),
          });
        } catch (asaasErr) {
          // Não falhar por causa do Asaas
          result.errors.push('Veículos sincronizados, mas não foi possível atualizar o valor no Asaas');
        }
      }
    }

    return reply.status(200).send({ success: true, data: result });
  });
};

export default multasRoutes;
