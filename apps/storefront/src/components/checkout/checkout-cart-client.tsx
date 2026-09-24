"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { CheckoutOrderSummary } from "@/components/checkout/order-summary";
import {
  cartCount,
  cartSubtotal,
  clearCartRemote,
  formatPrice,
  loadCartId,
  loadCartItems,
  mediaUrl,
  saveCartItems,
  tenantDomain,
  updateCartQuantity,
  type CartItem,
} from "@/lib/cart-storage";
import { loadGuestDelivery } from "@/lib/delivery";
import { storeHref } from "@/lib/store-url";

type StoreConfig = {
  name: string;
  freeDeliveryMinAmount: number | null;
};

export function CheckoutCartClient({ subdomain }: { subdomain: string }) {
  const router = useRouter();
  const domain = tenantDomain(subdomain);
  const [items, setItems] = useState<CartItem[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadCartId(subdomain);
    setItems(loadCartItems(subdomain));
    setReady(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/store/config`, {
      headers: { "X-Tenant-Domain": domain },
    })
      .then((r) => r.json())
      .then((data) =>
        setConfig({
          name: data.name ?? subdomain,
          freeDeliveryMinAmount: data.freeDeliveryMinAmount ?? null,
        })
      )
      .catch(() => setConfig({ name: subdomain, freeDeliveryMinAmount: null }));
  }, [subdomain, domain]);

  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const count = useMemo(() => cartCount(items), [items]);
  const freeMin = config?.freeDeliveryMinAmount;
  const freeProgress =
    freeMin && freeMin > 0
      ? Math.min(100, Math.round((subtotal / freeMin) * 100))
      : null;
  const missingFree =
    freeMin && freeMin > subtotal ? freeMin - subtotal : 0;

  const fulfillment = loadGuestDelivery(subdomain);
  const shippingAmount =
    fulfillment?.fulfillmentType === "pickup" ? 0 : null;
  const total = subtotal + (shippingAmount ?? 0);

  async function changeQty(batchId: string, delta: number) {
    const item = items.find((i) => i.batchId === batchId);
    if (!item) return;
    setBusy(batchId);
    setMessage(null);
    try {
      const next = await updateCartQuantity(
        domain,
        subdomain,
        items,
        batchId,
        item.quantity + delta
      );
      setItems(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao atualizar");
    } finally {
      setBusy(null);
    }
  }

  async function removeItem(batchId: string) {
    setBusy(batchId);
    try {
      const next = await updateCartQuantity(
        domain,
        subdomain,
        items,
        batchId,
        0
      );
      setItems(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao remover");
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    setBusy("all");
    await clearCartRemote(domain, subdomain, items);
    setItems([]);
    setBusy(null);
  }

  const continueCheckout = useCallback(() => {
    if (items.length === 0) return;
    router.push(storeHref(subdomain, "/checkout/entrega"));
  }, [items.length, router]);

  if (!ready) {
    return (
      <CheckoutShell
        current={1}
        storeName={config?.name ?? subdomain}
        subdomain={subdomain}
      >
        <p className="checkout-loading">Carregando sacola…</p>
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell
      current={1}
      storeName={config?.name ?? subdomain}
      subdomain={subdomain}
    >
      {message && <div className="checkout-toast">{message}</div>}
      {items.length === 0 ? (
        <div className="checkout-empty">
          <h1>Sua sacola está vazia</h1>
          <p>Adicione fragrâncias na vitrine para continuar.</p>
          <Link href={storeHref(subdomain)} className="btn-primary">
            Voltar à vitrine
          </Link>
        </div>
      ) : (
        <div className="checkout-grid">
          <section className="checkout-col">
            <div className="checkout-card">
              <div className="checkout-card-head">
                <div>
                  <h1 className="checkout-h1">Sua sacola de experiência</h1>
                  <span className="checkout-pill">
                    {count} {count === 1 ? "item" : "itens"}
                  </span>
                </div>
                <button
                  type="button"
                  className="checkout-link-btn"
                  disabled={busy !== null}
                  onClick={() => void clearAll()}
                >
                  Limpar sacola
                </button>
              </div>
              {freeProgress != null && freeMin != null && (
                <div className="checkout-frete-bar">
                  <p>
                    {missingFree > 0 ? (
                      <>
                        Falta{" "}
                        <strong>{formatPrice(missingFree)}</strong> para{" "}
                        <strong>frete grátis</strong>
                      </>
                    ) : (
                      <strong>Você ganhou frete grátis!</strong>
                    )}
                  </p>
                  <div className="checkout-frete-track">
                    <div
                      className="checkout-frete-fill"
                      style={{ width: `${freeProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="checkout-lines">
              {items.map((item) => {
                const img = mediaUrl(item.imageUrl);
                return (
                  <article key={item.lineId} className="checkout-line">
                    <div className="checkout-line-thumb">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" />
                      ) : (
                        <span>◈</span>
                      )}
                    </div>
                    <div className="checkout-line-body">
                      <div className="checkout-line-top">
                        <div>
                          <h2>{item.productName}</h2>
                          <p>{formatPrice(item.unitPrice)} cada</p>
                        </div>
                        <strong>
                          {formatPrice(item.unitPrice * item.quantity)}
                        </strong>
                      </div>
                      <div className="checkout-line-actions">
                        <div className="cart-qty-controls">
                          <button
                            type="button"
                            className="cart-qty-btn"
                            disabled={busy === item.lineId}
                            onClick={() => void changeQty(item.lineId, -1)}
                          >
                            −
                          </button>
                          <span className="cart-qty-value">{item.quantity}</span>
                          <button
                            type="button"
                            className="cart-qty-btn"
                            disabled={
                              busy === item.lineId ||
                              item.quantity >= item.maxQty
                            }
                            onClick={() => void changeQty(item.lineId, 1)}
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          className="checkout-link-btn"
                          disabled={busy === item.lineId}
                          onClick={() => void removeItem(item.lineId)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <Link href={storeHref(subdomain)} className="checkout-back">
              ← Continuar comprando
            </Link>
          </section>

          <CheckoutOrderSummary
            items={items}
            subtotal={subtotal}
            shippingAmount={shippingAmount}
            total={total}
            fulfillmentType={fulfillment?.fulfillmentType}
          >
            <button
              type="button"
              className="btn-primary checkout-cta"
              onClick={continueCheckout}
            >
              Seguir para identificação e entrega
            </button>
          </CheckoutOrderSummary>
        </div>
      )}
    </CheckoutShell>
  );
}
