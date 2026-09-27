import type { Prisma } from "@prisma/client";
import {
  commitBatchReservation,
  consumeProductFifo,
  reserveBatchStock,
  restoreProductStock,
} from "./stock.js";
import { getEffectivePrice } from "../lib/product-price.js";import { refreshCustomerDebt } from "./debt-summary.js";
import { payReceivable } from "./finance.js";

type Tx = Prisma.TransactionClient;

export type SaleEditItemInput = {
  batchId?: string;
  productId?: string;
  quantity: number;
  unitPrice: number;
  productName?: string;
};

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
  /** Vencimento da 1ª parcela. As seguintes somam o intervalo. */
  firstDueDate?: Date;
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

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function buildInstallments(
  total: number,
  count: number,
  daysBetween: number,
  firstDueDate?: Date
): Array<{ installmentNumber: number; amount: number; dueDate: Date }> {
  const base = Math.floor((total / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => {
    const amount =
      i === count - 1
        ? Math.round((total - base * (count - 1)) * 100) / 100
        : base;
    let due: Date;
    if (firstDueDate) {
      due = addUtcDays(firstDueDate, daysBetween * i);
    } else {
      due = new Date();
      due.setDate(due.getDate() + daysBetween * (i + 1));
    }
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

  const installmentRows = buildInstallments(
    total,
    installmentCount,
    daysBetween,
    options.firstDueDate
  );
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

function money(value: number) {
  return Number(value.toFixed(2));
}

/**
 * Reabre uma venda do PDV: devolve o estoque antigo, aplica a cesta nova
 * e recalcula só as parcelas ainda em aberto.
 */
export async function updateSale(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  items: SaleEditItemInput[],
  options: CreateSaleOptions = {}
): Promise<CreateSaleResult> {
  if (items.length === 0) {
    throw Object.assign(new Error("A venda precisa ter ao menos um produto"), {
      statusCode: 400,
    });
  }

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId },
    include: { items: true, accountsReceivable: true },
  });
  if (!invoice || invoice.tenantId !== tenantId) {
    throw Object.assign(new Error("Venda não encontrada"), { statusCode: 404 });
  }
  if (invoice.status === "canceled") {
    throw Object.assign(new Error("Venda cancelada não pode ser editada"), {
      statusCode: 409,
    });
  }

  for (const item of invoice.items) {
    if (!item.productId) continue;
    await restoreProductStock(tx, item.productId, item.quantity);
  }

  let total = 0;
  const lineItems: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }> = [];

  for (const item of items) {
    const unitPrice = Number(item.unitPrice);
    const lineTotal = money(unitPrice * item.quantity);
    if (item.batchId) {
      const ok = await reserveBatchStock(tx, item.batchId, item.quantity);
      if (!ok) {
        throw Object.assign(new Error("Estoque insuficiente para alterar a venda"), {
          statusCode: 409,
        });
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
      await commitBatchReservation(tx, item.batchId, item.quantity);
      total += lineTotal;
      lineItems.push({
        productId: batch.productId,
        productName: item.productName?.trim() || batch.product.name,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      });
      continue;
    }

    if (!item.productId) {
      throw Object.assign(new Error("Produto da venda inválido"), {
        statusCode: 400,
      });
    }
    const product = await tx.product.findFirst({ where: { id: item.productId } });
    if (!product || !product.isActive) {
      throw Object.assign(new Error("Produto inválido ou inativo"), {
        statusCode: 400,
      });
    }
    await consumeProductFifo(tx, item.productId, item.quantity);
    total += lineTotal;
    lineItems.push({
      productId: product.id,
      productName: item.productName?.trim() || product.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    });
  }

  total = money(total);
  const paidRows = invoice.accountsReceivable.filter((row) => row.status === "paid");
  const paidSum = money(paidRows.reduce((sum, row) => sum + Number(row.amount), 0));
  if (total + 0.009 < paidSum) {
    throw Object.assign(
      new Error(
        `O novo total (${total.toFixed(2)}) ficou menor que o valor já recebido (${paidSum.toFixed(2)})`
      ),
      { statusCode: 409 }
    );
  }

  await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
  await tx.invoiceItem.createMany({
    data: lineItems.map((line) => ({
      tenantId,
      invoiceId: invoice.id,
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
  });

  await tx.accountReceivable.deleteMany({
    where: {
      invoiceId: invoice.id,
      status: { in: ["pending", "overdue"] },
    },
  });

  const remaining = money(total - paidSum);
  const installmentCount = Math.max(1, options.installments ?? 1);
  const daysBetween = options.daysBetweenInstallments ?? 30;
  let paidNow = 0;

  if (remaining > 0.009) {
    const rows = buildInstallments(
      remaining,
      installmentCount,
      daysBetween,
      options.firstDueDate
    );
    const start =
      paidRows.reduce((max, row) => Math.max(max, row.installmentNumber), 0) + 1;
    let walletLeft = options.useWalletAmount ?? 0;
    for (const row of rows) {
      const created = await tx.accountReceivable.create({
        data: {
          tenantId,
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          installmentNumber: start + row.installmentNumber - 1,
          amount: row.amount,
          dueDate: row.dueDate,
          status: "pending",
        },
      });
      if (options.payNow) {
        const walletForThis = Math.min(walletLeft, Number(created.amount));
        const paid = await payReceivable({
          tx,
          tenantId,
          receivableId: created.id,
          useWalletAmount: walletForThis,
          description: "Pagamento na edição da venda",
        });
        walletLeft -= walletForThis;
        paidNow += paid.amount;
      }
    }
  }

  const openCount = await tx.accountReceivable.count({
    where: {
      invoiceId: invoice.id,
      status: { in: ["pending", "overdue"] },
    },
  });
  const status = openCount === 0 ? "paid" : paidSum > 0 ? "partial" : "pending";
  const updated = await tx.invoice.update({
    where: { id: invoice.id },
    data: { totalAmount: total, status },
    include: { accountsReceivable: true, items: true },
  });

  await refreshCustomerDebt(tx, tenantId, invoice.customerId);
  return { invoice: updated, total, paidNow };
}
