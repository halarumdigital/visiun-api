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

  /**
   * GET /api/manutencoes/:id
   * Buscar detalhes completos de uma ordem de serviço
   */
  app.get('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar detalhes de uma ordem de serviço por ID',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const os = await prisma.ordemServico.findUnique({
      where: { id },
      include: {
        motorcycle: {
          select: { placa: true, modelo: true },
        },
        servicos: true,
        pecas: true,
      },
    });

    if (!os) {
      return reply.status(404).send({
        success: false,
        error: 'Ordem de serviço não encontrada',
      });
    }

    // Buscar nomes de oficina e profissional via raw query (tabelas sem modelo Prisma)
    let oficinaNome: string | null = null;
    let profissionalNome: string | null = null;

    if (os.oficina_id) {
      const oficinas = await prisma.$queryRaw<{ nome: string }[]>`
        SELECT nome FROM oficinas WHERE id = ${os.oficina_id}::uuid LIMIT 1
      `;
      oficinaNome = oficinas[0]?.nome || null;
    }

    if (os.profissional_id) {
      const profissionais = await prisma.$queryRaw<{ nome: string }[]>`
        SELECT nome FROM profissionais WHERE id = ${os.profissional_id}::uuid LIMIT 1
      `;
      profissionalNome = profissionais[0]?.nome || null;
    }

    // Buscar nomes de serviços e peças via raw query
    const servicosComNome = await Promise.all(
      (os.servicos || []).map(async (s) => {
        let servicoNome: string | null = null;
        if (s.servico_id) {
          const servicos = await prisma.$queryRaw<{ nome: string }[]>`
            SELECT nome FROM servicos WHERE id = ${s.servico_id}::uuid LIMIT 1
          `;
          servicoNome = servicos[0]?.nome || null;
        }
        return {
          quantidade: Number(s.quantidade) || 1,
          preco_unitario: Number(s.preco_unitario) || 0,
          servico: { nome: servicoNome || 'Serviço' },
        };
      })
    );

    const pecasComNome = await Promise.all(
      (os.pecas || []).map(async (p) => {
        let pecaNome: string | null = null;
        if (p.peca_id) {
          const pecas = await prisma.$queryRaw<{ nome: string }[]>`
            SELECT nome FROM pecas WHERE id = ${p.peca_id}::uuid LIMIT 1
          `;
          pecaNome = pecas[0]?.nome || null;
        }
        return {
          quantidade: Number(p.quantidade) || 1,
          preco_unitario: Number(p.preco_unitario) || 0,
          peca: { nome: pecaNome || 'Peça' },
        };
      })
    );

    return reply.status(200).send({
      success: true,
      data: {
        id: os.id,
        numero_os: os.numero_os,
        data_abertura: os.data_abertura?.toISOString() || null,
        data_previsao: os.data_previsao?.toISOString() || null,
        data_conclusao: os.data_conclusao?.toISOString() || null,
        status: os.status || 'aberta',
        tipo_manutencao: os.tipo_manutencao,
        km_atual: os.km_atual,
        descricao_problema: os.descricao_problema,
        valor_pecas: os.valor_pecas ? Number(os.valor_pecas) : 0,
        valor_servicos: os.valor_servicos ? Number(os.valor_servicos) : 0,
        valor_total: os.valor_total ? Number(os.valor_total) : 0,
        observacoes: os.observacoes,
        placa: os.motorcycle?.placa || null,
        modelo: os.motorcycle?.modelo || null,
        oficina: oficinaNome ? { nome: oficinaNome } : null,
        profissional: profissionalNome ? { nome: profissionalNome } : null,
        servicos: servicosComNome,
        pecas: pecasComNome,
        // Imagens de vistoria (campos diretos se existirem)
        vistoria_1_antes: (os as any).vistoria_1_antes || null,
        vistoria_1_depois: (os as any).vistoria_1_depois || null,
        vistoria_2_antes: (os as any).vistoria_2_antes || null,
        vistoria_2_depois: (os as any).vistoria_2_depois || null,
        vistoria_3_antes: (os as any).vistoria_3_antes || null,
        vistoria_3_depois: (os as any).vistoria_3_depois || null,
        vistoria_4_antes: (os as any).vistoria_4_antes || null,
        vistoria_4_depois: (os as any).vistoria_4_depois || null,
        vistoria_5_antes: (os as any).vistoria_5_antes || null,
        vistoria_5_depois: (os as any).vistoria_5_depois || null,
      },
    });
  });
};

export default manutencoesRoutes;
