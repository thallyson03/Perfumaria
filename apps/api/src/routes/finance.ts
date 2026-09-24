import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, withTenant } from "@revendedor/database";
import { authenticateUser } from "../lib/auth-guards.js";
import {
  afterPaymentCommitted,
  payReceivable,
} from "../services/finance.js";
import { refreshCustomerDebt } from "../services/debt-summary.js";
import { createSale } from "../services/sale.js";
import { buildSaleReceipt } from "../services/receipt.js";

const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  totalAmount: z.number().positive(),
  installments: z
    .array(
      z.object({
        installmentNumber: z.number().int().positive(),
        amount: z.number().positive(),
        dueDate: z.string().date(),
      })
    )
    .min(1),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid(),
  items: z
    .array(
      z.object({
        batchId: z.string().uuid(),
        quantity: z.number().int().positive().max(500),
      })
    )
    .min(1)
    .max(50),
  installments: z.number().int().min(1).max(12).default(1),
  payNow: z.boolean().optional().default(false),
  useWalletAmount: z.number().min(0).optional().default(0),
});

const paySchema = z.object({
  useWalletAmount: z.number().min(0).optional().default(0),
  description: z.string().max(255).optional(),
});

const creditWalletSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.number().positive(),
  description: z.string().max(255).optional(),
});

export const financeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateUser);

  /** Venda pelo painel: produtos + estoque + fatura + parcelas */
  app.post("/sales", async (req, reply) => {
    const parsed = createSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    try {
      const result = await withTenant(prisma, tenantId, async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: parsed.data.customerId },
        });
        if (!customer) {
          throw Object.assign(new Error("Cliente não encontrado"), {
            statusCode: 404,
          });
        }
        return createSale(tx, tenantId, parsed.data.customerId, parsed.data.items, {
          installments: parsed.data.installments,
          payNow: parsed.data.payNow,
          useWalletAmount: parsed.data.useWalletAmount,
        });
      });

      if (result.paidNow > 0) {
        await afterPaymentCommitted(tenantId, result.paidNow);
      }

      return reply.status(201).send({
        invoiceId: result.invoice.id,
        totalAmount: result.total,
        paidNow: result.paidNow,
        status: result.invoice.status,
        items: result.invoice.items,
        installments: result.invoice.accountsReceivable,
      });
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  app.post("/invoices", async (req, reply) => {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const sumInstallments = parsed.data.installments.reduce(
      (s, i) => s + i.amount,
      0
    );
    if (Math.abs(sumInstallments - parsed.data.totalAmount) > 0.009) {
      return reply.status(400).send({
        error: "Soma das parcelas deve igualar totalAmount",
      });
    }

    const tenantId = req.tenantId!;
    const result = await withTenant(prisma, tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: parsed.data.customerId },
      });
      if (!customer) return null;

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          customerId: parsed.data.customerId,
          totalAmount: parsed.data.totalAmount,
          status: "pending",
          accountsReceivable: {
            create: parsed.data.installments.map((i) => ({
              tenantId,
              customerId: parsed.data.customerId,
              installmentNumber: i.installmentNumber,
              amount: i.amount,
              dueDate: new Date(i.dueDate),
              status: "pending",
            })),
          },
        },
        include: { accountsReceivable: true },
      });

      await refreshCustomerDebt(tx, tenantId, parsed.data.customerId);
      return invoice;
    });

    if (!result) {
      return reply.status(404).send({ error: "Cliente não encontrado" });
    }
    return reply.status(201).send(result);
  });

  app.get("/invoices/:id/receipt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    const receipt = await withTenant(prisma, tenantId, (tx) =>
      buildSaleReceipt(tx, tenantId, id)
    );

    if (!receipt) {
      return reply.status(404).send({ error: "Venda não encontrada" });
    }

    return receipt;
  });

  app.get("/receivables", async (req) => {
    const tenantId = req.tenantId!;
    const query = req.query as {
      status?: string;
      customerId?: string;
      q?: string;
    };

    return withTenant(prisma, tenantId, (tx) => {
      const where: Parameters<
        typeof tx.accountReceivable.findMany
      >[0]["where"] = {};

      if (query.status === "open") {
        where.status = { in: ["pending", "overdue"] };
      } else if (query.status) {
        where.status = query.status as "pending" | "paid" | "overdue";
      }

      if (query.customerId) {
        where.customerId = query.customerId;
      }

      const term = query.q?.trim();
      if (term) {
        where.customer = {
          OR: [
            { fullName: { contains: term, mode: "insensitive" } },
            { phone: { contains: term } },
            { documentCpf: { contains: term } },
          ],
        };
      }

      return tx.accountReceivable.findMany({
        where,
        orderBy: [{ dueDate: "asc" }],
        include: {
          customer: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              documentCpf: true,
              email: true,
            },
          },
          invoice: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              createdAt: true,
            },
          },
        },
      });
    });
  });

  app.post("/receivables/:id/pay", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = paySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    try {
      const paid = await withTenant(prisma, tenantId, (tx) =>
        payReceivable({
          tx,
          tenantId,
          receivableId: id,
          useWalletAmount: parsed.data.useWalletAmount,
          description: parsed.data.description,
        })
      );
      await afterPaymentCommitted(tenantId, paid.amount);
      return { ok: true, amount: paid.amount };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  app.post("/wallet/credit", async (req, reply) => {
    const parsed = creditWalletSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const tenantId = req.tenantId!;
    const entry = await withTenant(prisma, tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: parsed.data.customerId },
      });
      if (!customer) return null;
      return tx.walletLedger.create({
        data: {
          tenantId,
          customerId: parsed.data.customerId,
          operationType: "CREDIT",
          amount: parsed.data.amount,
          description: parsed.data.description ?? "Crédito manual",
        },
      });
    });
    if (!entry) {
      return reply.status(404).send({ error: "Cliente não encontrado" });
    }
    return reply.status(201).send(entry);
  });

  app.get("/wallet/:customerId/balance", async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    const tenantId = req.tenantId!;
    const balance = await withTenant(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ balance: string }>>`
        SELECT COALESCE(
          SUM(CASE WHEN operation_type = 'CREDIT' THEN amount ELSE -amount END),
          0
        ) AS balance
        FROM wallet_ledger
        WHERE customer_id = ${customerId}::uuid
      `;
      return Number(rows[0]?.balance ?? 0);
    });
    return reply.send({ customerId, balance });
  });
};
