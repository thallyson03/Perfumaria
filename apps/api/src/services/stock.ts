import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Reserva unidades com lock pessimista (FOR UPDATE).
 * Retorna false se não houver disponível.
 */
export async function reserveBatchStock(
  tx: Tx,
  batchId: string,
  qty: number
): Promise<boolean> {
  if (qty <= 0) return false;

  const rows = await tx.$queryRaw<
    Array<{ quantity: number; reserved_quantity: number }>
  >`
    SELECT quantity, reserved_quantity
    FROM product_batches
    WHERE id = ${batchId}::uuid
    FOR UPDATE
  `;

  const row = rows[0];
  if (!row) return false;

  const available = row.quantity - row.reserved_quantity;
  if (available < qty) return false;

  await tx.$executeRaw`
    UPDATE product_batches
    SET reserved_quantity = reserved_quantity + ${qty}
    WHERE id = ${batchId}::uuid
  `;

  return true;
}

/**
 * Confirma reserva: baixa quantity e libera reserved.
 */
export async function commitBatchReservation(
  tx: Tx,
  batchId: string,
  qty: number
): Promise<void> {
  await tx.$executeRaw`
    UPDATE product_batches
    SET
      quantity = quantity - ${qty},
      reserved_quantity = GREATEST(reserved_quantity - ${qty}, 0)
    WHERE id = ${batchId}::uuid
  `;
}

/** Devolve unidades vendidas ao lote que vence primeiro. */
export async function restoreProductStock(
  tx: Tx,
  productId: string,
  qty: number
): Promise<void> {
  if (qty <= 0) return;
  const batch = await tx.productBatch.findFirst({
    where: { productId },
    orderBy: { expirationDate: "asc" },
  });
  if (!batch) {
    throw Object.assign(
      new Error("Não há lote para devolver o estoque deste produto"),
      { statusCode: 409 }
    );
  }
  await tx.productBatch.update({
    where: { id: batch.id },
    data: { quantity: { increment: qty } },
  });
}

/**
 * Baixa estoque em lotes que vencem primeiro.
 */
export async function consumeProductFifo(
  tx: Tx,
  productId: string,
  qty: number
): Promise<void> {
  let need = qty;
  const batches = await tx.productBatch.findMany({
    where: { productId },
    orderBy: { expirationDate: "asc" },
  });
  for (const batch of batches) {
    if (need <= 0) break;
    const available = batch.quantity - batch.reservedQuantity;
    if (available <= 0) continue;
    const take = Math.min(available, need);
    const ok = await reserveBatchStock(tx, batch.id, take);
    if (!ok) continue;
    await commitBatchReservation(tx, batch.id, take);
    need -= take;
  }
  if (need > 0) {
    throw Object.assign(new Error("Estoque insuficiente para alterar a venda"), {
      statusCode: 409,
    });
  }
}

/**
 * Libera reserva expirada / cancelada (Cart DoS rollback).
 */
export async function releaseBatchReservation(
  tx: Tx,
  batchId: string,
  qty: number
): Promise<void> {
  await tx.$executeRaw`
    UPDATE product_batches
    SET reserved_quantity = GREATEST(reserved_quantity - ${qty}, 0)
    WHERE id = ${batchId}::uuid
  `;
}
