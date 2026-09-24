import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export async function refreshCustomerDebt(
  tx: Tx,
  tenantId: string,
  customerId: string
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{
      total_debt: string | null;
      overdue_debt: string | null;
      pending_count: bigint;
    }>
  >`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status IN ('pending', 'overdue')), 0) AS total_debt,
      COALESCE(SUM(amount) FILTER (WHERE status = 'overdue' OR (status = 'pending' AND due_date < CURRENT_DATE)), 0) AS overdue_debt,
      COUNT(*) FILTER (WHERE status IN ('pending', 'overdue')) AS pending_count
    FROM accounts_receivable
    WHERE tenant_id = ${tenantId}::uuid
      AND customer_id = ${customerId}::uuid
  `;

  const r = rows[0];
  const totalDebt = Number(r?.total_debt ?? 0);
  const overdueDebt = Number(r?.overdue_debt ?? 0);
  const pendingCount = Number(r?.pending_count ?? 0);

  await tx.customerDebtSummary.upsert({
    where: { customerId },
    create: {
      tenantId,
      customerId,
      totalDebt,
      overdueDebt,
      pendingCount,
    },
    update: {
      totalDebt,
      overdueDebt,
      pendingCount,
    },
  });
}
