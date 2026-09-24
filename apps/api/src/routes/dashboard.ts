import type { FastifyPluginAsync } from "fastify";
import { prisma, withTenant } from "@revendedor/database";
import { authenticateUser } from "../lib/auth-guards.js";
import {
  getDailySalesThisMonth,
  getInventoryStats,
  getMonthBusinessStats,
  getTodayBusinessStats,
  getTotalBusinessStats,
} from "../services/dashboard-summary.js";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateUser);

  app.get("/summary", async (req) => {
    const tenantId = req.tenantId!;

    const historical = await withTenant(prisma, tenantId, async (tx) => {
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const [
        today,
        totals,
        month,
        previousMonth,
        inventory,
        dailySales,
        monthly,
        topDebtors,
        expiringBatches,
        recentInvoices,
        dueReceivables,
      ] = await Promise.all([
        getTodayBusinessStats(tx, tenantId),
        getTotalBusinessStats(tx, tenantId),
        getMonthBusinessStats(tx, tenantId, 0),
        getMonthBusinessStats(tx, tenantId, -1),
        getInventoryStats(tx, tenantId),
        getDailySalesThisMonth(tx, tenantId),
        tx.$queryRaw<
          Array<{ month: Date; total_sales: string; total_orders: bigint }>
        >`
            SELECT month, total_sales, total_orders
            FROM secure_monthly_sales
            ORDER BY month DESC
            LIMIT 12
          `,
        tx.customerDebtSummary.findMany({
          where: { totalDebt: { gt: 0 } },
          orderBy: { totalDebt: "desc" },
          take: 5,
          include: {
            customer: { select: { id: true, fullName: true, phone: true } },
          },
        }),
        tx.productBatch.findMany({
          where: {
            quantity: { gt: 0 },
            expirationDate: {
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              gte: new Date(),
            },
          },
          orderBy: { expirationDate: "asc" },
          take: 10,
          include: {
            product: { select: { id: true, name: true } },
          },
        }),
        tx.invoice.findMany({
          where: { status: { not: "canceled" } },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: {
            customer: { select: { fullName: true } },
            accountsReceivable: {
              select: { status: true, amount: true },
              orderBy: { installmentNumber: "asc" },
              take: 1,
            },
          },
        }),
        tx.accountReceivable.findMany({
          where: {
            status: { in: ["pending", "overdue"] },
            dueDate: { lte: in7Days },
          },
          orderBy: { dueDate: "asc" },
          take: 5,
          include: {
            customer: { select: { fullName: true } },
          },
        }),
      ]);

      return {
        today,
        totals,
        month,
        previousMonth,
        inventory,
        dailySales,
        monthly,
        topDebtors,
        expiringBatches,
        recentInvoices,
        dueReceivables,
      };
    });

    return {
      today: historical.today,
      totals: historical.totals,
      month: historical.month,
      previousMonth: historical.previousMonth,
      inventory: historical.inventory,
      dailySales: historical.dailySales,
      monthlySales: historical.monthly.map((m) => ({
        month: m.month,
        totalSales: Number(m.total_sales),
        totalOrders: Number(m.total_orders),
      })),
      topDebtors: historical.topDebtors,
      expiringBatches: historical.expiringBatches,
      recentInvoices: historical.recentInvoices.map((inv) => ({
        id: inv.id,
        totalAmount: Number(inv.totalAmount),
        status: inv.status,
        createdAt: inv.createdAt,
        customerName: inv.customer.fullName,
        paidHint:
          inv.accountsReceivable[0]?.status === "paid" ? "Pago" : "A receber",
      })),
      dueReceivables: historical.dueReceivables.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        dueDate: r.dueDate,
        status: r.status,
        installmentNumber: r.installmentNumber,
        customerName: r.customer.fullName,
      })),
    };
  });

  app.post("/refresh-monthly-sales", async (req, reply) => {
    const adminUrl = process.env.DATABASE_URL_ADMIN;
    if (!adminUrl) {
      return reply.status(501).send({
        error:
          "Defina DATABASE_URL_ADMIN (superuser) para refresh da materialized view",
      });
    }

    const { PrismaClient } = await import("@prisma/client");
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    try {
      await admin.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_sales`;
      return { ok: true };
    } finally {
      await admin.$disconnect();
    }
  });
};
