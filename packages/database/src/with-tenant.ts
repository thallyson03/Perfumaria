import { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

/**
 * Executa o callback dentro de uma transação com RLS ativo.
 * SET LOCAL dura apenas até o COMMIT/ROLLBACK da transação —
 * seguro com connection pool.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TxClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.current_tenant', ${tenantId}, true)
    `;
    return fn(tx);
  });
}
