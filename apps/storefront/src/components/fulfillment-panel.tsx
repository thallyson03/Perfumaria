"use client";

import { useEffect, useRef, useState } from "react";
import { AddressForm } from "@/components/address-form";
import { loadCustomerSession } from "@/lib/customer-session";
import {
  buildFulfillmentPayload,
  emptyAddress,
  formatAddressShort,
  loadGuestDelivery,
  saveGuestDelivery,
  type DeliveryAddress,
  type FulfillmentSelection,
  type ShippingQuote,
} from "@/lib/delivery";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type StoreDeliveryConfig = {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  freeDeliveryMinAmount: number | null;
  deliveryMessage: string | null;
  pickupAddress: string | null;
};

type Props = {
  subdomain: string;
  domain: string;
  config: StoreDeliveryConfig;
  cartTotal: number;
  itemCount: number;
  value: FulfillmentSelection;
  onChange: (value: FulfillmentSelection) => void;
  onQuoteChange?: (quote: ShippingQuote | null) => void;
  compact?: boolean;
};

export function FulfillmentPanel({
  subdomain,
  domain,
  config,
  cartTotal,
  itemCount,
  value,
  onChange,
  onQuoteChange,
  compact,
}: Props) {
  const [savedAddresses, setSavedAddresses] = useState<DeliveryAddress[]>([]);
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [saveAddress, setSaveAddress] = useState(false);
  const [useNewAddress, setUseNewAddress] = useState(true);
  const token = loadCustomerSession(subdomain)?.token;

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/v1/store/addresses`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tenant-Domain": domain,
      },
    })
      .then(async (res) => {
        if (!res.ok) return [];
        return res.json() as Promise<DeliveryAddress[]>;
      })
      .then((rows) => {
        setSavedAddresses(rows);
        if (rows.length > 0 && value.fulfillmentType === "delivery" && !value.delivery) {
          const preferred = rows.find((a) => a.isDefault) ?? rows[0];
          onChange({
            fulfillmentType: "delivery",
            addressId: preferred.id,
          });
          setUseNewAddress(false);
        }
      })
      .catch(() => undefined);
  }, [token, domain, subdomain]);

  useEffect(() => {
    if (value.fulfillmentType !== "delivery") {
      setQuote(null);
      return;
    }

    const zipCode =
      value.delivery?.zipCode ??
      savedAddresses.find((a) => a.id === value.addressId)?.zipCode;
    if (!zipCode || zipCode.replace(/\D/g, "").length !== 8) {
      setQuote(null);
      return;
    }

    let cancelled = false;
    fetch(`${API}/v1/store/shipping/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Domain": domain,
      },
      body: JSON.stringify({ zipCode, cartTotal, itemCount }),
    })
      .then(async (res) => res.json())
      .then((data) => {
        if (!cancelled) setQuote(data as ShippingQuote);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    value.fulfillmentType,
    value.addressId,
    value.delivery?.zipCode,
    savedAddresses,
    cartTotal,
    itemCount,
    domain,
  ]);

  useEffect(() => {
    onQuoteChange?.(quote);
  }, [quote, onQuoteChange]);

  function setType(fulfillmentType: "delivery" | "pickup") {
    const next: FulfillmentSelection = { fulfillmentType };
    if (fulfillmentType === "delivery") {
      const guest = loadGuestDelivery(subdomain);
      if (guest?.fulfillmentType === "delivery") {
        onChange(guest);
        return;
      }
      next.delivery = emptyAddress();
    }
    onChange(next);
    saveGuestDelivery(subdomain, next);
  }

  function selectSavedAddress(id: string) {
    const next = { fulfillmentType: "delivery" as const, addressId: id };
    onChange(next);
    saveGuestDelivery(subdomain, next);
    setUseNewAddress(false);
  }

  function updateDelivery(delivery: DeliveryAddress) {
    const next = {
      fulfillmentType: "delivery" as const,
      delivery,
      saveAddress,
    };
    onChange(next);
    saveGuestDelivery(subdomain, next);
  }

  return (
    <div className={`fulfillment-panel ${compact ? "fulfillment-panel--compact" : ""}`}>
      <div className="fulfillment-type">
        {config.deliveryEnabled && (
          <button
            type="button"
            className={value.fulfillmentType === "delivery" ? "active" : ""}
            onClick={() => setType("delivery")}
          >
            Entrega
          </button>
        )}
        {config.pickupEnabled && (
          <button
            type="button"
            className={value.fulfillmentType === "pickup" ? "active" : ""}
            onClick={() => setType("pickup")}
          >
            Retirada
          </button>
        )}
      </div>

      {value.fulfillmentType === "pickup" ? (
        <div className="fulfillment-pickup-box">
          <strong>Retirar com o revendedor</strong>
          <p>
            {config.pickupAddress ??
              "Combine o horário e o local de retirada com o vendedor após o pedido."}
          </p>
        </div>
      ) : (
        <>
          {token && savedAddresses.length > 0 && (
            <div className="fulfillment-saved">
              <p className="fulfillment-label">Endereços salvos</p>
              {savedAddresses.map((address) => (
                <label key={address.id} className="fulfillment-saved-item">
                  <input
                    type="radio"
                    name="saved-address"
                    checked={value.addressId === address.id && !useNewAddress}
                    onChange={() => selectSavedAddress(address.id!)}
                  />
                  <span>
                    <strong>{address.label ?? "Endereço"}</strong>
                    <small>{formatAddressShort(address)}</small>
                  </span>
                </label>
              ))}
              <button
                type="button"
                className="fulfillment-link-btn"
                onClick={() => {
                  setUseNewAddress(true);
                  onChange({
                    fulfillmentType: "delivery",
                    delivery: emptyAddress(),
                    saveAddress,
                  });
                }}
              >
                + Usar outro endereço
              </button>
            </div>
          )}

          {(useNewAddress || savedAddresses.length === 0 || !token) && (
            <AddressForm
              domain={domain}
              value={value.delivery ?? emptyAddress()}
              onChange={updateDelivery}
              showSaveOption={Boolean(token)}
              saveAddress={saveAddress}
              onSaveAddressChange={(checked) => {
                setSaveAddress(checked);
                onChange({ ...value, saveAddress: checked });
              }}
            />
          )}

          {quote && (
            <div className="fulfillment-quote">
              {quote.freeDelivery ? (
                <strong>Frete grátis</strong>
              ) : quote.amount != null ? (
                <strong>Frete estimado: {quote.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>
              ) : (
                <strong>Frete a combinar</strong>
              )}
              <p>{quote.message}</p>
              {quote.estimatedDays != null && (
                <small>Prazo estimado: {quote.estimatedDays} dia(s)</small>
              )}
            </div>
          )}

          {!quote && config.deliveryMessage && (
            <p className="checkout-hint">{config.deliveryMessage}</p>
          )}
        </>
      )}
    </div>
  );
}

export function isFulfillmentValid(
  value: FulfillmentSelection,
  config: StoreDeliveryConfig
): boolean {
  if (value.fulfillmentType === "pickup") {
    return config.pickupEnabled;
  }
  if (!config.deliveryEnabled) return false;
  if (value.addressId) return true;
  const d = value.delivery;
  return Boolean(
    d?.recipientName &&
      d.phone &&
      d.zipCode.replace(/\D/g, "").length === 8 &&
      d.street &&
      d.number &&
      d.neighborhood &&
      d.city &&
      d.state.length === 2
  );
}

export function FulfillmentLocationMenu({
  subdomain,
  domain,
  config,
  cartTotal,
  itemCount,
  value,
  onChange,
  onQuoteChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = loadGuestDelivery(subdomain);
    if (saved) onChange(saved);
  }, [subdomain, onChange]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const label =
    value.fulfillmentType === "pickup"
      ? "Retirada"
      : value.addressId || value.delivery?.zipCode
        ? value.delivery
          ? formatAddressShort(value.delivery)
          : "Endereço selecionado"
        : "Informar localização";

  return (
    <>
      <div className="store-location" ref={ref}>
        <button
          type="button"
          className="store-header-link"
          onClick={() => setOpen((o) => !o)}
        >
          <LocationIcon />
          <span className="store-header-link-label store-location-label">
            {label}
          </span>
          <ChevronIcon />
        </button>
        {open && (
          <div className="store-location-panel">
            <FulfillmentPanel
              subdomain={subdomain}
              domain={domain}
              config={config}
              cartTotal={cartTotal}
              itemCount={itemCount}
              value={value}
              onQuoteChange={onQuoteChange}
              onChange={(next) => {
                onChange(next);
                saveGuestDelivery(subdomain, next);
              }}
              compact
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!isFulfillmentValid(value, config)}
              onClick={() => setOpen(false)}
            >
              Confirmar
            </button>
          </div>
        )}
      </div>

      {open && (
        <div
          className="store-location-overlay"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
    </>
  );
}

export { buildFulfillmentPayload };

function LocationIcon() {
  return (
    <svg
      className="store-header-link-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M12 21s7-4.5 7-10a7 7 0 1 0-14 0c0 5.5 7 10 7 10z" />
      <circle cx="12" cy="11" r="2.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="store-header-link-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
