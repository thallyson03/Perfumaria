import { normalizeZipCode } from "../lib/address.js";

export type ShippingQuoteInput = {
  zipCode: string;
  cartTotal: number;
  itemCount: number;
};

export type ShippingQuoteResult = {
  provider: "manual" | "melhor_envio" | "correios";
  amount: number | null;
  estimatedDays: number | null;
  freeDelivery: boolean;
  message: string;
};

type TenantShippingConfig = {
  shippingProvider: string | null;
  shippingOriginZipCode: string | null;
  melhorEnvioToken: string | null;
  correiosContractCode: string | null;
  freeDeliveryMinAmount: number | null;
  deliveryMessage: string | null;
};

const DEFAULT_MESSAGE =
  "Frete a combinar com o vendedor via WhatsApp após o pedido.";

export async function quoteShipping(
  tenant: TenantShippingConfig,
  input: ShippingQuoteInput
): Promise<ShippingQuoteResult> {
  const zipCode = normalizeZipCode(input.zipCode);
  const freeDelivery =
    tenant.freeDeliveryMinAmount != null &&
    input.cartTotal >= tenant.freeDeliveryMinAmount;

  const base: ShippingQuoteResult = {
    provider: "manual",
    amount: null,
    estimatedDays: null,
    freeDelivery,
    message: tenant.deliveryMessage?.trim() || DEFAULT_MESSAGE,
  };

  if (freeDelivery) {
    return {
      ...base,
      amount: 0,
      message: "Frete grátis para este pedido!",
    };
  }

  const provider = tenant.shippingProvider ?? "manual";

  if (provider === "melhor_envio" && tenant.melhorEnvioToken) {
    const quoted = await quoteMelhorEnvio(tenant, zipCode, input.itemCount);
    if (quoted) return quoted;
  }

  if (provider === "correios" && tenant.correiosContractCode) {
    const quoted = quoteCorreiosEstimate(tenant, zipCode, input.itemCount);
    if (quoted) return quoted;
  }

  return base;
}

async function quoteMelhorEnvio(
  tenant: TenantShippingConfig,
  toZipCode: string,
  itemCount: number
): Promise<ShippingQuoteResult | null> {
  const fromZip = tenant.shippingOriginZipCode?.replace(/\D/g, "");
  const toZip = toZipCode.replace(/\D/g, "");
  if (!fromZip || fromZip.length !== 8 || toZip.length !== 8) return null;

  try {
    const res = await fetch(
      "https://melhorenvio.com.br/api/v2/me/shipment/calculate",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${tenant.melhorEnvioToken}`,
          "User-Agent": "Revendedor SaaS (contato@revendedor.local)",
        },
        body: JSON.stringify({
          from: { postal_code: fromZip },
          to: { postal_code: toZip },
          products: Array.from({ length: Math.max(1, itemCount) }, () => ({
            id: "1",
            width: 12,
            height: 12,
            length: 12,
            weight: 0.3,
            insurance_value: 0,
            quantity: 1,
          })),
          services: "1,2,17",
        }),
      }
    );

    if (!res.ok) return null;

    const data = (await res.json()) as Array<{
      price?: string;
      delivery_time?: number;
      error?: string;
    }>;

    const options = data.filter((row) => !row.error && row.price);
    if (options.length === 0) return null;

    const cheapest = options.reduce((min, row) =>
      Number(row.price) < Number(min.price) ? row : min
    );

    return {
      provider: "melhor_envio",
      amount: Number(cheapest.price),
      estimatedDays: cheapest.delivery_time ?? null,
      freeDelivery: false,
      message: "Valor estimado via Melhor Envio. Confirme com o vendedor.",
    };
  } catch {
    return null;
  }
}

function quoteCorreiosEstimate(
  tenant: TenantShippingConfig,
  toZipCode: string,
  itemCount: number
): ShippingQuoteResult | null {
  const fromZip = tenant.shippingOriginZipCode?.replace(/\D/g, "") ?? "";
  const toZip = toZipCode.replace(/\D/g, "");
  if (fromZip.length !== 8 || toZip.length !== 8) return null;

  const regionDiff = Math.abs(Number(fromZip.slice(0, 1)) - Number(toZip.slice(0, 1)));
  const base = 12 + regionDiff * 4;
  const amount = Math.round((base + itemCount * 2) * 100) / 100;

  return {
    provider: "correios",
    amount,
    estimatedDays: regionDiff <= 1 ? 3 : regionDiff <= 3 ? 5 : 8,
    freeDelivery: false,
    message:
      "Estimativa Correios (PAC). Valor final a combinar com o vendedor.",
  };
}
