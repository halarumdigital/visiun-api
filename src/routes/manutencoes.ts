import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const manutencoesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/manutencoes
   * Listar ordens de serviço (manutenções) com filtros
   * Retorna dados da tabela ordens_servico mapeados para o formato MaintenanceRecord
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar manutenções (ordens de serviço) com filtros',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
          franchisee_id: { type: 'string' },
          motorcycle_ids: { type: 'string', description: 'IDs de motos separados por vírgula' },
          date_from: { type: 'string', description: 'Data início (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'Data fim (YYYY-MM-DD)' },
          status: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as {
      city_id?: string;
      franchisee_id?: string;
      motorcycle_ids?: string;
      date_from?: string;
      date_to?: string;
      status?: string;
    };

    const where: any = {};

    if (query.city_id) {
      where.city_id = query.city_id;
    }

    // franchisee_id: ordens_servico não tem este campo diretamente,
    // filtrar via relação com motorcycle
    if (query.franchisee_id) {
      where.motorcycle = {
        franchisee_id: query.franchisee_id,
      };
    }

    if (query.motorcycle_ids) {
      const ids = query.motorcycle_ids.split(',').filter(Boolean);
      if (ids.length > 0) {
        where.motorcycle_id = { in: ids };
      }
    }

    // data_previsao é timestamp with time zone
    if (query.date_from || query.date_to) {
      where.data_previsao = {};
      if (query.date_from) {
        const fromStr = query.date_from.split('T')[0]; // "YYYY-MM-DD"
        where.data_previsao.gte = new Date(fromStr + 'T00:00:00.000Z');
      }
      if (query.date_to) {
        const toStr = query.date_to.split('T')[0]; // "YYYY-MM-DD"
        // Incluir todo o dia (até 23:59:59.999)
        where.data_previsao.lte = new Date(toStr + 'T23:59:59.999Z');
      }
    }

    if (query.status) {
      where.status = query.status;
    }

    // Aplicar filtros baseados no role do usuário
    if (context.role === 'regional' && context.cityId) {
      where.city_id = context.cityId;
    } else if (context.role === 'franchisee' && context.franchiseeId) {
      where.motorcycle = {
        ...where.motorcycle,
        franchisee_id: context.franchiseeId,
      };
    }

    const ordens = await prisma.ordemServico.findMany({
      where,
      include: {
        servicos: true,
        pecas: true,
      },
      orderBy: { data_previsao: 'desc' },
    });

    // Mapear campos de ordens_servico para o formato MaintenanceRecord
    // esperado pelo frontend (data_entrada, tipo, etc.)
    const mapped = ordens.map(o => ({
      id: o.id,
      numero_os: o.numero_os,
      motorcycle_id: o.motorcycle_id,
      franchisee_id: null, // ordens_servico não tem franchisee_id diretamente
      city_id: o.city_id,
      tipo: o.tipo_manutencao || 'Manutenção',
      descricao: o.descricao_problema,
      status: o.status || 'aberta',
      data_entrada: o.data_previsao ? o.data_previsao.toISOString() : o.data_abertura ? o.data_abertura.toISOString() : null,
      data_saida: o.data_conclusao ? o.data_conclusao.toISOString() : null,
      valor_total: o.valor_total ? Number(o.valor_total) : 0,
      valor_pecas: o.valor_pecas ? Number(o.valor_pecas) : 0,
      valor_servicos: o.valor_servicos ? Number(o.valor_servicos) : 0,
      oficina: o.oficina_id,
      observacoes: o.observacoes,
      created_at: o.created_at ? o.created_at.toISOString() : null,
      updated_at: o.updated_at ? o.updated_at.toISOString() : null,
      servicos: o.servicos,
      pecas: o.pecas,
    }));

    return reply.status(200).send({
      success: true,
      data: mapped,
    });
  });
};

export default manutencoesRoutes;
