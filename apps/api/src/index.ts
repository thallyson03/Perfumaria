import "dotenv/config";

// Em produção (e preferencialmente em dev) a API usa o role sem BYPASSRLS.
if (process.env.DATABASE_URL_APP) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_APP;
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { authRoutes } from "./routes/auth.js";
import { customerRoutes } from "./routes/customers.js";
import { productRoutes } from "./routes/products.js";
import { financeRoutes } from "./routes/finance.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { cartRoutes } from "./routes/cart.js";
import { storeRoutes } from "./routes/store.js";
import { ordersRoutes } from "./routes/orders.js";
import { tenantRoutes } from "./routes/tenant.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { healthRoutes } from "./routes/health.js";
import { tenantPlugin } from "./plugins/tenant.js";
import { startReserveExpiryListener } from "./workers/reserve-expiry.js";
import { startDailyJobsScheduler } from "./workers/daily-jobs.js";
import { startOrderExpiryScheduler } from "./workers/order-expiry.js";

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? "0.0.0.0";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const UPLOAD_ROOT = path.resolve(
  process.env.UPLOAD_DIR ?? path.join(rootDir, "uploads")
);

async function main() {
  await mkdir(UPLOAD_ROOT, { recursive: true });

  const app = Fastify({
    logger: true,
  });

  await app.register(helmet, {
    // API JSON: CSP padrão do Helmet (script-src 'none') gera ruído
    // no console se alguém abrir a URL no navegador; não serve HTML.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-only-change-me",
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });
  await app.register(fastifyStatic, {
    root: UPLOAD_ROOT,
    prefix: "/uploads/",
    decorateReply: false,
  });

  await app.register(tenantPlugin);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(customerRoutes, { prefix: "/v1/customers" });
  await app.register(productRoutes, { prefix: "/v1/products" });
  await app.register(financeRoutes, { prefix: "/v1/finance" });
  await app.register(dashboardRoutes, { prefix: "/v1/dashboard" });
  await app.register(cartRoutes, { prefix: "/v1/cart" });
  await app.register(storeRoutes, { prefix: "/v1/store" });
  await app.register(ordersRoutes, { prefix: "/v1/orders" });
  await app.register(tenantRoutes, { prefix: "/v1/tenant" });
  await app.register(webhookRoutes, { prefix: "/v1/webhooks" });

  await startReserveExpiryListener(app.log);
  startDailyJobsScheduler(app.log);
  startOrderExpiryScheduler(app.log);

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
