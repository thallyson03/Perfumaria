import type { Prisma } from "@prisma/client";
import {
  commitBatchReservation,
  reserveBatchStock,
} from "./stock.js";
import { getEffectivePrice } from "../lib/product-price.js";import { refreshCustomerDebt } from "./debt-summary.js";
import { payReceivable } from "./finance.js";

type Tx = Prisma.TransactionClient;

export type SaleItemInput = {
  batchId: string;
  quantity: number;
  /** Carrinho vitrine: reserva Redis já incrementou reserved_quantity */
  skipReserve?: boolean;
  unitPrice?: number;
  productName?: string;
};

export type CreateSaleOptions = {
  installments?: number;
  /** Baixa parcelas na hora (balcão à vista ou recebimento imediato) */
  payNow?: boolean;
  useWalletAmount?: number;
  /** Dias entre parcelas (padrão 30) */
  daysBetweenInstallments?: number;
};

export type CreateSaleResult = {
  invoice: Awaited<ReturnType<typeof createInvoiceRecord>>;
  total: number;
  paidNow: number;
};

async function createInvoiceRecord(
  tx: Tx,
  params: {
    tenantId: string;
    customerId: string;
    total: number;
    lineItems: Array<{
      productId: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }>;
    installmentRows: Array<{
      installmentNumber: number;
      amount: number;
      dueDate: Date;
    }>;
  }
) {
  return tx.invoice.create({
    data: {
      tenantId: params.tenantId,
      customerId: params.customerId,
      totalAmount: params.total,
      status: "pending",
      items: {
        create: params.lineItems.map((li) => ({
          tenantId: params.tenantId,
          productId: li.productId,
          productName: li.productName,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
        })),
      },
      accountsReceivable: {
        create: params.installmentRows.map((i) => ({
          tenantId: params.tenantId,
          customerId: params.customerId,
          installmentNumber: i.installmentNumber,
          amount: i.amount,
          dueDate: i.dueDate,
          status: "pending",
        })),
      },
    },
    include: { accountsReceivable: true, items: true },
  });
}

function buildInstallments(
  total: number,
  count: number,
  daysBetween: number
): Array<{ installmentNumber: number; amount: number; dueDate: Date }> {
  const base = Math.floor((total / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => {
    const amount =
      i === count - 1
        ? Math.round((total - base * (count - 1)) * 100) / 100
        : base;
    const due = new Date();
    due.setDate(due.getDate() + daysBetween * (i + 1));
    return { installmentNumber: i + 1, amount, dueDate: due };
  });
}

/**
 * Venda com baixa de estoque (lote), itens da fatura e parcelas.
 * Usado pelo painel (balcão) e pela vitrine.
 */
export async function createSale(
  tx: Tx,
  tenantId: string,
  customerId: string,
  items: SaleItemInput[],
  options: CreateSaleOptions = {}
): Promise<CreateSaleResult> {
  if (items.length === 0) {
    throw Object.assign(new Error("Adicione ao menos um item"), { statusCode: 400 });
  }

  const installmentCount = options.installments ?? 1;
  const daysBetween = options.daysBetweenInstallments ?? 30;

  let total = 0;
  const lineItems: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }> = [];

  for (const item of items) {
    if (!item.skipReserve) {
      const ok = await reserveBatchStock(tx, item.batchId, item.quantity);
      if (!ok) {
        throw Object.assign(
          new Error(`Estoque insuficiente no lote ${item.batchId.slice(0, 8)}`),
          { statusCode: 409 }
        );
      }
    }

    const batch = await tx.productBatch.findFirst({
      where: { id: item.batchId },
      include: { product: true },
    });
    if (!batch || !batch.product.isActive) {
      throw Object.assign(new Error("Lote ou produto inválido"), {
        statusCode: 400,
      });
    }

    const unitPrice =
      item.unitPrice != null && Number.isFinite(item.unitPrice)
        ? Number(item.unitPrice)
        : getEffectivePrice(batch.product);
    const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
    total += lineTotal;
    lineItems.push({
      productId: batch.productId,
      productName: item.productName?.trim() || batch.product.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    });
    await commitBatchReservation(tx, item.batchId, item.quantity);
  }

  const installmentRows = buildInstallments(total, installmentCount, daysBetween);
  const invoice = await createInvoiceRecord(tx, {
    tenantId,
    customerId,
    total,
    lineItems,
    installmentRows,
  });

  let paidNow = 0;
  let walletLeft = options.useWalletAmount ?? 0;

  if (options.payNow) {
    const sorted = [...invoice.accountsReceivable].sort(
      (a, b) => a.installmentNumber - b.installmentNumber
    );
    for (const rec of sorted) {
      const walletForThis = Math.min(walletLeft, Number(rec.amount));
      const paid = await payReceivable({
        tx,
        tenantId,
        receivableId: rec.id,
        useWalletAmount: walletForThis,
        description: "Pagamento na venda (painel)",
      });
      walletLeft -= walletForThis;
      paidNow += paid.amount;
    }
  }

  await refreshCustomerDebt(tx, tenantId, customerId);

  return { invoice, total, paidNow };
}
