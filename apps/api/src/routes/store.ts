import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, withTenant } from "@revendedor/database";
import { isValidCpf, normalizeCpf } from "../lib/cpf.js";
import { authenticateCustomer, optionalAuthenticateCustomer } from "../lib/auth-guards.js";
import {
  addressPatchSchema,
  addressUpsertSchema,
  fulfillmentSchema,
} from "../lib/order-delivery.js";
import { fetchViaCep } from "../lib/viacep.js";
import { getEffectivePrice } from "../lib/product-price.js";
import {
  attachMercadoPagoPayment,
  cancelSalesOrder,
  createSalesOrder,
  notifyNewWhatsAppOrder,
} from "../services/order.js";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  listCustomerAddresses,
  updateCustomerAddress,
} from "../services/customer-address.js";
import { resolveOrderFulfillment } from "../services/resolve-order-fulfillment.js";
import { quoteShipping } from "../services/shipping.js";
import type { JwtCustomerPayload } from "../plugins/tenant.js";

const registerSchema = z
  .object({
    fullName: z.string().min(2).max(255),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    phone: z.string().max(20).optional(),
    documentCpf: z.string().min(11).max(14),
  })
  .superRefine((data, ctx) => {
    if (!isValidCpf(data.documentCpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF inválido",
        path: ["documentCpf"],
      });
    }
  });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const orderItemsSchema = z
  .array(
    z.object({
      batchId: z.string().uuid(),
      quantity: z.number().int().positive().max(50),
      unitPrice: z.number().min(0).optional(),
      productName: z.string().min(1).max(255).optional(),
    })
  )
  .min(1)
  .max(60);

const whatsappOrderSchema = z
  .object({
    cartId: z.string().min(8).optional(),
    customerName: z.string().min(2).max(255),
    customerPhone: z.string().min(8).max(20),
    customerDocumentCpf: z.string().min(11).max(14),
    items: orderItemsSchema,
    fulfillment: fulfillmentSchema,
  })
  .superRefine((data, ctx) => {
    if (!isValidCpf(data.customerDocumentCpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF inválido",
        path: ["customerDocumentCpf"],
      });
    }
  });

const paymentOrderSchema = z.object({
  cartId: z.string().min(8).optional(),
  customerName: z.string().min(2).max(255),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email(),
  items: orderItemsSchema,
  fulfillment: fulfillmentSchema,
});

const shippingQuoteSchema = z.object({
  zipCode: z.string().min(8).max(9),
  cartTotal: z.number().min(0),
  itemCount: z.number().int().positive().max(100),
});

function getOptionalCustomer(req: {
  user?: JwtCustomerPayload | { typ?: string };
}): JwtCustomerPayload | undefined {
  const user = req.user as JwtCustomerPayload | undefined;
  return user?.typ === "customer" ? user : undefined;
}

function tenantDeliverySelect() {
  return {
    id: true,
    name: true,
    subdomain: true,
    channelWhatsapp: true,
    channelOnlinePayment: true,
    whatsappPhone: true,
    mercadoPagoAccessToken: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    freeDeliveryMinAmount: true,
    deliveryMessage: true,
    pickupAddress: true,
    shippingProvider: true,
    shippingOriginZipCode: true,
    melhorEnvioToken: true,
    correiosContractCode: true,
  } as const;
}

function mapStoreConfig(tenant: {
  name: string;
  subdomain: string;
  channelWhatsapp: boolean;
  channelOnlinePayment: boolean;
  whatsappPhone: string | null;
  mercadoPagoAccessToken: string | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  freeDeliveryMinAmount: unknown;
  deliveryMessage: string | null;
  pickupAddress: string | null;
  shippingProvider: string | null;
}) {
  return {
    name: tenant.name,
    subdomain: tenant.subdomain,
    channelWhatsapp: tenant.channelWhatsapp,
    channelOnlinePayment:
      tenant.channelOnlinePayment && Boolean(tenant.mercadoPagoAccessToken),
    hasWhatsApp: Boolean(tenant.whatsappPhone),
    deliveryEnabled: tenant.deliveryEnabled,
    pickupEnabled: tenant.pickupEnabled,
    freeDeliveryMinAmount:
      tenant.freeDeliveryMinAmount != null
        ? Number(tenant.freeDeliveryMinAmount)
        : null,
    deliveryMessage: tenant.deliveryMessage,
    pickupAddress: tenant.pickupAddress,
    shippingProvider: tenant.shippingProvider,
  };
}

async function estimateCartTotal(
  tenantId: string,
  items: Array<{
    batchId: string;
    quantity: number;
    unitPrice?: number;
  }>
) {
  return withTenant(prisma, tenantId, async (tx) => {
    let total = 0;
    for (const item of items) {
      if (item.unitPrice != null && Number.isFinite(item.unitPrice)) {
        total += item.unitPrice * item.quantity;
        continue;
      }
      const batch = await tx.productBatch.findFirst({
        where: { id: item.batchId },
        include: { product: true },
      });
      if (!batch) continue;
      total += getEffectivePrice(batch.product) * item.quantity;
    }
    return total;
  });
}

export const storeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    if (!req.tenantId) {
      return reply.status(400).send({ error: "X-Tenant-Domain obrigatório" });
    }
  });

  app.get("/config", async (req) => {
    const tenantId = req.tenantId!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: tenantDeliverySelect(),
    });
    if (!tenant) {
      return {
        name: "",
        channelWhatsapp: true,
        channelOnlinePayment: false,
        deliveryEnabled: true,
        pickupEnabled: true,
      };
    }
    return mapStoreConfig(tenant);
  });

  app.get("/cep/:zipCode", async (req, reply) => {
    const { zipCode } = req.params as { zipCode: string };
    const result = await fetchViaCep(zipCode);
    if (!result) {
      return reply.status(404).send({ error: "CEP não encontrado" });
    }
    return result;
  });

  app.post("/shipping/quote", async (req, reply) => {
    const parsed = shippingQuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: tenantDeliverySelect(),
    });
    if (!tenant?.deliveryEnabled) {
      return reply.status(403).send({ error: "Entrega não disponível" });
    }

    const quote = await quoteShipping(
      {
        shippingProvider: tenant.shippingProvider,
        shippingOriginZipCode: tenant.shippingOriginZipCode,
        melhorEnvioToken: tenant.melhorEnvioToken,
        correiosContractCode: tenant.correiosContractCode,
        freeDeliveryMinAmount:
          tenant.freeDeliveryMinAmount != null
            ? Number(tenant.freeDeliveryMinAmount)
            : null,
        deliveryMessage: tenant.deliveryMessage,
      },
      parsed.data
    );

    return quote;
  });

  app.get("/orders/:publicCode", async (req, reply) => {
    const { publicCode } = req.params as { publicCode: string };
    const tenantId = req.tenantId!;
    const order = await withTenant(prisma, tenantId, (tx) =>
      tx.salesOrder.findFirst({
        where: { publicCode: publicCode.toUpperCase() },
        select: {
          publicCode: true,
          status: true,
          channel: true,
          fulfillmentType: true,
          totalAmount: true,
          shippingQuoteAmount: true,
          shippingQuoteDays: true,
          deliveryZipCode: true,
          deliveryCity: true,
          deliveryState: true,
          deliveryNeighborhood: true,
          createdAt: true,
          confirmedAt: true,
          expiresAt: true,
          items: {
            select: {
              productName: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
            },
          },
        },
      })
    );
    if (!order) {
      return reply.status(404).send({ error: "Pedido não encontrado" });
    }

    const productsSubtotal = order.items.reduce(
      (s, i) => s + Number(i.lineTotal),
      0
    );

    return {
      ...order,
      productsSubtotal,
      shippingAmount:
        order.fulfillmentType === "delivery" &&
        order.shippingQuoteAmount != null
          ? Number(order.shippingQuoteAmount)
          : null,
    };
  });

  app.post(
    "/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tenantId = req.tenantId!;
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const cpf = normalizeCpf(parsed.data.documentCpf);
      const email = parsed.data.email.toLowerCase();

      try {
        const customer = await withTenant(prisma, tenantId, async (tx) => {
          const byEmail = await tx.customer.findFirst({
            where: { tenantId, email },
          });
          if (byEmail?.passwordHash) {
            throw Object.assign(new Error("E-mail já cadastrado nesta loja"), {
              statusCode: 409,
            });
          }

          const byCpf = await tx.customer.findFirst({
            where: { tenantId, documentCpf: cpf },
          });

          if (byCpf) {
            if (byCpf.passwordHash) {
              throw Object.assign(new Error("CPF já cadastrado nesta loja"), {
                statusCode: 409,
              });
            }
            if (byEmail && byEmail.id !== byCpf.id) {
              throw Object.assign(
                new Error("E-mail já vinculado a outro cliente"),
                { statusCode: 409 }
              );
            }
            return tx.customer.update({
              where: { id: byCpf.id },
              data: {
                fullName: parsed.data.fullName,
                email,
                passwordHash,
                phone: parsed.data.phone?.trim() || byCpf.phone,
                documentCpf: cpf,
              },
            });
          }

          if (byEmail) {
            return tx.customer.update({
              where: { id: byEmail.id },
              data: {
                fullName: parsed.data.fullName,
                passwordHash,
                phone: parsed.data.phone?.trim() || byEmail.phone,
                documentCpf: cpf,
              },
            });
          }

          return tx.customer.create({
            data: {
              tenantId,
              fullName: parsed.data.fullName,
              email,
              passwordHash,
              phone: parsed.data.phone?.trim(),
              documentCpf: cpf,
            },
          });
        });

        const token = await reply.jwtSign({
          sub: customer.id,
          tenantId,
          typ: "customer",
        } satisfies JwtCustomerPayload);

        return {
          token,
          customer: {
            id: customer.id,
            fullName: customer.fullName,
            email: customer.email,
            phone: customer.phone,
            documentCpf: customer.documentCpf,
          },
        };
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        if (e.statusCode) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        return reply.status(409).send({ error: "Não foi possível criar a conta" });
      }
    }
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tenantId = req.tenantId!;
      const customer = await withTenant(prisma, tenantId, (tx) =>
        tx.customer.findFirst({
          where: { email: parsed.data.email.toLowerCase() },
        })
      );

      if (!customer?.passwordHash) {
        return reply.status(401).send({ error: "Credenciais inválidas" });
      }

      const ok = await bcrypt.compare(parsed.data.password, customer.passwordHash);
      if (!ok) {
        return reply.status(401).send({ error: "Credenciais inválidas" });
      }

      const token = await reply.jwtSign({
        sub: customer.id,
        tenantId,
        typ: "customer",
      } satisfies JwtCustomerPayload);

      return {
        token,
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          email: customer.email,
          phone: customer.phone,
          documentCpf: customer.documentCpf,
        },
      };
    }
  );

  app.get(
    "/addresses",
    { preHandler: authenticateCustomer },
    async (req) => {
      const customer = req.user as JwtCustomerPayload;
      const tenantId = req.tenantId!;
      return withTenant(prisma, tenantId, (tx) =>
        listCustomerAddresses(tx, tenantId, customer.sub)
      );
    }
  );

  app.post(
    "/addresses",
    { preHandler: authenticateCustomer },
    async (req, reply) => {
      const parsed = addressUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const customer = req.user as JwtCustomerPayload;
      const tenantId = req.tenantId!;
      const created = await withTenant(prisma, tenantId, (tx) =>
        createCustomerAddress(tx, tenantId, customer.sub, parsed.data)
      );
      return reply.status(201).send(created);
    }
  );

  app.patch(
    "/addresses/:id",
    { preHandler: authenticateCustomer },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = addressPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }
      const customer = req.user as JwtCustomerPayload;
      const tenantId = req.tenantId!;
      try {
        const updated = await withTenant(prisma, tenantId, (tx) =>
          updateCustomerAddress(tx, tenantId, customer.sub, id, parsed.data)
        );
        return updated;
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  app.delete(
    "/addresses/:id",
    { preHandler: authenticateCustomer },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const customer = req.user as JwtCustomerPayload;
      const tenantId = req.tenantId!;
      try {
        await withTenant(prisma, tenantId, (tx) =>
          deleteCustomerAddress(tx, tenantId, customer.sub, id)
        );
        return { ok: true };
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  app.post(
    "/orders/whatsapp",
    {
      preHandler: optionalAuthenticateCustomer,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const parsed = whatsappOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tenantId = req.tenantId!;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: tenantDeliverySelect(),
      });
      if (!tenant?.channelWhatsapp) {
        return reply.status(403).send({ error: "Canal WhatsApp desativado" });
      }
      if (!tenant.whatsappPhone) {
        return reply
          .status(400)
          .send({ error: "Loja sem WhatsApp configurado no painel" });
      }

      const authCustomer = getOptionalCustomer(req);

      try {
        const cartTotal = await estimateCartTotal(tenantId, parsed.data.items);
        const itemCount = parsed.data.items.reduce((s, i) => s + i.quantity, 0);

        const { order } = await withTenant(prisma, tenantId, async (tx) => {
          const resolved = await resolveOrderFulfillment(
            tx,
            { tenantId, ...tenant },
            parsed.data.fulfillment,
            {
              customerId: authCustomer?.sub,
              cartTotal,
              itemCount,
            }
          );

          return createSalesOrder(tx, {
            tenantId,
            channel: "whatsapp",
            customerName: parsed.data.customerName,
            customerPhone: parsed.data.customerPhone,
            customerDocumentCpf: normalizeCpf(parsed.data.customerDocumentCpf),
            cartId: parsed.data.cartId,
            items: parsed.data.items,
            customerId: authCustomer?.sub,
            saveAddress: parsed.data.fulfillment.saveAddress,
            addressLabel: parsed.data.fulfillment.addressLabel,
            fulfillment: resolved,
          });
        });

        const fullOrder = await withTenant(prisma, tenantId, (tx) =>
          tx.salesOrder.findFirst({
            where: { id: order.id },
            include: { items: true },
          })
        );

        const { whatsappUrl } = await notifyNewWhatsAppOrder({
          tenantId,
          tenantName: tenant.name,
          subdomain: tenant.subdomain,
          whatsappPhone: tenant.whatsappPhone,
          pickupAddress: tenant.pickupAddress,
          order: fullOrder!,
        });

        return reply.status(201).send({
          orderId: order.id,
          publicCode: order.publicCode,
          customerId: order.customerId,
          totalAmount: order.totalAmount,
          fulfillmentType: order.fulfillmentType,
          shippingQuoteAmount: order.shippingQuoteAmount,
          expiresAt: order.expiresAt,
          whatsappUrl,
        });
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  app.post(
    "/orders/payment",
    {
      preHandler: optionalAuthenticateCustomer,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const parsed = paymentOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tenantId = req.tenantId!;
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: tenantDeliverySelect(),
      });
      if (!tenant?.channelOnlinePayment || !tenant.mercadoPagoAccessToken) {
        return reply
          .status(403)
          .send({ error: "Pagamento online não configurado" });
      }

      const authCustomer = getOptionalCustomer(req);

      try {
        const cartTotal = await estimateCartTotal(tenantId, parsed.data.items);
        const itemCount = parsed.data.items.reduce((s, i) => s + i.quantity, 0);

        const { order } = await withTenant(prisma, tenantId, async (tx) => {
          const resolved = await resolveOrderFulfillment(
            tx,
            { tenantId, ...tenant },
            parsed.data.fulfillment,
            {
              customerId: authCustomer?.sub,
              cartTotal,
              itemCount,
            }
          );

          return createSalesOrder(tx, {
            tenantId,
            channel: "online_payment",
            customerName: parsed.data.customerName,
            customerPhone: parsed.data.customerPhone,
            customerEmail: parsed.data.customerEmail,
            cartId: parsed.data.cartId,
            items: parsed.data.items,
            customerId: authCustomer?.sub,
            saveAddress: parsed.data.fulfillment.saveAddress,
            addressLabel: parsed.data.fulfillment.addressLabel,
            fulfillment: resolved,
          });
        });

        try {
          const payment = await attachMercadoPagoPayment(
            tenantId,
            order,
            tenant.mercadoPagoAccessToken
          );

          await withTenant(prisma, tenantId, (tx) =>
            tx.salesOrder.update({
              where: { id: order.id },
              data: {
                paymentProvider: "mercadopago",
                paymentExternalId: payment.paymentId,
                paymentPixCode: payment.pixCode,
                paymentQrBase64: payment.qrCodeBase64,
              },
            })
          );

          return reply.status(201).send({
            orderId: order.id,
            publicCode: order.publicCode,
            totalAmount: order.totalAmount,
            fulfillmentType: order.fulfillmentType,
            shippingQuoteAmount: order.shippingQuoteAmount,
            expiresAt: order.expiresAt,
            payment: {
              provider: "mercadopago",
              paymentId: payment.paymentId,
              pixCode: payment.pixCode,
              qrCodeBase64: payment.qrCodeBase64,
            },
          });
        } catch (payErr) {
          await withTenant(prisma, tenantId, (tx) =>
            cancelSalesOrder(tx, tenantId, order.id, "cancelled")
          );
          throw payErr;
        }
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  app.get(
    "/me/orders",
    { preHandler: authenticateCustomer },
    async (req) => {
      const customer = req.user as JwtCustomerPayload;
      const tenantId = req.tenantId!;
      const orders = await withTenant(prisma, tenantId, (tx) =>
        tx.salesOrder.findMany({
          where: { customerId: customer.sub },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            publicCode: true,
            status: true,
            channel: true,
            fulfillmentType: true,
            totalAmount: true,
            shippingQuoteAmount: true,
            createdAt: true,
            confirmedAt: true,
            expiresAt: true,
            items: {
              select: {
                productName: true,
                quantity: true,
                lineTotal: true,
              },
            },
          },
        })
      );

      return orders.map((order) => {
        const productsSubtotal = order.items.reduce(
          (s, i) => s + Number(i.lineTotal),
          0
        );
        return {
          ...order,
          productsSubtotal,
          shippingAmount:
            order.fulfillmentType === "delivery" &&
            order.shippingQuoteAmount != null
              ? Number(order.shippingQuoteAmount)
              : null,
        };
      });
    }
  );

  app.get(
    "/me",
    { preHandler: authenticateCustomer },
    async (req) => {
      const customer = req.user as JwtCustomerPayload;
      const tenantId = req.tenantId!;
      const row = await withTenant(prisma, tenantId, (tx) =>
        tx.customer.findFirst({ where: { id: customer.sub } })
      );
      return row
        ? {
            id: row.id,
            fullName: row.fullName,
            email: row.email,
            phone: row.phone,
            documentCpf: row.documentCpf,
          }
        : null;
    }
  );
};
