"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { CheckoutOrderSummary } from "@/components/checkout/order-summary";
import {
  isFulfillmentValid,
  type StoreDeliveryConfig,
} from "@/components/fulfillment-panel";
import {
  cartSubtotal,
  clearCartRemote,
  formatPrice,
  loadCartId,
  loadCartItems,
  saveCartItems,
  tenantDomain,
  type CartItem,
} from "@/lib/cart-storage";
import { loadCustomerSession } from "@/lib/customer-session";
import {
  buildFulfillmentPayload,
  loadGuestDelivery,
  type FulfillmentSelection,
  type ShippingQuote,
} from "@/lib/delivery";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type StoreConfig = StoreDeliveryConfig & {
  name: string;
  channelWhatsapp: boolean;
  channelOnlinePayment: boolean;
  hasWhatsApp: boolean;
};

type PayMethod = "whatsapp" | "pix";

type CustomerDraft = {
  customerName: string;
  customerPhone: string;
  customerCpf: string;
  customerEmail: string;
};

export function CheckoutPaymentClient({ subdomain }: { subdomain: string }) {
  const router = useRouter();
  const domain = tenantDomain(subdomain);
  const [items, setItems] = useState<CartItem[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>({
    fulfillmentType: "delivery",
  });
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(
    null
  );
  const [customer, setCustomer] = useState<CustomerDraft | null>(null);
  const [method, setMethod] = useState<PayMethod>("whatsapp");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pixData, setPixData] = useState<{
    publicCode: string;
    pixCode: string | null;
    qrCodeBase64: string | null;
    totalAmount: number;
  } | null>(null);

  useEffect(() => {
    const cart = loadCartItems(subdomain);
    setItems(cart);
    if (cart.length === 0) {
      router.replace("/checkout");
      return;
    }

    const guest = loadGuestDelivery(subdomain);
    if (guest) setFulfillment(guest);

    const raw = sessionStorage.getItem(
      `revendedor_checkout_customer_${subdomain}`
    );
    if (raw) {
      try {
        setCustomer(JSON.parse(raw) as CustomerDraft);
      } catch {
        router.replace("/checkout/entrega");
        return;
      }
    } else {
      router.replace("/checkout/entrega");
      return;
    }

    fetch(`${API}/v1/store/config`, {
      headers: { "X-Tenant-Domain": domain },
    })
      .then((r) => r.json())
      .then((data) => {
        const cfg = data as StoreConfig;
        setConfig(cfg);
        if (cfg.channelOnlinePayment && !cfg.channelWhatsapp) {
          setMethod("pix");
        } else if (!cfg.channelOnlinePayment) {
          setMethod("whatsapp");
        }
      })
      .catch(() =>
        setConfig({
          name: subdomain,
          channelWhatsapp: true,
          channelOnlinePayment: false,
          hasWhatsApp: false,
          deliveryEnabled: true,
          pickupEnabled: true,
          freeDeliveryMinAmount: null,
          deliveryMessage: null,
          pickupAddress: null,
        })
      );

    // Refresh shipping quote for display
    const zip =
      guest?.delivery?.zipCode ??
      (guest?.addressId ? undefined : undefined);
    if (guest?.fulfillmentType === "delivery" && zip) {
      const sub = cartSubtotal(cart);
      const count = cart.reduce((s, i) => s + i.quantity, 0);
      fetch(`${API}/v1/store/shipping/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Domain": domain,
        },
        body: JSON.stringify({ zipCode: zip, cartTotal: sub, itemCount: count }),
      })
        .then((r) => r.json())
        .then((q) => setShippingQuote(q as ShippingQuote))
        .catch(() => undefined);
    }
  }, [subdomain, domain, router]);

  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const shippingAmount =
    fulfillment.fulfillmentType === "pickup"
      ? 0
      : shippingQuote?.freeDelivery
        ? 0
        : (shippingQuote?.amount ?? 0);
  const total = subtotal + shippingAmount;

  function orderHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tenant-Domain": domain,
    };
    const token = loadCustomerSession(subdomain)?.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function submitWhatsApp(e: FormEvent) {
    e.preventDefault();
    if (!customer || !config) return;
    if (!isFulfillmentValid(fulfillment, config)) {
      setMessage("Revise a entrega antes de finalizar.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const cartId = loadCartId(subdomain);
      const res = await fetch(`${API}/v1/store/orders/whatsapp`, {
        method: "POST",
        headers: orderHeaders(),
        body: JSON.stringify({
          cartId,
          customerName: customer.customerName,
          customerPhone: customer.customerPhone,
          customerDocumentCpf: customer.customerCpf,
          fulfillment: buildFulfillmentPayload(fulfillment),
          items: items.map((i) => ({
            batchId: i.batchId,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Falha ao criar pedido");
        return;
      }
      saveCartItems(subdomain, []);
      if (data.whatsappUrl) {
        window.open(data.whatsappUrl as string, "_blank");
      }
      router.push(`/pedido/${data.publicCode as string}`);
    } finally {
      setLoading(false);
    }
  }

  async function submitPix(e: FormEvent) {
    e.preventDefault();
    if (!customer || !config) return;
    if (!customer.customerEmail) {
      setMessage("Informe o e-mail na etapa anterior para pagar com PIX.");
      return;
    }
    if (!isFulfillmentValid(fulfillment, config)) {
      setMessage("Revise a entrega antes de finalizar.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const cartId = loadCartId(subdomain);
      const res = await fetch(`${API}/v1/store/orders/payment`, {
        method: "POST",
        headers: orderHeaders(),
        body: JSON.stringify({
          cartId,
          customerName: customer.customerName,
          customerPhone: customer.customerPhone,
          customerEmail: customer.customerEmail,
          fulfillment: buildFulfillmentPayload(fulfillment),
          items: items.map((i) => ({
            batchId: i.batchId,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Falha ao gerar PIX");
        return;
      }
      await clearCartRemote(domain, subdomain, items);
      setItems([]);
      setPixData({
        publicCode: data.publicCode,
        pixCode: data.payment?.pixCode ?? null,
        qrCodeBase64: data.payment?.qrCodeBase64 ?? null,
        totalAmount: Number(data.totalAmount ?? total),
      });
    } finally {
      setLoading(false);
    }
  }

  if (pixData) {
    return (
      <CheckoutShell current={4} storeName={config?.name ?? subdomain}>
        <div className="checkout-confirm">
          <div className="checkout-confirm-badge">✓</div>
          <h1 className="checkout-h1">Pedido realizado com sucesso!</h1>
          <p className="checkout-lead">
            Pedido <strong>#PED-{pixData.publicCode}</strong> — pague o PIX
            para confirmar automaticamente.
          </p>
          <div className="checkout-pix-panel">
            <p className="checkout-pix-total">
              Total a pagar: <strong>{formatPrice(pixData.totalAmount)}</strong>
            </p>
            {pixData.qrCodeBase64 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                alt="QR Code PIX"
                width={200}
                height={200}
              />
            )}
            {pixData.pixCode && (
              <>
                <textarea readOnly value={pixData.pixCode} rows={3} />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    void navigator.clipboard.writeText(pixData.pixCode!);
                    setMessage("Código PIX copiado!");
                  }}
                >
                  Copiar código PIX
                </button>
              </>
            )}
            <div className="checkout-nav-row">
              <Link
                href={`/pedido/${pixData.publicCode}`}
                className="btn-outline"
              >
                Acompanhar pedido
              </Link>
              <Link href="/" className="btn-outline">
                Voltar à vitrine
              </Link>
            </div>
          </div>
          {message && <div className="checkout-toast">{message}</div>}
        </div>
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell current={3} storeName={config?.name ?? subdomain}>
      {message && <div className="checkout-toast">{message}</div>}
      <div className="checkout-grid">
        <section className="checkout-col">
          <div className="checkout-card checkout-secure-banner">
            <strong>Ambiente criptografado</strong>
            <span>Pagamento processado com segurança na loja do revendedor.</span>
          </div>

          <div className="checkout-card">
            <h1 className="checkout-h1">Escolha a forma de pagamento</h1>
            <p className="checkout-hint">Etapa final de liquidação</p>
            <div className="checkout-pay-methods">
              {config?.channelWhatsapp !== false && (
                <button
                  type="button"
                  className={`checkout-pay-method ${
                    method === "whatsapp" ? "active" : ""
                  }`}
                  onClick={() => setMethod("whatsapp")}
                >
                  <strong>WhatsApp</strong>
                  <span>Finalize com o vendedor</span>
                </button>
              )}
              {config?.channelOnlinePayment && (
                <button
                  type="button"
                  className={`checkout-pay-method ${
                    method === "pix" ? "active" : ""
                  }`}
                  onClick={() => setMethod("pix")}
                >
                  <strong>PIX</strong>
                  <span>Confirmação automática</span>
                </button>
              )}
            </div>

            {method === "whatsapp" && (
              <div className="checkout-pay-detail">
                <p>
                  Você será direcionado ao WhatsApp do revendedor com o resumo
                  do pedido. A reserva de estoque fica ativa até a confirmação.
                </p>
                <form onSubmit={submitWhatsApp}>
                  <div className="checkout-nav-row">
                    <Link href="/checkout/entrega" className="checkout-back">
                      ← Voltar para entrega
                    </Link>
                    <button
                      type="submit"
                      className="btn-whatsapp"
                      disabled={loading || !config?.hasWhatsApp}
                    >
                      {loading
                        ? "Gerando…"
                        : `Finalizar no WhatsApp (${formatPrice(total)})`}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {method === "pix" && (
              <div className="checkout-pay-detail">
                <p>
                  Geramos um QR Code PIX. Após o pagamento, o pedido é
                  confirmado automaticamente.
                </p>
                <form onSubmit={submitPix}>
                  <div className="checkout-nav-row">
                    <Link href="/checkout/entrega" className="checkout-back">
                      ← Voltar para entrega
                    </Link>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={loading}
                    >
                      {loading
                        ? "Gerando PIX…"
                        : `Finalizar e gerar PIX (${formatPrice(total)})`}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          <div className="checkout-card checkout-muted-card">
            <strong>
              {fulfillment.fulfillmentType === "pickup"
                ? "Retirada selecionada"
                : "Entrega selecionada"}
            </strong>
            <Link href="/checkout/entrega">Alterar</Link>
          </div>
        </section>

        <CheckoutOrderSummary
          items={items}
          subtotal={subtotal}
          shippingAmount={shippingAmount}
          total={total}
          fulfillmentType={fulfillment.fulfillmentType}
          shippingQuote={shippingQuote}
        />
      </div>
    </CheckoutShell>
  );
}
