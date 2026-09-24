const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type OrderItem = {
  productName: string;
  quantity: number;
  unitPrice: string | number;
  lineTotal: string | number;
};

export type OrderSummary = {
  publicCode: string;
  status: string;
  channel: string;
  fulfillmentType: string;
  totalAmount: string | number;
  shippingQuoteAmount?: string | number | null;
  shippingQuoteDays?: number | null;
  productsSubtotal?: number;
  shippingAmount?: number | null;
  deliveryCity?: string | null;
  deliveryState?: string | null;
  deliveryNeighborhood?: string | null;
  createdAt: string;
  confirmedAt?: string | null;
  expiresAt?: string | null;
  items?: OrderItem[];
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_seller: "Aguardando vendedor",
  pending_payment: "Aguardando pagamento",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

export function formatOrderStatus(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function formatBrl(value: number | string) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export async function fetchPublicOrder(
  domain: string,
  publicCode: string
): Promise<OrderSummary> {
  const res = await fetch(
    `${API}/v1/store/orders/${encodeURIComponent(publicCode)}`,
    { headers: { "X-Tenant-Domain": domain } }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Pedido não encontrado"
    );
  }
  return data as OrderSummary;
}

export async function fetchMyOrders(
  domain: string,
  token: string
): Promise<OrderSummary[]> {
  const res = await fetch(`${API}/v1/store/me/orders`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Domain": domain,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Erro ao carregar pedidos"
    );
  }
  return data as OrderSummary[];
}
