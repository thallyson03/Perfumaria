import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@revendedor/database";
import { getRedis } from "../lib/redis.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    let db = false;
    let redis = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }

    try {
      const pong = await getRedis().ping();
      redis = pong === "PONG";
    } catch {
      redis = false;
    }

    return {
      status: db && redis ? "ok" : "degraded",
      db,
      redis,
      ts: new Date().toISOString(),
    };
  });
};
