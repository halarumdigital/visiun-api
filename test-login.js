const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const password = process.argv[3] || 'Mudar@123';

  if (!email) {
    console.log('Uso: node test-login.js <email> [senha]');
    process.exit(1);
  }

  console.log(`\n🔍 Testando login para: "${email}"`);
  console.log(`   Senha: "${password}"\n`);

  // Busca o usuário (email exato)
  let user = await prisma.appUser.findUnique({
    where: { email: email }
  });

  if (!user) {
    // Tenta com toLowerCase
    user = await prisma.appUser.findUnique({
      where: { email: email.toLowerCase() }
    });
  }

  if (!user) {
    // Tenta com trim
    user = await prisma.appUser.findUnique({
      where: { email: email.trim() }
    });
  }

  if (!user) {
    console.log('❌ Usuário NÃO encontrado no banco');

    // Lista emails similares
    const similar = await prisma.$queryRaw`
      SELECT email FROM app_users
      WHERE email ILIKE ${'%' + email.split('@')[0] + '%'}
      LIMIT 5
    `;
    if (similar.length > 0) {
      console.log('\n📧 Emails similares encontrados:');
      similar.forEach(u => console.log(`   "${u.email}"`));
    }
    return;
  }

  console.log('✅ Usuário encontrado:');
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: "${user.email}"`);
  console.log(`   Nome: ${user.name || '(não definido)'}`);
  console.log(`   Status: ${user.status}`);
  console.log(`   Role: ${user.role}`);
  console.log(`   Tem senha: ${!!user.password_hash}`);
  console.log(`   Locked until: ${user.locked_until || 'não bloqueado'}`);
  console.log(`   Failed attempts: ${user.failed_login_attempts}`);

  if (!user.password_hash) {
    console.log('\n❌ PROBLEMA: Usuário não tem senha definida!');
    return;
  }

  // Testa a senha
  console.log('\n🔐 Verificando senha...');
  const isValid = await bcrypt.compare(password, user.password_hash);

  if (isValid) {
    console.log('✅ Senha CORRETA!');
  } else {
    console.log('❌ Senha INCORRETA!');
    console.log(`   Hash no banco: ${user.password_hash.substring(0, 20)}...`);
  }

  // Verifica status
  if (user.status !== 'active') {
    console.log(`\n⚠️  ATENÇÃO: Status do usuário é "${user.status}", não "active"`);
  }
}

main()
  .catch(e => console.error('Erro:', e))
  .finally(() => prisma.$disconnect());
