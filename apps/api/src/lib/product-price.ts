type ProductPricing = {
  price: number | string | { toString(): string };
  cost?: number | string | { toString(): string } | null;
  salePrice?: number | string | { toString(): string } | null;
  salePriceUntil?: Date | string | null;
};

export function isSaleActive(product: ProductPricing, now = new Date()): boolean {
  if (product.salePrice == null || product.salePrice === "") return false;
  const sale = Number(product.salePrice);
  if (!Number.isFinite(sale) || sale <= 0) return false;
  if (product.salePriceUntil) {
    const until = new Date(product.salePriceUntil);
    if (until.getTime() < now.getTime()) return false;
  }
  return sale < Number(product.price);
}

/** Preço efetivo para venda (promoção ativa ou preço normal). */
export function getEffectivePrice(product: ProductPricing, now = new Date()): number {
  if (isSaleActive(product, now)) {
    return Number(product.salePrice);
  }
  return Number(product.price);
}

export function mapProductPricing<T extends ProductPricing>(product: T, now = new Date()) {
  const listPrice = Number(product.price);
  const onSale = isSaleActive(product, now);
  const effectivePrice = onSale ? Number(product.salePrice) : listPrice;
  return {
    ...product,
    listPrice,
    effectivePrice,
    onSale,
    originalPrice: onSale ? listPrice : null,
  };
}
