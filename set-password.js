const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.log('Uso: node set-password.js <email> <senha>');
    console.log('Exemplo: node set-password.js admin@email.com minhasenha123');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Verifica se o usuário existe
  let user = await prisma.appUser.findUnique({ where: { email } });

  if (user) {
    // Atualiza senha do usuário existente
    user = await prisma.appUser.update({
      where: { email },
      data: { password_hash: passwordHash }
    });
    console.log(`✅ Senha atualizada para: ${user.email}`);
  } else {
    // Cria novo usuário
    user = await prisma.$executeRaw`
      INSERT INTO app_users (email, password_hash, role, status, created_at, updated_at)
      VALUES (${email}, ${passwordHash}, 'master_br', 'active', NOW(), NOW())
    `;
    console.log(`✅ Usuário criado: ${email}`);
  }
}

main()
  .catch(e => {
    console.error('Erro:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
