import Redis from "ioredis";
import { prisma, withTenant } from "@revendedor/database";
import { releaseBatchReservation } from "../services/stock.js";

/**
 * Escuta expiração de chaves reserve:* e devolve estoque ao lote.
 * Formato da chave: reserve:{tenantId}:{batchId}:{cartId}:{quantity}
 */
export async function startReserveExpiryListener(log = console): Promise<Redis> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const sub = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  // Garante notify-keyspace-events Ex (idempotente)
  try {
    await sub.config("SET", "notify-keyspace-events", "Ex");
  } catch (err) {
    log.warn?.(
      { err },
      "Não foi possível setar notify-keyspace-events (pode já estar no redis.conf)"
    );
  }

  await sub.psubscribe("__keyevent@0__:expired");

  sub.on("pmessage", async (_pattern, _channel, key) => {
    if (!key.startsWith("reserve:")) return;

    const parts = key.split(":");
    // reserve : tenantId : batchId : cartId : quantity
    if (parts.length < 5) return;

    const tenantId = parts[1];
    const batchId = parts[2];
    const quantity = Number(parts[parts.length - 1]);
    if (!tenantId || !batchId || !Number.isFinite(quantity) || quantity <= 0) {
      return;
    }

    try {
      await withTenant(prisma, tenantId, (tx) =>
        releaseBatchReservation(tx, batchId, quantity)
      );
      log.info?.({ key, tenantId, batchId, quantity }, "Reserva expirada liberada");
    } catch (err) {
      log.error?.({ err, key }, "Falha ao liberar reserva expirada");
    }
  });

  log.info?.("Listener de expiração de reservas Redis ativo");
  return sub;
}
