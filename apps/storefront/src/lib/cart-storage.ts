import {
  adjustCartLine,
  releaseAllCartLines,
  reserveKit,
  type CartLinePayload,
  type KitComponentLine,
} from "@/lib/cart-api";

export type CartItem = {
  /** Chave estável da linha na sacola */
  lineId: string;
  kind: "simple" | "kit";
  productId: string;
  productName: string;
  imageUrl: string | null;
  /** Lote do produto simples; para kit use o productId como âncora */
  batchId: string;
  quantity: number;
  unitPrice: number;
  maxQty: number;
  reservedQuantity?: number;
  components?: KitComponentLine[];
};

export function cartStorageKey(subdomain: string) {
  return `revendedor_cart_${subdomain}`;
}

export function cartIdKey(subdomain: string) {
  return `revendedor_cartid_${subdomain}`;
}

export function loadCartId(subdomain: string): string {
  if (typeof window === "undefined") return "";
  const id =
    localStorage.getItem(cartIdKey(subdomain)) ?? crypto.randomUUID();
  localStorage.setItem(cartIdKey(subdomain), id);
  return id;
}

function normalizeCartItem(item: CartItem): CartItem {
  return {
    ...item,
    kind: item.kind ?? "simple",
    lineId: item.lineId ?? item.batchId,
    maxQty: item.maxQty ?? item.quantity,
    components: item.components ?? undefined,
  };
}

export function loadCartItems(subdomain: string): CartItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(cartStorageKey(subdomain));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CartItem[];
    return parsed.map(normalizeCartItem);
  } catch {
    return [];
  }
}

export function saveCartItems(subdomain: string, items: CartItem[]) {
  localStorage.setItem(cartStorageKey(subdomain), JSON.stringify(items));
}

export function cartSubtotal(items: CartItem[]) {
  return items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
}

export function cartCount(items: CartItem[]) {
  return items.reduce((s, i) => s + i.quantity, 0);
}

/** Achata a sacola em linhas de lote para reserva/checkout. */
export function flattenCartLines(items: CartItem[]): Array<{
  batchId: string;
  quantity: number;
  unitPrice?: number;
  productName?: string;
}> {
  const lines: Array<{
    batchId: string;
    quantity: number;
    unitPrice?: number;
    productName?: string;
  }> = [];
  for (const item of items) {
    if (item.kind === "kit" && item.components?.length) {
      for (const c of item.components) {
        lines.push({
          batchId: c.batchId,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          productName: c.productName,
        });
      }
    } else {
      lines.push({
        batchId: item.batchId,
        quantity: item.reservedQuantity ?? item.quantity,
        unitPrice: item.unitPrice,
        productName: item.productName,
      });
    }
  }
  return lines;
}

export function flattenCartForRelease(items: CartItem[]): CartLinePayload[] {
  return flattenCartLines(items).map((l) => ({
    batchId: l.batchId,
    quantity: l.quantity,
  }));
}

export async function clearCartRemote(
  domain: string,
  subdomain: string,
  items: CartItem[]
) {
  const cartId = loadCartId(subdomain);
  if (cartId && items.length > 0) {
    try {
      await releaseAllCartLines(domain, cartId, flattenCartForRelease(items));
    } catch {
      // ignore
    }
  }
  saveCartItems(subdomain, []);
}

export async function updateCartQuantity(
  domain: string,
  subdomain: string,
  items: CartItem[],
  lineId: string,
  nextQty: number
): Promise<CartItem[]> {
  const cartId = loadCartId(subdomain);
  const item = items.find((i) => i.lineId === lineId || i.batchId === lineId);
  if (!item || !cartId) return items;

  if (item.kind === "kit") {
    const previousComponents = item.components ?? [];
    if (nextQty <= 0) {
      await reserveKit(domain, {
        cartId,
        kitProductId: item.productId,
        quantity: 0,
        previousComponents,
      });
      const next = items.filter(
        (i) => i.lineId !== item.lineId && i.batchId !== item.batchId
      );
      saveCartItems(subdomain, next);
      return next;
    }
    if (nextQty > item.maxQty) {
      throw new Error("Quantidade máxima disponível atingida.");
    }
    const result = await reserveKit(domain, {
      cartId,
      kitProductId: item.productId,
      quantity: nextQty,
      previousComponents,
    });
    const next = items.map((i) =>
      i.lineId === item.lineId
        ? {
            ...i,
            quantity: nextQty,
            reservedQuantity: nextQty,
            unitPrice: result.unitPrice,
            maxQty: result.availableKits,
            components: result.components,
          }
        : i
    );
    saveCartItems(subdomain, next);
    return next;
  }

  if (nextQty <= 0) {
    await adjustCartLine(
      domain,
      cartId,
      item.batchId,
      item.reservedQuantity ?? item.quantity,
      0
    );
    const next = items.filter((i) => i.lineId !== item.lineId);
    saveCartItems(subdomain, next);
    return next;
  }

  if (nextQty > item.maxQty) {
    throw new Error("Quantidade máxima disponível atingida.");
  }

  await adjustCartLine(
    domain,
    cartId,
    item.batchId,
    item.reservedQuantity ?? item.quantity,
    nextQty
  );
  const next = items.map((i) =>
    i.lineId === item.lineId
      ? { ...i, quantity: nextQty, reservedQuantity: nextQty }
      : i
  );
  saveCartItems(subdomain, next);
  return next;
}

export function formatPrice(value: number | string) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function mediaUrl(pathOrUrl: string | null | undefined): string | null {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${API}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

import { tenantDomain as resolveTenantDomain } from "./store-url";

export function tenantDomain(subdomain: string) {
  return resolveTenantDomain(subdomain);
}
