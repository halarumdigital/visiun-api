/**
 * Script de Migração de Senhas
 *
 * Este script gera senhas temporárias para todos os usuários que não possuem
 * password_hash definido e exporta um CSV com as credenciais para envio manual.
 *
 * Uso:
 *   npm run migrate:passwords
 *
 * Saída:
 *   - Console: Progresso e resumo
 *   - Arquivo: scripts/output/passwords_TIMESTAMP.csv
 */

import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

interface MigrationResult {
  userId: string;
  email: string;
  name: string | null;
  tempPassword: string;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Gerar senha temporária segura
 */
function generateTempPassword(): string {
  const upperChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowerChars = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%';

  let password = '';

  // 3 letras maiúsculas
  for (let i = 0; i < 3; i++) {
    password += upperChars.charAt(Math.floor(Math.random() * upperChars.length));
  }

  // 3 letras minúsculas
  for (let i = 0; i < 3; i++) {
    password += lowerChars.charAt(Math.floor(Math.random() * lowerChars.length));
  }

  // 3 números
  for (let i = 0; i < 3; i++) {
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
  }

  // 1 caractere especial
  password += special.charAt(Math.floor(Math.random() * special.length));

  // Embaralhar
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Salvar resultados em CSV
 */
function saveToCSV(results: MigrationResult[]): string {
  const outputDir = path.join(__dirname, 'output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `passwords_${timestamp}.csv`;
  const filepath = path.join(outputDir, filename);

  const headers = ['User ID', 'Email', 'Nome', 'Senha Temporária', 'Status', 'Erro'];
  const rows = results.map(r => [
    r.userId,
    r.email,
    r.name || '',
    r.tempPassword,
    r.status,
    r.error || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');

  fs.writeFileSync(filepath, csvContent, 'utf8');

  return filepath;
}

/**
 * Função principal de migração
 */
async function migratePasswords() {
  console.log('='.repeat(60));
  console.log('   MIGRAÇÃO DE SENHAS - CITY SCOPE CRM');
  console.log('='.repeat(60));
  console.log();

  const results: MigrationResult[] = [];

  try {
    // Buscar usuários sem password_hash
    const usersWithoutPassword = await prisma.appUser.findMany({
      where: {
        OR: [
          { password_hash: null },
          { password_hash: '' },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    });

    console.log(`Encontrados ${usersWithoutPassword.length} usuários sem senha definida.`);
    console.log();

    if (usersWithoutPassword.length === 0) {
      console.log('Nenhum usuário para migrar.');
      return;
    }

    // Confirmar migração
    console.log('Usuários a serem migrados:');
    usersWithoutPassword.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.email} (${user.role})`);
    });
    console.log();

    // Processar cada usuário
    console.log('Iniciando migração...');
    console.log();

    for (const user of usersWithoutPassword) {
      const result: MigrationResult = {
        userId: user.id,
        email: user.email,
        name: user.name,
        tempPassword: '',
        status: 'success',
      };

      try {
        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

        await prisma.appUser.update({
          where: { id: user.id },
          data: {
            password_hash: passwordHash,
            status: 'pending', // Forçar usuário a trocar senha no primeiro login
            failed_login_attempts: 0,
            locked_until: null,
          },
        });

        result.tempPassword = tempPassword;
        result.status = 'success';

        console.log(`✓ ${user.email} - Senha gerada com sucesso`);
      } catch (error) {
        result.status = 'error';
        result.error = error instanceof Error ? error.message : 'Erro desconhecido';
        console.error(`✗ ${user.email} - Erro: ${result.error}`);
      }

      results.push(result);
    }

    // Salvar CSV
    console.log();
    const csvPath = saveToCSV(results);

    // Resumo
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    console.log('='.repeat(60));
    console.log('   RESUMO DA MIGRAÇÃO');
    console.log('='.repeat(60));
    console.log();
    console.log(`  Total de usuários: ${results.length}`);
    console.log(`  Sucesso: ${successCount}`);
    console.log(`  Erros: ${errorCount}`);
    console.log();
    console.log(`  Arquivo CSV salvo em: ${csvPath}`);
    console.log();
    console.log('='.repeat(60));
    console.log();
    console.log('IMPORTANTE:');
    console.log('  1. O arquivo CSV contém as senhas temporárias');
    console.log('  2. Envie as credenciais para cada usuário de forma segura');
    console.log('  3. Usuários devem trocar a senha no primeiro acesso');
    console.log('  4. Delete o arquivo CSV após o envio das credenciais');
    console.log();

  } catch (error) {
    console.error('Erro durante a migração:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Script para resetar senha de um usuário específico
 */
async function resetSingleUser(email: string) {
  console.log(`Resetando senha para: ${email}`);

  try {
    const user = await prisma.appUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      console.error('Usuário não encontrado');
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        password_hash: passwordHash,
        status: 'pending',
        failed_login_attempts: 0,
        locked_until: null,
      },
    });

    console.log();
    console.log('='.repeat(40));
    console.log(`Email: ${email}`);
    console.log(`Senha temporária: ${tempPassword}`);
    console.log('='.repeat(40));
    console.log();

  } catch (error) {
    console.error('Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar script
const args = process.argv.slice(2);

if (args[0] === '--user' && args[1]) {
  // Reset de usuário específico: npm run migrate:passwords -- --user email@example.com
  resetSingleUser(args[1]);
} else {
  // Migração completa
  migratePasswords();
}
