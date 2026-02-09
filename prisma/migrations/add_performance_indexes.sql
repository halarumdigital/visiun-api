-- Migration: Índices compostos para performance da página Locações
-- Data: 2026-02-09

-- =============================================
-- RENTALS - Índices compostos
-- =============================================

-- Query principal: filtro por cidade + ordenação por start_date DESC
CREATE INDEX IF NOT EXISTS idx_rentals_city_start_date
ON rentals (city_id, start_date DESC);

-- Query de franqueado: filtro por franchisee_id + ordenação por start_date DESC
CREATE INDEX IF NOT EXISTS idx_rentals_franchisee_start_date
ON rentals (franchisee_id, start_date DESC);

-- Filtro por status com ordenação por data
CREATE INDEX IF NOT EXISTS idx_rentals_status_start_date
ON rentals (status, start_date DESC);

-- Filtro combinado cidade + status (usado em queries de motos disponíveis)
CREATE INDEX IF NOT EXISTS idx_rentals_city_status
ON rentals (city_id, status);

-- =============================================
-- MOTORCYCLES - Índices compostos
-- =============================================

-- Query principal: filtro por cidade + status (motos disponíveis)
CREATE INDEX IF NOT EXISTS idx_motorcycles_city_status
ON motorcycles (city_id, status);

-- Query de listagem: filtro por cidade + ordenação por created_at
CREATE INDEX IF NOT EXISTS idx_motorcycles_city_created
ON motorcycles (city_id, created_at DESC);

-- =============================================
-- CLIENTS - Índice para busca por CNPJ
-- =============================================

CREATE INDEX IF NOT EXISTS idx_clients_cnpj
ON clients (cnpj);

-- =============================================
-- FRANCHISEES - Índice composto cidade + status
-- =============================================

CREATE INDEX IF NOT EXISTS idx_franchisees_city_status
ON franchisees (city_id, status);

-- =============================================
-- DISTRATOS - Índice composto rental + created_at
-- =============================================

CREATE INDEX IF NOT EXISTS idx_distratos_rental_created
ON distratos_locacoes (rental_id, created_at DESC);

-- =============================================
-- RENTAL_SECONDARY_VEHICLES - Índice composto rental + status
-- =============================================

CREATE INDEX IF NOT EXISTS idx_secondary_vehicles_rental_status
ON rental_secondary_vehicles (rental_id, status);
