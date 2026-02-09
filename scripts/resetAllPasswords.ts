/**
 * Script para redefinir a senha de todos os usuários para "Mudar@123"
 *
 * Cria as colunas de autenticação caso não existam e atualiza todas as senhas.
 *
 * Uso:
 *   npx tsx scripts/resetAllPasswords.ts
 */

import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;
const NEW_PASSWORD = 'Mudar@123';

async function main() {
  const prisma = new PrismaClient();

  try {
    // Criar colunas de autenticação se não existirem
    await prisma.$executeRawUnsafe(`
      ALTER TABLE app_users
        ADD COLUMN IF NOT EXISTS password_hash TEXT,
        ADD COLUMN IF NOT EXISTS refresh_token TEXT,
        ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
        ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ
    `);
    console.log('Colunas de autenticação verificadas/criadas.');

    const passwordHash = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);

    // Desabilitar TODOS os triggers temporariamente (app_users + franchisees em cascata)
    await prisma.$executeRawUnsafe(`ALTER TABLE app_users DISABLE TRIGGER ALL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE franchisees DISABLE TRIGGER ALL`);
    console.log('Triggers desabilitados.');

    const result = await prisma.$executeRawUnsafe(
      `UPDATE app_users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL`,
      passwordHash
    );

    // Reabilitar todos os triggers
    await prisma.$executeRawUnsafe(`ALTER TABLE app_users ENABLE TRIGGER ALL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE franchisees ENABLE TRIGGER ALL`);
    console.log('Triggers reabilitados.');

    console.log(`${result} usuários atualizados com sucesso.`);
    console.log(`Nova senha: ${NEW_PASSWORD}`);
  } catch (error) {
    console.error('Erro ao redefinir senhas:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
