export type DeliveryAddress = {
  id?: string;
  label?: string;
  recipientName: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault?: boolean;
};

export type FulfillmentSelection = {
  fulfillmentType: "delivery" | "pickup";
  addressId?: string;
  delivery?: DeliveryAddress;
  saveAddress?: boolean;
};

export type ShippingQuote = {
  provider: string;
  amount: number | null;
  estimatedDays: number | null;
  freeDelivery: boolean;
  message: string;
};

export function deliveryStorageKey(subdomain: string) {
  return `revendedor_delivery_${subdomain}`;
}

export function loadGuestDelivery(subdomain: string): FulfillmentSelection | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(deliveryStorageKey(subdomain));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FulfillmentSelection;
  } catch {
    return null;
  }
}

export function saveGuestDelivery(subdomain: string, value: FulfillmentSelection) {
  localStorage.setItem(deliveryStorageKey(subdomain), JSON.stringify(value));
}

export function formatAddressShort(address: DeliveryAddress): string {
  return `${address.street}, ${address.number} — ${address.neighborhood}, ${address.city}/${address.state}`;
}

export function emptyAddress(): DeliveryAddress {
  return {
    recipientName: "",
    phone: "",
    zipCode: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  };
}

export function normalizeZipInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function buildFulfillmentPayload(
  selection: FulfillmentSelection
): FulfillmentSelection {
  if (selection.fulfillmentType === "pickup") {
    return { fulfillmentType: "pickup" };
  }
  if (selection.addressId) {
    return {
      fulfillmentType: "delivery",
      addressId: selection.addressId,
      saveAddress: selection.saveAddress,
    };
  }
  return {
    fulfillmentType: "delivery",
    delivery: selection.delivery,
    saveAddress: selection.saveAddress,
  };
}
