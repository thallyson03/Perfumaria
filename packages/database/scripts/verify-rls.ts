import { PrismaClient } from "@prisma/client";
import { withTenant } from "../src/with-tenant";

/**
 * Smoke test de isolamento RLS (usa role da aplicação, sem BYPASSRLS).
 * Rode com: npm run db:verify-rls
 */
async function main() {
  const adminUrl =
    process.env.DATABASE_URL ??
    "postgresql://revendedor:revendedor@localhost:5434/revendedor?schema=public";
  const appUrl =
    process.env.DATABASE_URL_APP ??
    "postgresql://revendedor_app:revendedor_app@localhost:5434/revendedor?schema=public";

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });

  const a = await admin.tenant.create({
    data: { name: "Loja A", subdomain: `rls-a-${Date.now()}` },
  });
  const b = await admin.tenant.create({
    data: { name: "Loja B", subdomain: `rls-b-${Date.now()}` },
  });

  await withTenant(app, a.id, (tx) =>
    tx.customer.create({
      data: { tenantId: a.id, fullName: "Cliente A" },
    })
  );
  await withTenant(app, b.id, (tx) =>
    tx.customer.create({
      data: { tenantId: b.id, fullName: "Cliente B" },
    })
  );

  const onlyA = await withTenant(app, a.id, (tx) => tx.customer.findMany());
  const onlyB = await withTenant(app, b.id, (tx) => tx.customer.findMany());
  const withoutCtx = await app.customer.findMany();

  const leakA = onlyA.some((c) => c.fullName === "Cliente B");
  const leakB = onlyB.some((c) => c.fullName === "Cliente A");
  const openQueryBlocked = withoutCtx.length === 0;

  console.log({
    tenantA_count: onlyA.length,
    tenantB_count: onlyB.length,
    withoutTenantContext: withoutCtx.length,
    leakDetected: leakA || leakB,
    openQueryBlocked,
  });

  if (leakA || leakB || !openQueryBlocked) {
    process.exitCode = 1;
    console.error("FALHA: RLS não isolou corretamente");
  } else {
    console.log("OK: RLS isolou os tenants");
  }

  await admin.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await app.$disconnect();
  await admin.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
