-- ============================================
-- GESTÃO À VISTA - OTIMIZAÇÕES DE PERFORMANCE
-- Índices + Views para dashboard
-- ============================================

-- ============================================
-- PARTE 1: ÍNDICES FALTANTES
-- ============================================

-- OrdemServico: data_abertura é filtrada por range mas NÃO tinha índice
CREATE INDEX IF NOT EXISTS idx_ordens_servico_data_abertura
  ON ordens_servico (data_abertura);

CREATE INDEX IF NOT EXISTS idx_ordens_servico_city_data_abertura
  ON ordens_servico (city_id, data_abertura DESC);

-- Rental: attendant_id é usado para Top Consultores mas NÃO tinha índice
CREATE INDEX IF NOT EXISTS idx_rentals_attendant_id
  ON rentals (attendant_id);

CREATE INDEX IF NOT EXISTS idx_rentals_attendant_start
  ON rentals (attendant_id, start_date DESC);

-- Motorcycle: [franchisee_id, status] é o agrupamento mais comum para KPIs
CREATE INDEX IF NOT EXISTS idx_motorcycles_franchisee_status
  ON motorcycles (franchisee_id, status);

-- ============================================
-- PARTE 2: VIEWS PARA PRÉ-AGREGAÇÃO
-- ============================================

-- VIEW 1: KPIs da Frota por Franqueado
-- Substitui download de TODAS as motos + loop client-side
DROP VIEW IF EXISTS vw_dashboard_kpis CASCADE;
DROP VIEW IF EXISTS vw_fleet_stats_by_franchisee CASCADE;

CREATE OR REPLACE VIEW vw_fleet_stats_by_franchisee AS
SELECT
  f.id AS franchisee_id,
  COALESCE(f.fantasy_name, f.company_name, 'N/A') AS franqueado_name,
  f.city_id,
  COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda')) AS total_operacional,
  COUNT(*) FILTER (WHERE m.status IN ('alugada','relocada')) AS alugadas,
  COUNT(*) FILTER (WHERE m.status = 'renegociado') AS renegociadas,
  COUNT(*) FILTER (WHERE m.status = 'active') AS disponiveis,
  COUNT(*) FILTER (WHERE m.status = 'manutencao') AS em_manutencao,
  COUNT(*) FILTER (WHERE m.status = 'recolhida') AS recolhidas,
  COALESCE(SUM(m.valor_semanal) FILTER (WHERE m.status IN ('alugada','relocada')), 0) AS receita_semanal,
  COUNT(*) FILTER (
    WHERE m.status = 'active'
    AND m.data_ultima_mov < NOW() - INTERVAL '30 days'
  ) AS ociosas_30d,
  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda')) > 0
      THEN (COUNT(*) FILTER (WHERE m.status IN ('alugada','relocada','renegociado'))::numeric
            / COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda'))::numeric) * 100
      ELSE 0
    END, 2
  ) AS taxa_ocupacao,
  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda')) > 0
      THEN (COUNT(*) FILTER (WHERE m.status = 'manutencao')::numeric
            / COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda'))::numeric) * 100
      ELSE 0
    END, 2
  ) AS taxa_manutencao,
  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda')) > 0
      THEN (COUNT(*) FILTER (WHERE m.status = 'active' AND m.data_ultima_mov < NOW() - INTERVAL '30 days')::numeric
            / COUNT(*) FILTER (WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda'))::numeric) * 100
      ELSE 0
    END, 2
  ) AS taxa_ociosidade
FROM franchisees f
LEFT JOIN (
  SELECT DISTINCT ON (TRIM(placa)) *
  FROM motorcycles
  ORDER BY TRIM(placa), COALESCE(data_ultima_mov, created_at) DESC
) m ON m.franchisee_id = f.id
GROUP BY f.id, f.fantasy_name, f.company_name, f.city_id;


-- VIEW 2: KPIs Globais do Dashboard (usa a view anterior)
CREATE OR REPLACE VIEW vw_dashboard_kpis AS
SELECT
  SUM(total_operacional)::int AS frota_total,
  SUM(alugadas)::int AS locacoes_ativas,
  SUM(renegociadas)::int AS renegociadas,
  SUM(disponiveis)::int AS disponiveis,
  SUM(em_manutencao)::int AS em_manutencao,
  SUM(recolhidas)::int AS recolhidas,
  SUM(ociosas_30d)::int AS ociosas_30d,
  SUM(receita_semanal)::numeric AS receita_semanal_total,
  ROUND(
    CASE WHEN SUM(total_operacional) > 0
    THEN (SUM(alugadas) + SUM(renegociadas))::numeric / SUM(total_operacional)::numeric * 100
    ELSE 0 END, 2
  ) AS taxa_ocupacao_global,
  ROUND(
    CASE WHEN SUM(total_operacional) > 0
    THEN SUM(em_manutencao)::numeric / SUM(total_operacional)::numeric * 100
    ELSE 0 END, 2
  ) AS taxa_manutencao_global,
  ROUND(
    CASE WHEN SUM(total_operacional) > 0
    THEN SUM(ociosas_30d)::numeric / SUM(total_operacional)::numeric * 100
    ELSE 0 END, 2
  ) AS taxa_ociosidade_global,
  COUNT(*) FILTER (WHERE total_operacional > 0)::int AS franqueados_ativos
FROM vw_fleet_stats_by_franchisee;


-- VIEW 3: Top Consultores do Mês
DROP VIEW IF EXISTS vw_top_consultores_mes CASCADE;

CREATE OR REPLACE VIEW vw_top_consultores_mes AS
SELECT
  r.attendant_id,
  u.name AS nome,
  c.name AS cidade,
  COUNT(*) AS locacoes,
  ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS posicao
FROM rentals r
JOIN app_users u ON u.id = r.attendant_id
LEFT JOIN cities c ON c.id = u.city_id
WHERE r.attendant_id IS NOT NULL
  AND r.created_at >= DATE_TRUNC('month', CURRENT_DATE)
  AND u.name IS NOT NULL
  AND TRIM(u.name) != ''
  AND u.name != 'Sem nome'
GROUP BY r.attendant_id, u.name, c.name
ORDER BY locacoes DESC;


-- VIEW 4: Manutenções Diárias do Mês Atual
DROP VIEW IF EXISTS vw_manutencoes_diarias_mes CASCADE;

CREATE OR REPLACE VIEW vw_manutencoes_diarias_mes AS
SELECT
  DATE(data_abertura) AS dia,
  TO_CHAR(data_abertura, 'DD/MM') AS dia_formatado,
  city_id,
  COUNT(*) AS volume,
  COALESCE(SUM(valor_total), 0) AS receita
FROM ordens_servico
WHERE data_abertura >= DATE_TRUNC('month', CURRENT_DATE)
  AND data_abertura < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
GROUP BY DATE(data_abertura), TO_CHAR(data_abertura, 'DD/MM'), city_id
ORDER BY dia;


-- VIEW 5: Ranking de Franqueados por Ocupação
DROP VIEW IF EXISTS vw_ranking_franqueados CASCADE;

CREATE OR REPLACE VIEW vw_ranking_franqueados AS
SELECT
  franchisee_id,
  franqueado_name AS nome,
  total_operacional AS total_motos,
  taxa_ocupacao AS ocupacao,
  ROW_NUMBER() OVER (ORDER BY taxa_ocupacao DESC) AS posicao
FROM vw_fleet_stats_by_franchisee
WHERE total_operacional > 0
ORDER BY taxa_ocupacao DESC;


-- VIEW 6: Distribuição de Motos por Cidade
DROP VIEW IF EXISTS vw_distribuicao_motos_cidade CASCADE;

CREATE OR REPLACE VIEW vw_distribuicao_motos_cidade AS
SELECT
  c.id AS city_id,
  c.name AS cidade,
  c.slug,
  COUNT(*) AS quantidade
FROM (
  SELECT DISTINCT ON (TRIM(placa)) *
  FROM motorcycles
  ORDER BY TRIM(placa), COALESCE(data_ultima_mov, created_at) DESC
) m
LEFT JOIN cities c ON c.id = m.city_id
WHERE m.status NOT IN ('vendida','apropriacao_indebita','furto_roubo','a_venda')
GROUP BY c.id, c.name, c.slug
ORDER BY quantidade DESC;


-- VIEW 7: Receita Mensal (rentals do mês atual)
DROP VIEW IF EXISTS vw_receita_mensal CASCADE;

CREATE OR REPLACE VIEW vw_receita_mensal AS
SELECT
  r.city_id,
  r.franchisee_id,
  r.attendant_id,
  r.start_date,
  r.status,
  r.total_amount,
  r.created_at
FROM rentals r
WHERE r.created_at >= DATE_TRUNC('month', CURRENT_DATE);


-- VIEW 8: Movimentos de Hoje (alugadas e recolhidas)
DROP VIEW IF EXISTS vw_movimentos_hoje CASCADE;

CREATE OR REPLACE VIEW vw_movimentos_hoje AS
SELECT
  'alugadas' AS tipo,
  r.city_id,
  r.franchisee_id,
  COUNT(*) AS quantidade
FROM rentals r
WHERE r.start_date = CURRENT_DATE
GROUP BY r.city_id, r.franchisee_id

UNION ALL

SELECT
  'recolhidas' AS tipo,
  m.city_id,
  m.franchisee_id,
  COUNT(DISTINCT TRIM(m.placa)) AS quantidade
FROM motorcycles m
WHERE m.status = 'recolhida'
  AND DATE(m.data_ultima_mov) = CURRENT_DATE
GROUP BY m.city_id, m.franchisee_id;


-- VIEW 9: Crescimento da Frota (cumulativo por mês, ano atual)
DROP VIEW IF EXISTS vw_crescimento_frota CASCADE;

CREATE OR REPLACE VIEW vw_crescimento_frota AS
WITH monthly_new AS (
  SELECT
    DATE_TRUNC('month', created_at) AS mes,
    COUNT(DISTINCT TRIM(placa)) AS novas
  FROM motorcycles
  WHERE created_at IS NOT NULL
  GROUP BY DATE_TRUNC('month', created_at)
),
cumulative AS (
  SELECT
    mes,
    novas,
    SUM(novas) OVER (ORDER BY mes) AS cumulativo
  FROM monthly_new
)
SELECT
  TO_CHAR(mes, 'Mon') AS month_label,
  EXTRACT(YEAR FROM mes)::int AS ano,
  EXTRACT(MONTH FROM mes)::int AS mes_num,
  novas::int,
  cumulativo::int AS cumulative_count
FROM cumulative
ORDER BY mes;


-- VIEW 10: Manutenções do dia com dados de moto e franqueado
DROP VIEW IF EXISTS vw_manutencoes_hoje CASCADE;

CREATE OR REPLACE VIEW vw_manutencoes_hoje AS
SELECT
  os.id,
  os.data_abertura,
  os.tipo_manutencao AS tipo,
  os.status,
  os.valor_total,
  os.city_id,
  os.motorcycle_id,
  m.placa,
  m.franchisee_id,
  COALESCE(f.fantasy_name, f.company_name, 'N/A') AS franqueado,
  COALESCE(c.name, 'N/A') AS city_name
FROM ordens_servico os
LEFT JOIN (
  SELECT DISTINCT ON (id) id, placa, franchisee_id
  FROM motorcycles
) m ON m.id = os.motorcycle_id
LEFT JOIN franchisees f ON f.id = m.franchisee_id
LEFT JOIN cities c ON c.id = COALESCE(os.city_id, f.city_id)
WHERE os.data_abertura >= DATE_TRUNC('day', CURRENT_DATE)
  AND os.data_abertura < DATE_TRUNC('day', CURRENT_DATE) + INTERVAL '1 day';
