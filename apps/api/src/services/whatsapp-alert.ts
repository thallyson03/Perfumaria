import { getRedis } from "../lib/redis.js";

export type WhatsAppAlertPayload = {
  type: string;
  tenantId: string;
  tenantName: string;
  subdomain: string;
  [key: string]: unknown;
};

/** Enfileira alerta WhatsApp + webhook n8n opcional */
export async function enqueueWhatsAppAlert(
  payload: WhatsAppAlertPayload
): Promise<void> {
  const redis = getRedis();
  await redis.lpush("alerts:whatsapp", JSON.stringify(payload));

  const webhook = process.env.N8N_ALERTS_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // webhook opcional
    }
  }
}

export function normalizeWhatsAppPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55") && digits.length <= 11) {
    digits = `55${digits}`;
  }
  return digits;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const normalized = normalizeWhatsAppPhone(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
