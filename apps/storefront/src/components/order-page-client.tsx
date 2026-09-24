"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckoutShell } from "@/components/checkout/checkout-shell";
import { OrderDetail } from "@/components/order-detail";
import { fetchPublicOrder } from "@/lib/orders";

const ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
  process.env.ROOT_DOMAIN ??
  "localhost";

function tenantDomain(subdomain: string) {
  return `${subdomain}.${ROOT_DOMAIN}`;
}

export function OrderPageClient({
  subdomain,
  publicCode,
}: {
  subdomain: string;
  publicCode: string;
}) {
  const domain = tenantDomain(subdomain);
  const searchParams = useSearchParams();
  const paidBanner = searchParams.get("paid") === "1";
  const [storeName, setStoreName] = useState(subdomain);
  const [order, setOrder] = useState<Awaited<
    ReturnType<typeof fetchPublicOrder>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPublicOrder(domain, publicCode)
      .then(setOrder)
      .catch((e: Error) => setError(e.message));

    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/v1/store/config`,
      { headers: { "X-Tenant-Domain": domain } }
    )
      .then((r) => r.json())
      .then((data) => {
        if (data?.name) setStoreName(String(data.name));
      })
      .catch(() => undefined);
  }, [domain, publicCode]);

  if (error) {
    return (
      <CheckoutShell current={4} storeName={storeName}>
        <div className="checkout-empty">
          <h1>Pedido não encontrado</h1>
          <p>{error}</p>
          <a href="/" className="btn-primary">
            Voltar à vitrine
          </a>
        </div>
      </CheckoutShell>
    );
  }

  if (!order) {
    return (
      <CheckoutShell current={4} storeName={storeName}>
        <p className="checkout-loading">Carregando pedido…</p>
      </CheckoutShell>
    );
  }

  return (
    <CheckoutShell current={4} storeName={storeName}>
      <OrderDetail
        order={order}
        storeName={storeName}
        paidBanner={paidBanner}
        backHref="/"
        backLabel="Voltar para a vitrine"
        confirmationLayout
      />
    </CheckoutShell>
  );
}
