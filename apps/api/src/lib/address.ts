export type DeliveryAddressInput = {
  recipientName: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
};

export type DeliveryAddressSnapshot = DeliveryAddressInput & {
  deliveryAddressId?: string | null;
};

export function normalizeZipCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function normalizeState(value: string): string {
  return value.trim().toUpperCase().slice(0, 2);
}

export function formatZipCodeDisplay(value: string): string {
  const normalized = normalizeZipCode(value);
  return normalized.length === 9 ? normalized : value;
}

export function formatAddressBlock(address: DeliveryAddressInput): string[] {
  const line1 = `${address.street}, ${address.number}${
    address.complement ? ` - ${address.complement}` : ""
  }`;
  const line2 = `${address.neighborhood} - ${address.city}/${address.state}`;
  const line3 = `CEP ${formatZipCodeDisplay(address.zipCode)}`;
  return [line1, line2, line3];
}

export function formatAddressSingleLine(address: DeliveryAddressInput): string {
  return formatAddressBlock(address).join(" · ");
}

export function sanitizeAddressInput(
  input: DeliveryAddressInput
): DeliveryAddressInput {
  return {
    recipientName: input.recipientName.trim(),
    phone: input.phone.trim(),
    zipCode: normalizeZipCode(input.zipCode),
    street: input.street.trim(),
    number: input.number.trim(),
    complement: input.complement?.trim() || null,
    neighborhood: input.neighborhood.trim(),
    city: input.city.trim(),
    state: normalizeState(input.state),
  };
}

export function isValidZipCode(value: string): boolean {
  return /^\d{5}-\d{3}$/.test(normalizeZipCode(value));
}

export function isValidState(value: string): boolean {
  return /^[A-Z]{2}$/.test(normalizeState(value));
}

export function addressToOrderFields(
  address: DeliveryAddressSnapshot
): Record<string, string | null | undefined> {
  return {
    deliveryAddressId: address.deliveryAddressId ?? null,
    deliveryRecipientName: address.recipientName,
    deliveryPhone: address.phone,
    deliveryZipCode: address.zipCode,
    deliveryStreet: address.street,
    deliveryNumber: address.number,
    deliveryComplement: address.complement ?? null,
    deliveryNeighborhood: address.neighborhood,
    deliveryCity: address.city,
    deliveryState: address.state,
  };
}

export function orderToAddress(order: {
  deliveryRecipientName: string | null;
  deliveryPhone: string | null;
  deliveryZipCode: string | null;
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryComplement: string | null;
  deliveryNeighborhood: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  deliveryAddressId?: string | null;
}): DeliveryAddressSnapshot | null {
  if (
    !order.deliveryRecipientName ||
    !order.deliveryZipCode ||
    !order.deliveryStreet ||
    !order.deliveryNumber ||
    !order.deliveryNeighborhood ||
    !order.deliveryCity ||
    !order.deliveryState
  ) {
    return null;
  }
  return {
    deliveryAddressId: order.deliveryAddressId ?? null,
    recipientName: order.deliveryRecipientName,
    phone: order.deliveryPhone ?? "",
    zipCode: order.deliveryZipCode,
    street: order.deliveryStreet,
    number: order.deliveryNumber,
    complement: order.deliveryComplement,
    neighborhood: order.deliveryNeighborhood,
    city: order.deliveryCity,
    state: order.deliveryState,
  };
}

export function addressFromRecord(row: {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
}) {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    zipCode: row.zipCode,
    street: row.street,
    number: row.number,
    complement: row.complement,
    neighborhood: row.neighborhood,
    city: row.city,
    state: row.state,
    isDefault: row.isDefault,
  };
}
