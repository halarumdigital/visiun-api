-- =============================================
-- CRIAÇÃO DOS ENUMS (se não existirem)
-- =============================================
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('master_br', 'admin', 'regional', 'franchisee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked', 'inactive', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RegionalType" AS ENUM ('admin', 'simples');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MasterType" AS ENUM ('admin', 'simples');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================
-- TABELA app_users - Todas as colunas faltantes
-- =============================================
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS refresh_token TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Índice para refresh_token
CREATE INDEX IF NOT EXISTS app_users_refresh_token_idx ON app_users(refresh_token);

-- =============================================
-- TABELA audit_logs - Correções
-- =============================================
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_data JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_data JSONB;

-- Corrige constraints para serem opcionais (nullable)
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN user_email DROP NOT NULL;

-- =============================================
-- TABELA cities - Colunas faltantes
-- =============================================
ALTER TABLE cities ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE cities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- =============================================
-- TABELA franchisees - Colunas faltantes
-- =============================================
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE franchisees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
