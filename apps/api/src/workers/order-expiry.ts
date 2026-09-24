import type { FastifyBaseLogger } from "fastify";
import { prisma, withTenant } from "@revendedor/database";
import { cancelSalesOrder } from "../services/order.js";

const INTERVAL_MS = Number(process.env.ORDER_EXPIRY_INTERVAL_MS ?? 60_000);

export function startOrderExpiryScheduler(log: FastifyBaseLogger): void {
  async function run() {
    try {
      const now = new Date();
      const tenants = await prisma.tenant.findMany({
        where: { active: true },
        select: { id: true },
      });

      let total = 0;
      for (const t of tenants) {
        const expired = await withTenant(prisma, t.id, (tx) =>
          tx.salesOrder.findMany({
            where: {
              status: { in: ["awaiting_seller", "pending_payment"] },
              expiresAt: { lt: now },
            },
            select: { id: true },
            take: 20,
          })
        );

        for (const order of expired) {
          try {
            await withTenant(prisma, t.id, (tx) =>
              cancelSalesOrder(tx, t.id, order.id, "expired")
            );
            total += 1;
          } catch (err) {
            log.warn({ err, orderId: order.id }, "Falha ao expirar pedido");
          }
        }
      }

      if (total > 0) {
        log.info({ count: total }, "Pedidos expirados");
      }
    } catch (err) {
      log.error({ err }, "Order expiry scheduler error");
    }
  }

  void run();
  setInterval(run, INTERVAL_MS);
}
