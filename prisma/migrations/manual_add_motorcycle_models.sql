-- =====================================================
-- Migration: Add motorcycle_models table
-- Database: PostgreSQL (visiun @ 31.97.87.1:5432)
-- =====================================================
--
-- Execute este SQL no seu banco de dados PostgreSQL:
--
-- Opção 1 - Via terminal:
-- PGPASSWORD='@0dJ2m0q82320' psql -h 31.97.87.1 -p 5432 -U visiun -d visiun -f prisma/migrations/manual_add_motorcycle_models.sql
--
-- Opção 2 - Via DBeaver/pgAdmin/outro cliente SQL:
-- Conecte ao banco e execute este script
--
-- Opção 3 - Via Prisma (recomendado):
-- cd /media/gilliard/Desenvolvimento1/Master-Brasil-API
-- npx prisma migrate dev --name add_motorcycle_models_table
-- npx prisma generate
-- =====================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "motorcycle_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motorcycle_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (Unique constraint on brand + model)
CREATE UNIQUE INDEX IF NOT EXISTS "motorcycle_models_brand_model_key" ON "motorcycle_models"("brand", "model");

-- CreateIndex (Performance index on brand)
CREATE INDEX IF NOT EXISTS "motorcycle_models_brand_idx" ON "motorcycle_models"("brand");

-- CreateIndex (Performance index on active)
CREATE INDEX IF NOT EXISTS "motorcycle_models_active_idx" ON "motorcycle_models"("active");

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_motorcycle_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_motorcycle_models_updated_at ON motorcycle_models;
CREATE TRIGGER trigger_update_motorcycle_models_updated_at
    BEFORE UPDATE ON motorcycle_models
    FOR EACH ROW
    EXECUTE FUNCTION update_motorcycle_models_updated_at();

-- Verificar se a tabela foi criada
SELECT 'Tabela motorcycle_models criada com sucesso!' as status
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'motorcycle_models');
