import type { Prisma } from "@prisma/client";
import {
  addressFromRecord,
  sanitizeAddressInput,
  type DeliveryAddressInput,
} from "../lib/address.js";

type Tx = Prisma.TransactionClient;

export async function listCustomerAddresses(
  tx: Tx,
  tenantId: string,
  customerId: string
) {
  const rows = await tx.customerAddress.findMany({
    where: { tenantId, customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(addressFromRecord);
}

export async function createCustomerAddress(
  tx: Tx,
  tenantId: string,
  customerId: string,
  input: DeliveryAddressInput & { label?: string; isDefault?: boolean }
) {
  const data = sanitizeAddressInput(input);

  if (input.isDefault) {
    await tx.customerAddress.updateMany({
      where: { tenantId, customerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const hasDefault = await tx.customerAddress.findFirst({
    where: { tenantId, customerId, isDefault: true },
  });

  const row = await tx.customerAddress.create({
    data: {
      tenantId,
      customerId,
      label: input.label?.trim() || "Casa",
      recipientName: data.recipientName,
      phone: data.phone,
      zipCode: data.zipCode,
      street: data.street,
      number: data.number,
      complement: data.complement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      isDefault: input.isDefault ?? !hasDefault,
    },
  });

  return addressFromRecord(row);
}

export async function updateCustomerAddress(
  tx: Tx,
  tenantId: string,
  customerId: string,
  addressId: string,
  input: Partial<
    DeliveryAddressInput & { label?: string; isDefault?: boolean }
  >
) {
  const existing = await tx.customerAddress.findFirst({
    where: { id: addressId, tenantId, customerId },
  });
  if (!existing) {
    throw Object.assign(new Error("Endereço não encontrado"), { statusCode: 404 });
  }

  const data = input.recipientName
    ? sanitizeAddressInput({
        recipientName: input.recipientName ?? existing.recipientName,
        phone: input.phone ?? existing.phone,
        zipCode: input.zipCode ?? existing.zipCode,
        street: input.street ?? existing.street,
        number: input.number ?? existing.number,
        complement: input.complement ?? existing.complement,
        neighborhood: input.neighborhood ?? existing.neighborhood,
        city: input.city ?? existing.city,
        state: input.state ?? existing.state,
      })
    : null;

  if (input.isDefault) {
    await tx.customerAddress.updateMany({
      where: { tenantId, customerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const row = await tx.customerAddress.update({
    where: { id: addressId },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() || "Casa" } : {}),
      ...(data
        ? {
            recipientName: data.recipientName,
            phone: data.phone,
            zipCode: data.zipCode,
            street: data.street,
            number: data.number,
            complement: data.complement,
            neighborhood: data.neighborhood,
            city: data.city,
            state: data.state,
          }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    },
  });

  return addressFromRecord(row);
}

export async function deleteCustomerAddress(
  tx: Tx,
  tenantId: string,
  customerId: string,
  addressId: string
) {
  const existing = await tx.customerAddress.findFirst({
    where: { id: addressId, tenantId, customerId },
  });
  if (!existing) {
    throw Object.assign(new Error("Endereço não encontrado"), { statusCode: 404 });
  }

  await tx.customerAddress.delete({ where: { id: addressId } });

  if (existing.isDefault) {
    const next = await tx.customerAddress.findFirst({
      where: { tenantId, customerId },
      orderBy: { createdAt: "desc" },
    });
    if (next) {
      await tx.customerAddress.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }
}

export async function getCustomerAddressForOrder(
  tx: Tx,
  tenantId: string,
  customerId: string,
  addressId: string
) {
  const row = await tx.customerAddress.findFirst({
    where: { id: addressId, tenantId, customerId },
  });
  if (!row) {
    throw Object.assign(new Error("Endereço não encontrado"), { statusCode: 404 });
  }
  return {
    ...sanitizeAddressInput(row),
    deliveryAddressId: row.id,
  };
}
