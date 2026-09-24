"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, useAuthSession } from "@/components/admin-shell";
import {
  SaleReceipt,
  type SaleReceiptData,
} from "@/components/sale-receipt";

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const { token, ready } = useAuthSession();
  const [data, setData] = useState<SaleReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token || !params.id) return;
    apiFetch(`/v1/finance/invoices/${params.id}/receipt`, token)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [ready, token, params.id]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #0f1c18)", padding: "1rem" }}>
      <p className="no-print" style={{ margin: "0 0 1rem", maxWidth: 520, marginInline: "auto" }}>
        <Link href="/sales" style={{ color: "var(--muted, #888)" }}>
          ← Voltar
        </Link>
      </p>

      {error && (
        <p style={{ color: "var(--danger, #c44)", textAlign: "center" }}>{error}</p>
      )}
      {!data && !error && (
        <p style={{ color: "var(--muted, #888)", textAlign: "center" }}>Carregando comprovante…</p>
      )}
      {data && <SaleReceipt data={data} />}

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
