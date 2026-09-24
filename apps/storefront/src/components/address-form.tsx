"use client";

import { useEffect, useState } from "react";
import {
  emptyAddress,
  normalizeZipInput,
  type DeliveryAddress,
} from "@/lib/delivery";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Props = {
  domain: string;
  value: DeliveryAddress;
  onChange: (value: DeliveryAddress) => void;
  showSaveOption?: boolean;
  saveAddress?: boolean;
  onSaveAddressChange?: (value: boolean) => void;
};

export function AddressForm({
  domain,
  value,
  onChange,
  showSaveOption,
  saveAddress,
  onSaveAddressChange,
}: Props) {
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const zipDigits = value.zipCode.replace(/\D/g, "");

  useEffect(() => {
    if (zipDigits.length !== 8) return;

    let cancelled = false;
    setCepLoading(true);
    setCepError(null);

    fetch(`${API}/v1/store/cep/${zipDigits}`, {
      headers: { "X-Tenant-Domain": domain },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("CEP não encontrado");
        return res.json() as Promise<{
          street: string;
          neighborhood: string;
          city: string;
          state: string;
          zipCode: string;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        onChange({
          ...value,
          zipCode: data.zipCode,
          street: data.street || value.street,
          neighborhood: data.neighborhood || value.neighborhood,
          city: data.city || value.city,
          state: data.state || value.state,
        });
      })
      .catch(() => {
        if (!cancelled) setCepError("CEP não encontrado");
      })
      .finally(() => {
        if (!cancelled) setCepLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [zipDigits, domain]);

  function patch(fields: Partial<DeliveryAddress>) {
    onChange({ ...value, ...fields });
  }

  return (
    <div className="address-form">
      <label>
        Nome do recebedor
        <input
          value={value.recipientName}
          onChange={(e) => patch({ recipientName: e.target.value })}
          required
        />
      </label>
      <label>
        Telefone
        <input
          value={value.phone}
          onChange={(e) => patch({ phone: e.target.value })}
          required
        />
      </label>
      <label>
        CEP
        <input
          value={value.zipCode}
          onChange={(e) => patch({ zipCode: normalizeZipInput(e.target.value) })}
          inputMode="numeric"
          required
        />
        {cepLoading && <span className="address-form-hint">Buscando CEP…</span>}
        {cepError && <span className="address-form-error">{cepError}</span>}
      </label>
      <label>
        Rua
        <input
          value={value.street}
          onChange={(e) => patch({ street: e.target.value })}
          required
        />
      </label>
      <div className="address-form-row">
        <label>
          Número
          <input
            value={value.number}
            onChange={(e) => patch({ number: e.target.value })}
            required
          />
        </label>
        <label>
          Complemento
          <input
            value={value.complement ?? ""}
            onChange={(e) => patch({ complement: e.target.value })}
          />
        </label>
      </div>
      <label>
        Bairro
        <input
          value={value.neighborhood}
          onChange={(e) => patch({ neighborhood: e.target.value })}
          required
        />
      </label>
      <div className="address-form-row">
        <label>
          Cidade
          <input
            value={value.city}
            onChange={(e) => patch({ city: e.target.value })}
            required
          />
        </label>
        <label>
          UF
          <input
            value={value.state}
            onChange={(e) =>
              patch({ state: e.target.value.toUpperCase().slice(0, 2) })
            }
            maxLength={2}
            required
          />
        </label>
      </div>
      {showSaveOption && onSaveAddressChange && (
        <label className="address-form-check">
          <input
            type="checkbox"
            checked={saveAddress ?? false}
            onChange={(e) => onSaveAddressChange(e.target.checked)}
          />
          Salvar este endereço na minha conta
        </label>
      )}
    </div>
  );
}
