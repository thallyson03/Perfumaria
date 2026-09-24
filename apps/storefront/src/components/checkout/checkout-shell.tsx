"use client";

import Link from "next/link";
import { storeHref } from "@/lib/store-url";

type Props = {
  current: 1 | 2 | 3 | 4;
  storeName: string;
  subdomain: string;
};

function steps(subdomain: string) {
  return [
    {
      id: 1,
      label: "Sacola de Compras",
      short: "Sacola",
      href: storeHref(subdomain, "/checkout"),
    },
    {
      id: 2,
      label: "Identificação & Entrega",
      short: "Entrega",
      href: storeHref(subdomain, "/checkout/entrega"),
    },
    {
      id: 3,
      label: "Pagamento Seguro",
      short: "Pagamento",
      href: storeHref(subdomain, "/checkout/pagamento"),
    },
    {
      id: 4,
      label: "Confirmação",
      short: "Confirmação",
      href: null as string | null,
    },
  ] as const;
}

export function CheckoutStepper({
  current,
  subdomain,
}: {
  current: 1 | 2 | 3 | 4;
  subdomain: string;
}) {
  const STEPS = steps(subdomain);
  return (
    <div className="checkout-stepper">
      <ol className="checkout-stepper-list">
        {STEPS.map((step, index) => {
          const done = step.id < current;
          const active = step.id === current;
          const content = (
            <>
              <span
                className={`checkout-step-num ${
                  done || active ? "checkout-step-num--on" : ""
                }`}
              >
                {done ? "✓" : step.id}
              </span>
              <span className="checkout-step-label-full">{step.label}</span>
              <span className="checkout-step-label-short">{step.short}</span>
            </>
          );
          return (
            <li key={step.id} className="checkout-step-item">
              {index > 0 && <span className="checkout-step-line" aria-hidden />}
              {step.href && (done || active) ? (
                <Link
                  href={step.href}
                  className={`checkout-step ${
                    active ? "checkout-step--active" : ""
                  } ${done ? "checkout-step--done" : ""}`}
                >
                  {content}
                </Link>
              ) : (
                <span
                  className={`checkout-step ${
                    active ? "checkout-step--active" : ""
                  } ${done ? "checkout-step--done" : ""}`}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CheckoutShell({
  current,
  storeName,
  subdomain,
  children,
}: Props & { children: React.ReactNode }) {
  return (
    <div className="checkout-page">
      <header className="checkout-header">
        <div className="checkout-header-inner">
          <Link href={storeHref(subdomain)} className="checkout-brand">
            <span className="checkout-brand-name">{storeName}</span>
            <span className="checkout-brand-tag">
              Checkout seguro · Alta perfumaria
            </span>
          </Link>
          <div className="checkout-header-trust">
            <span>Ambiente criptografado</span>
            <span className="checkout-header-sep">·</span>
            <span>Atendimento exclusivo</span>
          </div>
        </div>
        <CheckoutStepper current={current} subdomain={subdomain} />
      </header>
      <main className="checkout-main">{children}</main>
      <footer className="checkout-footer">
        <p>
          © {new Date().getFullYear()} {storeName} · Compra segura · Estoque
          reservado na sacola
        </p>
      </footer>
    </div>
  );
}
