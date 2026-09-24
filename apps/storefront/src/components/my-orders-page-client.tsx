"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { OrderListItem } from "@/components/order-detail";
import { loadCustomerSession } from "@/lib/customer-session";
import { fetchMyOrders, type OrderSummary } from "@/lib/orders";
import { storeHref, tenantDomain } from "@/lib/store-url";

export function MyOrdersPageClient({ subdomain }: { subdomain: string }) {
  const domain = tenantDomain(subdomain);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadCustomerSession(subdomain);
    if (!session?.token) {
      setError("Faça login para ver seus pedidos.");
      setReady(true);
      return;
    }

    fetchMyOrders(domain, session.token)
      .then(setOrders)
      .catch((e: Error) => setError(e.message))
      .finally(() => setReady(true));
  }, [domain, subdomain]);

  return (
    <main className="order-shell">
      <Link href={storeHref(subdomain)} className="order-back-link">
        ← Voltar à loja
      </Link>
      <header className="order-header">
        <h1>Meus pedidos</h1>
      </header>

      {!ready && <p className="order-muted">Carregando…</p>}
      {error && <p className="order-error">{error}</p>}

      {ready && !error && orders.length === 0 && (
        <p className="order-muted">Você ainda não fez pedidos nesta loja.</p>
      )}

      {orders.length > 0 && (
        <div className="order-list">
          {orders.map((order) => (
            <OrderListItem
              key={order.publicCode}
              order={order}
              href={storeHref(subdomain, `/pedido/${order.publicCode}`)}
            />
          ))}
        </div>
      )}
    </main>
  );
}
