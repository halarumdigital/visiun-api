import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
  },
};

const rentalPlanResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    daily_rate: { type: 'number' },
    weekly_rate: { type: 'number', nullable: true },
    monthly_rate: { type: 'number', nullable: true },
    minimum_days: { type: 'number', nullable: true },
    maximum_days: { type: 'number', nullable: true },
    deposit_amount: { type: 'number', nullable: true },
    is_active: { type: 'boolean' },
    status: { type: 'string', nullable: true },
    city_id: { type: 'string', format: 'uuid', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const rentalPlansRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/rental-plans
   * Listar planos de locação
   * - Master BR/Admin: todos os planos ou filtrados por cidade
   * - Regional/Franchisee: planos da sua cidade + planos globais (city_id = null)
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar planos de locação',
      tags: ['Planos de Locação'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', format: 'uuid', description: 'Filtrar por cidade' },
          status: { type: 'string', description: 'Filtrar por status (ex: active)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: rentalPlanResponseSchema },
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { city_id, status } = request.query as { city_id?: string; status?: string };
    const context = getContext(request);

    // Para master_br/admin: se city_id for passado, filtrar por essa cidade + globais
    // Para regional/franchisee: sempre filtrar pela cidade do usuário + globais
    let plans;

    if (context.isMasterOrAdmin()) {
      // Master BR / Admin
      if (city_id) {
        // Filtrar por cidade específica + planos globais
        plans = await prisma.rentalPlan.findMany({
          where: {
            AND: [
              status ? { status } : {},
              {
                OR: [
                  { city_id: city_id },
                  { city_id: null },
                ],
              },
            ],
          },
          orderBy: { daily_rate: 'asc' },
        });
      } else {
        // Sem filtro de cidade - ver todos
        plans = await prisma.rentalPlan.findMany({
          where: status ? { status } : {},
          orderBy: { daily_rate: 'asc' },
        });
      }
    } else {
      // Regional / Franchisee - filtrar pela cidade do usuário + globais
      const userCityId = context.cityId;

      if (userCityId) {
        plans = await prisma.rentalPlan.findMany({
          where: {
            AND: [
              status ? { status } : {},
              {
                OR: [
                  { city_id: userCityId },
                  { city_id: null },
                ],
              },
            ],
          },
          orderBy: { daily_rate: 'asc' },
        });
      } else {
        // Sem cidade - apenas planos globais
        plans = await prisma.rentalPlan.findMany({
          where: {
            AND: [
              status ? { status } : {},
              { city_id: null },
            ],
          },
          orderBy: { daily_rate: 'asc' },
        });
      }
    }

    // Converter Decimal para number
    const formattedPlans = plans.map(plan => ({
      ...plan,
      daily_rate: Number(plan.daily_rate),
      weekly_rate: plan.weekly_rate ? Number(plan.weekly_rate) : null,
      monthly_rate: plan.monthly_rate ? Number(plan.monthly_rate) : null,
      deposit_amount: plan.deposit_amount ? Number(plan.deposit_amount) : null,
    }));

    return reply.status(200).send({
      success: true,
      data: formattedPlans,
    });
  });
};

export default rentalPlansRoutes;
