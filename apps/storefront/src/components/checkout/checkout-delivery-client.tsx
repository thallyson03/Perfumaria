"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { CheckoutOrderSummary } from "@/components/checkout/order-summary";
import {
  FulfillmentPanel,
  isFulfillmentValid,
  type StoreDeliveryConfig,
} from "@/components/fulfillment-panel";
import {
  cartSubtotal,
  loadCartId,
  loadCartItems,
  tenantDomain,
  type CartItem,
} from "@/lib/cart-storage";
import {
  loadCustomerSession,
  type CustomerSession,
} from "@/lib/customer-session";
import {
  loadGuestDelivery,
  saveGuestDelivery,
  type FulfillmentSelection,
  type ShippingQuote,
} from "@/lib/delivery";

type StoreConfig = StoreDeliveryConfig & {
  name: string;
  channelWhatsapp: boolean;
  channelOnlinePayment: boolean;
  hasWhatsApp: boolean;
};

export function CheckoutDeliveryClient({ subdomain }: { subdomain: string }) {
  const router = useRouter();
  const domain = tenantDomain(subdomain);
  const [items, setItems] = useState<CartItem[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>({
    fulfillmentType: "delivery",
  });
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(
    null
  );
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadCartId(subdomain);
    const cart = loadCartItems(subdomain);
    setItems(cart);
    if (cart.length === 0) {
      router.replace("/checkout");
      return;
    }

    const guest = loadGuestDelivery(subdomain);
    if (guest) setFulfillment(guest);

    const sess = loadCustomerSession(subdomain);
    setSession(sess);
    if (sess) {
      setCustomerName(sess.customer.fullName);
      setCustomerEmail(sess.customer.email);
      setCustomerPhone(sess.customer.phone ?? "");
      if (sess.customer.documentCpf) {
        setCustomerCpf(sess.customer.documentCpf);
      }
    }

    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/store/config`,
      { headers: { "X-Tenant-Domain": domain } }
    )
      .then((r) => r.json())
      .then((data) => setConfig(data as StoreConfig))
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
  }, [subdomain, domain, router]);

  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  const shippingAmount =
    fulfillment.fulfillmentType === "pickup"
      ? 0
      : shippingQuote?.freeDelivery
        ? 0
        : (shippingQuote?.amount ?? null);
  const total = subtotal + (shippingAmount ?? 0);

  function persistCustomer() {
    sessionStorage.setItem(
      `revendedor_checkout_customer_${subdomain}`,
      JSON.stringify({
        customerName,
        customerPhone,
        customerCpf: customerCpf.replace(/\D/g, ""),
        customerEmail,
      })
    );
  }

  function goPayment() {
    setMessage(null);
    if (!config || !isFulfillmentValid(fulfillment, config)) {
      setMessage("Informe como deseja receber o pedido.");
      return;
    }
    if (customerName.trim().length < 2) {
      setMessage("Informe seu nome completo.");
      return;
    }
    if (customerPhone.replace(/\D/g, "").length < 8) {
      setMessage("Informe um telefone/WhatsApp válido.");
      return;
    }
    if (customerCpf.replace(/\D/g, "").length !== 11) {
      setMessage("Informe um CPF válido (11 dígitos).");
      return;
    }
    saveGuestDelivery(subdomain, fulfillment);
    persistCustomer();
    router.push("/checkout/pagamento");
  }

  return (
    <CheckoutShell current={2} storeName={config?.name ?? subdomain}>
      {message && <div className="checkout-toast">{message}</div>}
      <div className="checkout-grid">
        <section className="checkout-col">
          <div className="checkout-card">
            <div className="checkout-card-head">
              <h1 className="checkout-h1">Identificação do cliente</h1>
              {session && (
                <span className="checkout-pill checkout-pill--gold">
                  Conta logada
                </span>
              )}
            </div>
            <div className="checkout-form-grid">
              <label>
                Nome completo
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </label>
              <label>
                CPF
                <input
                  value={customerCpf}
                  onChange={(e) =>
                    setCustomerCpf(
                      e.target.value.replace(/\D/g, "").slice(0, 11)
                    )
                  }
                  inputMode="numeric"
                  required
                  placeholder="Somente números"
                />
              </label>
              <label>
                WhatsApp / telefone
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  autoComplete="tel"
                  required
                />
              </label>
              <label>
                E-mail
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="Obrigatório para PIX"
                />
              </label>
            </div>
            {!session && (
              <p className="checkout-hint">
                Já tem conta?{" "}
                <Link href="/">Entre na loja</Link> para preencher automaticamente
                e salvar endereços.
              </p>
            )}
          </div>

          <div className="checkout-card">
            <h2 className="checkout-h2">Modalidade de recebimento</h2>
            {config && (
              <FulfillmentPanel
                subdomain={subdomain}
                domain={domain}
                config={config}
                cartTotal={subtotal}
                itemCount={itemCount}
                value={fulfillment}
                onChange={(next) => {
                  setFulfillment(next);
                  saveGuestDelivery(subdomain, next);
                }}
                onQuoteChange={setShippingQuote}
              />
            )}
          </div>

          <div className="checkout-nav-row">
            <Link href="/checkout" className="checkout-back">
              ← Voltar para a sacola
            </Link>
            <button
              type="button"
              className="btn-primary"
              onClick={goPayment}
            >
              Continuar para pagamento seguro
            </button>
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
