import { PrismaClient } from "@prisma/client";
import { prisma, withTenant } from "@revendedor/database";
import { enqueueWhatsAppAlert } from "../services/whatsapp-alert.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function markOverdueAsAppRole(): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { active: true },
    select: { id: true },
  });

  let total = 0;
  const today = new Date(new Date().toISOString().slice(0, 10));

  for (const t of tenants) {
    const n = await withTenant(prisma, t.id, (tx) =>
      tx.accountReceivable.updateMany({
        where: {
          status: "pending",
          dueDate: { lt: today },
        },
        data: { status: "overdue" },
      })
    );
    total += n.count;
  }
  return total;
}

async function refreshAllDebtSummaries(): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { active: true },
    select: { id: true },
  });

  let customers = 0;
  for (const t of tenants) {
    await withTenant(prisma, t.id, async (tx) => {
      const list = await tx.customer.findMany({ select: { id: true } });
      for (const c of list) {
        const rows = await tx.$queryRaw<
          Array<{
            total_debt: string;
            overdue_debt: string;
            pending_count: bigint;
          }>
        >`
          SELECT
            COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'overdue')), 0) AS total_debt,
            COALESCE(SUM(amount) FILTER (
              WHERE status = 'overdue' OR (status = 'pending' AND due_date < CURRENT_DATE)
            ), 0) AS overdue_debt,
            COUNT(*) FILTER (WHERE status IN ('pending', 'overdue')) AS pending_count
          FROM accounts_receivable
          WHERE customer_id = ${c.id}::uuid
        `;
        const r = rows[0];
        await tx.customerDebtSummary.upsert({
          where: { customerId: c.id },
          create: {
            tenantId: t.id,
            customerId: c.id,
            totalDebt: Number(r?.total_debt ?? 0),
            overdueDebt: Number(r?.overdue_debt ?? 0),
            pendingCount: Number(r?.pending_count ?? 0),
          },
          update: {
            totalDebt: Number(r?.total_debt ?? 0),
            overdueDebt: Number(r?.overdue_debt ?? 0),
            pendingCount: Number(r?.pending_count ?? 0),
          },
        });
        customers += 1;
      }
    });
  }
  return customers;
}

async function enqueueExpiryAlerts(): Promise<number> {
  const tenants = await prisma.tenant.findMany({
    where: { active: true },
    select: { id: true, name: true, subdomain: true },
  });

  let pushed = 0;
  const until = new Date(Date.now() + 30 * DAY_MS);

  for (const t of tenants) {
    const batches = await withTenant(prisma, t.id, (tx) =>
      tx.productBatch.findMany({
        where: {
          quantity: { gt: 0 },
          expirationDate: { gte: new Date(), lte: until },
        },
        include: { product: { select: { name: true } } },
      })
    );

    const overdue = await withTenant(prisma, t.id, (tx) =>
      tx.accountReceivable.findMany({
        where: {
          status: { in: ["overdue", "pending"] },
          dueDate: { lt: new Date() },
        },
        include: { customer: { select: { fullName: true, phone: true } } },
        take: 100,
      })
    );

    if (batches.length === 0 && overdue.length === 0) continue;

    const payload = {
      type: "daily_alerts",
      tenantId: t.id,
      tenantName: t.name,
      subdomain: t.subdomain,
      expiringBatches: batches.map((b) => ({
        product: b.product.name,
        batchNumber: b.batchNumber,
        expirationDate: b.expirationDate,
        quantity: b.quantity,
      })),
      overdueReceivables: overdue.map((r) => ({
        customer: r.customer.fullName,
        phone: r.customer.phone,
        amount: Number(r.amount),
        dueDate: r.dueDate,
      })),
      createdAt: new Date().toISOString(),
    };

    await enqueueWhatsAppAlert(payload);
    pushed += 1;
  }

  return pushed;
}

async function refreshMonthlySalesMv(): Promise<boolean> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!adminUrl) return false;

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_sales`;
    return true;
  } catch {
    try {
      await admin.$executeRaw`REFRESH MATERIALIZED VIEW mv_monthly_sales`;
      return true;
    } catch {
      return false;
    }
  } finally {
    await admin.$disconnect();
  }
}

export async function runDailyJobs(log = console): Promise<void> {
  const overdue = await markOverdueAsAppRole();
  const debts = await refreshAllDebtSummaries();
  const alerts = await enqueueExpiryAlerts();
  const mv = await refreshMonthlySalesMv();

  log.info?.({ overdue, debts, alerts, mv }, "Daily jobs concluídos");
}

/** Em MVP: roda na subida e a cada 6h (n8n/cron pode substituir). */
export function startDailyJobsScheduler(log = console): NodeJS.Timeout {
  const intervalMs = Number(
    process.env.DAILY_JOBS_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  void runDailyJobs(log).catch((err) =>
    log.error?.({ err }, "Falha no daily job inicial")
  );

  return setInterval(() => {
    void runDailyJobs(log).catch((err) =>
      log.error?.({ err }, "Falha no daily job")
    );
  }, intervalMs);
}
