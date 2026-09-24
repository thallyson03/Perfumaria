import { getRedis } from "../lib/redis.js";

function todayKey(tenantId: string, day = new Date()): string {
  const y = day.getUTCFullYear();
  const m = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");
  return `dashboard:tenant:${tenantId}:sales:${y}-${m}-${d}`;
}

/** amount em reais → centavos para HINCRBY (inteiro) */
export async function bumpTodaySales(
  tenantId: string,
  amountReais: number,
  orders = 1
): Promise<void> {
  const redis = getRedis();
  const key = todayKey(tenantId);
  const cents = Math.round(Number(amountReais) * 100);
  await redis.hincrby(key, "total_revenue", cents);
  await redis.hincrby(key, "total_orders", orders);
  await redis.expire(key, 60 * 60 * 48);
}

export async function getTodaySales(tenantId: string): Promise<{
  totalRevenue: number;
  totalOrders: number;
}> {
  const redis = getRedis();
  const data = await redis.hgetall(todayKey(tenantId));
  return {
    totalRevenue: Number(data.total_revenue ?? 0) / 100,
    totalOrders: Number(data.total_orders ?? 0),
  };
}
