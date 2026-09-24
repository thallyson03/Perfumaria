"use client";

import "@/styles/inventory.css";
import "@/styles/orders.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminShell,
  apiFetch,
  useAuthSession,
} from "@/components/admin-shell";
import { receiptPath } from "@/components/sale-receipt";

type OrderItem = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice?: string;
  lineTotal: string;
};

type Order = {
  id: string;
  publicCode: string;
  channel: string;
  status: string;
  fulfillmentType: string;
  customerName: string | null;
  customerPhone: string | null;
  customerDocumentCpf: string | null;
  customerEmail: string | null;
  customerId: string | null;
  deliveryRecipientName: string | null;
  deliveryPhone: string | null;
  deliveryZipCode: string | null;
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryComplement: string | null;
  deliveryNeighborhood: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  shippingQuoteAmount: string | null;
  shippingQuoteDays: number | null;
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    documentCpf: string | null;
  } | null;
  totalAmount: string;
  createdAt: string;
  expiresAt: string | null;
  invoiceId: string | null;
  items: OrderItem[];
};

type StatusFilter = "queue" | "awaiting_seller" | "pending_payment" | "confirmed" | "all";

const statusLabel: Record<string, string> = {
  awaiting_seller: "Aguardando você",
  pending_payment: "Aguardando PIX",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
};

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCpf(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11) return raw;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatDelivery(o: Order): string {
  if (o.fulfillmentType === "pickup") return "Retirada com o revendedor";
  if (!o.deliveryStreet) return "Entrega (sem endereço)";
  const parts = [
    `${o.deliveryStreet}, ${o.deliveryNumber ?? "s/n"}`,
    o.deliveryComplement,
    `${o.deliveryNeighborhood ?? ""} - ${o.deliveryCity ?? ""}/${o.deliveryState ?? ""}`,
    o.deliveryZipCode ? `CEP ${o.deliveryZipCode}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function minutesAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(diff / 60000));
  if (m < 60) return `Há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Há ${h}h`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function customerName(o: Order) {
  return o.customer?.fullName ?? o.customerName ?? "Cliente";
}

function customerPhone(o: Order) {
  return o.customer?.phone ?? o.customerPhone ?? null;
}

function customerCpf(o: Order) {
  return o.customer?.documentCpf ?? o.customerDocumentCpf ?? null;
}

function statusPill(status: string) {
  if (status === "confirmed") return "ord-pill--ok";
  if (status === "pending_payment") return "ord-pill--pix";
  if (status === "awaiting_seller") return "ord-pill--wait";
  if (status === "cancelled" || status === "expired") return "ord-pill--danger";
  return "";
}

function sumOrders(list: Order[]) {
  return list.reduce((s, o) => s + Number(o.totalAmount), 0);
}

export default function OrdersPage() {
  const { token, ready } = useAuthSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("queue");
  const [channelFilter, setChannelFilter] = useState("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null);
  const [installments, setInstallments] = useState("1");
  const [payNow, setPayNow] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (t: string) => {
    const data = (await apiFetch("/v1/orders", t)) as Order[];
    setOrders(data);
    setSelectedId((prev) => {
      if (prev && data.some((o) => o.id === prev)) return prev;
      const queue = data.filter(
        (o) =>
          o.status === "awaiting_seller" || o.status === "pending_payment"
      );
      return queue[0]?.id ?? data[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    load(token).catch((e: Error) => setError(e.message));
  }, [ready, token, load]);

  const awaiting = useMemo(
    () => orders.filter((o) => o.status === "awaiting_seller"),
    [orders]
  );
  const pendingPix = useMemo(
    () => orders.filter((o) => o.status === "pending_payment"),
    [orders]
  );
  const confirmed = useMemo(
    () => orders.filter((o) => o.status === "confirmed"),
    [orders]
  );
  const pickupQueue = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.fulfillmentType === "pickup" &&
          (o.status === "awaiting_seller" ||
            o.status === "pending_payment" ||
            o.status === "confirmed")
      ),
    [orders]
  );

  const filtered = useMemo(() => {
    let list = orders;
    if (filter === "queue") {
      list = list.filter(
        (o) =>
          o.status === "awaiting_seller" || o.status === "pending_payment"
      );
    } else if (filter !== "all") {
      list = list.filter((o) => o.status === filter);
    }
    if (channelFilter !== "all") {
      list = list.filter((o) => o.channel === channelFilter);
    }
    if (fulfillmentFilter !== "all") {
      list = list.filter((o) => o.fulfillmentType === fulfillmentFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (o) =>
          o.publicCode.toLowerCase().includes(q) ||
          customerName(o).toLowerCase().includes(q) ||
          (customerPhone(o) ?? "").includes(q) ||
          (customerCpf(o) ?? "").includes(q)
      );
    }
    return list;
  }, [orders, filter, channelFilter, fulfillmentFilter, query]);

  const selected =
    filtered.find((o) => o.id === selectedId) ??
    orders.find((o) => o.id === selectedId) ??
    null;

  async function refresh() {
    if (!token) return;
    setError(null);
    try {
      await load(token);
      setMsg("Fila atualizada");
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirm(id: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const result = await apiFetch(`/v1/orders/${id}/confirm`, token, {
        method: "POST",
        body: JSON.stringify({
          installments: Number(installments),
          payNow,
          useWalletAmount: 0,
        }),
      });
      setMsg(
        `Pedido confirmado · fatura ${String(result.invoiceId).slice(0, 8)}`
      );
      setLastInvoiceId(result.invoiceId as string);
      await load(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (!token) return;
    if (!window.confirm("Cancelar este pedido e liberar o estoque?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/orders/${id}/cancel`, token, { method: "POST" });
      setMsg("Pedido cancelado · estoque liberado.");
      await load(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell variant="atelier">
      <div className="ord-page">
        <header className="ord-header">
          <div>
            <div className="ord-crumb">
              Vendas omnichannel /{" "}
              <span>Confirmação & faturamento</span>
            </div>
            <h1>Confirmação & faturamento de pedidos</h1>
            <p>
              Triagem da vitrine (WhatsApp e PIX), conferência de itens e
              liberação para faturamento.
            </p>
          </div>
          <div className="ord-actions">
            <button type="button" className="inv-btn" onClick={() => void refresh()}>
              Atualizar fila
            </button>
            <Link href="/sales" className="inv-btn inv-btn--primary">
              Novo pedido POS
            </Link>
          </div>
        </header>

        <section className="ord-kpis">
          <article className="ord-kpi ord-kpi--warn">
            <span className="ord-kpi-label">Fila WhatsApp</span>
            <div className="ord-kpi-value">{awaiting.length} pedidos</div>
            <div className="ord-kpi-money">{formatBrl(sumOrders(awaiting))}</div>
            <p className="ord-kpi-meta">Aguardando confirmação do vendedor</p>
          </article>
          <article className="ord-kpi ord-kpi--ok">
            <span className="ord-kpi-label">PIX pendente</span>
            <div className="ord-kpi-value">{pendingPix.length} pedidos</div>
            <div className="ord-kpi-money">
              {formatBrl(sumOrders(pendingPix))}
            </div>
            <p className="ord-kpi-meta">Aguardando compensação automática</p>
          </article>
          <article className="ord-kpi ord-kpi--accent">
            <span className="ord-kpi-label">Confirmados</span>
            <div className="ord-kpi-value">{confirmed.length} pedidos</div>
            <div className="ord-kpi-money">
              {formatBrl(sumOrders(confirmed))}
            </div>
            <p className="ord-kpi-meta">Faturados / liberados</p>
          </article>
          <article className="ord-kpi">
            <span className="ord-kpi-label">Clique & retire</span>
            <div className="ord-kpi-value">{pickupQueue.length} pedidos</div>
            <div className="ord-kpi-money">
              {formatBrl(sumOrders(pickupQueue))}
            </div>
            <p className="ord-kpi-meta">Retirada com o revendedor</p>
          </article>
        </section>

        <div className="ord-layout">
          <aside className="ord-queue">
            <div className="ord-queue-head">
              <h2>Fila de liberação</h2>
              <p>
                {filtered.length} pedido(s) ·{" "}
                {formatBrl(sumOrders(filtered))}
              </p>
            </div>
            <div className="ord-filters">
              <input
                type="search"
                placeholder="Buscar código, cliente, CPF…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as StatusFilter)}
              >
                <option value="queue">Fila ativa (WhatsApp + PIX)</option>
                <option value="awaiting_seller">Só WhatsApp</option>
                <option value="pending_payment">Só PIX pendente</option>
                <option value="confirmed">Confirmados</option>
                <option value="all">Todos</option>
              </select>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
              >
                <option value="all">Todos os canais</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="online_payment">PIX / online</option>
              </select>
              <select
                value={fulfillmentFilter}
                onChange={(e) => setFulfillmentFilter(e.target.value)}
              >
                <option value="all">Todas as entregas</option>
                <option value="pickup">Retirada</option>
                <option value="delivery">Entrega</option>
              </select>
            </div>
            <div className="ord-queue-list">
              {filtered.length === 0 ? (
                <div className="ord-empty">Nenhum pedido neste filtro.</div>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`ord-card ${
                      selectedId === o.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedId(o.id)}
                  >
                    <div className="ord-card-top">
                      <div>
                        <div className="ord-card-code">#PED-{o.publicCode}</div>
                        <span className={`ord-pill ${statusPill(o.status)}`}>
                          {statusLabel[o.status] ?? o.status}
                        </span>
                      </div>
                      <div className="ord-card-total">
                        {formatBrl(Number(o.totalAmount))}
                      </div>
                    </div>
                    <div className="ord-card-name">{customerName(o)}</div>
                    <div className="ord-card-items">
                      {o.items.slice(0, 3).map((i) => (
                        <span key={i.id} className="ord-tag">
                          {i.productName}
                        </span>
                      ))}
                      {o.items.length > 3 && (
                        <span className="ord-tag">+{o.items.length - 3}</span>
                      )}
                    </div>
                    <div className="ord-card-foot">
                      <span>
                        {o.channel === "whatsapp" ? "WhatsApp" : "PIX"}
                      </span>
                      <span>
                        {o.fulfillmentType === "pickup"
                          ? "Retirada"
                          : "Entrega"}
                      </span>
                      <span>{minutesAgo(o.createdAt)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="ord-detail">
            {!selected ? (
              <div className="ord-detail-empty">
                Selecione um pedido na fila para conferir e faturar.
              </div>
            ) : (
              <>
                <div className="ord-detail-head">
                  <div className="ord-detail-title">
                    <h2>#PED-{selected.publicCode}</h2>
                    <span className={`ord-pill ${statusPill(selected.status)}`}>
                      {statusLabel[selected.status] ?? selected.status}
                    </span>
                  </div>
                  <div className="ord-banner">
                    <div
                      className={`ord-banner-box ${
                        selected.status === "pending_payment"
                          ? "ord-banner-box--wait"
                          : ""
                      }`}
                    >
                      {selected.channel === "whatsapp"
                        ? "Canal: WhatsApp Concierge"
                        : "Canal: PIX online"}
                      {" · "}
                      {new Date(selected.createdAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </div>
                    <div
                      className={`ord-banner-box ${
                        selected.status === "confirmed"
                          ? ""
                          : selected.status === "pending_payment"
                            ? "ord-banner-box--wait"
                            : "ord-banner-box--wait"
                      }`}
                    >
                      {selected.status === "confirmed"
                        ? "STATUS: Confirmado e faturado"
                        : selected.status === "pending_payment"
                          ? "STATUS FINANCEIRO: Aguardando PIX"
                          : "STATUS: Aguardando confirmação do vendedor"}
                    </div>
                  </div>
                </div>

                <div className="ord-detail-body">
                  <div className="ord-section">
                    <h3>Cliente titular</h3>
                    <div className="ord-grid-2">
                      <div>
                        <div className="ord-label">Nome</div>
                        <div className="ord-value">{customerName(selected)}</div>
                      </div>
                      <div>
                        <div className="ord-label">Contato</div>
                        <div className="ord-value">
                          {customerPhone(selected) ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="ord-label">CPF</div>
                        <div className="ord-value">
                          {customerCpf(selected)
                            ? formatCpf(customerCpf(selected)!)
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="ord-label">E-mail</div>
                        <div className="ord-value">
                          {selected.customerEmail ?? "—"}
                        </div>
                      </div>
                    </div>
                    {selected.customerId && (
                      <p style={{ margin: "0.75rem 0 0" }}>
                        <Link
                          href={`/customers/${selected.customerId}`}
                          className="crm-link"
                          style={{
                            color: "#7a1c30",
                            fontWeight: 700,
                            fontSize: "0.85rem",
                          }}
                        >
                          Abrir ficha no CRM →
                        </Link>
                      </p>
                    )}
                  </div>

                  <div className="ord-section">
                    <h3>Itens & reserva de estoque</h3>
                    <div className="ord-items">
                      {selected.items.map((i) => (
                        <div key={i.id} className="ord-item">
                          <span>
                            <strong>{i.productName}</strong>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#897173",
                                marginTop: "0.15rem",
                              }}
                            >
                              Qtd {i.quantity}
                              {i.unitPrice != null
                                ? ` · ${formatBrl(Number(i.unitPrice))}`
                                : ""}
                            </div>
                          </span>
                          <strong>{formatBrl(Number(i.lineTotal))}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ord-section">
                    <h3>Modalidade de entrega</h3>
                    <div className="ord-value">{formatDelivery(selected)}</div>
                    {selected.shippingQuoteAmount != null && (
                      <p
                        style={{
                          margin: "0.5rem 0 0",
                          fontSize: "0.85rem",
                          color: "#564243",
                        }}
                      >
                        Frete estimado:{" "}
                        {formatBrl(Number(selected.shippingQuoteAmount))}
                        {selected.shippingQuoteDays != null
                          ? ` · ${selected.shippingQuoteDays} dia(s)`
                          : ""}
                      </p>
                    )}
                  </div>

                  <div className="ord-section">
                    <h3>Resumo financeiro</h3>
                    <div className="ord-totals">
                      <div className="ord-totals-row">
                        <span>Itens</span>
                        <span>
                          {formatBrl(
                            selected.items.reduce(
                              (s, i) => s + Number(i.lineTotal),
                              0
                            )
                          )}
                        </span>
                      </div>
                      {selected.shippingQuoteAmount != null && (
                        <div className="ord-totals-row">
                          <span>Frete</span>
                          <span>
                            {Number(selected.shippingQuoteAmount) === 0
                              ? "Grátis"
                              : formatBrl(Number(selected.shippingQuoteAmount))}
                          </span>
                        </div>
                      )}
                      <div className="ord-totals-row ord-totals-row--grand">
                        <span>Total do pedido</span>
                        <span>{formatBrl(Number(selected.totalAmount))}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ord-detail-foot">
                  {selected.status === "awaiting_seller" && (
                    <div className="ord-confirm-box">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "0.65rem",
                        }}
                      >
                        <label className="ord-field">
                          Parcelas
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={installments}
                            onChange={(e) => setInstallments(e.target.value)}
                          />
                        </label>
                        <label className="ord-check" style={{ alignSelf: "end" }}>
                          <input
                            type="checkbox"
                            checked={payNow}
                            onChange={(e) => setPayNow(e.target.checked)}
                          />
                          Cliente já pagou (baixa agora)
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="ord-foot-actions">
                    {(selected.status === "awaiting_seller" ||
                      selected.status === "pending_payment") && (
                      <button
                        type="button"
                        className="inv-btn"
                        disabled={busy}
                        onClick={() => void cancel(selected.id)}
                      >
                        Cancelar pedido
                      </button>
                    )}
                    {selected.status === "confirmed" && selected.invoiceId && (
                      <Link
                        href={receiptPath(selected.invoiceId)}
                        target="_blank"
                        className="inv-btn inv-btn--primary"
                        style={{ textDecoration: "none" }}
                      >
                        Abrir comprovante
                      </Link>
                    )}
                    {lastInvoiceId && selected.status === "confirmed" && (
                      <Link
                        href={receiptPath(lastInvoiceId)}
                        target="_blank"
                        className="inv-btn"
                        style={{ textDecoration: "none" }}
                      >
                        Último recibo
                      </Link>
                    )}
                    {selected.status === "awaiting_seller" && (
                      <button
                        type="button"
                        className="inv-btn inv-btn--primary"
                        disabled={busy}
                        onClick={() => void confirm(selected.id)}
                      >
                        {busy
                          ? "Confirmando…"
                          : "Confirmar pedido & faturar"}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {error && <div className="ord-toast">{error}</div>}
      {msg && <div className="ord-toast ord-toast--ok">{msg}</div>}
    </AdminShell>
  );
}
