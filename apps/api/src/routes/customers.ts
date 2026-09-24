import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, withTenant } from "@revendedor/database";
import { authenticateUser } from "../lib/auth-guards.js";
import { createCustomerAddress } from "../services/customer-address.js";

const addressSchema = z.object({
  recipientName: z.string().min(2).max(255).optional(),
  phone: z.string().min(8).max(20).optional(),
  zipCode: z.string().min(8).max(9),
  street: z.string().min(2).max(255),
  number: z.string().min(1).max(20),
  complement: z.string().max(100).optional().nullable(),
  neighborhood: z.string().min(2).max(100),
  city: z.string().min(2).max(100),
  state: z.string().length(2),
  label: z.string().max(50).optional(),
});

const createCustomerSchema = z.object({
  fullName: z.string().min(2).max(255),
  phone: z.string().max(20).optional(),
  documentCpf: z.string().max(14).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  address: addressSchema.optional(),
});

function digitsOnly(value?: string | null) {
  return value?.replace(/\D/g, "") ?? "";
}

export const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateUser);

  app.get("/", async (req) => {
    const tenantId = req.tenantId!;
    return withTenant(prisma, tenantId, async (tx) => {
      const customers = await tx.customer.findMany({
        orderBy: { createdAt: "desc" },
        include: { debtSummary: true },
      });

      const mapped = customers.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        phone: c.phone,
        documentCpf: c.documentCpf,
        email: c.email,
        createdAt: c.createdAt,
        totalDebt: Number(c.debtSummary?.totalDebt ?? 0),
        overdueDebt: Number(c.debtSummary?.overdueDebt ?? 0),
        pendingCount: c.debtSummary?.pendingCount ?? 0,
      }));

      const withDebt = mapped.filter((c) => c.totalDebt > 0).length;
      const overdue = mapped.filter((c) => c.overdueDebt > 0).length;
      const withEmail = mapped.filter((c) => Boolean(c.email)).length;

      const purchaseRows = await tx.$queryRaw<
        Array<{ avg_ticket: string; total_revenue: string; buyers: bigint }>
      >`
        SELECT
          COALESCE(AVG(i.total_amount), 0) AS avg_ticket,
          COALESCE(SUM(i.total_amount), 0) AS total_revenue,
          COUNT(DISTINCT i.customer_id) AS buyers
        FROM invoices i
        WHERE i.tenant_id = ${tenantId}::uuid
          AND i.status != 'canceled'
      `;

      const avgTicket = Number(purchaseRows[0]?.avg_ticket ?? 0);
      const buyers = Number(purchaseRows[0]?.buyers ?? 0);
      const ltv =
        buyers > 0
          ? Number(purchaseRows[0]?.total_revenue ?? 0) / buyers
          : 0;

      return {
        items: mapped,
        stats: {
          total: mapped.length,
          withDebt,
          overdue,
          withEmail,
          avgTicket,
          ltv,
        },
      };
    });
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    const detail = await withTenant(prisma, tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id },
        include: { debtSummary: true, addresses: true },
      });
      if (!customer) return null;

      const invoices = await tx.invoice.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            orderBy: { productName: "asc" },
          },
          accountsReceivable: {
            orderBy: { installmentNumber: "asc" },
          },
        },
      });

      const walletRows = await tx.$queryRaw<Array<{ balance: string }>>`
        SELECT COALESCE(
          SUM(CASE WHEN operation_type = 'CREDIT' THEN amount ELSE -amount END),
          0
        ) AS balance
        FROM wallet_ledger
        WHERE customer_id = ${id}::uuid
      `;

      const ledger = await tx.walletLedger.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      const receivables = invoices.flatMap((inv) => inv.accountsReceivable);
      const openReceivables = receivables.filter((r) =>
        ["pending", "overdue"].includes(r.status)
      );
      const paidReceivables = receivables.filter((r) => r.status === "paid");

      const purchasedProducts = new Map<
        string,
        {
          productId: string | null;
          productName: string;
          quantity: number;
          totalSpent: number;
        }
      >();
      for (const inv of invoices) {
        for (const item of inv.items) {
          const key = item.productId ?? item.productName;
          const prev = purchasedProducts.get(key) ?? {
            productId: item.productId,
            productName: item.productName,
            quantity: 0,
            totalSpent: 0,
          };
          prev.quantity += item.quantity;
          prev.totalSpent += Number(item.lineTotal);
          purchasedProducts.set(key, prev);
        }
      }

      return {
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          phone: customer.phone,
          documentCpf: customer.documentCpf,
          email: customer.email,
          createdAt: customer.createdAt,
        },
        addresses: customer.addresses,
        summary: {
          totalDebt: Number(customer.debtSummary?.totalDebt ?? 0),
          overdueDebt: Number(customer.debtSummary?.overdueDebt ?? 0),
          pendingInstallments:
            customer.debtSummary?.pendingCount ?? openReceivables.length,
          totalPurchased: invoices.reduce(
            (s, i) => s + Number(i.totalAmount),
            0
          ),
          totalPaid: paidReceivables.reduce((s, r) => s + Number(r.amount), 0),
          walletBalance: Number(walletRows[0]?.balance ?? 0),
          invoicesCount: invoices.length,
        },
        purchasedProducts: [...purchasedProducts.values()].sort(
          (a, b) => b.totalSpent - a.totalSpent
        ),
        invoices: invoices.map((inv) => ({
          id: inv.id,
          totalAmount: Number(inv.totalAmount),
          status: inv.status,
          createdAt: inv.createdAt,
          items: inv.items.map((it) => ({
            id: it.id,
            productId: it.productId,
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: Number(it.unitPrice),
            lineTotal: Number(it.lineTotal),
          })),
          installments: inv.accountsReceivable.map((r) => ({
            id: r.id,
            installmentNumber: r.installmentNumber,
            amount: Number(r.amount),
            dueDate: r.dueDate,
            status: r.status,
          })),
        })),
        ledger: ledger.map((l) => ({
          id: l.id,
          operationType: l.operationType,
          amount: Number(l.amount),
          description: l.description,
          createdAt: l.createdAt,
        })),
      };
    });

    if (!detail) {
      return reply.status(404).send({ error: "Cliente não encontrado" });
    }
    return detail;
  });

  app.post("/", async (req, reply) => {
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    const cpf = digitsOnly(parsed.data.documentCpf) || undefined;
    const email = parsed.data.email?.trim() || undefined;
    const phone = parsed.data.phone?.trim() || undefined;

    try {
      const customer = await withTenant(prisma, tenantId, async (tx) => {
        const created = await tx.customer.create({
          data: {
            tenantId,
            fullName: parsed.data.fullName.trim(),
            phone,
            documentCpf: cpf,
            email,
          },
        });

        if (parsed.data.address) {
          await createCustomerAddress(tx, tenantId, created.id, {
            recipientName:
              parsed.data.address.recipientName?.trim() ||
              parsed.data.fullName.trim(),
            phone: parsed.data.address.phone?.trim() || phone || "00000000000",
            zipCode: parsed.data.address.zipCode,
            street: parsed.data.address.street,
            number: parsed.data.address.number,
            complement: parsed.data.address.complement ?? null,
            neighborhood: parsed.data.address.neighborhood,
            city: parsed.data.address.city,
            state: parsed.data.address.state.toUpperCase(),
            label: parsed.data.address.label ?? "Residencial",
            isDefault: true,
          });
        }

        return created;
      });

      return reply.status(201).send(customer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao cadastrar";
      if (
        message.includes("Unique constraint") ||
        message.includes("unique")
      ) {
        return reply.status(409).send({
          error: "Já existe cliente com este CPF ou e-mail nesta loja.",
        });
      }
      return reply.status(500).send({ error: message });
    }
  });
};
