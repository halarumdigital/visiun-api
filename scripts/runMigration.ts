import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🚀 Iniciando migração para criar tabela motorcycle_models...\n');

  try {
    // Criar a tabela
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "motorcycle_models" (
        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
        "brand" TEXT NOT NULL,
        "model" TEXT NOT NULL,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "motorcycle_models_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('✅ Tabela motorcycle_models criada');

    // Criar índice único
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "motorcycle_models_brand_model_key"
      ON "motorcycle_models"("brand", "model");
    `);
    console.log('✅ Índice único (brand, model) criado');

    // Criar índice de brand
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "motorcycle_models_brand_idx"
      ON "motorcycle_models"("brand");
    `);
    console.log('✅ Índice de brand criado');

    // Criar índice de active
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "motorcycle_models_active_idx"
      ON "motorcycle_models"("active");
    `);
    console.log('✅ Índice de active criado');

    // Criar função de trigger
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION update_motorcycle_models_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('✅ Função de trigger criada');

    // Criar trigger
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trigger_update_motorcycle_models_updated_at ON motorcycle_models;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER trigger_update_motorcycle_models_updated_at
        BEFORE UPDATE ON motorcycle_models
        FOR EACH ROW
        EXECUTE FUNCTION update_motorcycle_models_updated_at();
    `);
    console.log('✅ Trigger de updated_at criado');

    console.log('\n🎉 Migração concluída com sucesso!');
    console.log('\n📌 Próximos passos:');
    console.log('   1. Execute: npx prisma generate');
    console.log('   2. Reinicie a API');

  } catch (error) {
    console.error('❌ Erro na migração:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
