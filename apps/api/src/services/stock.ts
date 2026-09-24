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
