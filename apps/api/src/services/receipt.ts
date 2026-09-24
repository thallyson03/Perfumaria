import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type SaleReceipt = {
  receiptNumber: string;
  invoiceId: string;
  issuedAt: string;
  store: {
    name: string;
    subdomain: string;
    whatsappPhone: string | null;
  };
  customer: {
    fullName: string;
    phone: string | null;
    documentCpf: string | null;
    email: string | null;
  };
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totalAmount: number;
  status: string;
  statusLabel: string;
  installments: Array<{
    installmentNumber: number;
    amount: number;
    dueDate: string;
    status: string;
    statusLabel: string;
  }>;
  paidAmount: number;
  pendingAmount: number;
  paymentSummary: string;
  disclaimer: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  partial: "Parcialmente pago",
  paid: "Pago",
  canceled: "Cancelado",
  overdue: "Vencida",
};

function formatReceiptNumber(invoiceId: string, issuedAt: Date): string {
  const date = issuedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `CV-${date}-${invoiceId.slice(0, 8).toUpperCase()}`;
}

function buildPaymentSummary(
  installments: SaleReceipt["installments"],
  invoiceStatus: string
): string {
  if (installments.length === 0) {
    return invoiceStatus === "paid" ? "Quitado" : "A prazo";
  }
  const paid = installments.filter((i) => i.status === "paid");
  if (paid.length === installments.length) {
    return installments.length === 1 ? "À vista (pago)" : `Parcelado · ${installments.length}x (quitado)`;
  }
  if (paid.length === 0) {
    return installments.length === 1
      ? `A prazo · vence ${installments[0].dueDate.slice(0, 10)}`
      : `Parcelado · ${installments.length}x`;
  }
  return `Parcial · ${paid.length}/${installments.length} parcela(s) paga(s)`;
}

export async function buildSaleReceipt(
  tx: Tx,
  tenantId: string,
  invoiceId: string
): Promise<SaleReceipt | null> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId },
    include: {
      items: { orderBy: { productName: "asc" } },
      accountsReceivable: { orderBy: { installmentNumber: "asc" } },
      customer: true,
      tenant: {
        select: { name: true, subdomain: true, whatsappPhone: true },
      },
    },
  });

  if (!invoice || invoice.tenantId !== tenantId) {
    return null;
  }

  const installments = invoice.accountsReceivable.map((r) => ({
    installmentNumber: r.installmentNumber,
    amount: Number(r.amount),
    dueDate: r.dueDate.toISOString(),
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
  }));

  const paidAmount = installments
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + i.amount, 0);
  const pendingAmount = installments
    .filter((i) => i.status === "pending" || i.status === "overdue")
    .reduce((s, i) => s + i.amount, 0);

  const issuedAt = invoice.createdAt.toISOString();

  return {
    receiptNumber: formatReceiptNumber(invoice.id, invoice.createdAt),
    invoiceId: invoice.id,
    issuedAt,
    store: {
      name: invoice.tenant.name,
      subdomain: invoice.tenant.subdomain,
      whatsappPhone: invoice.tenant.whatsappPhone,
    },
    customer: {
      fullName: invoice.customer.fullName,
      phone: invoice.customer.phone,
      documentCpf: invoice.customer.documentCpf,
      email: invoice.customer.email,
    },
    items: invoice.items.map((it) => ({
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    })),
    totalAmount: Number(invoice.totalAmount),
    status: invoice.status,
    statusLabel: STATUS_LABELS[invoice.status] ?? invoice.status,
    installments,
    paidAmount,
    pendingAmount,
    paymentSummary: buildPaymentSummary(installments, invoice.status),
    disclaimer:
      "Comprovante de venda auxiliar. Não substitui Nota Fiscal eletrônica (NF-e/NFC-e).",
  };
}
