const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type CartLinePayload = {
  batchId: string;
  quantity: number;
  reservedQuantity?: number;
};

export type KitComponentLine = {
  batchId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

function cartHeaders(domain: string) {
  return {
    "Content-Type": "application/json",
    "X-Tenant-Domain": domain,
  };
}

async function parseError(res: Response, data: unknown) {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
  }
  return res.status === 409
    ? "Estoque insuficiente"
    : "Não foi possível atualizar a sacola";
}

export async function reserveCartLine(
  domain: string,
  cartId: string,
  batchId: string,
  quantity: number
): Promise<{ cartId: string }> {
  const res = await fetch(`${API}/v1/cart/reserve`, {
    method: "POST",
    headers: cartHeaders(domain),
    body: JSON.stringify({ cartId, batchId, quantity }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await parseError(res, data));
  return { cartId: (data.cartId as string) ?? cartId };
}

export async function adjustCartLine(
  domain: string,
  cartId: string,
  batchId: string,
  previousQuantity: number,
  quantity: number
): Promise<void> {
  const res = await fetch(`${API}/v1/cart/adjust`, {
    method: "POST",
    headers: cartHeaders(domain),
    body: JSON.stringify({
      cartId,
      batchId,
      previousQuantity,
      quantity,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await parseError(res, data));
}

export async function reserveKit(
  domain: string,
  payload: {
    cartId: string;
    kitProductId: string;
    quantity: number;
    previousComponents?: Array<{ batchId: string; quantity: number }>;
  }
): Promise<{
  cartId: string;
  quantity: number;
  unitPrice: number;
  availableKits: number;
  components: KitComponentLine[];
  kitName?: string;
}> {
  const res = await fetch(`${API}/v1/cart/reserve-kit`, {
    method: "POST",
    headers: cartHeaders(domain),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(await parseError(res, data));
  return {
    cartId: (data.cartId as string) ?? payload.cartId,
    quantity: Number(data.quantity ?? 0),
    unitPrice: Number(data.unitPrice ?? 0),
    availableKits: Number(data.availableKits ?? 0),
    components: (data.components ?? []) as KitComponentLine[],
    kitName: data.kitName as string | undefined,
  };
}

export async function releaseAllCartLines(
  domain: string,
  cartId: string,
  items: CartLinePayload[]
): Promise<void> {
  if (items.length === 0) return;
  const res = await fetch(`${API}/v1/cart/release-all`, {
    method: "POST",
    headers: cartHeaders(domain),
    body: JSON.stringify({
      cartId,
      items: items.map((item) => ({
        batchId: item.batchId,
        quantity: item.reservedQuantity ?? item.quantity,
      })),
    }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(await parseError(res, data));
  }
}

export async function syncCartReservations(
  domain: string,
  cartId: string,
  items: CartLinePayload[]
): Promise<CartLinePayload[]> {
  const synced: CartLinePayload[] = [];

  for (const item of items) {
    const previousQuantity = item.reservedQuantity ?? 0;
    try {
      await adjustCartLine(
        domain,
        cartId,
        item.batchId,
        previousQuantity,
        item.quantity
      );
      synced.push({ ...item, reservedQuantity: item.quantity });
    } catch {
      try {
        await adjustCartLine(domain, cartId, item.batchId, 0, item.quantity);
        synced.push({ ...item, reservedQuantity: item.quantity });
      } catch {
        // Sem estoque — item omitido
      }
    }
  }

  return synced;
}
