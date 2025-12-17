const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.appUser.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      password_hash: true,
    },
    take: 10
  });

  console.log('Usuários encontrados:', users.length);
  users.forEach(u => {
    console.log(`- ${u.email} | Status: ${u.status} | Tem senha: ${!!u.password_hash}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
