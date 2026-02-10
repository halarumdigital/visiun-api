import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';

const estoqueRoutes: FastifyPluginAsync = async (app) => {

  // ========================================
  // CONSUMO POR PERÍODO
  // ========================================

  /**
   * GET /api/estoque/consumo
   * Retorna consumo de peças agrupado por peça, em um período de OS concluídas
   */
  app.get('/consumo', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Consumo de peças por período',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          data_inicio: { type: 'string' },
          data_fim: { type: 'string' },
          city_id: { type: 'string' },
          categoria: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as {
      data_inicio?: string;
      data_fim?: string;
      city_id?: string;
      categoria?: string;
    };

    try {
      const conditions: string[] = [
        "os.status = 'concluida'",
      ];
      const params: any[] = [];
      let paramIndex = 1;

      // Date range
      if (query.data_inicio) {
        conditions.push(`os.data_abertura >= $${paramIndex++}::timestamptz`);
        params.push(query.data_inicio + 'T00:00:00.000Z');
      }
      if (query.data_fim) {
        conditions.push(`os.data_abertura <= $${paramIndex++}::timestamptz`);
        params.push(query.data_fim + 'T23:59:59.999Z');
      }

      // City filter
      if (context.role === 'master_br' && query.city_id) {
        conditions.push(`os.city_id = $${paramIndex++}::uuid`);
        params.push(query.city_id);
      } else if (context.role !== 'master_br' && context.cityId) {
        conditions.push(`os.city_id = $${paramIndex++}::uuid`);
        params.push(context.cityId);
      }

      // Category filter
      if (query.categoria) {
        conditions.push(`p.categoria = $${paramIndex++}`);
        params.push(query.categoria);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const itens = await prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id::text as peca_id, p.codigo as peca_codigo, p.nome as peca_nome,
                p.categoria, p.unidade_medida,
                COALESCE(p.preco_custo, 0)::float as preco_custo,
                COALESCE(p.preco_venda, 0)::float as preco_venda,
                SUM(osp.quantidade)::float as quantidade_consumida,
                SUM(osp.quantidade * osp.preco_unitario)::float as valor_total
         FROM ordens_servico_pecas osp
         JOIN ordens_servico os ON os.id = osp.ordem_servico_id
         JOIN pecas p ON p.id = osp.peca_id
         ${whereClause}
         GROUP BY p.id, p.codigo, p.nome, p.categoria, p.unidade_medida, p.preco_custo, p.preco_venda
         ORDER BY SUM(osp.quantidade) DESC`,
        ...params
      );

      // Calculate derived fields
      const mapped = itens.map(item => {
        const quantidade = Number(item.quantidade_consumida) || 0;
        const valorTotal = Number(item.valor_total) || 0;
        const precoCusto = Number(item.preco_custo) || 0;
        const valorUnitMedio = quantidade > 0 ? valorTotal / quantidade : 0;
        const custoTotal = quantidade * precoCusto;
        const margemTotal = valorTotal - custoTotal;

        return {
          peca_id: item.peca_id,
          peca_codigo: item.peca_codigo || '',
          peca_nome: item.peca_nome || '',
          categoria: item.categoria || '',
          unidade_medida: item.unidade_medida || 'UN',
          quantidade_consumida: quantidade,
          valor_unitario_medio: valorUnitMedio,
          valor_total: valorTotal,
          preco_custo_medio: precoCusto,
          custo_total: custoTotal,
          margem_total: margemTotal,
        };
      });

      // Totals
      const totais = mapped.reduce(
        (acc, item) => ({
          quantidade_total: acc.quantidade_total + item.quantidade_consumida,
          valor_total: acc.valor_total + item.valor_total,
          custo_total: acc.custo_total + item.custo_total,
          margem_total: acc.margem_total + item.margem_total,
        }),
        { quantidade_total: 0, valor_total: 0, custo_total: 0, margem_total: 0 }
      );

      return reply.status(200).send({
        success: true,
        data: {
          itens: mapped,
          totais,
          periodo: { data_inicio: query.data_inicio, data_fim: query.data_fim },
        },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar consumo de estoque');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ========================================
  // HISTÓRICO DE GIRO MENSAL
  // ========================================

  /**
   * GET /api/estoque/giro
   * Retorna histórico de consumo mensal por peça
   */
  app.get('/giro', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Histórico de giro mensal de peças',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
          meses: { type: 'string' },
          data_inicio: { type: 'string' },
          data_fim: { type: 'string' },
          peca_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as {
      city_id?: string;
      meses?: string;
      data_inicio?: string;
      data_fim?: string;
      peca_id?: string;
    };

    try {
      const meses = parseInt(query.meses || '12') || 12;

      const conditions: string[] = ["os.status = 'concluida'"];
      const params: any[] = [];
      let paramIndex = 1;

      // Date range
      if (query.data_inicio && query.data_fim) {
        conditions.push(`os.data_abertura >= $${paramIndex++}::timestamptz`);
        params.push(query.data_inicio + 'T00:00:00.000Z');
        conditions.push(`os.data_abertura <= $${paramIndex++}::timestamptz`);
        params.push(query.data_fim + 'T23:59:59.999Z');
      } else {
        const dataInicio = new Date();
        dataInicio.setMonth(dataInicio.getMonth() - meses);
        conditions.push(`os.data_abertura >= $${paramIndex++}::timestamptz`);
        params.push(dataInicio.toISOString());
      }

      // City filter
      if (context.role === 'master_br' && query.city_id) {
        conditions.push(`os.city_id = $${paramIndex++}::uuid`);
        params.push(query.city_id);
      } else if (context.role !== 'master_br' && context.cityId) {
        conditions.push(`os.city_id = $${paramIndex++}::uuid`);
        params.push(context.cityId);
      }

      // Peca filter
      if (query.peca_id) {
        conditions.push(`osp.peca_id = $${paramIndex++}::uuid`);
        params.push(query.peca_id);
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Single query: get monthly consumption grouped by peca and month
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id::text as peca_id, p.nome as peca_nome,
                to_char(os.data_abertura, 'YYYY-MM') || '-01' as mes,
                SUM(osp.quantidade)::float as quantidade_consumida,
                SUM(osp.quantidade * osp.preco_unitario)::float as valor_total
         FROM ordens_servico_pecas osp
         JOIN ordens_servico os ON os.id = osp.ordem_servico_id
         JOIN pecas p ON p.id = osp.peca_id
         ${whereClause}
         GROUP BY p.id, p.nome, to_char(os.data_abertura, 'YYYY-MM')
         ORDER BY p.nome, mes`,
        ...params
      );

      // Group by peca
      const pecaMap = new Map<string, { peca_nome: string; historico: any[] }>();
      rows.forEach(row => {
        if (!pecaMap.has(row.peca_id)) {
          pecaMap.set(row.peca_id, { peca_nome: row.peca_nome || '', historico: [] });
        }
        pecaMap.get(row.peca_id)!.historico.push({
          peca_id: row.peca_id,
          peca_nome: row.peca_nome || '',
          mes: row.mes,
          quantidade_consumida: Number(row.quantidade_consumida) || 0,
          valor_total: Number(row.valor_total) || 0,
        });
      });

      // Build result with stats
      const resultado = Array.from(pecaMap.entries()).map(([pecaId, data]) => {
        const historico = data.historico;
        const totalQuantidade = historico.reduce((sum: number, h: any) => sum + h.quantidade_consumida, 0);
        const mediaMensal = meses > 0 ? totalQuantidade / meses : 0;

        let tendencia: 'crescente' | 'decrescente' | 'estavel' = 'estavel';
        let variacao_percentual = 0;

        if (historico.length >= 2) {
          const ultimoMes = historico[historico.length - 1]?.quantidade_consumida || 0;
          const penultimoMes = historico[historico.length - 2]?.quantidade_consumida || 0;

          if (penultimoMes > 0) {
            variacao_percentual = ((ultimoMes - penultimoMes) / penultimoMes) * 100;
          }

          if (historico.length >= 3) {
            const ultimos3 = historico.slice(-3).map((h: any) => h.quantidade_consumida);
            const crescendo = ultimos3[0] <= ultimos3[1] && ultimos3[1] <= ultimos3[2];
            const decrescendo = ultimos3[0] >= ultimos3[1] && ultimos3[1] >= ultimos3[2];

            if (crescendo && variacao_percentual > 10) tendencia = 'crescente';
            else if (decrescendo && variacao_percentual < -10) tendencia = 'decrescente';
          }
        }

        return {
          peca_id: pecaId,
          peca_nome: data.peca_nome,
          historico,
          media_mensal: Math.round(mediaMensal * 100) / 100,
          tendencia,
          variacao_percentual: Math.round(variacao_percentual * 10) / 10,
        };
      });

      return reply.status(200).send({ success: true, data: resultado });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar histórico de giro');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ========================================
  // COBERTURA DE ESTOQUE
  // ========================================

  /**
   * GET /api/estoque/cobertura
   * Retorna análise de cobertura de estoque
   */
  app.get('/cobertura', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Análise de cobertura de estoque',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
          meses_base: { type: 'string' },
          data_inicio: { type: 'string' },
          data_fim: { type: 'string' },
          status: { type: 'string' },
          categoria: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as {
      city_id?: string;
      meses_base?: string;
      data_inicio?: string;
      data_fim?: string;
      status?: string;
      categoria?: string;
    };

    try {
      // Determine city filter
      let cityId: string | null = null;
      if (context.role === 'master_br' && query.city_id) {
        cityId = query.city_id;
      } else if (context.role !== 'master_br' && context.cityId) {
        cityId = context.cityId;
      }

      // Determine period
      let dataInicioStr: string;
      let dataFimStr: string;
      let mesesBase: number;

      if (query.data_inicio && query.data_fim) {
        dataInicioStr = query.data_inicio;
        dataFimStr = query.data_fim;
        const inicio = new Date(query.data_inicio);
        const fim = new Date(query.data_fim);
        const diffMs = fim.getTime() - inicio.getTime();
        const diffDias = diffMs / (1000 * 60 * 60 * 24);
        mesesBase = Math.max(1, Math.round(diffDias / 30));
      } else {
        mesesBase = parseInt(query.meses_base || '6') || 6;
        const dataInicio = new Date();
        dataInicio.setMonth(dataInicio.getMonth() - mesesBase);
        dataInicioStr = dataInicio.toISOString().split('T')[0];
        dataFimStr = new Date().toISOString().split('T')[0];
      }

      // 1) Get all active pecas
      const pecaConditions: string[] = ['ativo = true'];
      const pecaParams: any[] = [];
      let pecaParamIdx = 1;

      if (cityId) {
        pecaConditions.push(`city_id = $${pecaParamIdx++}::uuid`);
        pecaParams.push(cityId);
      }

      const pecas = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, codigo, nome, categoria, unidade_medida,
                COALESCE(estoque_atual, 0)::int as estoque_atual,
                COALESCE(estoque_minimo, 0)::int as estoque_minimo,
                COALESCE(preco_custo, 0)::float as preco_custo,
                COALESCE(preco_venda, 0)::float as preco_venda
         FROM pecas
         WHERE ${pecaConditions.join(' AND ')}`,
        ...pecaParams
      );

      if (pecas.length === 0) {
        return reply.status(200).send({
          success: true,
          data: {
            itens: [],
            resumo: {
              total_itens: 0, itens_criticos: 0, itens_atencao: 0,
              itens_ok: 0, itens_sem_consumo: 0, valor_total_estoque: 0,
            },
          },
        });
      }

      // 2) Get consumption per peca in the period
      const consumoConditions: string[] = [
        "os.status = 'concluida'",
        `os.data_abertura >= $1::date`,
        `os.data_abertura <= $2::date`,
      ];
      const consumoParams: any[] = [dataInicioStr, dataFimStr];
      let consumoParamIdx = 3;

      if (cityId) {
        consumoConditions.push(`os.city_id = $${consumoParamIdx++}::uuid`);
        consumoParams.push(cityId);
      }

      const consumoRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT osp.peca_id::text, SUM(osp.quantidade)::float as total_consumido
         FROM ordens_servico_pecas osp
         JOIN ordens_servico os ON os.id = osp.ordem_servico_id
         WHERE ${consumoConditions.join(' AND ')}
         GROUP BY osp.peca_id`,
        ...consumoParams
      );

      const consumoPorPeca = new Map<string, number>();
      consumoRows.forEach(r => {
        consumoPorPeca.set(r.peca_id, Number(r.total_consumido) || 0);
      });

      // 3) Calculate coverage
      const diasNoPeriodo = mesesBase * 30;
      const semanasNoPeriodo = mesesBase * 4.33;

      let itens = pecas.map(peca => {
        const consumoTotal = consumoPorPeca.get(peca.id) || 0;
        const mediaMensal = mesesBase > 0 ? consumoTotal / mesesBase : 0;
        const mediaSemanal = semanasNoPeriodo > 0 ? consumoTotal / semanasNoPeriodo : 0;
        const mediaDiaria = diasNoPeriodo > 0 ? consumoTotal / diasNoPeriodo : 0;
        const estoqueAtual = Number(peca.estoque_atual) || 0;

        const coberturaDias = mediaDiaria > 0 ? estoqueAtual / mediaDiaria : null;
        const coberturaMeses = mediaMensal > 0 ? estoqueAtual / mediaMensal : null;

        let statusCobertura = 'sem_consumo';
        if (mediaDiaria > 0) {
          if (coberturaDias !== null && coberturaDias < 30) statusCobertura = 'critico';
          else if (coberturaDias !== null && coberturaDias < 60) statusCobertura = 'atencao';
          else statusCobertura = 'ok';
        }

        const valorEstoque = estoqueAtual * (Number(peca.preco_custo) || Number(peca.preco_venda) || 0);

        return {
          peca_id: peca.id,
          peca_codigo: peca.codigo || '',
          peca_nome: peca.nome || '',
          categoria: peca.categoria || '',
          unidade_medida: peca.unidade_medida || 'UN',
          estoque_atual: estoqueAtual,
          estoque_minimo: Number(peca.estoque_minimo) || 0,
          media_consumo_diaria: Math.round(mediaDiaria * 100) / 100,
          media_consumo_semanal: Math.round(mediaSemanal * 100) / 100,
          media_consumo_mensal: Math.round(mediaMensal * 100) / 100,
          cobertura_dias: coberturaDias !== null ? Math.round(coberturaDias) : null,
          cobertura_meses: coberturaMeses !== null ? Math.round(coberturaMeses * 10) / 10 : null,
          status_cobertura: statusCobertura,
          valor_estoque: valorEstoque,
        };
      });

      // Filter by status
      if (query.status && query.status !== 'todos') {
        itens = itens.filter(i => i.status_cobertura === query.status);
      }

      // Filter by category
      if (query.categoria) {
        itens = itens.filter(i => i.categoria === query.categoria);
      }

      // Sort: criticos first
      const statusOrdem: Record<string, number> = { critico: 1, atencao: 2, ok: 3, sem_consumo: 4 };
      itens.sort((a, b) => {
        const diff = (statusOrdem[a.status_cobertura] || 5) - (statusOrdem[b.status_cobertura] || 5);
        if (diff !== 0) return diff;
        return (a.cobertura_dias || 9999) - (b.cobertura_dias || 9999);
      });

      const resumo = {
        total_itens: itens.length,
        itens_criticos: itens.filter(i => i.status_cobertura === 'critico').length,
        itens_atencao: itens.filter(i => i.status_cobertura === 'atencao').length,
        itens_ok: itens.filter(i => i.status_cobertura === 'ok').length,
        itens_sem_consumo: itens.filter(i => i.status_cobertura === 'sem_consumo').length,
        valor_total_estoque: itens.reduce((sum, i) => sum + i.valor_estoque, 0),
      };

      return reply.status(200).send({ success: true, data: { itens, resumo } });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar cobertura de estoque');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ========================================
  // SUGESTÃO DE COMPRA
  // ========================================

  /**
   * GET /api/estoque/sugestao-compra
   * Retorna sugestões de compra baseadas no consumo histórico
   */
  app.get('/sugestao-compra', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Sugestão de compra de peças',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string' },
          meses_cobertura: { type: 'string' },
          meses_base: { type: 'string' },
          prioridade: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const context = getContext(request);
    const query = request.query as {
      city_id?: string;
      meses_cobertura?: string;
      meses_base?: string;
      prioridade?: string;
    };

    try {
      const mesesCobertura = parseInt(query.meses_cobertura || '2') || 2;
      const mesesBase = parseInt(query.meses_base || '6') || 6;

      let cityId: string | null = null;
      if (context.role === 'master_br' && query.city_id) {
        cityId = query.city_id;
      } else if (context.role !== 'master_br' && context.cityId) {
        cityId = context.cityId;
      }

      // Get all active pecas with fornecedor info
      const pecaConditions: string[] = ['p.ativo = true'];
      const pecaParams: any[] = [];
      let pecaParamIdx = 1;

      if (cityId) {
        pecaConditions.push(`p.city_id = $${pecaParamIdx++}::uuid`);
        pecaParams.push(cityId);
      }

      const pecas = await prisma.$queryRawUnsafe<any[]>(
        `SELECT p.id::text, p.codigo, p.nome, p.categoria, p.unidade_medida,
                COALESCE(p.estoque_atual, 0)::int as estoque_atual,
                COALESCE(p.estoque_minimo, 0)::int as estoque_minimo,
                COALESCE(p.preco_custo, 0)::float as preco_custo,
                COALESCE(p.preco_venda, 0)::float as preco_venda,
                p.fornecedor_id::text,
                f.nome as fornecedor_nome
         FROM pecas p
         LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
         WHERE ${pecaConditions.join(' AND ')}`,
        ...pecaParams
      );

      if (pecas.length === 0) {
        return reply.status(200).send({
          success: true,
          data: {
            itens: [],
            totais: { quantidade_total: 0, valor_total_estimado: 0, itens_urgentes: 0, itens_alta_prioridade: 0 },
            parametros: { meses_cobertura: mesesCobertura, meses_base: mesesBase },
          },
        });
      }

      // Get consumption in base period
      const dataInicio = new Date();
      dataInicio.setMonth(dataInicio.getMonth() - mesesBase);

      const consumoConditions: string[] = [
        "os.status = 'concluida'",
        `os.data_abertura >= $1::timestamptz`,
      ];
      const consumoParams: any[] = [dataInicio.toISOString()];
      let consumoParamIdx = 2;

      if (cityId) {
        consumoConditions.push(`os.city_id = $${consumoParamIdx++}::uuid`);
        consumoParams.push(cityId);
      }

      const consumoRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT osp.peca_id::text, SUM(osp.quantidade)::float as total_consumido
         FROM ordens_servico_pecas osp
         JOIN ordens_servico os ON os.id = osp.ordem_servico_id
         WHERE ${consumoConditions.join(' AND ')}
         GROUP BY osp.peca_id`,
        ...consumoParams
      );

      const consumoPorPeca = new Map<string, number>();
      consumoRows.forEach(r => {
        consumoPorPeca.set(r.peca_id, Number(r.total_consumido) || 0);
      });

      // Calculate suggestions
      const diasNoPeriodo = mesesBase * 30;
      let itens = pecas.map(peca => {
        const consumoTotal = consumoPorPeca.get(peca.id) || 0;
        const mediaMensal = mesesBase > 0 ? consumoTotal / mesesBase : 0;
        const mediaDiaria = diasNoPeriodo > 0 ? consumoTotal / diasNoPeriodo : 0;
        const estoqueAtual = Number(peca.estoque_atual) || 0;
        const coberturaMeses = mediaMensal > 0 ? estoqueAtual / mediaMensal : null;

        const quantidadeNecessaria = mediaMensal * mesesCobertura;
        const quantidadeSugerida = Math.max(Math.ceil(quantidadeNecessaria - estoqueAtual), 0);
        const precoCusto = Number(peca.preco_custo) || 0;
        const valorEstimado = quantidadeSugerida * precoCusto;

        let prioridade: string = 'baixa';
        if (mediaMensal > 0 && coberturaMeses !== null) {
          if (coberturaMeses < 1) prioridade = 'urgente';
          else if (coberturaMeses < 2) prioridade = 'alta';
          else if (quantidadeSugerida > 0) prioridade = 'normal';
        }

        return {
          peca_id: peca.id,
          peca_codigo: peca.codigo || '',
          peca_nome: peca.nome || '',
          categoria: peca.categoria || '',
          unidade_medida: peca.unidade_medida || 'UN',
          fornecedor_nome: peca.fornecedor_nome || null,
          estoque_atual: estoqueAtual,
          media_consumo_mensal: Math.round(mediaMensal * 100) / 100,
          cobertura_atual_meses: coberturaMeses !== null ? Math.round(coberturaMeses * 10) / 10 : null,
          quantidade_sugerida: quantidadeSugerida,
          preco_custo_unitario: precoCusto,
          valor_estimado_compra: valorEstimado,
          prioridade,
        };
      }).filter(item => item.quantidade_sugerida > 0 || item.prioridade === 'urgente' || item.prioridade === 'alta');

      // Filter by priority
      if (query.prioridade && query.prioridade !== 'todas') {
        itens = itens.filter(i => i.prioridade === query.prioridade);
      }

      // Sort by priority
      const ordemPrioridade: Record<string, number> = { urgente: 1, alta: 2, normal: 3, baixa: 4 };
      itens.sort((a, b) => {
        const diff = (ordemPrioridade[a.prioridade] || 5) - (ordemPrioridade[b.prioridade] || 5);
        if (diff !== 0) return diff;
        return b.quantidade_sugerida - a.quantidade_sugerida;
      });

      const totais = {
        quantidade_total: itens.reduce((sum, i) => sum + i.quantidade_sugerida, 0),
        valor_total_estimado: itens.reduce((sum, i) => sum + i.valor_estimado_compra, 0),
        itens_urgentes: itens.filter(i => i.prioridade === 'urgente').length,
        itens_alta_prioridade: itens.filter(i => i.prioridade === 'alta').length,
      };

      return reply.status(200).send({
        success: true,
        data: {
          itens,
          totais,
          parametros: { meses_cobertura: mesesCobertura, meses_base: mesesBase },
        },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar sugestão de compra');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ========================================
  // CATEGORIAS E FORNECEDORES (para filtros)
  // ========================================

  /**
   * GET /api/estoque/categorias
   * Retorna categorias únicas de peças ativas
   */
  app.get('/categorias', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Categorias de peças',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    try {
      const rows = await prisma.$queryRawUnsafe<{ categoria: string }[]>(
        `SELECT DISTINCT categoria FROM pecas WHERE ativo = true AND categoria IS NOT NULL AND categoria != '' ORDER BY categoria`
      );

      const categorias = rows.map(r => r.categoria);
      return reply.status(200).send({ success: true, data: categorias });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar categorias');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/estoque/fornecedores
   * Retorna fornecedores ativos
   */
  app.get('/fornecedores', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Fornecedores ativos',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    try {
      const fornecedores = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, nome FROM fornecedores WHERE ativo = true ORDER BY nome`
      );

      return reply.status(200).send({ success: true, data: fornecedores });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao buscar fornecedores');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // ========================================
  // CONFIGURAÇÕES DE ESTOQUE
  // ========================================

  /**
   * PUT /api/estoque/pecas/:id/estoque-minimo
   * Atualizar estoque mínimo de uma peça
   */
  app.put('/pecas/:id/estoque-minimo', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Atualizar estoque mínimo de uma peça',
      tags: ['Estoque'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { estoque_minimo: number };

    try {
      await prisma.$queryRawUnsafe(
        `UPDATE pecas SET estoque_minimo = $1::integer WHERE id = $2::uuid`,
        Math.round(body.estoque_minimo || 0),
        id
      );

      return reply.status(200).send({
        success: true,
        data: { message: 'Estoque mínimo atualizado com sucesso' },
      });
    } catch (error: any) {
      app.log.error({ err: error }, 'Erro ao atualizar estoque mínimo');
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
};

export default estoqueRoutes;
