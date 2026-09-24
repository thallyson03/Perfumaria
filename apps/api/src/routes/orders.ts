import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, withTenant } from "@revendedor/database";
import { authenticateUser } from "../lib/auth-guards.js";
import { afterPaymentCommitted } from "../services/finance.js";
import {
  cancelSalesOrder,
  confirmSalesOrder,
} from "../services/order.js";

const confirmSchema = z.object({
  installments: z.number().int().min(1).max(12).default(1),
  payNow: z.boolean().optional().default(false),
  useWalletAmount: z.number().min(0).optional().default(0),
});

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateUser);

  app.get("/", async (req) => {
    const tenantId = req.tenantId!;
    const status = (req.query as { status?: string }).status;
    return withTenant(prisma, tenantId, (tx) =>
      tx.salesOrder.findMany({
        where: status
          ? {
              status: status as
                | "awaiting_seller"
                | "pending_payment"
                | "confirmed"
                | "cancelled"
                | "expired",
            }
          : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          customer: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              documentCpf: true,
            },
          },
        },
        take: 100,
      })
    );
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const order = await withTenant(prisma, tenantId, (tx) =>
      tx.salesOrder.findFirst({
        where: { id },
        include: { items: true },
      })
    );
    if (!order) {
      return reply.status(404).send({ error: "Pedido não encontrado" });
    }
    return order;
  });

  app.post("/:id/confirm", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = confirmSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    try {
      const result = await withTenant(prisma, tenantId, (tx) =>
        confirmSalesOrder(tx, tenantId, id, parsed.data)
      );
      if (result.paidNow > 0) {
        await afterPaymentCommitted(tenantId, result.paidNow);
      }
      return { ok: true, invoiceId: result.invoiceId, paidNow: result.paidNow };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  app.post("/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    try {
      await withTenant(prisma, tenantId, (tx) =>
        cancelSalesOrder(tx, tenantId, id, "cancelled")
      );
      return { ok: true };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });
};
