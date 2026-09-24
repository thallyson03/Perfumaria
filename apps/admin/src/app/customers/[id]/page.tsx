"use client";

import "@/styles/inventory.css";
import "@/styles/crm.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AdminShell,
  apiFetch,
  useAuthSession,
} from "@/components/admin-shell";
import { receiptPath } from "@/components/sale-receipt";

type CustomerDetail = {
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    documentCpf: string | null;
    email: string | null;
    createdAt: string;
  };
  summary: {
    totalDebt: number;
    overdueDebt: number;
    pendingInstallments: number;
    totalPurchased: number;
    totalPaid: number;
    walletBalance: number;
    invoicesCount: number;
  };
  purchasedProducts: Array<{
    productId: string | null;
    productName: string;
    quantity: number;
    totalSpent: number;
  }>;
  invoices: Array<{
    id: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    items: Array<{
      id: string;
      productName: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }>;
    installments: Array<{
      id: string;
      installmentNumber: number;
      amount: number;
      dueDate: string;
      status: string;
    }>;
  }>;
  ledger: Array<{
    id: string;
    operationType: string;
    amount: number;
    description: string | null;
    createdAt: string;
  }>;
};

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { token, ready } = useAuthSession();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token || !params.id) return;
    apiFetch(`/v1/customers/${params.id}`, token)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [ready, token, params.id]);

  return (
    <AdminShell variant="atelier">
      <div className="crm-page">
      <p style={{ margin: 0 }}>
        <Link href="/customers" className="crm-link">
          ← Clientes
        </Link>
      </p>

      {error && <p className="dash-error">{error}</p>}
      {!data && !error && <p className="crm-meta">Carregando…</p>}

      {data && (
        <>
          <header className="crm-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
            <div>
              <div className="crm-title-row">
                <h1>{data.customer.fullName}</h1>
                <span className="crm-badge">Ficha do cliente</span>
              </div>
              <p>
                {data.customer.phone ?? "sem telefone"} ·{" "}
                {data.customer.documentCpf ?? "sem CPF"} ·{" "}
                {data.customer.email ?? "sem e-mail"}
              </p>
            </div>
            <div className="crm-actions">
              <Link href="/sales" className="inv-btn inv-btn--primary">
                Abrir no PDV
              </Link>
            </div>
          </header>

          <section className="crm-detail-stats">
            <article className="crm-kpi">
              <div>
                <span className="crm-kpi-label">Dívida total</span>
                <div className="crm-kpi-value">{money(data.summary.totalDebt)}</div>
              </div>
            </article>
            <article className="crm-kpi">
              <div>
                <span className="crm-kpi-label">Em atraso</span>
                <div className="crm-kpi-value">{money(data.summary.overdueDebt)}</div>
              </div>
            </article>
            <article className="crm-kpi">
              <div>
                <span className="crm-kpi-label">Parcelas abertas</span>
                <div className="crm-kpi-value">
                  {data.summary.pendingInstallments}
                </div>
              </div>
            </article>
            <article className="crm-kpi">
              <div>
                <span className="crm-kpi-label">Total comprado</span>
                <div className="crm-kpi-value">
                  {money(data.summary.totalPurchased)}
                </div>
              </div>
            </article>
            <article className="crm-kpi">
              <div>
                <span className="crm-kpi-label">Total pago</span>
                <div className="crm-kpi-value">{money(data.summary.totalPaid)}</div>
              </div>
            </article>
            <article className="crm-kpi">
              <div>
                <span className="crm-kpi-label">Saldo carteira</span>
                <div className="crm-kpi-value">
                  {money(data.summary.walletBalance)}
                </div>
              </div>
            </article>
          </section>

          <section className="crm-section">
            <div className="crm-section-head">
              <div className="crm-section-letter">1</div>
              <div>
                <h2>Produtos comprados</h2>
                <p>Histórico agregado por SKU nesta loja.</p>
              </div>
            </div>
            {data.purchasedProducts.length === 0 ? (
              <p className="crm-meta">
                Nenhum item vinculado ainda (pedidos antigos sem itens ou só
                cobrança manual).
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {data.purchasedProducts.map((p) => (
                  <li key={p.productId ?? p.productName} style={row}>
                    <span>
                      <strong>{p.productName}</strong> · {p.quantity} un.
                    </span>
                    <strong>{money(p.totalSpent)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="crm-section">
            <div className="crm-section-head">
              <div className="crm-section-letter">2</div>
              <div>
                <h2>Pedidos / faturas</h2>
                <p>Vendas e parcelas vinculadas ao cliente.</p>
              </div>
            </div>
            {data.invoices.length === 0 ? (
              <p className="crm-meta">Sem faturas.</p>
            ) : (
              data.invoices.map((inv) => (
                <article
                  key={inv.id}
                  style={{
                    borderTop: "1px solid rgba(220,192,193,0.25)",
                    padding: "1rem 0",
                  }}
                >
                  <div style={row}>
                    <div>
                      <strong>Fatura {inv.id.slice(0, 8)}</strong>
                      <div className="crm-meta">
                        {inv.createdAt.slice(0, 10)} · status {inv.status}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      <Link
                        href={receiptPath(inv.id)}
                        target="_blank"
                        className="crm-link"
                      >
                        Comprovante
                      </Link>
                      <strong>{money(inv.totalAmount)}</strong>
                    </div>
                  </div>

                  {inv.items.length > 0 && (
                    <div style={{ marginTop: "0.75rem" }}>
                      <div className="crm-meta">Itens</div>
                      <ul style={{ listStyle: "none", padding: 0, margin: "0.35rem 0 0" }}>
                        {inv.items.map((it) => (
                          <li key={it.id} style={{ ...row, padding: "0.25rem 0", borderTop: "none" }}>
                            <span>
                              {it.productName} × {it.quantity} @ {money(it.unitPrice)}
                            </span>
                            <span>{money(it.lineTotal)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div style={{ marginTop: "0.75rem" }}>
                    <div className="crm-meta">Parcelas</div>
                    <ul style={{ listStyle: "none", padding: 0, margin: "0.35rem 0 0" }}>
                      {inv.installments.map((r) => (
                        <li key={r.id} style={{ ...row, padding: "0.35rem 0", borderTop: "none" }}>
                          <span>
                            #{r.installmentNumber} · vence {r.dueDate.slice(0, 10)} ·{" "}
                            <em style={{ fontStyle: "normal", color: statusColor(r.status) }}>
                              {r.status}
                            </em>
                          </span>
                          <strong>{money(r.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))
            )}
          </section>

          <section className="crm-section">
            <div className="crm-section-head">
              <div className="crm-section-letter">3</div>
              <div>
                <h2>Movimentos da carteira</h2>
                <p>Créditos e débitos do saldo do cliente.</p>
              </div>
            </div>
            {data.ledger.length === 0 ? (
              <p className="crm-meta">Sem lançamentos.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {data.ledger.map((l) => (
                  <li key={l.id} style={row}>
                    <span>
                      {l.operationType} · {l.description ?? "—"} ·{" "}
                      {l.createdAt.slice(0, 10)}
                    </span>
                    <strong>
                      {l.operationType === "CREDIT" ? "+" : "-"}
                      {money(l.amount)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      </div>
    </AdminShell>
  );
}

function money(v: number) {
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function statusColor(status: string) {
  if (status === "paid") return "#1b6b48";
  if (status === "overdue") return "#ba1a1a";
  return "#897173";
}

const row = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  alignItems: "center",
  borderTop: "1px solid rgba(220,192,193,0.25)",
  padding: "0.65rem 0",
} as const;
