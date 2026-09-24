"use client";

import Link from "next/link";

export type SaleReceiptData = {
  receiptNumber: string;
  invoiceId: string;
  issuedAt: string;
  store: {
    name: string;
    subdomain: string;
    whatsappPhone: string | null;
  };
  customer: {
    fullName: string;
    phone: string | null;
    documentCpf: string | null;
    email: string | null;
  };
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totalAmount: number;
  status: string;
  statusLabel: string;
  installments: Array<{
    installmentNumber: number;
    amount: number;
    dueDate: string;
    status: string;
    statusLabel: string;
  }>;
  paidAmount: number;
  pendingAmount: number;
  paymentSummary: string;
  disclaimer: string;
};

export function receiptPath(invoiceId: string): string {
  return `/receipt/${invoiceId}`;
}

function money(v: number) {
  return `R$ ${v.toFixed(2)}`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

type Props = {
  data: SaleReceiptData;
  showActions?: boolean;
};

export function SaleReceipt({ data, showActions = true }: Props) {
  return (
    <div className="receipt-root">
      {showActions && (
        <div className="receipt-actions no-print">
          <button type="button" className="receipt-btn primary" onClick={() => window.print()}>
            Imprimir
          </button>
          <Link href="/sales" className="receipt-btn">
            Nova venda
          </Link>
        </div>
      )}

      <article className="receipt-paper">
        <header className="receipt-header">
          <h1 className="receipt-store">{data.store.name}</h1>
          <p className="receipt-sub">
            Comprovante de Venda
            {data.store.whatsappPhone ? ` · ${data.store.whatsappPhone}` : ""}
          </p>
        </header>

        <div className="receipt-meta">
          <div>
            <span className="label">Nº</span>
            <strong>{data.receiptNumber}</strong>
          </div>
          <div>
            <span className="label">Emissão</span>
            <strong>{formatDateTime(data.issuedAt)}</strong>
          </div>
          <div>
            <span className="label">Status</span>
            <strong>{data.statusLabel}</strong>
          </div>
        </div>

        <section className="receipt-block">
          <h2>Cliente</h2>
          <p className="receipt-line">
            <strong>{data.customer.fullName}</strong>
          </p>
          {data.customer.phone && (
            <p className="receipt-line muted">Tel: {data.customer.phone}</p>
          )}
          {data.customer.documentCpf && (
            <p className="receipt-line muted">CPF: {data.customer.documentCpf}</p>
          )}
          {data.customer.email && (
            <p className="receipt-line muted">{data.customer.email}</p>
          )}
        </section>

        <section className="receipt-block">
          <h2>Itens</h2>
          <table className="receipt-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Qtd</th>
                <th>Unit.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Cobrança avulsa (sem itens de produto)
                  </td>
                </tr>
              ) : (
                data.items.map((item, idx) => (
                  <tr key={`${item.productName}-${idx}`}>
                    <td>{item.productName}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.unitPrice)}</td>
                    <td>{money(item.lineTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section className="receipt-totals">
          <div className="receipt-total-row">
            <span>Total da venda</span>
            <strong>{money(data.totalAmount)}</strong>
          </div>
          <div className="receipt-total-row muted">
            <span>Forma de pagamento</span>
            <span>{data.paymentSummary}</span>
          </div>
          {data.paidAmount > 0 && (
            <div className="receipt-total-row">
              <span>Recebido</span>
              <span>{money(data.paidAmount)}</span>
            </div>
          )}
          {data.pendingAmount > 0 && (
            <div className="receipt-total-row">
              <span>Em aberto</span>
              <span>{money(data.pendingAmount)}</span>
            </div>
          )}
        </section>

        {data.installments.length > 0 && (
          <section className="receipt-block">
            <h2>Parcelas</h2>
            <table className="receipt-table compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.installments.map((p) => (
                  <tr key={p.installmentNumber}>
                    <td>{p.installmentNumber}</td>
                    <td>{p.dueDate.slice(0, 10)}</td>
                    <td>{money(p.amount)}</td>
                    <td>{p.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="receipt-footer">
          <p>{data.disclaimer}</p>
          <p className="muted">ID interno: {data.invoiceId.slice(0, 8)}</p>
        </footer>
      </article>

      <style jsx global>{`
        .receipt-root {
          max-width: 520px;
          margin: 0 auto;
          padding: 1rem;
        }
        .receipt-actions {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .receipt-btn {
          padding: 0.6rem 1rem;
          border: 1px solid var(--line, #ccc);
          background: transparent;
          color: inherit;
          text-decoration: none;
          font: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
        }
        .receipt-btn.primary {
          background: var(--accent, #2d8f6f);
          color: #04140c;
          border: 0;
          font-weight: 700;
        }
        .receipt-paper {
          background: #fff;
          color: #111;
          border: 1px solid #ddd;
          padding: 1.25rem 1rem;
          font-family: "Courier New", Courier, monospace;
          font-size: 13px;
          line-height: 1.45;
        }
        .receipt-header {
          text-align: center;
          border-bottom: 1px dashed #999;
          padding-bottom: 0.75rem;
          margin-bottom: 0.75rem;
        }
        .receipt-store {
          margin: 0;
          font-family: var(--font-display, Georgia, serif);
          font-size: 1.35rem;
          letter-spacing: 0.02em;
        }
        .receipt-sub {
          margin: 0.35rem 0 0;
          font-size: 0.85rem;
          color: #444;
        }
        .receipt-meta {
          display: grid;
          gap: 0.35rem;
          margin-bottom: 0.75rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px dashed #ccc;
        }
        .receipt-meta .label {
          display: inline-block;
          min-width: 4.5rem;
          color: #666;
        }
        .receipt-block h2 {
          margin: 0 0 0.4rem;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #555;
        }
        .receipt-line {
          margin: 0.15rem 0;
        }
        .receipt-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .receipt-table th,
        .receipt-table td {
          border-bottom: 1px dotted #ccc;
          padding: 0.35rem 0.2rem;
          text-align: left;
        }
        .receipt-table th {
          font-size: 0.7rem;
          text-transform: uppercase;
          color: #666;
        }
        .receipt-table td:nth-child(2),
        .receipt-table td:nth-child(3),
        .receipt-table td:nth-child(4),
        .receipt-table th:nth-child(2),
        .receipt-table th:nth-child(3),
        .receipt-table th:nth-child(4) {
          text-align: right;
          white-space: nowrap;
        }
        .receipt-totals {
          margin: 0.75rem 0;
          padding: 0.75rem 0;
          border-top: 1px dashed #999;
          border-bottom: 1px dashed #999;
        }
        .receipt-total-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.2rem 0;
        }
        .receipt-footer {
          margin-top: 1rem;
          text-align: center;
          font-size: 0.75rem;
          color: #666;
        }
        .muted {
          color: #666;
        }
        @media print {
          body {
            background: #fff !important;
          }
          .no-print {
            display: none !important;
          }
          .receipt-root {
            max-width: none;
            padding: 0;
          }
          .receipt-paper {
            border: none;
            padding: 0;
          }
        }
      `}</style>
    </div>
  );
}
