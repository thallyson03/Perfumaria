import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma, withTenant } from "@revendedor/database";
import { getRedis } from "../lib/redis.js";
import {
  releaseBatchReservation,
  reserveBatchStock,
} from "../services/stock.js";
import { allocateKitComponents } from "../services/kit.js";

export const RESERVE_TTL_SECONDS = Number(
  process.env.CART_RESERVE_TTL_SECONDS ?? 900
);

export function reserveRedisKey(
  tenantId: string,
  batchId: string,
  cartId: string,
  quantity: number
): string {
  return `reserve:${tenantId}:${batchId}:${cartId}:${quantity}`;
}

const reserveSchema = z.object({
  batchId: z.string().uuid(),
  quantity: z.number().int().positive().max(50),
  cartId: z.string().min(8).max(80).optional(),
});

/**
 * Reserva temporária de estoque (anti Cart DoS).
 * Chave Redis com TTL; ao expirar o listener devolve reserved_quantity.
 */
export const cartRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (req, reply) => {
    if (!req.tenantId) {
      return reply.status(400).send({ error: "X-Tenant-Domain obrigatório" });
    }
  });

  app.post(
    "/reserve",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const parsed = reserveSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tenantId = req.tenantId!;
      const cartId = parsed.data.cartId ?? randomUUID();
      const { batchId, quantity } = parsed.data;

      const redis = getRedis();
      const rateKey = `cart_rate:${tenantId}:${req.ip}`;
      const hits = await redis.incr(rateKey);
      if (hits === 1) await redis.expire(rateKey, 60);
      if (hits > 60) {
        return reply.status(429).send({ error: "Rate limit de carrinho" });
      }

      const ok = await withTenant(prisma, tenantId, (tx) =>
        reserveBatchStock(tx, batchId, quantity)
      );

      if (!ok) {
        return reply.status(409).send({ error: "Estoque insuficiente" });
      }

      const reserveKey = reserveRedisKey(tenantId, batchId, cartId, quantity);
      await redis.set(reserveKey, "1", "EX", RESERVE_TTL_SECONDS);

      return reply.status(201).send({
        cartId,
        batchId,
        quantity,
        expiresInSeconds: RESERVE_TTL_SECONDS,
        reserveKey,
      });
    }
  );

  app.post("/release", async (req, reply) => {
    const schema = z.object({
      batchId: z.string().uuid(),
      quantity: z.number().int().positive(),
      cartId: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    const { batchId, quantity, cartId } = parsed.data;
    const redis = getRedis();
    const reserveKey = reserveRedisKey(tenantId, batchId, cartId, quantity);
    const existed = await redis.del(reserveKey);

    await withTenant(prisma, tenantId, (tx) =>
      releaseBatchReservation(tx, batchId, quantity)
    );

    return { ok: true, released: existed > 0 };
  });

  /** Ajusta a quantidade reservada de um lote no carrinho (substitui reserva anterior). */
  app.post("/adjust", async (req, reply) => {
    const schema = z.object({
      cartId: z.string().min(8).max(80),
      batchId: z.string().uuid(),
      previousQuantity: z.number().int().min(0).max(50),
      quantity: z.number().int().min(0).max(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    let { cartId, batchId, previousQuantity, quantity } = parsed.data;
    const redis = getRedis();

    if (previousQuantity === quantity) {
      if (quantity === 0) {
        return { ok: true, quantity: 0 };
      }
      const existingKey = reserveRedisKey(
        tenantId,
        batchId,
        cartId,
        quantity
      );
      if ((await redis.exists(existingKey)) === 1) {
        await redis.expire(existingKey, RESERVE_TTL_SECONDS);
        return { ok: true, quantity, expiresInSeconds: RESERVE_TTL_SECONDS };
      }
      if (previousQuantity > 0) {
        await withTenant(prisma, tenantId, (tx) =>
          releaseBatchReservation(tx, batchId, previousQuantity)
        );
      }
      previousQuantity = 0;
    }

    if (previousQuantity > 0) {
      const oldKey = reserveRedisKey(
        tenantId,
        batchId,
        cartId,
        previousQuantity
      );
      await redis.del(oldKey);
      await withTenant(prisma, tenantId, (tx) =>
        releaseBatchReservation(tx, batchId, previousQuantity)
      );
    }

    if (quantity === 0) {
      return { ok: true, quantity: 0 };
    }

    const ok = await withTenant(prisma, tenantId, (tx) =>
      reserveBatchStock(tx, batchId, quantity)
    );
    if (!ok) {
      return reply.status(409).send({ error: "Estoque insuficiente" });
    }

    const newKey = reserveRedisKey(tenantId, batchId, cartId, quantity);
    await redis.set(newKey, "1", "EX", RESERVE_TTL_SECONDS);

    return {
      ok: true,
      quantity,
      expiresInSeconds: RESERVE_TTL_SECONDS,
    };
  });

  /** Libera todas as reservas informadas (esvaziar sacola). */
  app.post("/release-all", async (req, reply) => {
    const schema = z.object({
      cartId: z.string().min(8).max(80),
      items: z
        .array(
          z.object({
            batchId: z.string().uuid(),
            quantity: z.number().int().positive().max(50),
          })
        )
        .max(50),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const tenantId = req.tenantId!;
    const redis = getRedis();

    for (const item of parsed.data.items) {
      const key = reserveRedisKey(
        tenantId,
        item.batchId,
        parsed.data.cartId,
        item.quantity
      );
      await redis.del(key);
      await withTenant(prisma, tenantId, (tx) =>
        releaseBatchReservation(tx, item.batchId, item.quantity)
      );
    }

    return { ok: true, released: parsed.data.items.length };
  });

  /**
   * Reserva (ou troca) um kit: libera componentes anteriores e aloca lotes FIFO
   * dos componentes com preço rateado do kit.
   */
  app.post(
    "/reserve-kit",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const schema = z.object({
        cartId: z.string().min(8).max(80).optional(),
        kitProductId: z.string().uuid(),
        quantity: z.number().int().min(0).max(20),
        previousComponents: z
          .array(
            z.object({
              batchId: z.string().uuid(),
              quantity: z.number().int().positive().max(100),
            })
          )
          .max(60)
          .optional()
          .default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const tenantId = req.tenantId!;
      const cartId = parsed.data.cartId ?? randomUUID();
      const redis = getRedis();
      const previous = parsed.data.previousComponents ?? [];

      try {
        const allocation = await withTenant(prisma, tenantId, async (tx) => {
          for (const item of previous) {
            await releaseBatchReservation(tx, item.batchId, item.quantity);
          }

          if (parsed.data.quantity === 0) {
            return null;
          }

          const result = await allocateKitComponents(
            tx,
            parsed.data.kitProductId,
            parsed.data.quantity
          );
          for (const line of result.components) {
            const ok = await reserveBatchStock(tx, line.batchId, line.quantity);
            if (!ok) {
              throw Object.assign(new Error("Estoque insuficiente no kit"), {
                statusCode: 409,
              });
            }
          }
          return result;
        });

        for (const item of previous) {
          await redis.del(
            reserveRedisKey(tenantId, item.batchId, cartId, item.quantity)
          );
        }

        if (!allocation) {
          return {
            ok: true,
            cartId,
            quantity: 0,
            components: [],
          };
        }

        for (const line of allocation.components) {
          const key = reserveRedisKey(
            tenantId,
            line.batchId,
            cartId,
            line.quantity
          );
          await redis.set(key, "1", "EX", RESERVE_TTL_SECONDS);
        }

        return {
          ok: true,
          cartId,
          kitProductId: allocation.kitProductId,
          kitName: allocation.kitName,
          quantity: allocation.kitQuantity,
          unitPrice: allocation.unitPrice,
          availableKits: allocation.availableKits,
          components: allocation.components,
          expiresInSeconds: RESERVE_TTL_SECONDS,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Falha ao reservar kit";
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 400;
        return reply.status(status).send({ error: message });
      }
    }
  );
};
