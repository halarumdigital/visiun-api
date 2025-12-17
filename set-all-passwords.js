const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const password = process.argv[2] || 'Acesso#00';

  console.log(`Definindo senha padrão para todos os usuários...`);
  console.log(`Senha: ${password}\n`);

  const passwordHash = await bcrypt.hash(password, 12);

  // Atualiza todos os usuários usando SQL direto
  const result = await prisma.$executeRaw`
    UPDATE app_users SET password_hash = ${passwordHash}, updated_at = NOW()
  `;

  console.log(`✅ ${result} usuários atualizados com a nova senha!`);

  // Lista os usuários
  const users = await prisma.$queryRaw`
    SELECT email, name FROM app_users ORDER BY email
  `;

  console.log(`\nUsuários atualizados:`);
  users.forEach(u => console.log(`  - ${u.email}`));
}

main()
  .catch(e => {
    console.error('Erro:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
