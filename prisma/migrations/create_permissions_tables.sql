-- Migration: Create Permissions Tables
-- Date: 2025-12-18
-- Description: Creates tables for role-based permissions management

-- 1. Create screens table (reference table for all system screens)
CREATE TABLE IF NOT EXISTS screens (
  id VARCHAR(100) PRIMARY KEY,
  name_pt VARCHAR(255) NOT NULL,
  path VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'main',
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create role_permissions table (default permissions per role)
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(50) NOT NULL,
  screen_id VARCHAR(100) NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT false,
  can_create BOOLEAN DEFAULT false,
  can_edit BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  can_export BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(role, screen_id)
);

-- 3. Create user_permission_overrides table (individual user overrides)
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  screen_id VARCHAR(100) NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  can_view BOOLEAN,
  can_create BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  can_export BOOLEAN,
  granted_by UUID REFERENCES app_users(id),
  granted_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, screen_id)
);

-- 4. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_screen ON role_permissions(screen_id);
CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user ON user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_screen ON user_permission_overrides(screen_id);

-- 5. Insert all system screens
INSERT INTO screens (id, name_pt, path, category, order_index) VALUES
  ('dashboard', 'Dashboard', '/', 'main', 1),
  ('leads', 'Leads', '/leads', 'main', 2),
  ('deals', 'Esteira de Locação', '/deals', 'main', 3),
  ('motos', 'Gestão de Motos', '/motos', 'main', 4),
  ('locacoes', 'Locações', '/locacoes', 'main', 5),
  ('vendas', 'Vendas', '/vendas', 'main', 6),
  ('clientes', 'Clientes', '/clientes', 'main', 7),
  ('vistorias', 'Vistorias', '/vistorias', 'main', 8),
  ('franchisees', 'Franqueados', '/franchisees', 'main', 9),
  ('financeiro', 'Financeiro', '/financeiro', 'main', 10),
  ('financas', 'Finanças', '/financas', 'main', 11),
  ('frota', 'Frota', '/frota', 'main', 12),
  ('projecao', 'Projeção de Crescimento', '/projecao', 'main', 13),
  ('rastreadores', 'Rastreadores', '/rastreadores', 'main', 14),
  ('distratos', 'Distratos', '/distratos', 'main', 15),
  ('ranking_locacao', 'Ranking de Locação', '/ranking-locacao', 'main', 16),
  ('pesquisa_satisfacao', 'Pesquisa de Satisfação', '/pesquisa-satisfacao', 'main', 17),
  ('campanhas', 'Campanhas', '/campanhas', 'main', 18),
  ('sugestoes', 'Sugestões', '/sugestoes', 'main', 19),
  ('usuarios', 'Usuários', '/usuarios', 'admin', 20),
  ('manutencao_lista', 'Manutenções', '/manutencao/lista', 'manutencao', 21),
  ('manutencao_calendario', 'Calendário', '/manutencao/calendario', 'manutencao', 22),
  ('manutencao_kpi', 'KPI', '/manutencao/kpi', 'manutencao', 23),
  ('manutencao_pecas', 'Peças', '/manutencao/pecas', 'manutencao', 24),
  ('manutencao_servicos', 'Serviços', '/manutencao/servicos', 'manutencao', 25),
  ('manutencao_oficinas', 'Oficinas', '/manutencao/oficinas', 'manutencao', 26),
  ('manutencao_profissionais', 'Profissionais', '/manutencao/profissionais', 'manutencao', 27),
  ('ociosidade', 'Previsão de Ociosidade', '/ociosidade', 'main', 28),
  ('recorrentes', 'Recorrentes', '/recorrentes', 'main', 29)
ON CONFLICT (id) DO NOTHING;

-- 6. Insert default permissions for each role

-- ADMIN: Full access to everything
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'admin', id, true, true, true, true, true FROM screens
ON CONFLICT (role, screen_id) DO NOTHING;

-- MASTER_BR: Full access to most screens
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'master_br', id, true, true, true, true, true FROM screens WHERE id NOT IN ('usuarios', 'financas')
ON CONFLICT (role, screen_id) DO NOTHING;

INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('master_br', 'usuarios', false, false, false, false, false),
       ('master_br', 'financas', false, false, false, false, false)
ON CONFLICT (role, screen_id) DO NOTHING;

-- REGIONAL_ADMIN: Full access except admin-specific screens
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'regional_admin', id, true, true, true, true, true FROM screens WHERE id NOT IN ('financas')
ON CONFLICT (role, screen_id) DO NOTHING;

INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('regional_admin', 'financas', false, false, false, false, false)
ON CONFLICT (role, screen_id) DO NOTHING;

-- REGIONAL: Similar to regional_admin but no user management
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'regional', id, true, true, true, true, true FROM screens WHERE id NOT IN ('usuarios', 'financas')
ON CONFLICT (role, screen_id) DO NOTHING;

INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('regional', 'usuarios', false, false, false, false, false),
       ('regional', 'financas', false, false, false, false, false)
ON CONFLICT (role, screen_id) DO NOTHING;

-- FRANCHISEE: View-only for most, full access to financas
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'franchisee', id, true, false, false, false, false FROM screens
WHERE id IN ('dashboard', 'motos', 'locacoes', 'vistorias', 'franchisees', 'frota', 'sugestoes',
             'manutencao_lista', 'manutencao_calendario', 'manutencao_kpi', 'ociosidade')
ON CONFLICT (role, screen_id) DO NOTHING;

-- Franchisee: Full access to financas
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('franchisee', 'financas', true, true, true, true, true),
       ('franchisee', 'recorrentes', true, true, true, true, true)
ON CONFLICT (role, screen_id) DO NOTHING;

-- Franchisee: No access to admin/regional screens
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'franchisee', id, false, false, false, false, false FROM screens
WHERE id IN ('vendas', 'clientes', 'financeiro', 'projecao', 'rastreadores', 'distratos',
             'ranking_locacao', 'campanhas', 'usuarios', 'leads', 'deals',
             'manutencao_pecas', 'manutencao_servicos', 'manutencao_oficinas', 'manutencao_profissionais')
ON CONFLICT (role, screen_id) DO NOTHING;

-- Franchisee: Partial access to some screens (view + edit for surveys)
INSERT INTO role_permissions (role, screen_id, can_view, can_create, can_edit, can_delete, can_export)
VALUES ('franchisee', 'pesquisa_satisfacao', true, false, true, false, false)
ON CONFLICT (role, screen_id) DO NOTHING;

-- 7. Create function to get computed permissions for a user
CREATE OR REPLACE FUNCTION get_user_computed_permissions(p_user_id UUID)
RETURNS TABLE (
  screen_id VARCHAR(100),
  screen_name VARCHAR(255),
  screen_path VARCHAR(255),
  screen_category VARCHAR(100),
  can_view BOOLEAN,
  can_create BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  can_export BOOLEAN,
  is_override BOOLEAN
) AS $$
DECLARE
  v_role VARCHAR(50);
BEGIN
  -- Get user's role
  SELECT role INTO v_role FROM app_users WHERE id = p_user_id;

  RETURN QUERY
  SELECT
    s.id AS screen_id,
    s.name_pt AS screen_name,
    s.path AS screen_path,
    s.category AS screen_category,
    COALESCE(upo.can_view, rp.can_view, false) AS can_view,
    COALESCE(upo.can_create, rp.can_create, false) AS can_create,
    COALESCE(upo.can_edit, rp.can_edit, false) AS can_edit,
    COALESCE(upo.can_delete, rp.can_delete, false) AS can_delete,
    COALESCE(upo.can_export, rp.can_export, false) AS can_export,
    (upo.id IS NOT NULL) AS is_override
  FROM screens s
  LEFT JOIN role_permissions rp ON s.id = rp.screen_id AND rp.role = v_role
  LEFT JOIN user_permission_overrides upo ON s.id = upo.screen_id AND upo.user_id = p_user_id
  WHERE s.is_active = true
  ORDER BY s.order_index;
END;
$$ LANGUAGE plpgsql;

-- 8. Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_role_permissions_updated_at
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_permission_overrides_updated_at
  BEFORE UPDATE ON user_permission_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
