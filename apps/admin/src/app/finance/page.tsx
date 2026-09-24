"use client";

import "@/styles/inventory.css";
import "@/styles/finance.css";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminShell,
  apiFetch,
  useAuthSession,
} from "@/components/admin-shell";
import { receiptPath } from "@/components/sale-receipt";

type Customer = {
  id: string;
  fullName: string;
  phone?: string | null;
  documentCpf?: string | null;
  totalDebt?: number;
  overdueDebt?: number;
};

type Receivable = {
  id: string;
  amount: string;
  dueDate: string;
  status: string;
  installmentNumber: number;
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    documentCpf?: string | null;
    email?: string | null;
  };
  invoice?: {
    id: string;
    status: string;
    totalAmount: string;
    createdAt: string;
  } | null;
};

type Tab = "open" | "pending" | "overdue" | "paid";
type PayMethod = "pix" | "cash" | "debit" | "credit" | "wallet";

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function daysUntil(iso: string) {
  const end = new Date(iso);
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

function statusLabel(status: string, dueDate: string) {
  if (status === "paid") return "Liquidada";
  if (status === "overdue" || daysUntil(dueDate) < 0) return "Vencida";
  return "A vencer";
}

function statusClass(status: string, dueDate: string) {
  if (status === "paid") return "fin-pill--ok";
  if (status === "overdue" || daysUntil(dueDate) < 0) return "fin-pill--danger";
  return "";
}

export default function FinancePage() {
  const { token, ready } = useAuthSession();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [paidReceivables, setPaidReceivables] = useState<Receivable[]>([]);
  const [filterCustomerId, setFilterCustomerId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<Tab>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>("pix");
  const [useWallet, setUseWallet] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [totalAmount, setTotalAmount] = useState("100");
  const [dueDate, setDueDate] = useState("");

  const loadReceivables = useCallback(
    async (t: string, customer?: string, q?: string, status = "open") => {
      const params = new URLSearchParams({ status });
      if (customer) params.set("customerId", customer);
      if (q?.trim()) params.set("q", q.trim());
      return apiFetch(`/v1/finance/receivables?${params}`, t) as Promise<
        Receivable[]
      >;
    },
    []
  );

  const refresh = useCallback(
    async (t: string) => {
      const [c, open, paid] = await Promise.all([
        apiFetch("/v1/customers", t),
        loadReceivables(t, filterCustomerId, searchQuery, "open"),
        loadReceivables(t, filterCustomerId, searchQuery, "paid"),
      ]);
      const list = (Array.isArray(c) ? c : c.items) as Customer[];
      setCustomers(list);
      setReceivables(open);
      setPaidReceivables(paid.slice(0, 40));
      setInvoiceCustomerId((prev) => prev || list[0]?.id || "");
      setSelectedId((prev) => {
        if (prev && open.some((r) => r.id === prev)) return prev;
        return open[0]?.id ?? null;
      });
    },
    [filterCustomerId, searchQuery, loadReceivables]
  );

  useEffect(() => {
    if (!ready || !token) return;
    const timer = setTimeout(() => {
      refresh(token).catch((e: Error) => setError(e.message));
    }, filterCustomerId || searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [ready, token, filterCustomerId, searchQuery, refresh]);

  const selected = useMemo(
    () =>
      receivables.find((r) => r.id === selectedId) ??
      paidReceivables.find((r) => r.id === selectedId) ??
      null,
    [receivables, paidReceivables, selectedId]
  );

  useEffect(() => {
    if (!token || !selected || selected.status === "paid") {
      setWalletBalance(0);
      return;
    }
    apiFetch(`/v1/finance/wallet/${selected.customer.id}/balance`, token)
      .then((d) => setWalletBalance(Number(d.balance ?? 0)))
      .catch(() => setWalletBalance(0));
  }, [token, selected]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.documentCpf ?? "").includes(q)
    );
  }, [customers, searchQuery]);

  const pending = useMemo(
    () =>
      receivables.filter(
        (r) => r.status === "pending" && daysUntil(r.dueDate) >= 0
      ),
    [receivables]
  );
  const overdue = useMemo(
    () =>
      receivables.filter(
        (r) => r.status === "overdue" || daysUntil(r.dueDate) < 0
      ),
    [receivables]
  );

  const tableRows = useMemo(() => {
    if (tab === "pending") return pending;
    if (tab === "overdue") return overdue;
    if (tab === "paid") return paidReceivables;
    return receivables;
  }, [tab, pending, overdue, paidReceivables, receivables]);

  const kpiOpen = useMemo(
    () => pending.reduce((s, r) => s + Number(r.amount), 0),
    [pending]
  );
  const kpiOverdue = useMemo(
    () => overdue.reduce((s, r) => s + Number(r.amount), 0),
    [overdue]
  );
  const kpiPaid = useMemo(
    () => paidReceivables.reduce((s, r) => s + Number(r.amount), 0),
    [paidReceivables]
  );

  async function createInvoice(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setMsg(null);
    const amount = Number(totalAmount);
    try {
      await apiFetch("/v1/finance/invoices", token, {
        method: "POST",
        body: JSON.stringify({
          customerId: invoiceCustomerId,
          totalAmount: amount,
          installments: [
            {
              installmentNumber: 1,
              amount,
              dueDate,
            },
          ],
        }),
      });
      setMsg("Cobrança criada.");
      setShowCreate(false);
      await refresh(token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmPay() {
    if (!token || !selected || selected.status === "paid") return;
    setPaying(true);
    setError(null);
    setMsg(null);
    try {
      const amount = Number(selected.amount);
      const walletAmt =
        useWallet || payMethod === "wallet"
          ? Math.min(walletBalance, amount)
          : 0;
      await apiFetch(`/v1/finance/receivables/${selected.id}/pay`, token, {
        method: "POST",
        body: JSON.stringify({
          useWalletAmount: walletAmt,
          description: `Baixa via ${payMethod.toUpperCase()}`,
        }),
      });
      setMsg("Parcela baixada com sucesso.");
      setUseWallet(false);
      await refresh(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPaying(false);
    }
  }

  const selectedDays = selected ? daysUntil(selected.dueDate) : 0;

  return (
    <AdminShell variant="atelier">
      <div className="fin-page">
        <header className="fin-header">
          <div>
            <div className="fin-crumb">
              Financeiro / <span>Parcelas & crediário</span>
            </div>
            <h1>Gestão de parcelas, carnê & crediário</h1>
            <p>
              Busque o cliente, selecione a parcela e confirme a baixa com
              recibo. Cobranças avulsas também entram neste fluxo.
            </p>
          </div>
          <div className="fin-actions">
            <Link href="/customers" className="inv-btn">
              CRM clientes
            </Link>
            <button
              type="button"
              className="inv-btn"
              onClick={() => setShowCreate(true)}
            >
              Nova cobrança
            </button>
            <Link href="/sales" className="inv-btn inv-btn--primary">
              Novo pedido POS
            </Link>
          </div>
        </header>

        <section className="fin-kpis">
          <article className="fin-kpi">
            <span className="fin-kpi-label">A vencer no prazo</span>
            <div className="fin-kpi-value">{formatBrl(kpiOpen)}</div>
            <p className="fin-kpi-meta">{pending.length} parcela(s) ativas</p>
          </article>
          <article className="fin-kpi">
            <span className="fin-kpi-label">Parcelas vencidas</span>
            <div className="fin-kpi-value fin-kpi-value--danger">
              {formatBrl(kpiOverdue)}
            </div>
            <p className="fin-kpi-meta">{overdue.length} em atraso</p>
          </article>
          <article className="fin-kpi">
            <span className="fin-kpi-label">Histórico quitado</span>
            <div className="fin-kpi-value fin-kpi-value--ok">
              {formatBrl(kpiPaid)}
            </div>
            <p className="fin-kpi-meta">
              {paidReceivables.length} liquidações recentes
            </p>
          </article>
          <article className="fin-kpi">
            <span className="fin-kpi-label">Carteira em aberto</span>
            <div className="fin-kpi-value">
              {formatBrl(kpiOpen + kpiOverdue)}
            </div>
            <p className="fin-kpi-meta">
              {receivables.length} título(s) filtrados
            </p>
          </article>
        </section>

        <div className="fin-layout">
          <div className="fin-main">
            <section className="fin-card">
              <div className="fin-card-head">
                <h2>Parcelas do crediário</h2>
                <button
                  type="button"
                  className="inv-btn"
                  onClick={() => token && void refresh(token)}
                >
                  Atualizar
                </button>
              </div>
              <div className="fin-filters">
                <input
                  type="search"
                  placeholder="Buscar por nome, telefone ou CPF…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                />
                <select
                  value={filterCustomerId}
                  onChange={(e) => setFilterCustomerId(e.target.value)}
                >
                  <option value="">Todos os clientes</option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="fin-tabs">
                {(
                  [
                    ["open", `Em aberto (${receivables.length})`],
                    ["pending", `A vencer (${pending.length})`],
                    ["overdue", `Vencidas (${overdue.length})`],
                    ["paid", `Liquidadas (${paidReceivables.length})`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`fin-tab ${tab === id ? "active" : ""}`}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="fin-table-wrap">
                {tableRows.length === 0 ? (
                  <div className="fin-empty">
                    Nenhuma parcela neste filtro.
                  </div>
                ) : (
                  <table className="fin-table">
                    <thead>
                      <tr>
                        <th>Cliente / pedido</th>
                        <th>Parcela</th>
                        <th>Vencimento</th>
                        <th>Valor</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((r) => {
                        const d = daysUntil(r.dueDate);
                        return (
                          <tr
                            key={r.id}
                            className={selectedId === r.id ? "selected" : ""}
                            onClick={() => setSelectedId(r.id)}
                          >
                            <td>
                              <div className="fin-customer">
                                {r.customer.fullName}
                              </div>
                              <div className="fin-meta">
                                {r.invoice
                                  ? `Fatura ${r.invoice.id.slice(0, 8)}`
                                  : "Cobrança avulsa"}
                                {r.customer.phone
                                  ? ` · ${r.customer.phone}`
                                  : ""}
                              </div>
                            </td>
                            <td>#{r.installmentNumber}</td>
                            <td>
                              {r.dueDate.slice(0, 10)}
                              {r.status !== "paid" && (
                                <div className="fin-meta">
                                  {d < 0
                                    ? `${Math.abs(d)} dia(s) em atraso`
                                    : d === 0
                                      ? "Vence hoje"
                                      : `Em ${d} dia(s)`}
                                </div>
                              )}
                            </td>
                            <td>
                              <span className="fin-amount">
                                {formatBrl(Number(r.amount))}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`fin-pill ${statusClass(
                                  r.status,
                                  r.dueDate
                                )}`}
                              >
                                {statusLabel(r.status, r.dueDate)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          <aside className="fin-panel">
            {!selected ? (
              <div className="fin-panel-empty">
                Selecione uma parcela na tabela para dar baixa ou consultar.
              </div>
            ) : (
              <>
                <div className="fin-panel-head">
                  <h2>
                    {selected.status === "paid"
                      ? "Parcela liquidada"
                      : "Dar baixa em parcela"}
                  </h2>
                  <p>
                    {selected.customer.fullName} · parcela #
                    {selected.installmentNumber}
                  </p>
                </div>
                <div className="fin-panel-body">
                  <div>
                    <div className="fin-meta">Vencimento</div>
                    <strong>{selected.dueDate.slice(0, 10)}</strong>
                    {selected.status !== "paid" && (
                      <div className="fin-meta">
                        {selectedDays < 0
                          ? `${Math.abs(selectedDays)} dia(s) em atraso`
                          : selectedDays === 0
                            ? "Vence hoje"
                            : `Faltam ${selectedDays} dia(s)`}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="fin-meta">Cliente</div>
                    <strong>{selected.customer.fullName}</strong>
                    <div className="fin-meta">
                      {selected.customer.phone ?? "Sem telefone"}
                      {selected.customer.documentCpf
                        ? ` · CPF ${selected.customer.documentCpf}`
                        : ""}
                    </div>
                  </div>

                  {selected.status !== "paid" && (
                    <>
                      <div className="fin-field">
                        Forma de recebimento
                        <div className="fin-pay-methods">
                          {(
                            [
                              ["pix", "PIX"],
                              ["cash", "Dinheiro"],
                              ["debit", "Débito"],
                              ["credit", "Crédito"],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              className={`fin-pay-method ${
                                payMethod === id ? "active" : ""
                              }`}
                              onClick={() => setPayMethod(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {walletBalance > 0 && (
                        <label className="fin-check">
                          <input
                            type="checkbox"
                            checked={useWallet}
                            onChange={(e) => setUseWallet(e.target.checked)}
                          />
                          Usar carteira ({formatBrl(walletBalance)} disp.)
                        </label>
                      )}

                      <div className="fin-panel-total">
                        <span>Total a receber</span>
                        <strong>{formatBrl(Number(selected.amount))}</strong>
                      </div>
                    </>
                  )}

                  {selected.status === "paid" && selected.invoice && (
                    <Link
                      href={receiptPath(selected.invoice.id)}
                      target="_blank"
                      className="inv-btn inv-btn--primary"
                      style={{ textAlign: "center", textDecoration: "none" }}
                    >
                      Abrir comprovante
                    </Link>
                  )}
                </div>
                {selected.status !== "paid" && (
                  <div className="fin-panel-foot">
                    <button
                      type="button"
                      className="inv-btn inv-btn--primary"
                      style={{ width: "100%" }}
                      disabled={paying}
                      onClick={() => void confirmPay()}
                    >
                      {paying
                        ? "Confirmando…"
                        : "Confirmar baixa & emitir recibo"}
                    </button>
                    {selected.invoice && (
                      <Link
                        href={receiptPath(selected.invoice.id)}
                        target="_blank"
                        className="inv-btn"
                        style={{
                          width: "100%",
                          textAlign: "center",
                          textDecoration: "none",
                        }}
                      >
                        Ver fatura / recibo
                      </Link>
                    )}
                    <Link
                      href={`/customers/${selected.customer.id}`}
                      className="inv-btn"
                      style={{
                        width: "100%",
                        textAlign: "center",
                        textDecoration: "none",
                      }}
                    >
                      Ficha do cliente
                    </Link>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </div>

      {showCreate && (
        <div
          className="fin-modal-overlay"
          onClick={() => setShowCreate(false)}
        >
          <form
            className="fin-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={createInvoice}
          >
            <h2>Nova cobrança avulsa</h2>
            <label className="fin-field">
              Cliente
              <select
                value={invoiceCustomerId}
                onChange={(e) => setInvoiceCustomerId(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="fin-field">
              Valor
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                required
              />
            </label>
            <label className="fin-field">
              Vencimento
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </label>
            <div className="fin-modal-actions">
              <button
                type="button"
                className="inv-btn"
                onClick={() => setShowCreate(false)}
              >
                Cancelar
              </button>
              <button type="submit" className="inv-btn inv-btn--primary">
                Criar cobrança
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <div className="fin-toast">{error}</div>}
      {msg && <div className="fin-toast fin-toast--ok">{msg}</div>}
    </AdminShell>
  );
}
