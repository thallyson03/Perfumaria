import type { FulfillmentType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { sanitizeAddressInput, type DeliveryAddressSnapshot } from "../lib/address.js";
import type { FulfillmentInput } from "../lib/order-delivery.js";
import { getCustomerAddressForOrder } from "./customer-address.js";
import { quoteShipping } from "./shipping.js";

type Tx = Prisma.TransactionClient;

type TenantFulfillmentConfig = {
  tenantId: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  shippingProvider: string | null;
  shippingOriginZipCode: string | null;
  melhorEnvioToken: string | null;
  correiosContractCode: string | null;
  freeDeliveryMinAmount: unknown;
  deliveryMessage: string | null;
};

export async function resolveOrderFulfillment(
  tx: Tx,
  tenant: TenantFulfillmentConfig,
  fulfillment: FulfillmentInput,
  options: {
    customerId?: string;
    cartTotal: number;
    itemCount: number;
  }
): Promise<{
  fulfillmentType: FulfillmentType;
  delivery: DeliveryAddressSnapshot | null;
  shippingQuoteAmount: number | null;
  shippingQuoteDays: number | null;
  shippingProvider: string | null;
}> {
  if (fulfillment.fulfillmentType === "pickup") {
    if (!tenant.pickupEnabled) {
      throw Object.assign(new Error("Retirada não disponível nesta loja"), {
        statusCode: 403,
      });
    }
    return {
      fulfillmentType: "pickup",
      delivery: null,
      shippingQuoteAmount: null,
      shippingQuoteDays: null,
      shippingProvider: null,
    };
  }

  if (!tenant.deliveryEnabled) {
    throw Object.assign(new Error("Entrega não disponível nesta loja"), {
      statusCode: 403,
    });
  }

  let delivery: DeliveryAddressSnapshot | null = null;

  if (fulfillment.addressId) {
    if (!options.customerId) {
      throw Object.assign(
        new Error("Faça login para usar um endereço salvo"),
        { statusCode: 401 }
      );
    }
    delivery = await getCustomerAddressForOrder(
      tx,
      tenant.tenantId,
      options.customerId,
      fulfillment.addressId
    );
  } else if (fulfillment.delivery) {
    delivery = {
      ...sanitizeAddressInput(fulfillment.delivery),
      deliveryAddressId: null,
    };
  }

  if (!delivery) {
    throw Object.assign(new Error("Endereço de entrega é obrigatório"), {
      statusCode: 400,
    });
  }

  const quote = await quoteShipping(
    {
      shippingProvider: tenant.shippingProvider,
      shippingOriginZipCode: tenant.shippingOriginZipCode,
      melhorEnvioToken: tenant.melhorEnvioToken,
      correiosContractCode: tenant.correiosContractCode,
      freeDeliveryMinAmount:
        tenant.freeDeliveryMinAmount != null
          ? Number(tenant.freeDeliveryMinAmount)
          : null,
      deliveryMessage: tenant.deliveryMessage,
    },
    {
      zipCode: delivery.zipCode,
      cartTotal: options.cartTotal,
      itemCount: options.itemCount,
    }
  );

  return {
    fulfillmentType: "delivery",
    delivery,
    shippingQuoteAmount: quote.amount,
    shippingQuoteDays: quote.estimatedDays,
    shippingProvider: quote.provider,
  };
}
