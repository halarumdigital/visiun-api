-- =============================================
-- TABELA audit_logs - Colunas extras para logs completos
-- =============================================
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_role TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS city_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS city_name TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS franchisee_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS franchisee_name TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_label TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS changed_fields TEXT[] DEFAULT '{}';
