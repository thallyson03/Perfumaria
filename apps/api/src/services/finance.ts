import type { Prisma } from "@prisma/client";
import { bumpTodaySales } from "./dashboard-metrics.js";
import { refreshCustomerDebt } from "./debt-summary.js";

type Tx = Prisma.TransactionClient;

/**
 * Baixa parcela + (opcional) DEBIT na carteira na mesma transação.
 * Após COMMIT, incrementa counters Redis do dia.
 */
export async function payReceivable(params: {
  tx: Tx;
  tenantId: string;
  receivableId: string;
  useWalletAmount?: number;
  description?: string;
}): Promise<{ amount: number; customerId: string }> {
  const { tx, tenantId, receivableId, useWalletAmount = 0, description } =
    params;

  const receivable = await tx.accountReceivable.findFirst({
    where: { id: receivableId },
  });

  if (!receivable) {
    throw Object.assign(new Error("Parcela não encontrada"), { statusCode: 404 });
  }
  if (receivable.status === "paid") {
    throw Object.assign(new Error("Parcela já paga"), { statusCode: 409 });
  }

  const amount = Number(receivable.amount);
  if (useWalletAmount < 0 || useWalletAmount > amount) {
    throw Object.assign(new Error("Valor de carteira inválido"), {
      statusCode: 400,
    });
  }

  if (useWalletAmount > 0) {
    const balanceRows = await tx.$queryRaw<Array<{ balance: string }>>`
      SELECT COALESCE(
        SUM(CASE WHEN operation_type = 'CREDIT' THEN amount ELSE -amount END),
        0
      ) AS balance
      FROM wallet_ledger
      WHERE customer_id = ${receivable.customerId}::uuid
    `;
    const balance = Number(balanceRows[0]?.balance ?? 0);
    if (balance < useWalletAmount) {
      throw Object.assign(new Error("Saldo de carteira insuficiente"), {
        statusCode: 400,
      });
    }

    await tx.walletLedger.create({
      data: {
        tenantId,
        customerId: receivable.customerId,
        operationType: "DEBIT",
        amount: useWalletAmount,
        description: description ?? `Abatimento parcela ${receivable.installmentNumber}`,
        referenceId: receivable.id,
      },
    });
  }

  await tx.accountReceivable.update({
    where: { id: receivable.id },
    data: { status: "paid" },
  });

  if (receivable.invoiceId) {
    const remaining = await tx.accountReceivable.count({
      where: {
        invoiceId: receivable.invoiceId,
        status: { in: ["pending", "overdue"] },
      },
    });
    await tx.invoice.update({
      where: { id: receivable.invoiceId },
      data: { status: remaining === 0 ? "paid" : "partial" },
    });
  }

  await refreshCustomerDebt(tx, tenantId, receivable.customerId);

  return { amount, customerId: receivable.customerId };
}

export async function afterPaymentCommitted(
  tenantId: string,
  amount: number
): Promise<void> {
  await bumpTodaySales(tenantId, amount, 1);
}
