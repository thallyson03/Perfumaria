"use client";

import "@/styles/inventory.css";
import "@/styles/dashboard.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AdminShell,
  apiFetch,
  useAuthSession,
} from "@/components/admin-shell";

type BusinessStats = {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  totalOrders: number;
};

type Summary = {
  today: BusinessStats;
  totals: BusinessStats;
  month: BusinessStats;
  previousMonth: BusinessStats;
  inventory: {
    totalUnits: number;
    productsInStock: number;
    totalCost: number;
  };
  dailySales: Array<{ day: string; totalSales: number; totalOrders: number }>;
  monthlySales: Array<{
    month: string;
    totalSales: number;
    totalOrders: number;
  }>;
  topDebtors: Array<{
    totalDebt: string;
    overdueDebt: string;
    customer: { fullName: string; phone: string | null };
  }>;
  expiringBatches: Array<{
    batchNumber: string | null;
    expirationDate: string;
    quantity: number;
    product: { name: string };
  }>;
  recentInvoices: Array<{
    id: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    customerName: string;
    paidHint: string;
  }>;
  dueReceivables: Array<{
    id: string;
    amount: number;
    dueDate: string;
    status: string;
    installmentNumber: number;
    customerName: string;
  }>;
};

type Period = "today" | "month" | "all";

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function daysUntil(iso: string) {
  const end = new Date(iso);
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

export default function DashboardPage() {
  const { token, ready, tenant } = useAuthSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("month");

  useEffect(() => {
    if (!ready || !token) return;
    apiFetch("/v1/dashboard/summary", token)
      .then(setSummary)
      .catch((e: Error) => setError(e.message));
  }, [ready, token]);

  const focus = useMemo(() => {
    if (!summary) return null;
    if (period === "today") return summary.today;
    if (period === "all") return summary.totals;
    return summary.month;
  }, [summary, period]);

  const monthDelta = useMemo(() => {
    if (!summary || summary.previousMonth.totalRevenue <= 0) return null;
    return (
      ((summary.month.totalRevenue - summary.previousMonth.totalRevenue) /
        summary.previousMonth.totalRevenue) *
      100
    );
  }, [summary]);

  const marginPct = useMemo(() => {
    if (!focus || focus.totalRevenue <= 0) return null;
    return (focus.totalProfit / focus.totalRevenue) * 100;
  }, [focus]);

  const chartMax = useMemo(() => {
    if (!summary?.dailySales.length) return 1;
    return Math.max(...summary.dailySales.map((d) => d.totalSales), 1);
  }, [summary]);

  const greetingPositive =
    summary != null && summary.today.totalProfit >= 0;

  return (
    <AdminShell variant="atelier">
      <div className="dash-page">
        <header className="dash-header">
          <div>
            <div className="dash-crumb">
              {tenant?.name ?? "Franquia"} · Balanço do dia
            </div>
            <h1>
              {greetingPositive
                ? "Seu fluxo consolidado está positivo hoje."
                : "Acompanhe o fluxo consolidado da loja."}
            </h1>
            <p>
              Monitoramento financeiro, estoque e cobranças — PDV e vitrine no
              mesmo painel.
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem" }}>
            <div className="dash-periods">
              {(
                [
                  ["today", "Hoje"],
                  ["month", "Este mês"],
                  ["all", "Geral"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`dash-period ${period === id ? "active" : ""}`}
                  onClick={() => setPeriod(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Link href="/finance" className="dash-btn">
              Abrir financeiro
            </Link>
            <Link href="/sales" className="dash-btn dash-btn--primary">
              Novo pedido POS
            </Link>
          </div>
        </header>

        {error && <p className="dash-error">{error}</p>}
        {!summary && !error && (
          <p className="dash-loading">Carregando dashboard…</p>
        )}

        {summary && focus && (
          <>
            <section className="dash-kpis">
              <article className="dash-kpi">
                <div className="dash-kpi-top">
                  <div>
                    <p className="dash-kpi-label">
                      {period === "today"
                        ? "Faturamento de hoje"
                        : period === "month"
                          ? "Faturamento do mês"
                          : "Faturamento total"}
                    </p>
                    <p className="dash-kpi-value">
                      {formatBrl(focus.totalRevenue)}
                    </p>
                  </div>
                  <span className="dash-kpi-icon">$</span>
                </div>
                <div className="dash-kpi-foot">
                  {period === "month" && monthDelta != null ? (
                    <>
                      <span
                        className={`dash-delta ${
                          monthDelta < 0 ? "dash-delta--down" : ""
                        }`}
                      >
                        {monthDelta >= 0 ? "+" : ""}
                        {monthDelta.toFixed(1)}%
                      </span>
                      <span>
                        vs. mês anterior (
                        {formatBrl(summary.previousMonth.totalRevenue)})
                      </span>
                    </>
                  ) : (
                    <span>{focus.totalOrders} vendas registradas</span>
                  )}
                </div>
              </article>

              <article className="dash-kpi">
                <div className="dash-kpi-top">
                  <div>
                    <p className="dash-kpi-label">Lucro líquido</p>
                    <p
                      className={`dash-kpi-value ${
                        focus.totalProfit >= 0 ? "dash-kpi-value--ok" : ""
                      }`}
                    >
                      {formatBrl(focus.totalProfit)}
                    </p>
                  </div>
                  <span className="dash-kpi-icon">↗</span>
                </div>
                <div className="dash-kpi-foot">
                  <span>Custo {formatBrl(focus.totalCost)}</span>
                  <span>·</span>
                  <span>Receita {formatBrl(focus.totalRevenue)}</span>
                </div>
              </article>

              <article className="dash-kpi">
                <div className="dash-kpi-top">
                  <div>
                    <p className="dash-kpi-label">Estoque em prateleira</p>
                    <p className="dash-kpi-value">
                      {formatBrl(summary.inventory.totalCost)}
                    </p>
                  </div>
                  <span className="dash-kpi-icon">◈</span>
                </div>
                <div className="dash-kpi-foot">
                  <span>
                    {summary.inventory.totalUnits.toLocaleString("pt-BR")} un
                    ativas
                  </span>
                  <span>·</span>
                  <span>{summary.inventory.productsInStock} SKUs</span>
                </div>
              </article>

              <article className="dash-kpi">
                <div className="dash-kpi-top">
                  <div>
                    <p className="dash-kpi-label">Margem bruta média</p>
                    <p className="dash-kpi-value">
                      {marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                  <span className="dash-kpi-icon">%</span>
                </div>
                <div className="dash-kpi-foot">
                  <span>
                    Lucro {formatBrl(focus.totalProfit)} no período
                    selecionado
                  </span>
                </div>
              </article>
            </section>

            <div className="dash-grid">
              <div className="dash-col">
                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>Fluxo de vendas diário (mês)</h2>
                    <Link href="/products" className="dash-btn">
                      Ver estoque
                    </Link>
                  </div>
                  <div className="dash-card-body">
                    {summary.dailySales.length === 0 ? (
                      <div className="dash-chart-empty">
                        Sem vendas neste mês ainda.
                      </div>
                    ) : (
                      <div className="dash-chart">
                        {summary.dailySales.map((d) => (
                          <div key={d.day} className="dash-chart-bar-wrap">
                            <div
                              className="dash-chart-bar"
                              style={{
                                height: `${Math.max(
                                  8,
                                  (d.totalSales / chartMax) * 100
                                )}%`,
                              }}
                              title={`${formatBrl(d.totalSales)} · ${d.totalOrders} vendas`}
                            />
                            <span className="dash-chart-label">
                              {dayLabel(d.day)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>Lançamentos recentes</h2>
                    <Link href="/finance" className="dash-btn">
                      Ver todos
                    </Link>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    {summary.recentInvoices.length === 0 ? (
                      <p className="dash-empty" style={{ padding: "1rem" }}>
                        Nenhuma venda registrada ainda.
                      </p>
                    ) : (
                      <table className="dash-table">
                        <thead>
                          <tr>
                            <th>Data</th>
                            <th>Cliente</th>
                            <th>Status</th>
                            <th>Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.recentInvoices.map((inv) => (
                            <tr key={inv.id}>
                              <td>
                                {new Date(inv.createdAt).toLocaleString(
                                  "pt-BR",
                                  {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  }
                                )}
                              </td>
                              <td>{inv.customerName}</td>
                              <td>
                                <span
                                  className={`dash-pill ${
                                    inv.paidHint === "Pago"
                                      ? "dash-pill--paid"
                                      : "dash-pill--open"
                                  }`}
                                >
                                  {inv.paidHint}
                                </span>
                              </td>
                              <td>
                                <span className="dash-amount dash-amount--in">
                                  {formatBrl(inv.totalAmount)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              </div>

              <aside className="dash-col">
                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>Resumo do período</h2>
                  </div>
                  <div className="dash-card-body dash-mix">
                    <div className="dash-mix-bar">
                      <div
                        className="dash-mix-seg"
                        style={{
                          width: `${
                            focus.totalRevenue > 0
                              ? (focus.totalProfit / focus.totalRevenue) * 100
                              : 0
                          }%`,
                          background: "#1b6b48",
                        }}
                      />
                      <div
                        className="dash-mix-seg"
                        style={{
                          width: `${
                            focus.totalRevenue > 0
                              ? (focus.totalCost / focus.totalRevenue) * 100
                              : 0
                          }%`,
                          background: "#5b021c",
                        }}
                      />
                    </div>
                    <div className="dash-mix-legend">
                      <div className="dash-mix-row">
                        <span>Lucro</span>
                        <strong>{formatBrl(focus.totalProfit)}</strong>
                      </div>
                      <div className="dash-mix-row">
                        <span>Custo dos produtos</span>
                        <strong>{formatBrl(focus.totalCost)}</strong>
                      </div>
                      <div className="dash-mix-row">
                        <span>Pedidos</span>
                        <strong>{focus.totalOrders}</strong>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>Alertas & boletos</h2>
                  </div>
                  <div className="dash-card-body dash-alerts">
                    {summary.dueReceivables.length === 0 &&
                    summary.expiringBatches.length === 0 ? (
                      <p className="dash-empty">Nenhum alerta no momento.</p>
                    ) : null}

                    {summary.dueReceivables.map((r) => {
                      const d = daysUntil(r.dueDate);
                      const urgent = d <= 0 || r.status === "overdue";
                      return (
                        <div
                          key={r.id}
                          className={`dash-alert ${
                            urgent ? "dash-alert--urgent" : "dash-alert--warn"
                          }`}
                        >
                          <span className="dash-alert-tag">
                            {urgent
                              ? d < 0 || r.status === "overdue"
                                ? "Vencido"
                                : "Vence hoje"
                              : `Vence em ${d} dia(s)`}
                          </span>
                          <strong>{formatBrl(r.amount)}</strong>
                          <p>
                            {r.customerName} · parcela {r.installmentNumber}
                          </p>
                          <div className="dash-alert-actions">
                            <Link
                              href="/finance"
                              className="dash-btn dash-btn--primary"
                            >
                              Liquidar
                            </Link>
                          </div>
                        </div>
                      );
                    })}

                    {summary.expiringBatches.slice(0, 3).map((b, i) => (
                      <div key={i} className="dash-alert dash-alert--warn">
                        <span className="dash-alert-tag">Lote a vencer</span>
                        <strong>{b.product.name}</strong>
                        <p>
                          Lote {b.batchNumber ?? "—"} · {b.quantity} un ·{" "}
                          {b.expirationDate.slice(0, 10)}
                        </p>
                        <div className="dash-alert-actions">
                          <Link href="/products" className="dash-btn">
                            Ver estoque
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="dash-card">
                  <div className="dash-card-head">
                    <h2>Top devedores</h2>
                  </div>
                  <div className="dash-card-body">
                    {summary.topDebtors.length === 0 ? (
                      <p className="dash-empty">Nenhuma dívida aberta.</p>
                    ) : (
                      <ul className="dash-list">
                        {summary.topDebtors.map((d, i) => (
                          <li key={i}>
                            <span>
                              {d.customer.fullName}
                              <div className="dash-list-meta">
                                {d.customer.phone ?? "Sem telefone"}
                              </div>
                            </span>
                            <strong>{formatBrl(Number(d.totalDebt))}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <div className="dash-status-box">
                  API online · {summary.today.totalOrders} venda(s) hoje ·{" "}
                  {summary.inventory.productsInStock} SKUs com estoque
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
