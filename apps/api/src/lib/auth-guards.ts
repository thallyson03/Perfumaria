import type { FastifyReply, FastifyRequest } from "fastify";
import type { JwtCustomerPayload, JwtUserPayload } from "../plugins/tenant.js";

export async function authenticateUser(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await req.jwtVerify();
    const user = req.user as JwtUserPayload | JwtCustomerPayload;

    if (user.typ !== "user") {
      return reply.status(403).send({ error: "Token de usuário do painel exigido" });
    }

    if (req.tenantId && req.tenantId !== user.tenantId) {
      return reply.status(403).send({ error: "Tenant do token diverge do domínio" });
    }

    req.tenantId = user.tenantId;
  } catch {
    return reply.status(401).send({ error: "Não autenticado" });
  }
}

export async function authenticateCustomer(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await req.jwtVerify();
    const user = req.user as JwtUserPayload | JwtCustomerPayload;

    if (user.typ !== "customer") {
      return reply.status(403).send({ error: "Token de cliente da vitrine exigido" });
    }

    if (!req.tenantId) {
      return reply.status(400).send({ error: "Cabeçalho X-Tenant-Domain obrigatório" });
    }

    if (req.tenantId !== user.tenantId) {
      return reply.status(403).send({ error: "Cliente não pertence a esta loja" });
    }
  } catch {
    return reply.status(401).send({ error: "Não autenticado" });
  }
}

/** Valida JWT de cliente quando enviado; ignora silenciosamente se ausente ou inválido. */
export async function optionalAuthenticateCustomer(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return;

  try {
    await req.jwtVerify();
  } catch {
    return;
  }

  const user = req.user as JwtUserPayload | JwtCustomerPayload;
  if (user.typ !== "customer") {
    (req as { user?: unknown }).user = undefined;
    return;
  }

  if (req.tenantId && req.tenantId !== user.tenantId) {
    (req as { user?: unknown }).user = undefined;
  }
}
