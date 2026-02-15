import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rbac } from '../middleware/rbac.js';
import { getContext } from '../utils/context.js';
import { logger } from '../utils/logger.js';

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /api/dashboard/gestao-avista
   * Endpoint unificado que retorna TODOS os dados do dashboard Gestão à Vista
   * Usa views SQL pré-agregadas ao invés de retornar dados brutos
   */
  app.get('/gestao-avista', {
    preHandler: [authMiddleware, rbac()],
    schema: {
      description: 'Dados consolidados da Gestão à Vista',
      tags: ['Dashboard'],
      querystring: {
        type: 'object',
        properties: {
          city_id: { type: 'string', description: 'Filtrar por cidade (master_br)' },
        },
      },
    },
  }, async (request, reply) => {
    const startTime = Date.now();
    const context = getContext(request);
    const { city_id } = request.query as { city_id?: string };

    // Determinar filtro de cidade efetivo
    let effectiveCityId: string | undefined;
    if (context.role === 'master_br' && city_id) {
      effectiveCityId = city_id;
    } else if (context.role === 'regional' && context.cityId) {
      effectiveCityId = context.cityId;
    }

    // Determinar filtro de franqueado
    const franchiseeId = context.role === 'franchisee' ? context.franchiseeId : undefined;

    try {
      // Construir WHERE clauses dinâmicas para as views
      const cityWhereSQL = effectiveCityId ? `WHERE city_id = '${effectiveCityId}'` : '';
      const cityAndSQL = effectiveCityId ? `AND city_id = '${effectiveCityId}'` : '';
      const franchiseeWhereSQL = franchiseeId ? `WHERE franchisee_id = '${franchiseeId}'` : '';
      const franchiseeAndSQL = franchiseeId ? `AND franchisee_id = '${franchiseeId}'` : '';

      // Combinar filtro: franchisee tem prioridade, senão city
      const filterWhereSQL = franchiseeId
        ? `WHERE franchisee_id = '${franchiseeId}'`
        : effectiveCityId
          ? `WHERE city_id = '${effectiveCityId}'`
          : '';
      const filterAndSQL = franchiseeId
        ? `AND franchisee_id = '${franchiseeId}'`
        : effectiveCityId
          ? `AND city_id = '${effectiveCityId}'`
          : '';

      // ============================================================
      // EXECUTAR TODAS AS QUERIES EM PARALELO (views pré-agregadas)
      // ============================================================
      const [
        kpisResult,
        franqueadosRevenueResult,
        topConsultoresResult,
        manutencoesDiariasResult,
        movimentosHojeResult,
        distribuicaoCidadesResult,
        rankingFranqueadosResult,
        crescimentoFrotaResult,
        manutencoesHojeResult,
        receitaMensalResult,
        statusFrotaResult,
        mapaLocacoesResult,
      ] = await Promise.all([
        // 1. KPIs globais
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            COALESCE(SUM(total_operacional), 0)::int AS frota_total,
            COALESCE(SUM(alugadas + renegociadas), 0)::int AS locacoes_ativas,
            COALESCE(SUM(disponiveis), 0)::int AS disponiveis,
            COALESCE(SUM(em_manutencao), 0)::int AS em_manutencao,
            COALESCE(SUM(recolhidas), 0)::int AS recolhidas,
            COALESCE(SUM(ociosas_30d), 0)::int AS ociosas_30d,
            COALESCE(SUM(receita_semanal), 0)::numeric AS receita_semanal_total,
            ROUND(
              CASE WHEN COALESCE(SUM(total_operacional), 0) > 0
              THEN (SUM(alugadas) + SUM(renegociadas))::numeric / SUM(total_operacional)::numeric * 100
              ELSE 0 END, 2
            ) AS taxa_ocupacao_global,
            ROUND(
              CASE WHEN COALESCE(SUM(total_operacional), 0) > 0
              THEN SUM(em_manutencao)::numeric / SUM(total_operacional)::numeric * 100
              ELSE 0 END, 2
            ) AS taxa_manutencao_global,
            ROUND(
              CASE WHEN COALESCE(SUM(total_operacional), 0) > 0
              THEN SUM(ociosas_30d)::numeric / SUM(total_operacional)::numeric * 100
              ELSE 0 END, 2
            ) AS taxa_ociosidade_global,
            COUNT(*) FILTER (WHERE total_operacional > 0)::int AS franqueados_ativos
          FROM vw_fleet_stats_by_franchisee
          ${filterWhereSQL}
        `),

        // 2. Receita por franqueado
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            franchisee_id,
            franqueado_name,
            city_id,
            total_operacional::int AS motorcycle_count,
            alugadas::int,
            em_manutencao::int AS maintenance_count,
            ociosas_30d::int,
            taxa_ocupacao::numeric AS occupation_rate,
            taxa_manutencao::numeric AS maintenance_rate,
            taxa_ociosidade::numeric AS idle_rate,
            receita_semanal::numeric AS weekly_revenue,
            ROUND(receita_semanal * 4.33, 2)::numeric AS projected_monthly_revenue
          FROM vw_fleet_stats_by_franchisee
          WHERE total_operacional > 0
          ${filterAndSQL}
          ORDER BY receita_semanal DESC
        `),

        // 3. Top consultores do mês
        prisma.$queryRawUnsafe<any[]>(`
          SELECT attendant_id, nome, cidade, locacoes::int, posicao::int
          FROM vw_top_consultores_mes
          ${effectiveCityId ? `WHERE attendant_id IN (SELECT id FROM app_users WHERE city_id = '${effectiveCityId}')` : ''}
        `),

        // 4. Manutenções diárias do mês
        prisma.$queryRawUnsafe<any[]>(`
          SELECT dia, dia_formatado, SUM(volume)::int AS volume, SUM(receita)::numeric AS receita
          FROM vw_manutencoes_diarias_mes
          ${franchiseeId ? `WHERE franchisee_id = '${franchiseeId}'` : effectiveCityId ? `WHERE city_id = '${effectiveCityId}'` : ''}
          GROUP BY dia, dia_formatado
          ORDER BY dia
        `),

        // 5. Movimentos de hoje (com nome do franqueado e cidade)
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            m.tipo,
            m.city_id,
            m.franchisee_id,
            m.quantidade::int,
            COALESCE(f.fantasy_name, f.company_name, m.franchisee_id::text) AS franqueado_name,
            COALESCE(c.name, 'N/A') AS city_name
          FROM vw_movimentos_hoje m
          LEFT JOIN franchisees f ON f.id = m.franchisee_id
          LEFT JOIN cities c ON c.id = m.city_id
          ${franchiseeId ? `WHERE m.franchisee_id = '${franchiseeId}'` : effectiveCityId ? `WHERE m.city_id = '${effectiveCityId}'` : ''}
        `),

        // 6. Distribuição por cidade
        prisma.$queryRawUnsafe<any[]>(`
          SELECT city_id, cidade, slug, quantidade::int
          FROM vw_distribuicao_motos_cidade
          ${effectiveCityId ? `WHERE city_id = '${effectiveCityId}'` : ''}
        `),

        // 7. Ranking franqueados por ocupação
        prisma.$queryRawUnsafe<any[]>(`
          SELECT franchisee_id, nome, total_motos::int, ocupacao::numeric, posicao::int
          FROM vw_ranking_franqueados
          ${franchiseeId ? `WHERE franchisee_id = '${franchiseeId}'` : effectiveCityId ? `WHERE franchisee_id IN (SELECT id FROM franchisees WHERE city_id = '${effectiveCityId}')` : ''}
          LIMIT 30
        `),

        // 8. Placeholder - crescimento da frota agora usa total_operacional da query 11
        prisma.$queryRawUnsafe<any[]>(`SELECT 1 AS _`),

        // 9. Manutenções de hoje (detalhado)
        prisma.$queryRawUnsafe<any[]>(`
          SELECT id, data_abertura, tipo, status, valor_total::numeric, city_id, motorcycle_id, placa, franchisee_id, franqueado, city_name
          FROM vw_manutencoes_hoje
          ${franchiseeId ? `WHERE franchisee_id = '${franchiseeId}'` : effectiveCityId ? `WHERE city_id = '${effectiveCityId}'` : ''}
        `),

        // 10. Receita mensal (rentals do mês)
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            COALESCE(SUM(total_amount), 0)::numeric AS receita_mensal,
            COUNT(*)::int AS novas_locacoes_mes
          FROM vw_receita_mensal
          WHERE 1=1
          ${franchiseeId ? `AND franchisee_id = '${franchiseeId}'` : ''}
          ${effectiveCityId ? `AND city_id = '${effectiveCityId}'` : ''}
        `),

        // 11. Status da frota para donut (agrupado)
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            COALESCE(SUM(alugadas + renegociadas), 0)::int AS alugadas,
            COALESCE(SUM(disponiveis), 0)::int AS disponiveis,
            COALESCE(SUM(em_manutencao), 0)::int AS em_manutencao,
            COALESCE(SUM(recolhidas), 0)::int AS recolhidas,
            COALESCE(SUM(total_operacional), 0)::int AS total_operacional
          FROM vw_fleet_stats_by_franchisee
          ${filterWhereSQL}
        `),

        // 12. Mapa de locações por cidade (rentals do mês com city name/slug)
        prisma.$queryRawUnsafe<any[]>(`
          SELECT
            r.city_id,
            c.name AS city_name,
            c.slug AS city_slug,
            COUNT(*)::int AS total_rentals,
            COUNT(*) FILTER (WHERE r.status = 'active')::int AS active_rentals
          FROM rentals r
          LEFT JOIN cities c ON c.id = r.city_id
          WHERE r.start_date >= DATE_TRUNC('month', CURRENT_DATE)
            AND r.city_id IS NOT NULL
          ${franchiseeId ? `AND r.franchisee_id = '${franchiseeId}'` : ''}
          ${effectiveCityId ? `AND r.city_id = '${effectiveCityId}'` : ''}
          GROUP BY r.city_id, c.name, c.slug
          ORDER BY total_rentals DESC
        `),
      ]);

      // ============================================================
      // FORMATAR RESPOSTA
      // ============================================================

      const kpis = kpisResult[0] || {};
      const statusFrotaRaw = statusFrotaResult[0] || {};
      const receitaRaw = receitaMensalResult[0] || {};
      const totalOp = Number(statusFrotaRaw.total_operacional) || 0;

      // Processar movimentos de hoje
      let alugadasHoje = 0;
      let recolhidasHoje = 0;
      const alugadasPorFranquia: any[] = [];
      const recolhidasPorFranquia: any[] = [];

      for (const mov of movimentosHojeResult) {
        if (mov.tipo === 'alugadas') {
          alugadasHoje += Number(mov.quantidade);
          alugadasPorFranquia.push({
            franchisee_id: mov.franchisee_id,
            city_id: mov.city_id,
            quantidade: Number(mov.quantidade),
          });
        } else {
          recolhidasHoje += Number(mov.quantidade);
          recolhidasPorFranquia.push({
            franchisee_id: mov.franchisee_id,
            city_id: mov.city_id,
            quantidade: Number(mov.quantidade),
          });
        }
      }

      // Criar Map de franchisee_id → nome e cidade para lookups
      const franchiseeNameMap = new Map<string, string>();
      const franchiseeCityMap = new Map<string, string>();
      for (const f of franqueadosRevenueResult) {
        franchiseeNameMap.set(f.franchisee_id, f.franqueado_name || f.franchisee_id);
      }
      // Map city_id → nome da cidade
      const cityNameMap = new Map<string, string>();
      for (const d of distribuicaoCidadesResult) {
        cityNameMap.set(d.city_id, d.cidade || 'N/A');
      }
      // Para cada franqueado, mapear a cidade
      for (const f of franqueadosRevenueResult) {
        franchiseeCityMap.set(f.franchisee_id, cityNameMap.get(f.city_id) || 'N/A');
      }

      // Calcular alertas críticos
      const franquiasAbaixoMeta = franqueadosRevenueResult.filter((f: any) => Number(f.occupation_rate) < 75);
      const franquiasManutencaoAlta = franqueadosRevenueResult.filter((f: any) => Number(f.maintenance_rate) > 15);
      const franquiasOciosasAlta = franqueadosRevenueResult.filter((f: any) => Number(f.idle_rate) > 10);

      const alertas: any[] = [];

      if (franquiasAbaixoMeta.length > 0) {
        alertas.push({
          titulo: `${franquiasAbaixoMeta.length} franquias abaixo da meta`,
          descricao: 'Taxa < 75%',
          severidade: 'critical',
          tipo: 'ocupacao',
          franquiasDetalhes: franquiasAbaixoMeta.map((f: any) => ({
            franqueadoName: f.franqueado_name,
            franchiseeId: f.franchisee_id,
            motorcycleCount: Number(f.motorcycle_count),
            value: Number(f.occupation_rate),
            meta: 75,
          })),
        });
      }

      if (franquiasManutencaoAlta.length > 0) {
        alertas.push({
          titulo: `${franquiasManutencaoAlta.length} franquias c/ manutenção alta`,
          descricao: 'Taxa > 15%',
          severidade: 'critical',
          tipo: 'manutencao',
          franquiasDetalhes: franquiasManutencaoAlta.map((f: any) => ({
            franqueadoName: f.franqueado_name,
            franchiseeId: f.franchisee_id,
            motorcycleCount: Number(f.motorcycle_count),
            value: Number(f.maintenance_rate),
            meta: 15,
            maintenanceCount: Number(f.maintenance_count),
          })),
        });
      }

      if (franquiasOciosasAlta.length > 0) {
        alertas.push({
          titulo: `${franquiasOciosasAlta.length} franquias c/ ociosas alta`,
          descricao: 'Taxa > 10% (30d)',
          severidade: 'critical',
          tipo: 'ociosidade',
          franquiasDetalhes: franquiasOciosasAlta.map((f: any) => ({
            franqueadoName: f.franqueado_name,
            franchiseeId: f.franchisee_id,
            motorcycleCount: Number(f.motorcycle_count),
            value: Number(f.idle_rate),
            meta: 10,
          })),
        });
      }

      if (alugadasHoje > 0) {
        alertas.push({
          titulo: `${alugadasHoje} motos alugadas hoje`,
          descricao: 'Novas locações',
          severidade: 'info',
          tipo: 'info',
          franquiasDetalhes: alugadasPorFranquia.map(a => ({
            franqueadoName: franchiseeNameMap.get(a.franchisee_id) || a.franchisee_id,
            franchiseeId: a.franchisee_id,
            cityName: franchiseeCityMap.get(a.franchisee_id) || cityNameMap.get(a.city_id) || 'N/A',
            motorcycleCount: a.quantidade,
            value: a.quantidade,
            meta: 0,
          })),
        });
      }

      if (recolhidasHoje > 0) {
        alertas.push({
          titulo: `${recolhidasHoje} motos recolhidas hoje`,
          descricao: 'Devoluções',
          severidade: 'info',
          tipo: 'info',
          franquiasDetalhes: recolhidasPorFranquia.map(r => ({
            franqueadoName: franchiseeNameMap.get(r.franchisee_id) || r.franchisee_id,
            franchiseeId: r.franchisee_id,
            cityName: franchiseeCityMap.get(r.franchisee_id) || cityNameMap.get(r.city_id) || 'N/A',
            motorcycleCount: r.quantidade,
            value: r.quantidade,
            meta: 0,
          })),
        });
      }

      if (manutencoesHojeResult.length > 0) {
        const isFranqueado = context.role === 'franchisee';
        alertas.push({
          titulo: `${manutencoesHojeResult.length} manutenções ${isFranqueado ? 'do mês' : 'hoje'}`,
          descricao: 'Calendário',
          severidade: 'info',
          tipo: 'info',
        });
      }

      // Status frota formatado para donut
      const statusFrota = [
        { name: 'Alugadas', value: Number(statusFrotaRaw.alugadas) || 0, color: '#22c55e', percentage: totalOp > 0 ? ((Number(statusFrotaRaw.alugadas) || 0) / totalOp) * 100 : 0 },
        { name: 'Disponíveis', value: Number(statusFrotaRaw.disponiveis) || 0, color: '#3b82f6', percentage: totalOp > 0 ? ((Number(statusFrotaRaw.disponiveis) || 0) / totalOp) * 100 : 0 },
        { name: 'Manutenção', value: Number(statusFrotaRaw.em_manutencao) || 0, color: '#f97316', percentage: totalOp > 0 ? ((Number(statusFrotaRaw.em_manutencao) || 0) / totalOp) * 100 : 0 },
        { name: 'Recolhidas', value: Number(statusFrotaRaw.recolhidas) || 0, color: '#ef4444', percentage: totalOp > 0 ? ((Number(statusFrotaRaw.recolhidas) || 0) / totalOp) * 100 : 0 },
      ];

      // Top consultores formatado
      const topConsultores = topConsultoresResult.map((c: any) => ({
        nome: c.nome,
        iniciais: c.nome?.split(' ').map((n: string) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '??',
        cidade: c.cidade || 'Matriz',
        locacoes: Number(c.locacoes),
        posicao: Number(c.posicao),
      }));

      // Manutenções diárias
      const manutencoesDiarias = manutencoesDiariasResult.map((d: any) => ({
        data: d.dia,
        dataFormatada: d.dia_formatado,
        volume: Number(d.volume),
        receita: Number(d.receita),
      }));

      // Franqueados revenue formatado
      const franqueadosRevenue = franqueadosRevenueResult.map((f: any) => ({
        franchiseeId: f.franchisee_id,
        franqueadoName: f.franqueado_name,
        motorcycleCount: Number(f.motorcycle_count),
        occupationRate: Number(f.occupation_rate),
        maintenanceRate: Number(f.maintenance_rate),
        maintenanceCount: Number(f.maintenance_count),
        idleRate: Number(f.idle_rate),
        weeklyRevenue: Number(f.weekly_revenue),
        projectedMonthlyRevenue: Number(f.projected_monthly_revenue),
      }));

      // Ranking formatado
      const topFranqueados = rankingFranqueadosResult.map((f: any) => ({
        posicao: Number(f.posicao),
        nome: f.nome,
        ocupacao: Number(f.ocupacao),
        totalMotos: Number(f.total_motos),
      }));

      // Distribuição por cidade
      const distribuicaoEstados = distribuicaoCidadesResult.map((d: any) => ({
        sigla: d.cidade || 'Outros',
        quantidade: Number(d.quantidade),
      }));

      // Crescimento da frota - usa total_operacional atual como base
      // Meses até o atual recebem totalOp (frota operacional real), futuros recebem 0 (projeção no frontend)
      const mesesGrowth = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const mesAtualGrowth = new Date().getMonth(); // 0-indexed
      const baseGrowth = mesesGrowth.map((mes, i) => ({
        month: mes,
        cumulativeCount: i <= mesAtualGrowth ? totalOp : 0,
      }));

      // Manutenções de hoje formatadas
      const manutencoesHoje = manutencoesHojeResult.map((m: any) => ({
        placa: m.placa || 'N/A',
        tipo: m.tipo || 'Manutenção',
        status: m.status === 'concluida' ? 'concluida' : m.status === 'em_andamento' ? 'em_andamento' : 'pendente',
        franqueado: m.franqueado || 'N/A',
        numeroOS: m.id?.substring(0, 8) || 'N/A',
        valor: Number(m.valor_total) || 0,
        cityId: m.city_id,
        cityName: m.city_name || 'N/A',
      }));

      // Receita evolução (projeção baseada na receita semanal)
      const WEEKS_PER_MONTH = 4.33;
      const receitaSemanalTotal = Number(kpis.receita_semanal_total) || 0;
      const projecaoMensal = receitaSemanalTotal * WEEKS_PER_MONTH;

      const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const mesAtual = new Date().getMonth();
      const receitaEvolution = meses.slice(0, mesAtual + 1).map((mes, index) => ({
        mes,
        receita: index === mesAtual ? projecaoMensal : 0,
        meta: 500000,
      }));

      // Metas
      const taxaOcupacao = Number(kpis.taxa_ocupacao_global) || 0;
      const percentualManutencao = Number(kpis.taxa_manutencao_global) || 0;
      const metas = [
        { nome: 'Taxa de Ocupação', atual: taxaOcupacao, objetivo: 75, unidade: '%' },
        { nome: 'Receita Mensal', atual: Number(receitaRaw.receita_mensal) || 0, objetivo: 1000000, prefixo: 'R$' },
        { nome: 'Máx. em Manutenção', atual: percentualManutencao, objetivo: 10, unidade: '%', invertido: true },
        { nome: 'Novas Locações', atual: Number(receitaRaw.novas_locacoes_mes) || 0, objetivo: 350 },
      ];

      // Resumo financeiro (estimativa)
      const receitaOperacional = receitaSemanalTotal * 4;
      const caucao = receitaOperacional * 0.10;
      const juros = receitaOperacional * 0.02;
      const receitaBruta = receitaOperacional + caucao + juros;
      const simplesNacional = receitaBruta * 0.15;
      const custosOperacionais = receitaBruta * 0.20;
      const resultadoLiquido = receitaBruta - simplesNacional - custosOperacionais;

      const resumoFinanceiro = {
        receitaOperacional,
        caucao,
        juros,
        receitaBruta,
        simplesNacional,
        custosOperacionais,
        resultadoLiquido,
      };

      // Médias de locações baseadas nos rentals
      const mediasResult = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          COALESCE(COUNT(*) FILTER (WHERE start_date >= CURRENT_DATE - INTERVAL '30 days')::numeric / 30, 0) AS media_diaria,
          COALESCE(COUNT(*) FILTER (WHERE start_date >= CURRENT_DATE - INTERVAL '7 days'), 0)::int AS media_semanal,
          COALESCE(COUNT(*)::numeric / 3, 0) AS media_mensal
        FROM rentals
        WHERE start_date >= CURRENT_DATE - INTERVAL '90 days'
        ${franchiseeId ? `AND franchisee_id = '${franchiseeId}'` : ''}
        ${effectiveCityId ? `AND city_id = '${effectiveCityId}'` : ''}
      `);
      const medias = mediasResult[0] || {};

      const elapsed = Date.now() - startTime;
      logger.info(`[Dashboard] Gestão à Vista data loaded in ${elapsed}ms`);

      return reply.send({
        success: true,
        data: {
          kpis: {
            frotaTotal: Number(kpis.frota_total) || 0,
            taxaOcupacao: Number(kpis.taxa_ocupacao_global) || 0,
            taxaOcupacaoTrend: 0,
            receitaMensal: Number(receitaRaw.receita_mensal) || 0,
            receitaTrend: 0,
            locacoesAtivas: Number(kpis.locacoes_ativas) || 0,
            emManutencao: Number(kpis.em_manutencao) || 0,
            alertasCriticos: alertas.filter(a => a.severidade === 'critical').length,
          },
          statusFrota,
          franqueadosRevenue,
          topFranqueados,
          topConsultores,
          distribuicaoEstados,
          alertas,
          manutencoesHoje,
          manutencoesDiarias,
          receitaEvolution,
          metas,
          resumoFinanceiro,
          baseGrowth,
          movimentosHoje: {
            alugadasHoje,
            recolhidasHoje,
            alugadasPorFranquia,
            recolhidasPorFranquia,
          },
          medias: {
            diaria: Number(medias.media_diaria) || 0,
            semanal: Number(medias.media_semanal) || 0,
            mensal: Number(medias.media_mensal) || 0,
          },
          mapaLocacoesCidades: mapaLocacoesResult.map((r: any) => ({
            cityId: r.city_id,
            cityName: r.city_name,
            citySlug: r.city_slug,
            totalRentals: Number(r.total_rentals),
            activeRentals: Number(r.active_rentals),
          })),
          motosOciosas30Dias: Number(kpis.ociosas_30d) || 0,
          franqueadosAtivos: Number(kpis.franqueados_ativos) || 0,
          _meta: {
            elapsed_ms: elapsed,
            query_count: 13,
          },
        },
      });
    } catch (error: any) {
      logger.error(`[Dashboard] Error loading Gestão à Vista: ${error.message}`);
      return reply.status(500).send({
        success: false,
        error: 'Erro ao carregar dados do dashboard',
        message: error.message,
      });
    }
  });
};

export default dashboardRoutes;
