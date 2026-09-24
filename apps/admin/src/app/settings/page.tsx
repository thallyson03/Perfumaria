"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  AdminShell,
  apiFetch,
  useAuthSession,
} from "@/components/admin-shell";

type Settings = {
  whatsappPhone: string | null;
  channelWhatsapp: boolean;
  channelOnlinePayment: boolean;
  mercadoPagoConfigured: boolean;
  mercadoPagoAccessToken: string | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  freeDeliveryMinAmount: number | null;
  deliveryMessage: string | null;
  pickupAddress: string | null;
  shippingProvider: string | null;
  shippingOriginZipCode: string | null;
  melhorEnvioConfigured: boolean;
  melhorEnvioToken: string | null;
  correiosContractCode: string | null;
};

export default function SettingsPage() {
  const { token, ready } = useAuthSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [channelWhatsapp, setChannelWhatsapp] = useState(true);
  const [channelOnlinePayment, setChannelOnlinePayment] = useState(false);
  const [mpToken, setMpToken] = useState("");
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [freeDeliveryMinAmount, setFreeDeliveryMinAmount] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [shippingProvider, setShippingProvider] = useState("manual");
  const [shippingOriginZipCode, setShippingOriginZipCode] = useState("");
  const [melhorEnvioToken, setMelhorEnvioToken] = useState("");
  const [correiosContractCode, setCorreiosContractCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    apiFetch("/v1/tenant/settings", token)
      .then((data: Settings) => {
        setSettings(data);
        setWhatsappPhone(data.whatsappPhone ?? "");
        setChannelWhatsapp(data.channelWhatsapp);
        setChannelOnlinePayment(data.channelOnlinePayment);
        setMpToken(data.mercadoPagoAccessToken ?? "");
        setDeliveryEnabled(data.deliveryEnabled);
        setPickupEnabled(data.pickupEnabled);
        setFreeDeliveryMinAmount(
          data.freeDeliveryMinAmount != null
            ? String(data.freeDeliveryMinAmount)
            : ""
        );
        setDeliveryMessage(data.deliveryMessage ?? "");
        setPickupAddress(data.pickupAddress ?? "");
        setShippingProvider(data.shippingProvider ?? "manual");
        setShippingOriginZipCode(data.shippingOriginZipCode ?? "");
        setMelhorEnvioToken(data.melhorEnvioToken ?? "");
        setCorreiosContractCode(data.correiosContractCode ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, [ready, token]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        whatsappPhone: whatsappPhone || null,
        channelWhatsapp,
        channelOnlinePayment,
        deliveryEnabled,
        pickupEnabled,
        freeDeliveryMinAmount: freeDeliveryMinAmount
          ? Number(freeDeliveryMinAmount)
          : null,
        deliveryMessage: deliveryMessage || null,
        pickupAddress: pickupAddress || null,
        shippingProvider: shippingProvider || "manual",
        shippingOriginZipCode: shippingOriginZipCode || null,
        correiosContractCode: correiosContractCode || null,
      };
      if (mpToken && mpToken !== "••••••••") {
        body.mercadoPagoAccessToken = mpToken;
      } else if (!mpToken) {
        body.mercadoPagoAccessToken = null;
      }
      if (melhorEnvioToken && melhorEnvioToken !== "••••••••") {
        body.melhorEnvioToken = melhorEnvioToken;
      } else if (!melhorEnvioToken) {
        body.melhorEnvioToken = null;
      }

      await apiFetch("/v1/tenant/settings", token, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMsg("Configurações salvas.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AdminShell>
      <h1 style={{ marginTop: 0 }}>Configurações da loja</h1>
      <p style={{ color: "var(--muted)" }}>
        Canais de venda, entrega/retirada e integrações de frete.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {msg && <p style={{ color: "var(--accent)" }}>{msg}</p>}

      {!settings ? (
        <p style={{ color: "var(--muted)" }}>Carregando…</p>
      ) : (
        <form
          onSubmit={save}
          style={{ display: "grid", gap: "1.25rem", maxWidth: 560 }}
        >
          <fieldset style={fieldset}>
            <legend style={legend}>WhatsApp</legend>
            <label style={label}>
              <input
                type="checkbox"
                checked={channelWhatsapp}
                onChange={(e) => setChannelWhatsapp(e.target.checked)}
              />
              Ativar botão &quot;Fechar no WhatsApp&quot; na vitrine
            </label>
            <label style={label}>
              Número do vendedor (com DDD)
              <input
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="11999998888"
                style={input}
              />
            </label>
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Pagamento online (PIX)</legend>
            <label style={label}>
              <input
                type="checkbox"
                checked={channelOnlinePayment}
                onChange={(e) => setChannelOnlinePayment(e.target.checked)}
              />
              Ativar &quot;Pagar com PIX&quot; na vitrine
            </label>
            <label style={label}>
              Access Token Mercado Pago
              <input
                value={mpToken}
                onChange={(e) => setMpToken(e.target.value)}
                placeholder={
                  settings.mercadoPagoConfigured
                    ? "•••••••• (deixe para manter)"
                    : "TEST-..."
                }
                style={input}
              />
            </label>
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Entrega e retirada</legend>
            <label style={label}>
              <input
                type="checkbox"
                checked={deliveryEnabled}
                onChange={(e) => setDeliveryEnabled(e.target.checked)}
              />
              Oferecer entrega no endereço
            </label>
            <label style={label}>
              <input
                type="checkbox"
                checked={pickupEnabled}
                onChange={(e) => setPickupEnabled(e.target.checked)}
              />
              Oferecer retirada com o revendedor
            </label>
            <label style={label}>
              Frete grátis a partir de (R$)
              <input
                value={freeDeliveryMinAmount}
                onChange={(e) => setFreeDeliveryMinAmount(e.target.value)}
                placeholder="99.00"
                style={input}
              />
            </label>
            <label style={label}>
              Mensagem sobre frete na vitrine
              <textarea
                value={deliveryMessage}
                onChange={(e) => setDeliveryMessage(e.target.value)}
                placeholder="Frete a combinar com o vendedor via WhatsApp."
                style={{ ...input, minHeight: 72 }}
              />
            </label>
            <label style={label}>
              Endereço/instruções de retirada
              <textarea
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                placeholder="Retirada na minha casa, combinar horário pelo WhatsApp."
                style={{ ...input, minHeight: 72 }}
              />
            </label>
          </fieldset>

          <fieldset style={fieldset}>
            <legend style={legend}>Cotação de frete (opcional)</legend>
            <label style={label}>
              Provedor
              <select
                value={shippingProvider}
                onChange={(e) => setShippingProvider(e.target.value)}
                style={input}
              >
                <option value="manual">Combinar no WhatsApp</option>
                <option value="melhor_envio">Melhor Envio</option>
                <option value="correios">Correios (estimativa)</option>
              </select>
            </label>
            <label style={label}>
              CEP de origem (envio)
              <input
                value={shippingOriginZipCode}
                onChange={(e) => setShippingOriginZipCode(e.target.value)}
                placeholder="01310-100"
                style={input}
              />
            </label>
            {shippingProvider === "melhor_envio" && (
              <label style={label}>
                Token Melhor Envio
                <input
                  value={melhorEnvioToken}
                  onChange={(e) => setMelhorEnvioToken(e.target.value)}
                  placeholder={
                    settings.melhorEnvioConfigured
                      ? "•••••••• (deixe para manter)"
                      : "Bearer token"
                  }
                  style={input}
                />
              </label>
            )}
            {shippingProvider === "correios" && (
              <label style={label}>
                Código do contrato Correios
                <input
                  value={correiosContractCode}
                  onChange={(e) => setCorreiosContractCode(e.target.value)}
                  style={input}
                />
              </label>
            )}
            <span style={hint}>
              Mesmo com cotação automática, o valor final pode ser combinado no
              WhatsApp.
            </span>
          </fieldset>

          <button type="submit" style={btn}>
            Salvar
          </button>
        </form>
      )}
    </AdminShell>
  );
}

const fieldset = {
  border: "1px solid var(--line)",
  padding: "1rem",
  margin: 0,
} as const;

const legend = {
  padding: "0 0.35rem",
  color: "var(--muted)",
} as const;

const label = {
  display: "grid",
  gap: "0.35rem",
  fontSize: "0.9rem",
  marginBottom: "0.75rem",
} as const;

const hint = {
  fontSize: "0.75rem",
  color: "var(--muted)",
} as const;

const input = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
  padding: "0.65rem 0.75rem",
  font: "inherit",
} as const;

const btn = {
  background: "var(--accent)",
  color: "#04140c",
  border: 0,
  padding: "0.75rem 1rem",
  fontWeight: 700,
  cursor: "pointer",
  maxWidth: 160,
} as const;
