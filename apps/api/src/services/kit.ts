import type { Prisma } from "@prisma/client";
import { getEffectivePrice } from "../lib/product-price.js";

type Tx = Prisma.TransactionClient;

export type KitComponentAllocation = {
  batchId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type KitAllocationResult = {
  kitProductId: string;
  kitName: string;
  kitQuantity: number;
  unitPrice: number;
  availableKits: number;
  components: KitComponentAllocation[];
};

type BatchRow = {
  id: string;
  productId: string;
  quantity: number;
  reservedQuantity: number;
  expirationDate: Date;
  product: { id: string; name: string; isActive: boolean; kind: string };
};

function availableOf(b: { quantity: number; reservedQuantity: number }) {
  return Math.max(0, b.quantity - b.reservedQuantity);
}

/** Quantidade máxima de kits montáveis com o estoque atual dos componentes. */
export function computeKitAvailability(
  items: Array<{ quantity: number; available: number }>
): number {
  if (items.length === 0) return 0;
  let max = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.quantity <= 0) return 0;
    max = Math.min(max, Math.floor(item.available / item.quantity));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

/**
 * Aloca lotes FIFO dos componentes para N kits e distribui o preço do kit
 * proporcionalmente ao preço de lista × qty de cada componente.
 */
export async function allocateKitComponents(
  tx: Tx,
  kitProductId: string,
  kitQuantity: number
): Promise<KitAllocationResult> {
  if (kitQuantity <= 0) {
    throw Object.assign(new Error("Quantidade inválida"), { statusCode: 400 });
  }

  const kit = await tx.product.findFirst({
    where: { id: kitProductId, kind: "kit", isActive: true },
    include: {
      kitItems: {
        include: {
          component: {
            include: {
              batches: {
                select: {
                  id: true,
                  productId: true,
                  quantity: true,
                  reservedQuantity: true,
                  expirationDate: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!kit || kit.kitItems.length === 0) {
    throw Object.assign(new Error("Kit indisponível ou sem composição"), {
      statusCode: 400,
    });
  }

  const kitUnitPrice = getEffectivePrice(kit);

  const availabilityInputs = kit.kitItems.map((item) => {
    const available = item.component.batches.reduce(
      (s, b) => s + availableOf(b),
      0
    );
    return { quantity: item.quantity, available };
  });
  const availableKits = computeKitAvailability(availabilityInputs);
  if (availableKits < kitQuantity) {
    throw Object.assign(
      new Error(
        availableKits <= 0
          ? "Kit sem estoque nos componentes"
          : `Só há estoque para ${availableKits} kit(s)`
      ),
      { statusCode: 409 }
    );
  }

  type WeightRow = {
    componentProductId: string;
    componentName: string;
    perKitQty: number;
    weight: number;
    batches: Array<{
      id: string;
      available: number;
      expirationDate: Date;
    }>;
  };

  const weighted: WeightRow[] = [];
  let totalWeight = 0;

  for (const item of kit.kitItems) {
    if (item.component.kind === "kit") {
      throw Object.assign(new Error("Componente não pode ser outro kit"), {
        statusCode: 400,
      });
    }
    if (!item.component.isActive) {
      throw Object.assign(
        new Error(`Componente inativo: ${item.component.name}`),
        { statusCode: 400 }
      );
    }
    const listPrice = Math.max(getEffectivePrice(item.component), 0.01);
    const weight = listPrice * item.quantity;
    totalWeight += weight;
    const batches = item.component.batches
      .map((b) => ({
        id: b.id,
        available: availableOf(b),
        expirationDate: b.expirationDate,
      }))
      .filter((b) => b.available > 0)
      .sort(
        (a, b) =>
          new Date(a.expirationDate).getTime() -
          new Date(b.expirationDate).getTime()
      );
    weighted.push({
      componentProductId: item.componentProductId,
      componentName: item.component.name,
      perKitQty: item.quantity,
      weight,
      batches,
    });
  }

  if (totalWeight <= 0) totalWeight = 1;

  const components: KitComponentAllocation[] = [];
  const kitLineTotal = kitUnitPrice * kitQuantity;

  for (const row of weighted) {
    let need = row.perKitQty * kitQuantity;
    const shareTotal = kitLineTotal * (row.weight / totalWeight);
    const batchTakes: Array<{ batchId: string; quantity: number }> = [];

    for (const batch of row.batches) {
      if (need <= 0) break;
      const take = Math.min(batch.available, need);
      if (take <= 0) continue;
      batchTakes.push({ batchId: batch.id, quantity: take });
      need -= take;
    }

    if (need > 0) {
      throw Object.assign(
        new Error(`Estoque insuficiente para ${row.componentName}`),
        { statusCode: 409 }
      );
    }

    const units = batchTakes.reduce((s, b) => s + b.quantity, 0);
    let allocatedMoney = 0;

    batchTakes.forEach((take, index) => {
      const isLast = index === batchTakes.length - 1;
      const lineTotal = isLast
        ? Number((shareTotal - allocatedMoney).toFixed(2))
        : Number(((shareTotal * take.quantity) / units).toFixed(2));
      allocatedMoney += lineTotal;
      const unitPrice = Number((lineTotal / take.quantity).toFixed(4));
      components.push({
        batchId: take.batchId,
        productId: row.componentProductId,
        productName: `${kit.name} · ${row.componentName}`,
        quantity: take.quantity,
        unitPrice,
        lineTotal,
      });
    });
  }

  // Corrige arredondamento para bater o total do kit
  const sumLines = components.reduce((s, c) => s + c.lineTotal, 0);
  const drift = Number((kitLineTotal - sumLines).toFixed(2));
  if (drift !== 0 && components.length > 0) {
    const last = components[components.length - 1];
    last.lineTotal = Number((last.lineTotal + drift).toFixed(2));
    last.unitPrice = Number((last.lineTotal / last.quantity).toFixed(4));
  }

  return {
    kitProductId: kit.id,
    kitName: kit.name,
    kitQuantity,
    unitPrice: kitUnitPrice,
    availableKits,
    components,
  };
}

export async function getKitAvailableStock(
  tx: Tx,
  kitProductId: string
): Promise<number> {
  const kit = await tx.product.findFirst({
    where: { id: kitProductId, kind: "kit" },
    include: {
      kitItems: {
        include: {
          component: {
            include: {
              batches: {
                select: { quantity: true, reservedQuantity: true },
              },
            },
          },
        },
      },
    },
  });
  if (!kit || !kit.isActive || kit.kitItems.length === 0) return 0;
  return computeKitAvailability(
    kit.kitItems.map((item) => ({
      quantity: item.quantity,
      available: item.component.batches.reduce(
        (s, b) => s + availableOf(b),
        0
      ),
    }))
  );
}

/** Lotes FIFO de um produto simples (helper para tipagem). */
export function sortBatchesFifo<T extends { expirationDate: Date }>(
  batches: T[]
): T[] {
  return [...batches].sort(
    (a, b) =>
      new Date(a.expirationDate).getTime() -
      new Date(b.expirationDate).getTime()
  );
}

export type { BatchRow };
