import type { Prisma } from "@prisma/client";
import { formatCpfDisplay, isValidCpf, normalizeCpf } from "../lib/cpf.js";

type Tx = Prisma.TransactionClient;

export type UpsertCustomerInput = {
  fullName: string;
  documentCpf: string;
  phone?: string;
  email?: string;
};

/**
 * Cadastra ou atualiza cliente pelo CPF (único por loja).
 * Usado no pedido WhatsApp e na confirmação de venda.
 */
export async function upsertCustomerByCpf(
  tx: Tx,
  tenantId: string,
  params: UpsertCustomerInput
): Promise<{ id: string; created: boolean }> {
  const cpf = normalizeCpf(params.documentCpf);
  if (!isValidCpf(cpf)) {
    throw Object.assign(new Error("CPF inválido"), { statusCode: 400 });
  }

  const existing = await tx.customer.findFirst({
    where: { tenantId, documentCpf: cpf },
  });

  if (existing) {
    await tx.customer.update({
      where: { id: existing.id },
      data: {
        fullName: params.fullName.trim(),
        phone: params.phone?.trim() || existing.phone,
        ...(params.email
          ? { email: params.email.toLowerCase() }
          : undefined),
      },
    });
    return { id: existing.id, created: false };
  }

  const customer = await tx.customer.create({
    data: {
      tenantId,
      fullName: params.fullName.trim(),
      documentCpf: cpf,
      phone: params.phone?.trim(),
      email: params.email?.toLowerCase(),
    },
  });

  return { id: customer.id, created: true };
}

export async function findOrCreateCustomer(
  tx: Tx,
  tenantId: string,
  params: {
    fullName: string;
    documentCpf?: string;
    phone?: string;
    email?: string;
  }
): Promise<string> {
  if (params.documentCpf) {
    const { id } = await upsertCustomerByCpf(tx, tenantId, {
      fullName: params.fullName,
      documentCpf: params.documentCpf,
      phone: params.phone,
      email: params.email,
    });
    return id;
  }

  if (params.phone) {
    const byPhone = await tx.customer.findFirst({
      where: { tenantId, phone: params.phone },
    });
    if (byPhone) return byPhone.id;
  }

  if (params.email) {
    const byEmail = await tx.customer.findFirst({
      where: { tenantId, email: params.email.toLowerCase() },
    });
    if (byEmail) return byEmail.id;
  }

  const customer = await tx.customer.create({
    data: {
      tenantId,
      fullName: params.fullName,
      phone: params.phone,
      email: params.email?.toLowerCase(),
    },
  });
  return customer.id;
}

export { formatCpfDisplay, normalizeCpf };
