import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const manutencoesRoutes: FastifyPluginAsync = async (app) => {

  // ========================================
  // Helper: mapear status de oficinas_agendamentos para valores da UI
  // ========================================
  const mapAgendamentoStatusToUI = (dbStatus: string): string => {
    const statusMapping: Record<string, string> = {
      'agendado': 'agendado',
      'confirmado': 'agendado',
      'em_atendimento': 'em_andamento',
      'concluido': 'concluida',
      'cancelado': 'cancelada',
      'nao_compareceu': 'cancelada',
    };
    return statusMapping[dbStatus] || 'agendado';
  };

  // ========================================
  // Helper: mapear status da UI para oficinas_agendamentos
  // ========================================
  const mapUIStatusToAgendamento = (uiStatus: string): string => {
    const statusMapping: Record<string, string> = {
      'agendado': 'agendado',
      'aberta': 'agendado',
      'em_andamento': 'em_atendimento',
      'concluida': 'concluido',
      'cancelada': 'cancelado',
    };
    return statusMapping[uiStatus] || 'agendado';
  };

  /**
   * GET /api/manutencoes
   * Listar ordens de serviço + agendamentos IA com dados relacionais completos
   */
  app.get('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Listar manutenções (ordens de serviço + agendamentos IA) com filtros',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
          franchisee_id: { type: 'string' },
          motorcycle_ids: { type: 'string', description: 'IDs de motos separados por vírgula' },
          date_from: { type: 'string', description: 'Data abertura início (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'Data abertura fim (YYYY-MM-DD)' },
          data_previsao_from: { type: 'string', description: 'Data previsão início (ISO)' },
          data_previsao_to: { type: 'string', description: 'Data previsão fim (ISO)' },
          oficina_id: { type: 'string', description: 'Filtrar por oficina' },
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
      data_previsao_from?: string;
      data_previsao_to?: string;
      oficina_id?: string;
      status?: string;
    };

    // ====== PARTE 1: Buscar ordens de serviço via Prisma ======
    const where: any = {};

    // Filtro de cidade
    if (query.city_id) {
      where.city_id = query.city_id;
    }
    if (context.role === 'master_br' && query.city_id) {
      where.city_id = query.city_id;
    } else if (context.role !== 'master_br' && context.cityId) {
      where.city_id = context.cityId;
    }

    // Filtro de franqueado via motorcycle
    if (query.franchisee_id) {
      where.motorcycle = { franchisee_id: query.franchisee_id };
    }
    if (context.role === 'franchisee' && context.franchiseeId) {
      where.motorcycle = {
        ...where.motorcycle,
        franchisee_id: context.franchiseeId,
      };
    }

    if (query.motorcycle_ids) {
      const ids = query.motorcycle_ids.split(',').filter(Boolean);
      if (ids.length > 0) {
        where.motorcycle_id = { in: ids };
      }
    }

    // Filtro de data (data_abertura)
    if (query.date_from || query.date_to) {
      where.data_abertura = {};
      if (query.date_from) {
        where.data_abertura.gte = new Date(query.date_from.split('T')[0] + 'T00:00:00.000Z');
      }
      if (query.date_to) {
        where.data_abertura.lte = new Date(query.date_to.split('T')[0] + 'T23:59:59.999Z');
      }
    }

    // Filtro de data_previsao
    if (query.data_previsao_from || query.data_previsao_to) {
      where.data_previsao = {};
      if (query.data_previsao_from) {
        where.data_previsao.gte = new Date(query.data_previsao_from);
      }
      if (query.data_previsao_to) {
        where.data_previsao.lte = new Date(query.data_previsao_to);
      }
    }

    // Filtro de oficina
    if (query.oficina_id) {
      where.oficina_id = query.oficina_id;
    }

    if (query.status && query.status !== 'todos') {
      where.status = query.status;
    }

    const ordens = await prisma.ordemServico.findMany({
      where,
      include: {
        motorcycle: {
          select: {
            id: true,
            placa: true,
            modelo: true,
            franchisee_id: true,
          },
        },
        servicos: true,
        pecas: true,
      },
      orderBy: { data_abertura: 'desc' },
    });

    // ====== Buscar dados relacionais em PARALELO (antes era sequencial) ======
    const oficinaIds = [...new Set(ordens.map(o => o.oficina_id).filter(Boolean))] as string[];
    const profissionalIds = [...new Set(ordens.map(o => o.profissional_id).filter(Boolean))] as string[];
    const franchiseeIds = [...new Set(ordens.map(o => o.motorcycle?.franchisee_id).filter(Boolean))] as string[];
    const motorcycleIds = [...new Set(ordens.map(o => o.motorcycle_id).filter(Boolean))] as string[];
    const ordemIds = ordens.map(o => o.id);

    const [oficinasResult, profissionaisResult, franchiseesResult, rentalsResult, vistoriaResult] = await Promise.all([
      // Oficinas
      oficinaIds.length > 0
        ? prisma.$queryRawUnsafe<{ id: string; nome: string }[]>(
            `SELECT id::text, nome FROM oficinas WHERE id = ANY($1::uuid[])`,
            oficinaIds
          )
        : Promise.resolve([]),
      // Profissionais
      profissionalIds.length > 0
        ? prisma.$queryRawUnsafe<{ id: string; nome: string }[]>(
            `SELECT id::text, nome FROM profissionais WHERE id = ANY($1::uuid[])`,
            profissionalIds
          )
        : Promise.resolve([]),
      // Franqueados
      franchiseeIds.length > 0
        ? prisma.franchisee.findMany({
            where: { id: { in: franchiseeIds } },
            select: { id: true, company_name: true, fantasy_name: true, city_id: true },
          })
        : Promise.resolve([]),
      // Locatários
      motorcycleIds.length > 0
        ? prisma.$queryRawUnsafe<{ motorcycle_id: string; client_name: string }[]>(
            `SELECT DISTINCT ON (motorcycle_id) motorcycle_id::text, client_name
             FROM rentals
             WHERE motorcycle_id = ANY($1::uuid[])
             ORDER BY motorcycle_id, created_at DESC`,
            motorcycleIds
          )
        : Promise.resolve([]),
      // Vistorias
      ordemIds.length > 0
        ? prisma.$queryRawUnsafe<any[]>(
            `SELECT id::text,
                    vistoria_1_antes, vistoria_1_depois,
                    vistoria_2_antes, vistoria_2_depois,
                    vistoria_3_antes, vistoria_3_depois,
                    vistoria_4_antes, vistoria_4_depois,
                    vistoria_5_antes, vistoria_5_depois
             FROM ordens_servico WHERE id = ANY($1::uuid[])`,
            ordemIds
          )
        : Promise.resolve([]),
    ]);

    // Construir maps a partir dos resultados
    const oficinasMap = new Map<string, string>();
    oficinasResult.forEach((o: any) => oficinasMap.set(o.id, o.nome));

    const profissionaisMap = new Map<string, string>();
    profissionaisResult.forEach((p: any) => profissionaisMap.set(p.id, p.nome));

    const franchiseesMap = new Map<string, { company_name: string; fantasy_name: string | null; city_id: string }>();
    franchiseesResult.forEach((f: any) => franchiseesMap.set(f.id, { company_name: f.company_name || '', fantasy_name: f.fantasy_name || null, city_id: f.city_id }));

    const locatarioMap = new Map<string, string>();
    rentalsResult.forEach((r: any) => {
      if (r.client_name) locatarioMap.set(r.motorcycle_id, r.client_name);
    });

    const vistoriaMap = new Map<string, any>();
    vistoriaResult.forEach((v: any) => vistoriaMap.set(v.id, v));

    // Mapear ordens de serviço com todos os dados relacionais
    const mappedOrdens = ordens.map(o => {
      const vis = vistoriaMap.get(o.id) || {};
      return {
        id: o.id,
        numero_os: o.numero_os,
        motorcycle_id: o.motorcycle_id,
        oficina_id: o.oficina_id,
        profissional_id: o.profissional_id,
        city_id: o.city_id,
        data_abertura: o.data_abertura?.toISOString() || null,
        data_previsao: o.data_previsao?.toISOString() || null,
        data_conclusao: o.data_conclusao?.toISOString() || null,
        status: o.status || 'aberta',
        tipo_manutencao: o.tipo_manutencao,
        km_atual: o.km_atual,
        descricao_problema: o.descricao_problema,
        valor_total: (() => {
          const calcServicos = o.servicos.reduce((sum, s) => sum + (Number(s.quantidade || 0) * Number(s.preco_unitario || 0)), 0);
          const calcPecas = o.pecas.reduce((sum, p) => sum + (Number(p.quantidade || 0) * Number(p.preco_unitario || 0)), 0);
          const calc = calcServicos + calcPecas;
          return calc > 0 ? calc : (o.valor_total ? Number(o.valor_total) : 0);
        })(),
        valor_pecas: (() => {
          const calc = o.pecas.reduce((sum, p) => sum + (Number(p.quantidade || 0) * Number(p.preco_unitario || 0)), 0);
          return calc > 0 ? calc : (o.valor_pecas ? Number(o.valor_pecas) : 0);
        })(),
        valor_servicos: (() => {
          const calc = o.servicos.reduce((sum, s) => sum + (Number(s.quantidade || 0) * Number(s.preco_unitario || 0)), 0);
          return calc > 0 ? calc : (o.valor_servicos ? Number(o.valor_servicos) : 0);
        })(),
        observacoes: o.observacoes,
        motorcycle: o.motorcycle ? {
          placa: o.motorcycle.placa,
          modelo: o.motorcycle.modelo,
          franchisee_id: o.motorcycle.franchisee_id,
        } : null,
        oficina: o.oficina_id && oficinasMap.has(o.oficina_id) ? { nome: oficinasMap.get(o.oficina_id)! } : null,
        profissional: o.profissional_id && profissionaisMap.has(o.profissional_id) ? { nome: profissionaisMap.get(o.profissional_id)! } : null,
        franchisee: o.motorcycle?.franchisee_id && franchiseesMap.has(o.motorcycle.franchisee_id)
          ? {
              company_name: franchiseesMap.get(o.motorcycle.franchisee_id)!.company_name,
              fantasy_name: franchiseesMap.get(o.motorcycle.franchisee_id)!.fantasy_name,
              city_id: franchiseesMap.get(o.motorcycle.franchisee_id)!.city_id,
            }
          : null,
        locatario: o.locatario || (o.motorcycle_id && locatarioMap.has(o.motorcycle_id) ? locatarioMap.get(o.motorcycle_id)! : null),
        isAgendamentoIA: false,
        // Imagens de vistoria (via raw SQL)
        vistoria_1_antes: vis.vistoria_1_antes || null,
        vistoria_1_depois: vis.vistoria_1_depois || null,
        vistoria_2_antes: vis.vistoria_2_antes || null,
        vistoria_2_depois: vis.vistoria_2_depois || null,
        vistoria_3_antes: vis.vistoria_3_antes || null,
        vistoria_3_depois: vis.vistoria_3_depois || null,
        vistoria_4_antes: vis.vistoria_4_antes || null,
        vistoria_4_depois: vis.vistoria_4_depois || null,
        vistoria_5_antes: vis.vistoria_5_antes || null,
        vistoria_5_depois: vis.vistoria_5_depois || null,
      };
    });

    // ====== PARTE 2: Buscar agendamentos IA (oficinas_agendamentos) ======
    try {
      let agendamentosQuery = `
        SELECT a.*,
               o.id as oficina_ref_id, o.nome as oficina_nome
        FROM oficinas_agendamentos a
        LEFT JOIN oficinas o ON o.id = a.oficina_id
      `;
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (query.status && query.status !== 'todos') {
        conditions.push(`a.status = $${paramIndex++}`);
        params.push(query.status);
      }

      // Filtro de data_previsao nos agendamentos (campo data_hora)
      if (query.data_previsao_from) {
        conditions.push(`a.data_hora >= $${paramIndex++}`);
        params.push(new Date(query.data_previsao_from));
      }
      if (query.data_previsao_to) {
        conditions.push(`a.data_hora <= $${paramIndex++}`);
        params.push(new Date(query.data_previsao_to));
      }

      // Filtro de oficina nos agendamentos
      if (query.oficina_id) {
        conditions.push(`a.oficina_id = $${paramIndex++}`);
        params.push(query.oficina_id);
      }

      // Filtro de cidade nos agendamentos (via oficina)
      if (context.role === 'master_br' && query.city_id) {
        conditions.push(`o.city_id = $${paramIndex++}::uuid`);
        params.push(query.city_id);
      } else if (context.role !== 'master_br' && context.cityId) {
        conditions.push(`o.city_id = $${paramIndex++}::uuid`);
        params.push(context.cityId);
      }

      if (conditions.length > 0) {
        agendamentosQuery += ' WHERE ' + conditions.join(' AND ');
      }
      agendamentosQuery += ' ORDER BY a.created_at DESC';

      const agendamentos = await prisma.$queryRawUnsafe<any[]>(agendamentosQuery, ...params);

      // Buscar dados de motos dos agendamentos (pela placa)
      const placasAgendamentos = agendamentos.map((a: any) => a.placa).filter(Boolean);
      let motosAgendMap = new Map<string, { modelo: string; franchisee_id: string | null }>();
      if (placasAgendamentos.length > 0) {
        const motos = await prisma.$queryRawUnsafe<{ placa: string; modelo: string; franchisee_id: string | null }[]>(
          `SELECT DISTINCT ON (placa) placa, modelo, franchisee_id::text
           FROM motorcycles
           WHERE placa = ANY($1::text[])
           ORDER BY placa, data_ultima_mov DESC NULLS LAST`,
          placasAgendamentos
        );
        motos.forEach(m => motosAgendMap.set(m.placa, { modelo: m.modelo, franchisee_id: m.franchisee_id }));
      }

      // Buscar franqueados das motos dos agendamentos
      const agendFranchiseeIds = [...new Set(
        Array.from(motosAgendMap.values()).map(m => m.franchisee_id).filter(Boolean)
      )] as string[];
      let agendFranchiseesMap = new Map<string, { company_name: string; city_id: string }>();
      if (agendFranchiseeIds.length > 0) {
        const franchisees = await prisma.franchisee.findMany({
          where: { id: { in: agendFranchiseeIds } },
          select: { id: true, company_name: true, city_id: true },
        });
        franchisees.forEach(f => agendFranchiseesMap.set(f.id, { company_name: f.company_name || '', city_id: f.city_id }));
      }

      // Converter agendamentos para formato de OS
      let mappedAgendamentos = agendamentos.map((a: any) => {
        const motoData = a.placa ? motosAgendMap.get(a.placa) : null;
        const franchiseeData = motoData?.franchisee_id ? agendFranchiseesMap.get(motoData.franchisee_id) : null;

        return {
          id: a.id,
          numero_os: `AGD-${String(a.id).substring(0, 8)}`,
          motorcycle_id: null,
          oficina_id: a.oficina_id,
          profissional_id: null,
          city_id: null,
          data_abertura: a.created_at ? new Date(a.created_at).toISOString() : null,
          data_previsao: a.data_hora ? new Date(a.data_hora).toISOString() : null,
          data_conclusao: null,
          status: mapAgendamentoStatusToUI(a.status),
          tipo_manutencao: a.tipo_manutencao,
          km_atual: a.km_atual,
          descricao_problema: a.observacoes,
          valor_total: 0,
          valor_pecas: 0,
          valor_servicos: 0,
          observacoes: null,
          motorcycle: a.placa ? {
            placa: a.placa,
            modelo: motoData?.modelo || 'Modelo não encontrado',
            franchisee_id: motoData?.franchisee_id || null,
          } : null,
          oficina: a.oficina_nome ? { nome: a.oficina_nome } : null,
          profissional: null,
          franchisee: franchiseeData || (a.franqueado ? { company_name: a.franqueado, city_id: null } : null),
          locatario: a.locatario || null,
          isAgendamentoIA: true,
          vistoria_1_antes: null,
          vistoria_1_depois: null,
          vistoria_2_antes: null,
          vistoria_2_depois: null,
          vistoria_3_antes: null,
          vistoria_3_depois: null,
          vistoria_4_antes: null,
          vistoria_4_depois: null,
          vistoria_5_antes: null,
          vistoria_5_depois: null,
        };
      });

      // Aplicar filtros de role nos agendamentos
      if (context.role === 'regional' && context.cityId) {
        // Buscar franchisee_ids da cidade do regional
        const franchiseesInCity = await prisma.franchisee.findMany({
          where: { city_id: context.cityId },
          select: { id: true },
        });
        const cityFranchiseeIds = new Set(franchiseesInCity.map(f => f.id));

        mappedAgendamentos = mappedAgendamentos.filter(a =>
          (a.motorcycle?.franchisee_id && cityFranchiseeIds.has(a.motorcycle.franchisee_id)) ||
          (a.franchisee && (a.franchisee as any).city_id === context.cityId)
        );
      } else if (context.role === 'franchisee' && context.franchiseeId) {
        mappedAgendamentos = mappedAgendamentos.filter(a =>
          a.motorcycle?.franchisee_id === context.franchiseeId
        );
      }

      // Aplicar filtro de data nos agendamentos
      if (query.date_from || query.date_to) {
        mappedAgendamentos = mappedAgendamentos.filter(a => {
          if (!a.data_abertura) return false;
          const d = a.data_abertura.split('T')[0];
          if (query.date_from && d < query.date_from) return false;
          if (query.date_to && d > query.date_to) return false;
          return true;
        });
      }

      // ====== MERGE: Combinar ordens + agendamentos ======
      const todas = [...mappedOrdens, ...mappedAgendamentos];
      todas.sort((a, b) => {
        const dA = a.data_abertura ? new Date(a.data_abertura).getTime() : 0;
        const dB = b.data_abertura ? new Date(b.data_abertura).getTime() : 0;
        return dB - dA;
      });

      return reply.status(200).send({
        success: true,
        data: todas,
      });
    } catch (agendError) {
      // Se falhar ao buscar agendamentos, retornar apenas as ordens
      app.log.warn({ err: agendError }, 'Falha ao buscar agendamentos IA, retornando apenas ordens');
      return reply.status(200).send({
        success: true,
        data: mappedOrdens,
      });
    }
  });

  /**
   * POST /api/manutencoes
   * Criar uma nova ordem de serviço (com serviços e peças opcionais)
   */
  app.post('/', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Criar uma nova ordem de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const body = request.body as any;
    const authContext = getContext(request);

    try {
      // Gerar numero_os
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const numero_os = body.numero_os || `OS${timestamp}${random}`;

      // Inserir a OS
      const osResult = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO ordens_servico (
          id, numero_os, motorcycle_id, oficina_id, profissional_id,
          data_previsao, status, tipo_manutencao, km_atual,
          descricao_problema, valor_pecas, valor_servicos, valor_total,
          observacoes, created_by, city_id, locatario, data_abertura
        ) VALUES (
          gen_random_uuid(), $1, $2::uuid, $3::uuid, $4::uuid,
          $5::timestamp, $6, $7, $8,
          $9, $10::numeric, $11::numeric, $12::numeric,
          $13, $14::uuid, $15::uuid, $16, NOW()
        ) RETURNING id::text`,
        numero_os,
        body.motorcycle_id,
        body.oficina_id,
        body.profissional_id || null,
        body.data_previsao ? new Date(body.data_previsao) : new Date(),
        body.status || 'agendado',
        body.tipo_manutencao || 'preventiva',
        body.km_atual ? parseInt(body.km_atual) : null,
        body.descricao_problema || null,
        Number(body.valor_pecas) || 0,
        Number(body.valor_servicos) || 0,
        Number(body.valor_total) || 0,
        body.observacoes || null,
        authContext.userId,
        body.city_id || null,
        body.locatario || null
      );

      const osId = osResult[0]?.id;
      if (!osId) {
        throw new Error('Falha ao criar ordem de serviço');
      }

      // Inserir serviços
      if (body.servicos && body.servicos.length > 0) {
        for (const s of body.servicos) {
          await prisma.$queryRawUnsafe(
            `INSERT INTO ordens_servico_servicos (id, ordem_servico_id, servico_id, quantidade, preco_unitario, observacoes)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::integer, $4::numeric, $5)`,
            osId, s.servico_id, Number(s.quantidade) || 1, Number(s.preco_unitario) || 0, s.observacoes || null
          );
        }
      }

      // Inserir peças e baixar estoque
      if (body.pecas && body.pecas.length > 0) {
        for (const p of body.pecas) {
          const qtd = Number(p.quantidade) || 1;
          await prisma.$queryRawUnsafe(
            `INSERT INTO ordens_servico_pecas (id, ordem_servico_id, peca_id, quantidade, preco_unitario)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::integer, $4::numeric)`,
            osId, p.peca_id, qtd, Number(p.preco_unitario) || 0
          );
          // Baixar estoque
          await prisma.$queryRawUnsafe(
            `UPDATE pecas SET estoque_atual = GREATEST(estoque_atual - $1, 0) WHERE id = $2::uuid`,
            qtd, p.peca_id
          );
        }
      }

      return reply.status(201).send({
        success: true,
        data: { id: osId, numero_os, message: 'Ordem de serviço criada com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao criar OS');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao criar ordem de serviço',
      });
    }
  });

  /**
   * GET /api/manutencoes/oficinas
   * Buscar oficinas ativas (filtrado por cidade)
   */
  app.get('/oficinas', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar oficinas ativas filtradas por cidade',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as { city_id?: string };

    const conditions: string[] = ['ativo = true'];
    const params: any[] = [];
    let paramIndex = 1;

    // Filtro de cidade
    const cityId = query.city_id || (context.role !== 'master_br' ? context.cityId : null);
    if (cityId) {
      conditions.push(`city_id = $${paramIndex++}::uuid`);
      params.push(cityId);
    }

    const oficinas = await prisma.$queryRawUnsafe<{ id: string; nome: string }[]>(
      `SELECT id::text, nome FROM oficinas WHERE ${conditions.join(' AND ')} ORDER BY nome`,
      ...params
    );

    return reply.status(200).send({
      success: true,
      data: oficinas,
    });
  });

  /**
   * GET /api/manutencoes/servicos-catalogo
   * Buscar catálogo de serviços disponíveis (filtrado por cidade)
   */
  app.get('/servicos-catalogo', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar catálogo de serviços disponíveis',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const { city_id } = request.query as { city_id?: string };

    let cityIdToUse = city_id;
    if (context.role !== 'master_br' && context.cityId) {
      cityIdToUse = context.cityId;
    }

    let servicos: any[];
    if (cityIdToUse) {
      servicos = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, nome, descricao, preco_base, ativo, city_id::text, created_at
         FROM servicos
         WHERE ativo = true AND city_id = $1::uuid
         ORDER BY nome`,
        cityIdToUse
      );
    } else {
      servicos = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, nome, descricao, preco_base, ativo, city_id::text, created_at
         FROM servicos
         WHERE ativo = true
         ORDER BY nome`
      );
    }

    return reply.status(200).send({ success: true, data: servicos });
  });

  /**
   * GET /api/manutencoes/pecas-catalogo
   * Buscar catálogo de peças disponíveis (filtrado por cidade)
   */
  app.get('/pecas-catalogo', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar catálogo de peças disponíveis',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const { city_id } = request.query as { city_id?: string };

    let cityIdToUse = city_id;
    if (context.role !== 'master_br' && context.cityId) {
      cityIdToUse = context.cityId;
    }

    let pecas: any[];
    if (cityIdToUse) {
      pecas = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, nome, descricao, preco_venda, preco_custo, estoque_atual, estoque_minimo, ativo, city_id::text, created_at
         FROM pecas
         WHERE ativo = true AND city_id = $1::uuid
         ORDER BY nome`,
        cityIdToUse
      );
    } else {
      pecas = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, nome, descricao, preco_venda, preco_custo, estoque_atual, estoque_minimo, ativo, city_id::text, created_at
         FROM pecas
         WHERE ativo = true
         ORDER BY nome`
      );
    }

    return reply.status(200).send({ success: true, data: pecas });
  });

  /**
   * GET /api/manutencoes/:id/servicos
   * Buscar serviços vinculados a uma OS (com nomes)
   */
  app.get('/:id/servicos', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar serviços de uma ordem de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const servicos = await prisma.$queryRawUnsafe<any[]>(
      `SELECT oss.id::text, oss.ordem_servico_id::text, oss.servico_id::text,
              oss.quantidade, oss.preco_unitario,
              s.nome as servico_nome
       FROM ordens_servico_servicos oss
       LEFT JOIN servicos s ON s.id = oss.servico_id
       WHERE oss.ordem_servico_id = $1::uuid
       ORDER BY s.nome`,
      id
    );

    return reply.status(200).send({
      success: true,
      data: servicos.map(s => ({
        id: s.id,
        servico_id: s.servico_id,
        nome: s.servico_nome || 'Serviço não encontrado',
        quantidade: Number(s.quantidade) || 1,
        preco_unitario: Number(s.preco_unitario) || 0,
      })),
    });
  });

  /**
   * GET /api/manutencoes/:id/pecas
   * Buscar peças vinculadas a uma OS (com nomes)
   */
  app.get('/:id/pecas', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar peças de uma ordem de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const pecas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT osp.id::text, osp.ordem_servico_id::text, osp.peca_id::text,
              osp.quantidade, osp.preco_unitario,
              p.nome as peca_nome
       FROM ordens_servico_pecas osp
       LEFT JOIN pecas p ON p.id = osp.peca_id
       WHERE osp.ordem_servico_id = $1::uuid
       ORDER BY p.nome`,
      id
    );

    return reply.status(200).send({
      success: true,
      data: pecas.map(p => ({
        id: p.id,
        peca_id: p.peca_id,
        nome: p.peca_nome || 'Peça não encontrada',
        quantidade: Number(p.quantidade) || 1,
        preco_unitario: Number(p.preco_unitario) || 0,
      })),
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
          select: { placa: true, modelo: true, franchisee_id: true },
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

    // Buscar nomes de oficina e profissional via raw query
    let oficinaNome: string | null = null;
    let profissionalNome: string | null = null;
    let oficinaCnpj: string | null = null;

    if (os.oficina_id) {
      const oficinas = await prisma.$queryRaw<{ nome: string; cnpj: string }[]>`
        SELECT nome, cnpj FROM oficinas WHERE id = ${os.oficina_id}::uuid LIMIT 1
      `;
      oficinaNome = oficinas[0]?.nome || null;
      oficinaCnpj = oficinas[0]?.cnpj || null;
    }

    if (os.profissional_id) {
      const profissionais = await prisma.$queryRaw<{ nome: string }[]>`
        SELECT nome FROM profissionais WHERE id = ${os.profissional_id}::uuid LIMIT 1
      `;
      profissionalNome = profissionais[0]?.nome || null;
    }

    // Buscar franqueado
    let franchiseeData: { company_name: string; whatsapp_01: string | null } | null = null;
    if (os.motorcycle?.franchisee_id) {
      const f = await prisma.franchisee.findUnique({
        where: { id: os.motorcycle.franchisee_id },
        select: { company_name: true, whatsapp_01: true },
      });
      if (f) franchiseeData = { company_name: f.company_name || '', whatsapp_01: f.whatsapp_01 };
    }

    // Buscar locatário e número de locação via rental (busca por placa para evitar problemas com múltiplos motorcycle_id)
    let locatarioNome = os.locatario || '';
    let numeroLocacao = '';
    if (os.motorcycle?.placa) {
      const rentals = await prisma.$queryRawUnsafe<{ id: string; client_name: string }[]>(
        `SELECT id::text, client_name FROM rentals
         WHERE motorcycle_plate = $1
         ORDER BY created_at DESC LIMIT 1`,
        os.motorcycle.placa
      );
      if (rentals[0]) {
        if (!locatarioNome && rentals[0].client_name) locatarioNome = rentals[0].client_name;
        // Buscar contract_number
        const contracts = await prisma.$queryRawUnsafe<{ contract_number: string }[]>(
          `SELECT contract_number FROM generated_contracts
           WHERE rental_id = $1::uuid
           ORDER BY created_at ASC LIMIT 1`,
          rentals[0].id
        );
        if (contracts[0]?.contract_number) numeroLocacao = contracts[0].contract_number;
      }
    }

    // Buscar campos de vistoria via raw SQL (não estão no modelo Prisma)
    const vistoriaRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT vistoria_1_antes, vistoria_1_depois,
              vistoria_2_antes, vistoria_2_depois,
              vistoria_3_antes, vistoria_3_depois,
              vistoria_4_antes, vistoria_4_depois,
              vistoria_5_antes, vistoria_5_depois
       FROM ordens_servico WHERE id = $1::uuid`,
      id
    );
    const vis = vistoriaRows[0] || {};

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
          servico_id: s.servico_id,
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
          peca_id: p.peca_id,
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
        motorcycle_id: os.motorcycle_id,
        oficina_id: os.oficina_id,
        profissional_id: os.profissional_id,
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
        oficina: oficinaNome ? { nome: oficinaNome, cnpj: oficinaCnpj } : null,
        profissional: profissionalNome ? { nome: profissionalNome } : null,
        franchisee: franchiseeData,
        locatario: locatarioNome || null,
        numero_locacao: numeroLocacao || null,
        servicos: servicosComNome,
        pecas: pecasComNome,
        vistoria_1_antes: vis.vistoria_1_antes || null,
        vistoria_1_depois: vis.vistoria_1_depois || null,
        vistoria_2_antes: vis.vistoria_2_antes || null,
        vistoria_2_depois: vis.vistoria_2_depois || null,
        vistoria_3_antes: vis.vistoria_3_antes || null,
        vistoria_3_depois: vis.vistoria_3_depois || null,
        vistoria_4_antes: vis.vistoria_4_antes || null,
        vistoria_4_depois: vis.vistoria_4_depois || null,
        vistoria_5_antes: vis.vistoria_5_antes || null,
        vistoria_5_depois: vis.vistoria_5_depois || null,
      },
    });
  });

  /**
   * POST /api/manutencoes/kpi/custo-pecas
   * Calcular custo total de peças para ordens de serviço (para KPI líquido)
   */
  app.post('/kpi/custo-pecas', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Calcular custo total de peças para ordens de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { ordem_ids } = request.body as { ordem_ids: string[] };

    if (!ordem_ids || ordem_ids.length === 0) {
      return reply.status(200).send({ success: true, data: { custoTotal: 0 } });
    }

    try {
      // Buscar peças das OS com preco_custo e preco_venda da tabela pecas
      const pecasOS = await prisma.$queryRawUnsafe<any[]>(
        `SELECT osp.ordem_servico_id::text, osp.peca_id::text, osp.quantidade, osp.preco_unitario,
                p.preco_custo, p.preco_venda
         FROM ordens_servico_pecas osp
         LEFT JOIN pecas p ON p.id = osp.peca_id
         WHERE osp.ordem_servico_id = ANY($1::uuid[])`,
        ordem_ids
      );

      let custoTotal = 0;

      if (pecasOS.length > 0) {
        custoTotal = pecasOS.reduce((acc: number, p: any) => {
          const quantidade = Number(p.quantidade) || 1;
          const precoCusto = Number(p.preco_custo) || 0;
          const precoVenda = Number(p.preco_venda) || 0;
          const precoUnitario = Number(p.preco_unitario) || 0;

          // Prioridade: preco_custo > 60% preco_venda > 60% preco_unitario
          let custoPeca = precoCusto;
          if (custoPeca === 0 && precoVenda > 0) {
            custoPeca = precoVenda * 0.6;
          }
          if (custoPeca === 0 && precoUnitario > 0) {
            custoPeca = precoUnitario * 0.6;
          }

          return acc + (quantidade * custoPeca);
        }, 0);
      }

      // Se não calculou custo pelas peças, estimar via valor_pecas/valor_total
      if (custoTotal === 0) {
        const ordensInfo = await prisma.$queryRawUnsafe<{ valor_pecas: string; valor_total: string }[]>(
          `SELECT valor_pecas, valor_total FROM ordens_servico WHERE id = ANY($1::uuid[])`,
          ordem_ids
        );

        custoTotal = ordensInfo.reduce((acc: number, o: any) => {
          const valorPecas = Number(o.valor_pecas) || 0;
          if (valorPecas > 0) return acc + valorPecas * 0.6;
          const valorTotal = Number(o.valor_total) || 0;
          return acc + valorTotal * 0.18;
        }, 0);
      }

      return reply.status(200).send({
        success: true,
        data: { custoTotal },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao calcular custo de peças');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao calcular custo de peças',
      });
    }
  });

  /**
   * PUT /api/manutencoes/:id
   * Atualizar uma ordem de serviço (com serviços e peças)
   */
  app.put('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar uma ordem de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    // Atualizar campos da OS
    const updateData: any = {};
    if (body.status !== undefined) updateData.status = body.status;
    if (body.data_previsao !== undefined) updateData.data_previsao = body.data_previsao ? new Date(body.data_previsao) : null;
    if (body.km_atual !== undefined) updateData.km_atual = body.km_atual ? parseInt(body.km_atual) : null;
    if (body.descricao_problema !== undefined) updateData.descricao_problema = body.descricao_problema;
    if (body.valor_servicos !== undefined) updateData.valor_servicos = body.valor_servicos;
    if (body.valor_pecas !== undefined) updateData.valor_pecas = body.valor_pecas;
    if (body.valor_total !== undefined) updateData.valor_total = body.valor_total;
    if (body.data_conclusao !== undefined) updateData.data_conclusao = body.data_conclusao ? new Date(body.data_conclusao) : null;

    // Se status = concluida, definir data_conclusao automaticamente
    if (body.status === 'concluida' && !body.data_conclusao) {
      updateData.data_conclusao = new Date();
    } else if (body.status && body.status !== 'concluida') {
      updateData.data_conclusao = null;
    }

    // Imagens de vistoria (não existem no modelo Prisma, atualizar via raw SQL)
    const vistoriaFieldNames = [
      'vistoria_1_antes', 'vistoria_1_depois',
      'vistoria_2_antes', 'vistoria_2_depois',
      'vistoria_3_antes', 'vistoria_3_depois',
      'vistoria_4_antes', 'vistoria_4_depois',
      'vistoria_5_antes', 'vistoria_5_depois',
    ];
    const vistoriaUpdates: Record<string, string> = {};
    for (const field of vistoriaFieldNames) {
      if (body[field] !== undefined) vistoriaUpdates[field] = body[field];
    }

    updateData.updated_at = new Date();

    try {
      const updated = await prisma.ordemServico.update({
        where: { id },
        data: updateData,
      });

      // Atualizar campos de vistoria via raw SQL (não estão no modelo Prisma)
      if (Object.keys(vistoriaUpdates).length > 0) {
        const setClauses: string[] = [];
        const params: any[] = [id];
        let paramIdx = 2;
        for (const [field, value] of Object.entries(vistoriaUpdates)) {
          setClauses.push(`${field} = $${paramIdx++}`);
          params.push(value);
        }
        await prisma.$queryRawUnsafe(
          `UPDATE ordens_servico SET ${setClauses.join(', ')} WHERE id = $1::uuid`,
          ...params
        );
      }

      // Atualizar serviços se fornecidos
      if (body.servicos !== undefined) {
        // Deletar existentes
        await prisma.$queryRawUnsafe(
          `DELETE FROM ordens_servico_servicos WHERE ordem_servico_id = $1::uuid`,
          id
        );
        // Inserir novos
        if (body.servicos && body.servicos.length > 0) {
          for (const s of body.servicos) {
            await prisma.$queryRawUnsafe(
              `INSERT INTO ordens_servico_servicos (id, ordem_servico_id, servico_id, quantidade, preco_unitario)
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::integer, $4::numeric)`,
              id, s.servico_id, Number(s.quantidade) || 1, Number(s.preco_unitario) || 0
            );
          }
        }
      }

      // Atualizar peças se fornecidas (com ajuste de estoque)
      if (body.pecas !== undefined) {
        // 1) Buscar peças antigas para devolver ao estoque
        const pecasAntigas = await prisma.$queryRawUnsafe<{ peca_id: string; quantidade: number }[]>(
          `SELECT peca_id::text, quantidade FROM ordens_servico_pecas WHERE ordem_servico_id = $1::uuid`,
          id
        );

        // 2) Devolver estoque das peças antigas
        for (const peca of pecasAntigas) {
          if (peca.peca_id) {
            await prisma.$queryRawUnsafe(
              `UPDATE pecas SET estoque_atual = estoque_atual + $1 WHERE id = $2::uuid`,
              Number(peca.quantidade), peca.peca_id
            );
          }
        }

        // 3) Deletar vínculos antigos
        await prisma.$queryRawUnsafe(
          `DELETE FROM ordens_servico_pecas WHERE ordem_servico_id = $1::uuid`,
          id
        );

        // 4) Inserir novas peças e baixar estoque
        if (body.pecas && body.pecas.length > 0) {
          for (const p of body.pecas) {
            const qtd = Number(p.quantidade) || 1;
            await prisma.$queryRawUnsafe(
              `INSERT INTO ordens_servico_pecas (id, ordem_servico_id, peca_id, quantidade, preco_unitario)
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::integer, $4::numeric)`,
              id, p.peca_id, qtd, Number(p.preco_unitario) || 0
            );
            // Baixar estoque da peça
            await prisma.$queryRawUnsafe(
              `UPDATE pecas SET estoque_atual = GREATEST(estoque_atual - $1, 0) WHERE id = $2::uuid`,
              qtd, p.peca_id
            );
          }
        }
      }

      return reply.status(200).send({
        success: true,
        data: { id: updated.id, message: 'Ordem de serviço atualizada com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar OS');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao atualizar ordem de serviço',
      });
    }
  });

  /**
   * DELETE /api/manutencoes/:id
   * Deletar uma ordem de serviço (devolver estoque de peças)
   */
  app.delete('/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar uma ordem de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      // Buscar peças usadas para devolver ao estoque
      const pecasUsadas = await prisma.$queryRawUnsafe<{ peca_id: string; quantidade: number }[]>(
        `SELECT peca_id::text, quantidade FROM ordens_servico_pecas WHERE ordem_servico_id = $1::uuid`,
        id
      );

      // Devolver peças ao estoque
      for (const peca of pecasUsadas) {
        if (peca.peca_id) {
          await prisma.$queryRawUnsafe(
            `UPDATE pecas SET estoque_atual = estoque_atual + $1 WHERE id = $2::uuid`,
            Number(peca.quantidade), peca.peca_id
          );
        }
      }

      // Deletar vínculos (cascade deve cuidar, mas por segurança)
      await prisma.$queryRawUnsafe(
        `DELETE FROM ordens_servico_servicos WHERE ordem_servico_id = $1::uuid`, id
      );
      await prisma.$queryRawUnsafe(
        `DELETE FROM ordens_servico_pecas WHERE ordem_servico_id = $1::uuid`, id
      );

      // Deletar a OS
      await prisma.ordemServico.delete({ where: { id } });

      return reply.status(200).send({
        success: true,
        data: { message: 'Ordem de serviço excluída com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao deletar OS');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao excluir ordem de serviço',
      });
    }
  });

  /**
   * PUT /api/manutencoes/agendamento/:id
   * Atualizar um agendamento IA (oficinas_agendamentos)
   */
  app.put('/agendamento/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar um agendamento IA',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    try {
      const sets: string[] = [];
      const params: any[] = [];
      let paramIdx = 1;

      if (body.status !== undefined) {
        sets.push(`status = $${paramIdx++}`);
        params.push(mapUIStatusToAgendamento(body.status));
      }
      if (body.tipo_manutencao !== undefined) {
        sets.push(`tipo_manutencao = $${paramIdx++}`);
        params.push(body.tipo_manutencao);
      }
      if (body.km_atual !== undefined) {
        sets.push(`km_atual = $${paramIdx++}`);
        params.push(body.km_atual ? parseInt(body.km_atual) : null);
      }
      if (body.data_hora !== undefined) {
        sets.push(`data_hora = $${paramIdx++}`);
        params.push(body.data_hora ? new Date(body.data_hora) : null);
      }
      if (body.observacoes !== undefined) {
        sets.push(`observacoes = $${paramIdx++}`);
        params.push(body.observacoes);
      }

      if (sets.length === 0) {
        return reply.status(400).send({ success: false, error: 'Nenhum campo para atualizar' });
      }

      params.push(id);
      await prisma.$queryRawUnsafe(
        `UPDATE oficinas_agendamentos SET ${sets.join(', ')} WHERE id = $${paramIdx}::uuid`,
        ...params
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Agendamento atualizado com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar agendamento');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao atualizar agendamento',
      });
    }
  });

  /**
   * DELETE /api/manutencoes/agendamento/:id
   * Deletar um agendamento IA
   */
  app.delete('/agendamento/:id', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Deletar um agendamento IA',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.$queryRawUnsafe(
        `DELETE FROM oficinas_agendamentos WHERE id = $1::uuid`,
        id
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Agendamento excluído com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao deletar agendamento');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao excluir agendamento',
      });
    }
  });

  /**
   * POST /api/manutencoes/converter-agendamento
   * Converter um agendamento IA em ordem de serviço completa
   */
  app.post('/converter-agendamento', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Converter um agendamento IA em ordem de serviço',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const body = request.body as any;

    try {
      // 1. Buscar moto pela placa
      const motos = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM motorcycles WHERE placa = $1 ORDER BY data_ultima_mov DESC NULLS LAST LIMIT 1`,
        body.placa
      );

      if (!motos[0]) {
        return reply.status(404).send({
          success: false,
          error: 'Moto não encontrada com a placa informada',
        });
      }

      // 2. Gerar número único para OS
      const timestamp = Date.now().toString().slice(-8);
      const numeroOS = `OS-${timestamp}`;

      // 3. Criar ordem de serviço
      const novaOS = await prisma.ordemServico.create({
        data: {
          numero_os: numeroOS,
          motorcycle_id: motos[0].id,
          oficina_id: body.oficina_id || null,
          profissional_id: body.profissional_id || null,
          data_abertura: body.data_abertura ? new Date(body.data_abertura) : new Date(),
          data_previsao: body.data_previsao ? new Date(body.data_previsao) : null,
          data_conclusao: body.data_conclusao ? new Date(body.data_conclusao) : null,
          status: body.status || 'aberta',
          tipo_manutencao: body.tipo_manutencao,
          km_atual: body.km_atual ? parseInt(body.km_atual) : null,
          descricao_problema: body.descricao_problema,
          valor_servicos: body.valor_servicos || 0,
          valor_pecas: body.valor_pecas || 0,
          valor_total: body.valor_total || 0,
          locatario: body.locatario || null,
          city_id: body.city_id || null,
        },
      });

      // 4. Inserir serviços
      if (body.servicos && body.servicos.length > 0) {
        for (const s of body.servicos) {
          await prisma.$queryRawUnsafe(
            `INSERT INTO ordens_servico_servicos (id, ordem_servico_id, servico_id, quantidade, preco_unitario)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::integer, $4::numeric)`,
            novaOS.id, s.servico_id, Number(s.quantidade) || 1, Number(s.preco_unitario) || 0
          );
        }
      }

      // 5. Inserir peças
      if (body.pecas && body.pecas.length > 0) {
        for (const p of body.pecas) {
          await prisma.$queryRawUnsafe(
            `INSERT INTO ordens_servico_pecas (id, ordem_servico_id, peca_id, quantidade, preco_unitario)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::integer, $4::numeric)`,
            novaOS.id, p.peca_id, Number(p.quantidade) || 1, Number(p.preco_unitario) || 0
          );
        }
      }

      // 6. Deletar agendamento original
      if (body.agendamento_id) {
        await prisma.$queryRawUnsafe(
          `DELETE FROM oficinas_agendamentos WHERE id = $1::uuid`,
          body.agendamento_id
        );
      }

      return reply.status(201).send({
        success: true,
        data: { id: novaOS.id, numero_os: numeroOS, message: 'Agendamento convertido em OS com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao converter agendamento');
      return reply.status(500).send({
        success: false,
        error: error.message || 'Erro ao converter agendamento em OS',
      });
    }
  });

  // ========================================
  // SUGESTÕES DE MANUTENÇÃO (Aceite do Franqueado)
  // ========================================

  /**
   * GET /api/manutencoes/sugestoes-pendentes
   * Buscar ordens de serviço pendentes de aceite pelo franqueado
   */
  app.get('/sugestoes-pendentes', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Buscar sugestões de manutenção pendentes para o franqueado',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);

    if (context.role !== 'franchisee' || !context.franchiseeId) {
      return reply.status(200).send({ success: true, data: [] });
    }

    // Buscar motos do franqueado
    const motos = await prisma.motorcycle.findMany({
      where: { franchisee_id: context.franchiseeId },
      select: { id: true, placa: true, modelo: true },
    });

    if (motos.length === 0) {
      return reply.status(200).send({ success: true, data: [] });
    }

    const motoIds = motos.map(m => m.id);
    const motoMap = new Map(motos.map(m => [m.id, { placa: m.placa, modelo: m.modelo }]));

    // Buscar ordens de serviço pendentes
    const ordens = await prisma.ordemServico.findMany({
      where: {
        motorcycle_id: { in: motoIds },
        OR: [
          { aceite_franqueado: null },
          { aceite_franqueado: 'pendente' },
        ],
      },
      orderBy: { data_abertura: 'desc' },
    });

    const result = ordens.map(os => {
      const motoInfo = os.motorcycle_id ? motoMap.get(os.motorcycle_id) : null;
      return {
        id: os.id,
        numero_os: os.numero_os,
        data_abertura: os.data_abertura?.toISOString() || null,
        data_previsao: os.data_previsao?.toISOString() || null,
        status: os.status,
        valor_total: os.valor_total ? Number(os.valor_total) : 0,
        descricao_problema: os.descricao_problema,
        tipo_manutencao: os.tipo_manutencao,
        motorcycle_id: os.motorcycle_id,
        placa: motoInfo?.placa || null,
        modelo: motoInfo?.modelo || null,
        franchisee_id: context.franchiseeId,
        aceite_franqueado: os.aceite_franqueado,
      };
    });

    return reply.status(200).send({ success: true, data: result });
  });

  /**
   * POST /api/manutencoes/:id/aceitar
   * Aceitar uma sugestão de manutenção e criar lançamento financeiro
   */
  app.post('/:id/aceitar', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Aceitar sugestão de manutenção e criar lançamento financeiro de saída',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const { id } = request.params as { id: string };
    const body = request.body as { observacao?: string } || {};

    if (context.role !== 'franchisee' || !context.franchiseeId) {
      return reply.status(403).send({ success: false, error: 'Apenas franqueados podem aceitar sugestões' });
    }

    // Buscar a ordem de serviço com moto
    const os = await prisma.ordemServico.findUnique({
      where: { id },
      include: {
        motorcycle: { select: { placa: true, modelo: true, franchisee_id: true } },
      },
    });

    if (!os) {
      return reply.status(404).send({ success: false, error: 'Ordem de serviço não encontrada' });
    }

    if (os.motorcycle?.franchisee_id !== context.franchiseeId) {
      return reply.status(403).send({ success: false, error: 'Esta ordem de serviço não pertence ao seu franqueado' });
    }

    if (os.aceite_franqueado === 'aceito') {
      return reply.status(400).send({ success: false, error: 'Esta ordem de serviço já foi aceita' });
    }

    // Buscar categoria "Manutenção"
    const categorias = await prisma.categoriaFinanceiro.findMany({
      where: { nome: 'Manutenção', ativo: true },
    });
    const categoriaManutencao = categorias.find(c => c.tipo === 'saida' || c.tipo === 'ambos');

    if (!categoriaManutencao) {
      return reply.status(400).send({ success: false, error: 'Categoria "Manutenção" não encontrada' });
    }

    // Criar lançamento financeiro de saída
    const lancamento = await prisma.financeiro.create({
      data: {
        franchisee_id: context.franchiseeId,
        tipo: 'saida',
        placa: os.motorcycle?.placa || null,
        categoria_id: categoriaManutencao.id,
        valor: os.valor_total ? Number(os.valor_total) : 0,
        data: os.data_abertura ? new Date(os.data_abertura.toISOString().split('T')[0]) : new Date(),
        descricao: `Manutenção OS ${os.numero_os}: ${os.motorcycle?.modelo || os.motorcycle?.placa || ''}${body.observacao ? ` - ${body.observacao}` : ''}`,
        pago: true,
        created_by: context.userId,
      },
    });

    // Atualizar ordem de serviço como aceita
    await prisma.ordemServico.update({
      where: { id },
      data: {
        aceite_franqueado: 'aceito',
        aceite_data: new Date(),
        financeiro_id: lancamento.id,
        aceite_observacao: body.observacao || null,
      },
    });

    return reply.status(200).send({
      success: true,
      data: { message: 'Sugestão aceita e lançamento financeiro criado', financeiro_id: lancamento.id },
    });
  });

  /**
   * POST /api/manutencoes/:id/recusar
   * Recusar uma sugestão de manutenção
   */
  app.post('/:id/recusar', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Recusar sugestão de manutenção',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const { id } = request.params as { id: string };
    const body = request.body as { observacao?: string } || {};

    if (context.role !== 'franchisee' || !context.franchiseeId) {
      return reply.status(403).send({ success: false, error: 'Apenas franqueados podem recusar sugestões' });
    }

    // Buscar a ordem de serviço com moto
    const os = await prisma.ordemServico.findUnique({
      where: { id },
      include: {
        motorcycle: { select: { franchisee_id: true } },
      },
    });

    if (!os) {
      return reply.status(404).send({ success: false, error: 'Ordem de serviço não encontrada' });
    }

    if (os.motorcycle?.franchisee_id !== context.franchiseeId) {
      return reply.status(403).send({ success: false, error: 'Esta ordem de serviço não pertence ao seu franqueado' });
    }

    // Atualizar ordem de serviço como recusada
    await prisma.ordemServico.update({
      where: { id },
      data: {
        aceite_franqueado: 'recusado',
        aceite_data: new Date(),
        aceite_observacao: body.observacao || null,
      },
    });

    return reply.status(200).send({
      success: true,
      data: { message: 'Sugestão recusada com sucesso' },
    });
  });

  /**
   * GET /api/manutencoes/sugestoes-pendentes/count
   * Contar sugestões pendentes (para badge/notificação)
   */
  app.get('/sugestoes-pendentes/count', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Contar sugestões de manutenção pendentes',
      tags: ['Manutenções'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const context = getContext(request);

    if (context.role !== 'franchisee' || !context.franchiseeId) {
      return reply.status(200).send({ success: true, data: { count: 0 } });
    }

    const motos = await prisma.motorcycle.findMany({
      where: { franchisee_id: context.franchiseeId },
      select: { id: true },
    });

    if (motos.length === 0) {
      return reply.status(200).send({ success: true, data: { count: 0 } });
    }

    const motoIds = motos.map(m => m.id);

    const count = await prisma.ordemServico.count({
      where: {
        motorcycle_id: { in: motoIds },
        OR: [
          { aceite_franqueado: null },
          { aceite_franqueado: 'pendente' },
        ],
      },
    });

    return reply.status(200).send({ success: true, data: { count } });
  });
};

export default manutencoesRoutes;
