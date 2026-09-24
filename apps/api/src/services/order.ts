import { randomBytes } from "node:crypto";
import type { FulfillmentType, OrderChannel, Prisma } from "@prisma/client";
import { getRedis } from "../lib/redis.js";
import { reserveRedisKey } from "../routes/cart.js";
import { releaseBatchReservation, reserveBatchStock } from "./stock.js";
import { createSale } from "./sale.js";
import { afterPaymentCommitted } from "./finance.js";
import {
  buildWhatsAppUrl,
  enqueueWhatsAppAlert,
} from "./whatsapp-alert.js";
import { createMercadoPagoPixPayment } from "./payment-mercadopago.js";
import {
  findOrCreateCustomer,
  upsertCustomerByCpf,
  formatCpfDisplay,
  normalizeCpf,
} from "./customer-upsert.js";
import {
  addressToOrderFields,
  formatAddressBlock,
  type DeliveryAddressSnapshot,
} from "../lib/address.js";
import { createCustomerAddress } from "./customer-address.js";
import { getEffectivePrice } from "../lib/product-price.js";

type Tx = Prisma.TransactionClient;

export const ORDER_WHATSAPP_TTL_SECONDS = Number(
  process.env.ORDER_WHATSAPP_TTL_SECONDS ?? 3600
);
export const ORDER_PAYMENT_TTL_SECONDS = Number(
  process.env.ORDER_PAYMENT_TTL_SECONDS ?? 1800
);

export type OrderItemInput = {
  batchId: string;
  quantity: number;
  /** Preço unitário (kits: preço rateado). Se omitido, usa preço do produto do lote. */
  unitPrice?: number;
  /** Nome exibido (kits: "Kit · Componente"). */
  productName?: string;
};

export type OrderFulfillmentInput = {
  fulfillmentType: FulfillmentType;
  delivery?: DeliveryAddressSnapshot | null;
  shippingQuoteAmount?: number | null;
  shippingQuoteDays?: number | null;
  shippingProvider?: string | null;
};

export type CreateOrderInput = {
  tenantId: string;
  channel: OrderChannel;
  customerName: string;
  customerPhone?: string;
  customerDocumentCpf?: string;
  customerEmail?: string;
  cartId?: string;
  items: OrderItemInput[];
  fulfillment: OrderFulfillmentInput;
  customerId?: string;
  saveAddress?: boolean;
  addressLabel?: string;
};

function generatePublicCode(): string {
  return randomBytes(2).toString("hex").toUpperCase();
}

function orderRedisKey(tenantId: string, orderId: string): string {
  return `order:active:${tenantId}:${orderId}`;
}

export function buildOrderWhatsAppMessage(params: {
  storeName: string;
  publicCode: string;
  customerName: string;
  customerPhone?: string;
  customerDocumentCpf?: string;
  fulfillmentType: FulfillmentType;
  pickupAddress?: string | null;
  delivery?: DeliveryAddressSnapshot | null;
  shippingQuoteAmount?: number | null;
  shippingQuoteDays?: number | null;
  items: Array<{ productName: string; quantity: number; lineTotal: number }>;
  totalAmount: number;
}): string {
  const productsSubtotal = params.items.reduce((s, i) => s + i.lineTotal, 0);
  const grandTotal = params.totalAmount;

  const lines = params.items.map(
    (i) =>
      `• ${i.productName} — ${i.quantity}x R$ ${(i.lineTotal / i.quantity).toFixed(2)}`
  );
  const cpfLine = params.customerDocumentCpf
    ? `CPF: ${formatCpfDisplay(params.customerDocumentCpf)}`
    : "";

  const fulfillmentLines =
    params.fulfillmentType === "pickup"
      ? [
          "Retirada com o vendedor",
          params.pickupAddress ? `Local: ${params.pickupAddress}` : "",
        ]
      : params.delivery
        ? [
            "Entrega:",
            ...formatAddressBlock(params.delivery),
            params.delivery.recipientName
              ? `Recebedor: ${params.delivery.recipientName}`
              : "",
            params.delivery.phone
              ? `Tel. entrega: ${params.delivery.phone}`
              : "",
            params.shippingQuoteAmount != null
              ? `Frete estimado: R$ ${params.shippingQuoteAmount.toFixed(2)}`
              : "Frete: a combinar",
            params.shippingQuoteDays != null
              ? `Prazo estimado: ${params.shippingQuoteDays} dia(s)`
              : "",
          ]
        : ["Entrega: endereço não informado"];

  return [
    `Olá! Quero fazer um pedido #PED-${params.publicCode}`,
    "",
    ...lines,
    "",
    `Subtotal produtos: R$ ${productsSubtotal.toFixed(2)}`,
    params.fulfillmentType === "delivery" &&
    params.shippingQuoteAmount != null
      ? `Frete: R$ ${params.shippingQuoteAmount.toFixed(2)}`
      : null,
    `Total do pedido: R$ ${grandTotal.toFixed(2)}`,
    "",
    ...fulfillmentLines,
    "",
    `Meu nome: ${params.customerName}`,
    params.customerPhone ? `Telefone: ${params.customerPhone}` : "",
    cpfLine,
    "",
    `Loja: ${params.storeName}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function reserveOrderItems(
  tx: Tx,
  tenantId: string,
  orderId: string,
  items: OrderItemInput[],
  cartId?: string
): Promise<
  Array<{
    batchId: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>
> {
  const redis = getRedis();
  const lineItems: Array<{
    batchId: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }> = [];

  for (const item of items) {
    let alreadyReserved = false;
    if (cartId) {
      const key = reserveRedisKey(tenantId, item.batchId, cartId, item.quantity);
      const had = (await redis.exists(key)) === 1;
      if (had) {
        await redis.del(key);
        alreadyReserved = true;
      }
    }

    if (!alreadyReserved) {
      const ok = await reserveBatchStock(tx, item.batchId, item.quantity);
      if (!ok) {
        throw Object.assign(new Error("Estoque insuficiente"), {
          statusCode: 409,
        });
      }
    }

    const batch = await tx.productBatch.findFirst({
      where: { id: item.batchId },
      include: { product: true },
    });
    if (!batch || !batch.product.isActive) {
      throw Object.assign(new Error("Produto indisponível"), { statusCode: 400 });
    }

    const unitPrice =
      item.unitPrice != null && Number.isFinite(item.unitPrice)
        ? Number(item.unitPrice)
        : getEffectivePrice(batch.product);
    const productName = item.productName?.trim() || batch.product.name;
    lineItems.push({
      batchId: item.batchId,
      productId: batch.productId,
      productName,
      quantity: item.quantity,
      unitPrice,
      lineTotal: Number((unitPrice * item.quantity).toFixed(2)),
    });
  }

  return lineItems;
}

export async function createSalesOrder(
  tx: Tx,
  input: CreateOrderInput
): Promise<{
  order: Awaited<ReturnType<typeof tx.salesOrder.create>>;
  lineItems: Awaited<ReturnType<typeof reserveOrderItems>>;
}> {
  if (input.items.length === 0) {
    throw Object.assign(new Error("Carrinho vazio"), { statusCode: 400 });
  }

  const lineItems = await reserveOrderItems(
    tx,
    input.tenantId,
    "pending",
    input.items,
    input.cartId
  );
  const productsSubtotal = lineItems.reduce((s, i) => s + i.lineTotal, 0);
  const shippingAmount =
    input.fulfillment.fulfillmentType === "delivery" &&
    input.fulfillment.shippingQuoteAmount != null
      ? Number(input.fulfillment.shippingQuoteAmount)
      : 0;
  const totalAmount = productsSubtotal + shippingAmount;

  let publicCode = generatePublicCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await tx.salesOrder.findFirst({
      where: { tenantId: input.tenantId, publicCode },
    });
    if (!exists) break;
    publicCode = generatePublicCode();
  }

  const ttl =
    input.channel === "whatsapp"
      ? ORDER_WHATSAPP_TTL_SECONDS
      : ORDER_PAYMENT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  let customerId: string | undefined = input.customerId;
  const cpfNormalized = input.customerDocumentCpf
    ? normalizeCpf(input.customerDocumentCpf)
    : undefined;

  if (cpfNormalized) {
    const upserted = await upsertCustomerByCpf(tx, input.tenantId, {
      fullName: input.customerName,
      documentCpf: cpfNormalized,
      phone: input.customerPhone,
      email: input.customerEmail,
    });
    customerId = upserted.id;
  }

  let deliverySnapshot = input.fulfillment.delivery ?? null;
  if (
    input.fulfillment.fulfillmentType === "delivery" &&
    deliverySnapshot &&
    input.saveAddress &&
    customerId
  ) {
    const saved = await createCustomerAddress(tx, input.tenantId, customerId, {
      ...deliverySnapshot,
      label: input.addressLabel,
      isDefault: true,
    });
    deliverySnapshot = {
      ...deliverySnapshot,
      deliveryAddressId: saved.id,
    };
  }

  const deliveryFields =
    input.fulfillment.fulfillmentType === "delivery" && deliverySnapshot
      ? addressToOrderFields(deliverySnapshot)
      : {
          deliveryAddressId: null,
          deliveryRecipientName: null,
          deliveryPhone: null,
          deliveryZipCode: null,
          deliveryStreet: null,
          deliveryNumber: null,
          deliveryComplement: null,
          deliveryNeighborhood: null,
          deliveryCity: null,
          deliveryState: null,
        };

  const order = await tx.salesOrder.create({
    data: {
      tenantId: input.tenantId,
      publicCode,
      channel: input.channel,
      status:
        input.channel === "whatsapp" ? "awaiting_seller" : "pending_payment",
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerDocumentCpf: cpfNormalized,
      customerEmail: input.customerEmail,
      customerId,
      fulfillmentType: input.fulfillment.fulfillmentType,
      ...deliveryFields,
      shippingQuoteAmount: input.fulfillment.shippingQuoteAmount ?? null,
      shippingQuoteDays: input.fulfillment.shippingQuoteDays ?? null,
      shippingProvider: input.fulfillment.shippingProvider ?? null,
      cartId: input.cartId,
      totalAmount,
      expiresAt,
      items: {
        create: lineItems.map((li) => ({
          tenantId: input.tenantId,
          batchId: li.batchId,
          productId: li.productId,
          productName: li.productName,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
        })),
      },
    },
    include: { items: true },
  });

  const redis = getRedis();
  await redis.set(
    orderRedisKey(input.tenantId, order.id),
    JSON.stringify(
      lineItems.map((li) => ({ batchId: li.batchId, quantity: li.quantity }))
    ),
    "EX",
    ttl
  );

  return { order, lineItems };
}

export async function cancelSalesOrder(
  tx: Tx,
  tenantId: string,
  orderId: string,
  status: "cancelled" | "expired" = "cancelled"
): Promise<void> {
  const order = await tx.salesOrder.findFirst({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    throw Object.assign(new Error("Pedido não encontrado"), { statusCode: 404 });
  }
  if (order.status === "confirmed") {
    throw Object.assign(new Error("Pedido já confirmado"), { statusCode: 409 });
  }
  if (order.status === "cancelled" || order.status === "expired") {
    return;
  }

  for (const item of order.items) {
    await releaseBatchReservation(tx, item.batchId, item.quantity);
  }

  await tx.salesOrder.update({
    where: { id: order.id },
    data: { status },
  });

  const redis = getRedis();
  await redis.del(orderRedisKey(tenantId, order.id));
}

export async function confirmSalesOrder(
  tx: Tx,
  tenantId: string,
  orderId: string,
  options: {
    installments?: number;
    payNow?: boolean;
    useWalletAmount?: number;
  } = {}
): Promise<{ invoiceId: string; paidNow: number }> {
  const order = await tx.salesOrder.findFirst({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    throw Object.assign(new Error("Pedido não encontrado"), { statusCode: 404 });
  }
  if (order.status === "confirmed") {
    throw Object.assign(new Error("Pedido já confirmado"), { statusCode: 409 });
  }
  if (order.status === "cancelled" || order.status === "expired") {
    throw Object.assign(new Error("Pedido cancelado ou expirado"), {
      statusCode: 409,
    });
  }

  const customerId =
    order.customerId ??
    (await findOrCreateCustomer(tx, tenantId, {
      fullName: order.customerName ?? "Cliente",
      documentCpf: order.customerDocumentCpf ?? undefined,
      phone: order.customerPhone ?? undefined,
      email: order.customerEmail ?? undefined,
    }));

  const saleItems = order.items.map((i) => ({
    batchId: i.batchId,
    quantity: i.quantity,
    skipReserve: true,
  }));

  const payNow =
    options.payNow ?? order.channel === "online_payment";

  const result = await createSale(tx, tenantId, customerId, saleItems, {
    installments: options.installments ?? 1,
    payNow,
    useWalletAmount: options.useWalletAmount ?? 0,
  });

  await tx.salesOrder.update({
    where: { id: order.id },
    data: {
      status: "confirmed",
      customerId,
      invoiceId: result.invoice.id,
      confirmedAt: new Date(),
    },
  });

  const redis = getRedis();
  await redis.del(orderRedisKey(tenantId, order.id));

  return { invoiceId: result.invoice.id, paidNow: result.paidNow };
}

export async function notifyNewWhatsAppOrder(params: {
  tenantId: string;
  tenantName: string;
  subdomain: string;
  whatsappPhone: string;
  pickupAddress?: string | null;
  order: {
    id: string;
    publicCode: string;
    customerName: string | null;
    customerPhone: string | null;
    customerDocumentCpf?: string | null;
    fulfillmentType: FulfillmentType;
    deliveryRecipientName: string | null;
    deliveryPhone: string | null;
    deliveryZipCode: string | null;
    deliveryStreet: string | null;
    deliveryNumber: string | null;
    deliveryComplement: string | null;
    deliveryNeighborhood: string | null;
    deliveryCity: string | null;
    deliveryState: string | null;
    shippingQuoteAmount: unknown;
    shippingQuoteDays: number | null;
    totalAmount: unknown;
    items: Array<{
      productName: string;
      quantity: number;
      lineTotal: unknown;
    }>;
  };
}): Promise<{ whatsappUrl: string }> {
  const totalAmount = Number(params.order.totalAmount);
  const delivery =
    params.order.fulfillmentType === "delivery" &&
    params.order.deliveryStreet &&
    params.order.deliveryZipCode
      ? {
          deliveryAddressId: null,
          recipientName: params.order.deliveryRecipientName ?? "",
          phone: params.order.deliveryPhone ?? "",
          zipCode: params.order.deliveryZipCode,
          street: params.order.deliveryStreet,
          number: params.order.deliveryNumber ?? "",
          complement: params.order.deliveryComplement,
          neighborhood: params.order.deliveryNeighborhood ?? "",
          city: params.order.deliveryCity ?? "",
          state: params.order.deliveryState ?? "",
        }
      : null;

  const message = buildOrderWhatsAppMessage({
    storeName: params.tenantName,
    publicCode: params.order.publicCode,
    customerName: params.order.customerName ?? "Cliente",
    customerPhone: params.order.customerPhone ?? undefined,
    customerDocumentCpf: params.order.customerDocumentCpf ?? undefined,
    fulfillmentType: params.order.fulfillmentType,
    pickupAddress: params.pickupAddress,
    delivery,
    shippingQuoteAmount:
      params.order.shippingQuoteAmount != null
        ? Number(params.order.shippingQuoteAmount)
        : null,
    shippingQuoteDays: params.order.shippingQuoteDays,
    items: params.order.items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      lineTotal: Number(i.lineTotal),
    })),
    totalAmount,
  });

  const whatsappUrl = buildWhatsAppUrl(params.whatsappPhone, message);

  await enqueueWhatsAppAlert({
    type: "new_order_whatsapp",
    tenantId: params.tenantId,
    tenantName: params.tenantName,
    subdomain: params.subdomain,
    orderId: params.order.id,
    publicCode: params.order.publicCode,
    customerName: params.order.customerName,
    customerPhone: params.order.customerPhone,
    totalAmount,
    whatsappUrl,
    message,
    createdAt: new Date().toISOString(),
  });

  return { whatsappUrl };
}

export async function attachMercadoPagoPayment(
  tenantId: string,
  order: {
    id: string;
    publicCode: string;
    totalAmount: unknown;
    customerName: string | null;
    customerEmail: string | null;
  },
  accessToken: string
): Promise<{
  paymentId: string;
  pixCode: string | null;
  qrCodeBase64: string | null;
}> {
  const payment = await createMercadoPagoPixPayment({
    accessToken,
    orderId: order.id,
    publicCode: order.publicCode,
    amount: Number(order.totalAmount),
    payerEmail: order.customerEmail ?? "cliente@revendedor.local",
    payerName: order.customerName ?? "Cliente",
    description: `Pedido #PED-${order.publicCode}`,
  });

  const redis = getRedis();
  await redis.set(
    `mp:payment:${payment.id}`,
    JSON.stringify({ tenantId, orderId: order.id }),
    "EX",
    ORDER_PAYMENT_TTL_SECONDS + 300
  );

  return {
    paymentId: payment.id,
    pixCode: payment.pixCode,
    qrCodeBase64: payment.qrCodeBase64,
  };
}

export async function handleMercadoPagoPaymentApproved(
  tenantId: string,
  orderId: string,
  paymentId: string
): Promise<{ invoiceId: string }> {
  const { prisma, withTenant } = await import("@revendedor/database");

  const result = await withTenant(prisma, tenantId, async (tx) => {
    const order = await tx.salesOrder.findFirst({ where: { id: orderId } });
    if (!order) {
      throw Object.assign(new Error("Pedido não encontrado"), { statusCode: 404 });
    }
    if (order.status === "confirmed" && order.invoiceId) {
      return { invoiceId: order.invoiceId, paidNow: 0 };
    }
    if (order.status === "cancelled" || order.status === "expired") {
      throw Object.assign(new Error("Pedido inválido"), { statusCode: 409 });
    }

    await tx.salesOrder.update({
      where: { id: orderId },
      data: {
        paymentExternalId: paymentId,
        paymentProvider: "mercadopago",
      },
    });

    return confirmSalesOrder(tx, tenantId, orderId, { payNow: true });
  });

  if (result.paidNow > 0) {
    await afterPaymentCommitted(tenantId, result.paidNow);
  }

  return { invoiceId: result.invoiceId };
}
