import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@revendedor/database";
import { getRedis } from "../lib/redis.js";
import { fetchMercadoPagoPayment } from "../services/payment-mercadopago.js";
import { handleMercadoPagoPaymentApproved } from "../services/order.js";

type MpWebhookBody = {
  action?: string;
  type?: string;
  data?: { id?: string | number };
};

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/mercadopago", async (req, reply) => {
    const body = req.body as MpWebhookBody;
    const paymentId = body.data?.id ? String(body.data.id) : null;

    if (!paymentId) {
      return reply.status(200).send({ ok: true, ignored: true });
    }

    const redis = getRedis();
    const mappingRaw = await redis.get(`mp:payment:${paymentId}`);
    if (!mappingRaw) {
      return reply.status(200).send({ ok: true, unknown: true });
    }

    const mapping = JSON.parse(mappingRaw) as {
      tenantId: string;
      orderId: string;
    };

    const tenant = await prisma.tenant.findUnique({
      where: { id: mapping.tenantId },
      select: { mercadoPagoAccessToken: true },
    });
    if (!tenant?.mercadoPagoAccessToken) {
      return reply.status(200).send({ ok: true, noToken: true });
    }

    try {
      const payment = await fetchMercadoPagoPayment(
        tenant.mercadoPagoAccessToken,
        paymentId
      );

      if (payment.status !== "approved") {
        return reply.status(200).send({ ok: true, status: payment.status });
      }

      const orderId = payment.external_reference ?? mapping.orderId;
      const result = await handleMercadoPagoPaymentApproved(
        mapping.tenantId,
        orderId,
        paymentId
      );

      return reply.status(200).send({ ok: true, invoiceId: result.invoiceId });
    } catch (err) {
      req.log.error({ err, paymentId }, "Webhook Mercado Pago falhou");
      return reply.status(200).send({ ok: false });
    }
  });
};
