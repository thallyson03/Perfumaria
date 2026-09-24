import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@revendedor/database";
import { getRedis } from "../lib/redis.js";

export type JwtUserPayload = {
  sub: string;
  tenantId: string;
  role: string;
  typ: "user";
};

export type JwtCustomerPayload = {
  sub: string;
  tenantId: string;
  typ: "customer";
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtUserPayload | JwtCustomerPayload;
    user: JwtUserPayload | JwtCustomerPayload;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string | null;
    tenantSubdomain: string | null;
  }
}

async function resolveTenantIdFromDomain(domain: string): Promise<string | null> {
  const normalized = domain.toLowerCase().trim();
  const subdomain = normalized.split(".")[0];
  if (!subdomain || subdomain === "www" || subdomain === "api") {
    return null;
  }

  const redis = getRedis();
  const cacheKey = `tenant_domain:${normalized}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ subdomain }, { subdomain: normalized }],
      active: true,
    },
    select: { id: true, subdomain: true },
  });

  if (!tenant) return null;

  const root = process.env.ROOT_DOMAIN ?? "localhost";
  const fullDomain = `${tenant.subdomain}.${root}`;
  await redis.set(`tenant_domain:${fullDomain}`, tenant.id, "EX", 3600);
  await redis.set(`tenant_domain:${tenant.subdomain}`, tenant.id, "EX", 3600);

  return tenant.id;
}

const tenantPluginImpl: FastifyPluginAsync = async (app) => {
  app.decorateRequest("tenantId", null);
  app.decorateRequest("tenantSubdomain", null);

  app.addHook("onRequest", async (req: FastifyRequest) => {
    const raw =
      req.headers["x-tenant-domain"] ??
      req.headers["x-tenant-subdomain"] ??
      req.headers["x-tenant"];

    const headerDomain = Array.isArray(raw) ? raw[0] : raw;
    if (!headerDomain || typeof headerDomain !== "string") return;

    req.tenantSubdomain = headerDomain.split(".")[0] ?? null;
    const tenantId = await resolveTenantIdFromDomain(headerDomain);
    if (tenantId) req.tenantId = tenantId;
  });
};

/** fp() quebra encapsulamento para o hook valer em todas as rotas */
export const tenantPlugin = fp(tenantPluginImpl, {
  name: "tenant-plugin",
});
