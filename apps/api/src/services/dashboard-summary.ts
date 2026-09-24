import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";

type Tx = PrismaTypes.TransactionClient;

export type BusinessStats = {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalOrders: number;
};

export type TodayBusinessStats = BusinessStats;

export type InventoryStats = {
  totalUnits: number;
  productsInStock: number;
  /** Custo de compra das unidades disponíveis em estoque */
  totalCost: number;
};

async function queryBusinessStats(
  tx: Tx,
  tenantId: string,
  options?: { todayOnly?: boolean; monthOffset?: number }
): Promise<BusinessStats> {
  let periodFilter = Prisma.empty;
  if (options?.todayOnly) {
    periodFilter = Prisma.sql`AND i.created_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;
  } else if (options?.monthOffset != null) {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getFullYear(), now.getMonth() + options.monthOffset, 1)
    );
    const end = new Date(
      Date.UTC(now.getFullYear(), now.getMonth() + options.monthOffset + 1, 1)
    );
    periodFilter = Prisma.sql`AND i.created_at >= ${start} AND i.created_at < ${end}`;
  }

  const rows = await tx.$queryRaw<
    Array<{
      total_revenue: string;
      total_cost: string;
      total_orders: bigint;
    }>
  >`
    SELECT
      COALESCE(SUM(ii.line_total), 0) AS total_revenue,
      COALESCE(SUM(COALESCE(p.cost, 0) * ii.quantity), 0) AS total_cost,
      COUNT(DISTINCT i.id) AS total_orders
    FROM invoices i
    INNER JOIN invoice_items ii ON ii.invoice_id = i.id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE i.tenant_id = ${tenantId}::uuid
      AND i.status != 'canceled'
      ${periodFilter}
  `;

  const row = rows[0];
  const totalRevenue = Number(row?.total_revenue ?? 0);
  const totalCost = Number(row?.total_cost ?? 0);

  return {
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    totalOrders: Number(row?.total_orders ?? 0),
  };
}

/** Vendas, custo e lucro do dia (fuso America/Sao_Paulo) com base nas faturas emitidas. */
export async function getTodayBusinessStats(
  tx: Tx,
  tenantId: string
): Promise<TodayBusinessStats> {
  return queryBusinessStats(tx, tenantId, { todayOnly: true });
}

/** Vendas, custo e lucro acumulados (todas as faturas). */
export async function getTotalBusinessStats(
  tx: Tx,
  tenantId: string
): Promise<BusinessStats> {
  return queryBusinessStats(tx, tenantId);
}

/** Vendas do mês corrente (offset 0) ou mês anterior (offset -1). */
export async function getMonthBusinessStats(
  tx: Tx,
  tenantId: string,
  monthOffset = 0
): Promise<BusinessStats> {
  return queryBusinessStats(tx, tenantId, { monthOffset });
}

/** Unidades disponíveis e produtos distintos com estoque (lotes). */
export async function getInventoryStats(
  tx: Tx,
  tenantId: string
): Promise<InventoryStats> {
  const rows = await tx.$queryRaw<
    Array<{
      total_units: bigint;
      products_in_stock: bigint;
      total_cost: string;
    }>
  >`
    SELECT
      COALESCE(SUM(GREATEST(pb.quantity - pb.reserved_quantity, 0)), 0) AS total_units,
      COUNT(DISTINCT pb.product_id) FILTER (
        WHERE pb.quantity - pb.reserved_quantity > 0
      ) AS products_in_stock,
      COALESCE(SUM(
        GREATEST(pb.quantity - pb.reserved_quantity, 0) * COALESCE(p.cost, 0)
      ), 0) AS total_cost
    FROM product_batches pb
    INNER JOIN products p ON p.id = pb.product_id
    WHERE pb.tenant_id = ${tenantId}::uuid
  `;

  const row = rows[0];
  return {
    totalUnits: Number(row?.total_units ?? 0),
    productsInStock: Number(row?.products_in_stock ?? 0),
    totalCost: Number(row?.total_cost ?? 0),
  };
}

/** Faturamento diário do mês corrente (para gráfico). */
export async function getDailySalesThisMonth(
  tx: Tx,
  tenantId: string
): Promise<Array<{ day: string; totalSales: number; totalOrders: number }>> {
  const rows = await tx.$queryRaw<
    Array<{ day: Date; total_sales: string; total_orders: bigint }>
  >`
    SELECT
      date_trunc('day', i.created_at AT TIME ZONE 'America/Sao_Paulo') AS day,
      COALESCE(SUM(ii.line_total), 0) AS total_sales,
      COUNT(DISTINCT i.id) AS total_orders
    FROM invoices i
    INNER JOIN invoice_items ii ON ii.invoice_id = i.id
    WHERE i.tenant_id = ${tenantId}::uuid
      AND i.status != 'canceled'
      AND i.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map((r) => ({
    day: r.day.toISOString(),
    totalSales: Number(r.total_sales),
    totalOrders: Number(r.total_orders),
  }));
}
