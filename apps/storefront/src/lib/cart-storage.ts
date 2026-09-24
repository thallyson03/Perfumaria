import {
  adjustCartLine,
  releaseAllCartLines,
  type CartLinePayload,
} from "@/lib/cart-api";

export type CartItem = {
  productId: string;
  productName: string;
  imageUrl: string | null;
  batchId: string;
  quantity: number;
  unitPrice: number;
  maxQty: number;
  reservedQuantity?: number;
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

export function loadCartItems(subdomain: string): CartItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(cartStorageKey(subdomain));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CartItem[];
    return parsed.map((item) => ({
      ...item,
      maxQty: item.maxQty ?? item.quantity,
    }));
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

export async function clearCartRemote(
  domain: string,
  subdomain: string,
  items: CartItem[]
) {
  const cartId = loadCartId(subdomain);
  if (cartId && items.length > 0) {
    try {
      await releaseAllCartLines(domain, cartId, items as CartLinePayload[]);
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
  batchId: string,
  nextQty: number
): Promise<CartItem[]> {
  const cartId = loadCartId(subdomain);
  const item = items.find((i) => i.batchId === batchId);
  if (!item || !cartId) return items;

  if (nextQty <= 0) {
    await adjustCartLine(
      domain,
      cartId,
      batchId,
      item.reservedQuantity ?? item.quantity,
      0
    );
    const next = items.filter((i) => i.batchId !== batchId);
    saveCartItems(subdomain, next);
    return next;
  }

  if (nextQty > item.maxQty) {
    throw new Error("Quantidade máxima disponível atingida.");
  }

  await adjustCartLine(
    domain,
    cartId,
    batchId,
    item.reservedQuantity ?? item.quantity,
    nextQty
  );
  const next = items.map((i) =>
    i.batchId === batchId
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

export function tenantDomain(subdomain: string) {
  const ROOT =
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    process.env.ROOT_DOMAIN ??
    "localhost";
  return `${subdomain}.${ROOT}`;
}
