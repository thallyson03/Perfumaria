import { Suspense } from "react";
import { OrderPageClient } from "@/components/order-page-client";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ subdomain: string; publicCode: string }>;
}) {
  const { subdomain, publicCode } = await params;
  return (
    <Suspense fallback={<main className="order-shell"><p className="order-muted">Carregando…</p></main>}>
      <OrderPageClient subdomain={subdomain} publicCode={publicCode} />
    </Suspense>
  );
}
