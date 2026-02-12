-- Migration: Add can_generate_boleto permission column
-- Date: 2026-02-12
-- Description: Adds can_generate_boleto column to role_permissions and user_permission_overrides tables

-- 1. Add column to role_permissions
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_generate_boleto BOOLEAN DEFAULT false;

-- 2. Add column to user_permission_overrides (nullable for inheritance)
ALTER TABLE user_permission_overrides ADD COLUMN IF NOT EXISTS can_generate_boleto BOOLEAN;

-- 3. Set default values for existing roles
-- Admin: full access
UPDATE role_permissions SET can_generate_boleto = true WHERE role = 'admin';

-- Master BR: full access
UPDATE role_permissions SET can_generate_boleto = true WHERE role = 'master_br';

-- Regional Admin: full access
UPDATE role_permissions SET can_generate_boleto = true WHERE role = 'regional_admin';

-- Regional: full access
UPDATE role_permissions SET can_generate_boleto = true WHERE role = 'regional';

-- Franchisee: no access to generate boletos by default
UPDATE role_permissions SET can_generate_boleto = false WHERE role = 'franchisee';

-- 4. Drop and recreate the computed permissions function (return type changed)
DROP FUNCTION IF EXISTS get_user_computed_permissions(UUID);
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
  can_generate_boleto BOOLEAN,
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
    COALESCE(upo.can_generate_boleto, rp.can_generate_boleto, false) AS can_generate_boleto,
    (upo.id IS NOT NULL) AS is_override
  FROM screens s
  LEFT JOIN role_permissions rp ON s.id = rp.screen_id AND rp.role = v_role
  LEFT JOIN user_permission_overrides upo ON s.id = upo.screen_id AND upo.user_id = p_user_id
  WHERE s.is_active = true
  ORDER BY s.order_index;
END;
$$ LANGUAGE plpgsql;
