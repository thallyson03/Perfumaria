"use client";

import type { CartItem } from "@/lib/cart-storage";
import { formatPrice, mediaUrl } from "@/lib/cart-storage";
import type { ShippingQuote } from "@/lib/delivery";

type Props = {
  items: CartItem[];
  subtotal: number;
  shippingAmount: number | null;
  shippingLabel?: string;
  total: number;
  fulfillmentType?: "delivery" | "pickup";
  shippingQuote?: ShippingQuote | null;
  children?: React.ReactNode;
};

export function CheckoutOrderSummary({
  items,
  subtotal,
  shippingAmount,
  shippingLabel,
  total,
  fulfillmentType,
  shippingQuote,
  children,
}: Props) {
  return (
    <aside className="checkout-summary">
      <h2 className="checkout-summary-title">Resumo do pedido</h2>
      <ul className="checkout-summary-items">
        {items.map((item) => {
          const img = mediaUrl(item.imageUrl);
          return (
            <li key={item.lineId} className="checkout-summary-item">
              <div className="checkout-summary-thumb">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" />
                ) : (
                  <span>◈</span>
                )}
              </div>
              <div className="checkout-summary-info">
                <strong>{item.productName}</strong>
                <span>Qtd: {item.quantity}</span>
              </div>
              <span className="checkout-summary-price">
                {formatPrice(item.unitPrice * item.quantity)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="checkout-summary-rows">
        <div className="checkout-summary-row">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>
        {fulfillmentType === "pickup" ? (
          <div className="checkout-summary-row">
            <span>Retirada</span>
            <span className="checkout-summary-free">Grátis</span>
          </div>
        ) : (
          <div className="checkout-summary-row">
            <span>{shippingLabel ?? "Frete"}</span>
            <span>
              {shippingQuote?.freeDelivery
                ? "Grátis"
                : shippingAmount != null
                  ? formatPrice(shippingAmount)
                  : "A calcular"}
            </span>
          </div>
        )}
        <div className="checkout-summary-row checkout-summary-row--total">
          <span>Total</span>
          <strong>{formatPrice(total)}</strong>
        </div>
      </div>
      {children}
      <div className="checkout-summary-trust">
        <span>Compra segura</span>
        <span>Produtos originais</span>
        <span>Estoque reservado</span>
      </div>
    </aside>
  );
}
