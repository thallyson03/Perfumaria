import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, withTenant } from "@revendedor/database";
import { authenticateUser } from "../lib/auth-guards.js";

const settingsSchema = z.object({
  whatsappPhone: z.string().max(20).optional().nullable(),
  channelWhatsapp: z.boolean().optional(),
  channelOnlinePayment: z.boolean().optional(),
  mercadoPagoAccessToken: z.string().max(512).optional().nullable(),
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  freeDeliveryMinAmount: z.number().min(0).optional().nullable(),
  deliveryMessage: z.string().max(500).optional().nullable(),
  pickupAddress: z.string().max(500).optional().nullable(),
  shippingProvider: z.enum(["manual", "melhor_envio", "correios"]).optional().nullable(),
  shippingOriginZipCode: z.string().max(9).optional().nullable(),
  melhorEnvioToken: z.string().max(512).optional().nullable(),
  correiosContractCode: z.string().max(64).optional().nullable(),
});

const tenantSelect = {
  id: true,
  name: true,
  subdomain: true,
  whatsappPhone: true,
  channelWhatsapp: true,
  channelOnlinePayment: true,
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

function mapSettings(tenant: {
  whatsappPhone: string | null;
  channelWhatsapp: boolean;
  channelOnlinePayment: boolean;
  mercadoPagoAccessToken: string | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  freeDeliveryMinAmount: unknown;
  deliveryMessage: string | null;
  pickupAddress: string | null;
  shippingProvider: string | null;
  shippingOriginZipCode: string | null;
  melhorEnvioToken: string | null;
  correiosContractCode: string | null;
}) {
  return {
    ...tenant,
    freeDeliveryMinAmount:
      tenant.freeDeliveryMinAmount != null
        ? Number(tenant.freeDeliveryMinAmount)
        : null,
    mercadoPagoConfigured: Boolean(tenant.mercadoPagoAccessToken),
    melhorEnvioConfigured: Boolean(tenant.melhorEnvioToken),
    mercadoPagoAccessToken: tenant.mercadoPagoAccessToken ? "••••••••" : null,
    melhorEnvioToken: tenant.melhorEnvioToken ? "••••••••" : null,
  };
}

export const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", authenticateUser);

  app.get("/settings", async (req) => {
    const tenantId = req.tenantId!;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: tenantSelect,
    });
    return mapSettings(tenant!);
  });

  app.patch("/settings", async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    const data: Record<string, unknown> = {};

    if (parsed.data.whatsappPhone !== undefined) {
      data.whatsappPhone = parsed.data.whatsappPhone || null;
    }
    if (parsed.data.channelWhatsapp !== undefined) {
      data.channelWhatsapp = parsed.data.channelWhatsapp;
    }
    if (parsed.data.channelOnlinePayment !== undefined) {
      data.channelOnlinePayment = parsed.data.channelOnlinePayment;
    }
    if (parsed.data.deliveryEnabled !== undefined) {
      data.deliveryEnabled = parsed.data.deliveryEnabled;
    }
    if (parsed.data.pickupEnabled !== undefined) {
      data.pickupEnabled = parsed.data.pickupEnabled;
    }
    if (parsed.data.freeDeliveryMinAmount !== undefined) {
      data.freeDeliveryMinAmount = parsed.data.freeDeliveryMinAmount;
    }
    if (parsed.data.deliveryMessage !== undefined) {
      data.deliveryMessage = parsed.data.deliveryMessage || null;
    }
    if (parsed.data.pickupAddress !== undefined) {
      data.pickupAddress = parsed.data.pickupAddress || null;
    }
    if (parsed.data.shippingProvider !== undefined) {
      data.shippingProvider = parsed.data.shippingProvider || null;
    }
    if (parsed.data.shippingOriginZipCode !== undefined) {
      data.shippingOriginZipCode = parsed.data.shippingOriginZipCode || null;
    }
    if (parsed.data.correiosContractCode !== undefined) {
      data.correiosContractCode = parsed.data.correiosContractCode || null;
    }
    if (parsed.data.mercadoPagoAccessToken !== undefined) {
      const token = parsed.data.mercadoPagoAccessToken;
      if (token && token !== "••••••••") {
        data.mercadoPagoAccessToken = token;
      } else if (!token) {
        data.mercadoPagoAccessToken = null;
      }
    }
    if (parsed.data.melhorEnvioToken !== undefined) {
      const token = parsed.data.melhorEnvioToken;
      if (token && token !== "••••••••") {
        data.melhorEnvioToken = token;
      } else if (!token) {
        data.melhorEnvioToken = null;
      }
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: tenantSelect,
    });

    return mapSettings(updated);
  });
};
