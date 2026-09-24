import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma, withTenant } from "@revendedor/database";
import { getRedis } from "../lib/redis.js";

const registerSchema = z.object({
  storeName: z.string().trim().min(2, "Nome da loja muito curto").max(255),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Subdomínio muito curto")
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Use apenas minúsculas, números e hífen"),
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(8, "Senha deve ter no mínimo 8 caracteres").max(128),
});

const loginSchema = z.object({
  subdomain: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/register",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "15 minutes" },
      },
    },
    async (req, reply) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const { storeName, subdomain, email, password } = parsed.data;
      const existing = await prisma.tenant.findUnique({ where: { subdomain } });
      if (existing) {
        return reply.status(409).send({ error: "Subdomínio já em uso" });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: storeName, subdomain },
        });

        await tx.$executeRaw`
          SELECT set_config('app.current_tenant', ${tenant.id}, true)
        `;

        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: email.toLowerCase(),
            passwordHash,
            role: "admin",
          },
        });

        return { tenant, user };
      });

      const root = process.env.ROOT_DOMAIN ?? "localhost";
      const redis = getRedis();
      await redis.set(
        `tenant_domain:${result.tenant.subdomain}.${root}`,
        result.tenant.id,
        "EX",
        3600
      );
      await redis.set(
        `tenant_domain:${result.tenant.subdomain}`,
        result.tenant.id,
        "EX",
        3600
      );

      const token = await reply.jwtSign({
        sub: result.user.id,
        tenantId: result.tenant.id,
        role: result.user.role,
        typ: "user",
      });

      return {
        token,
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
          subdomain: result.tenant.subdomain,
        },
        user: {
          id: result.user.id,
          email: result.user.email,
          role: result.user.role,
        },
      };
    }
  );

  app.post(
    "/login",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "15 minutes" },
      },
    },
    async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const { subdomain, email, password } = parsed.data;

      const tenant = await prisma.tenant.findFirst({
        where: { subdomain, active: true },
      });
      if (!tenant) {
        return reply.status(401).send({ error: "Credenciais inválidas" });
      }

      const user = await withTenant(prisma, tenant.id, (tx) =>
        tx.user.findFirst({
          where: { email: email.toLowerCase() },
        })
      );

      if (!user) {
        return reply.status(401).send({ error: "Credenciais inválidas" });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return reply.status(401).send({ error: "Credenciais inválidas" });
      }

      const token = await reply.jwtSign({
        sub: user.id,
        tenantId: tenant.id,
        role: user.role,
        typ: "user",
      });

      return {
        token,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          subdomain: tenant.subdomain,
        },
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      };
    }
  );
};
