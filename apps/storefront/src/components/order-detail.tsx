"use client";

import Link from "next/link";
import {
  formatBrl,
  formatOrderStatus,
  type OrderSummary,
} from "@/lib/orders";

type Props = {
  order: OrderSummary;
  storeName?: string;
  paidBanner?: boolean;
  backHref?: string;
  backLabel?: string;
  confirmationLayout?: boolean;
};

export function OrderDetail({
  order,
  storeName,
  paidBanner,
  backHref,
  backLabel,
  confirmationLayout,
}: Props) {
  const productsSubtotal =
    order.productsSubtotal ??
    (order.items?.reduce((s, i) => s + Number(i.lineTotal), 0) ?? 0);
  const shippingAmount =
    order.shippingAmount ??
    (order.fulfillmentType === "delivery" && order.shippingQuoteAmount != null
      ? Number(order.shippingQuoteAmount)
      : null);

  const createdLabel = new Date(order.createdAt).toLocaleString("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <div
      className={`order-page ${confirmationLayout ? "checkout-order" : ""}`}
    >
      {confirmationLayout && (
        <div className="checkout-confirm-badge" aria-hidden>
          ✓
        </div>
      )}

      {!confirmationLayout && backHref && (
        <Link href={backHref} className="order-back-link">
          ← {backLabel ?? "Voltar"}
        </Link>
      )}

      {paidBanner && (
        <div className="order-banner order-banner--success">
          Pagamento confirmado! Seu pedido foi registrado.
        </div>
      )}

      <header className="order-header">
        {!confirmationLayout && (
          <p className="order-kicker">{storeName ?? "Sua loja"}</p>
        )}
        <h1>
          {confirmationLayout
            ? "Pedido realizado com sucesso!"
            : `Pedido #PED-${order.publicCode}`}
        </h1>
        {confirmationLayout ? (
          <p className="checkout-lead" style={{ margin: "0.75rem auto 0" }}>
            Obrigado pela compra. Seu pedido já está sendo preparado com
            cuidado.
          </p>
        ) : (
          <span className={`order-status order-status--${order.status}`}>
            {formatOrderStatus(order.status)}
          </span>
        )}
      </header>

      {confirmationLayout && (
        <div className="order-meta-bar">
          <span>
            Pedido <strong>#PED-{order.publicCode}</strong>
          </span>
          <span>{createdLabel}</span>
          <span className={`order-status order-status--${order.status}`}>
            {formatOrderStatus(order.status)}
          </span>
        </div>
      )}

      <div className="checkout-grid" style={confirmationLayout ? undefined : { display: "block" }}>
        <section className="checkout-col">
          <section className="order-card checkout-card">
            <h2>Itens do pedido</h2>
            {order.items && order.items.length > 0 ? (
              <ul className="order-items">
                {order.items.map((item, i) => (
                  <li key={i}>
                    <span>
                      {item.productName} × {item.quantity}
                    </span>
                    <strong>{formatBrl(item.lineTotal)}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="order-totals">
              <div className="order-total-row">
                <span>Subtotal produtos</span>
                <span>{formatBrl(productsSubtotal)}</span>
              </div>
              {order.fulfillmentType === "delivery" && (
                <div className="order-total-row">
                  <span>Frete</span>
                  <span>
                    {shippingAmount != null
                      ? formatBrl(shippingAmount)
                      : "A combinar"}
                  </span>
                </div>
              )}
              {order.fulfillmentType === "pickup" && (
                <div className="order-total-row">
                  <span>Retirada</span>
                  <span className="checkout-summary-free">Grátis</span>
                </div>
              )}
              <div className="order-total-row order-total-row--grand">
                <span>Total</span>
                <strong>{formatBrl(order.totalAmount)}</strong>
              </div>
            </div>
          </section>

          <section className="order-card checkout-card">
            <h2>Modalidade de entrega</h2>
            <p>
              {order.fulfillmentType === "pickup"
                ? "Retirada com o vendedor"
                : order.deliveryCity
                  ? `${order.deliveryNeighborhood ?? ""} · ${order.deliveryCity}/${order.deliveryState}`
                  : "Entrega — endereço informado no pedido"}
            </p>
            {order.shippingQuoteDays != null && (
              <p className="order-muted">
                Prazo estimado: {order.shippingQuoteDays} dia(s)
              </p>
            )}
          </section>

          {!confirmationLayout && (
            <section className="order-card order-meta">
              <p>Realizado em {createdLabel}</p>
              {order.confirmedAt && (
                <p>
                  Confirmado em{" "}
                  {new Date(order.confirmedAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              )}
              {order.status === "pending_payment" && order.expiresAt && (
                <p className="order-muted">
                  Expira em{" "}
                  {new Date(order.expiresAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              )}
            </section>
          )}

          {confirmationLayout && backHref && (
            <div className="checkout-nav-row">
              <Link href={backHref} className="btn-outline">
                {backLabel ?? "Voltar à vitrine"}
              </Link>
              <Link href="/conta/pedidos" className="btn-primary">
                Meus pedidos
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function OrderListItem({
  order,
  href,
}: {
  order: OrderSummary;
  href: string;
}) {
  const itemCount = order.items?.reduce((s, i) => s + i.quantity, 0) ?? 0;

  return (
    <Link href={href} className="order-list-item">
      <div>
        <strong>#PED-{order.publicCode}</strong>
        <p className="order-muted">
          {new Date(order.createdAt).toLocaleDateString("pt-BR")} · {itemCount}{" "}
          {itemCount === 1 ? "item" : "itens"}
        </p>
      </div>
      <div className="order-list-item-right">
        <strong>{formatBrl(order.totalAmount)}</strong>
        <span className={`order-status order-status--${order.status}`}>
          {formatOrderStatus(order.status)}
        </span>
      </div>
    </Link>
  );
}
