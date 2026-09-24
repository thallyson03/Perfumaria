import { PrismaClient } from "@prisma/client";

const password = process.env.APP_DB_PASSWORD;
if (!password) {
  console.error("APP_DB_PASSWORD is required for sync");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe(
    `ALTER ROLE revendedor_app WITH PASSWORD '${password.replace(/'/g, "''")}'`
  );
  console.log("[api] revendedor_app password updated");
} finally {
  await prisma.$disconnect();
}
