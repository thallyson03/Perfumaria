"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

type Tenant = { id: string; name: string; subdomain: string };

export function useAuthSession() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("revendedor_token");
    const raw = localStorage.getItem("revendedor_tenant");
    if (!t) {
      router.replace("/");
      return;
    }
    setToken(t);
    if (raw) setTenant(JSON.parse(raw) as Tenant);
    setReady(true);
  }, [router]);

  function logout() {
    localStorage.removeItem("revendedor_token");
    localStorage.removeItem("revendedor_tenant");
    router.replace("/");
  }

  return { token, tenant, ready, logout };
}

export function AdminShell({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "pos" | "atelier";
}) {
  const { tenant, ready, logout } = useAuthSession();
  const pathname = usePathname();

  if (!ready) {
    return (
      <main style={{ padding: "2rem", color: "var(--muted)" }}>Carregando…</main>
    );
  }

  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/orders", label: "Pedidos" },
    { href: "/sales", label: "PDV" },
    { href: "/customers", label: "Clientes" },
    { href: "/products", label: "Estoque" },
    { href: "/finance", label: "Financeiro" },
    { href: "/settings", label: "Canais" },
  ];

  if (variant === "pos") {
    return (
      <div className="pdv-shell">
        <header className="pdv-topbar">
          <div className="pdv-topbar-brand">
            <Link href="/dashboard" className="pdv-logo">
              {tenant?.name ?? "Revendedor"}
            </Link>
            <span className="pdv-online">
              <span className="pdv-online-dot" />
              PDV Online · Caixa aberto
            </span>
          </div>
          <nav className="pdv-topbar-nav">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  pathname === item.href || pathname.startsWith(item.href + "/")
                    ? "pdv-topbar-link active"
                    : "pdv-topbar-link"
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="pdv-topbar-actions">
            <span className="pdv-topbar-sub">{tenant?.subdomain}</span>
            <button type="button" className="pdv-btn-ghost" onClick={logout}>
              Sair
            </button>
          </div>
        </header>
        <div className="pdv-workspace">{children}</div>
      </div>
    );
  }

  if (variant === "atelier") {
    return (
      <div className="atelier-shell">
        <aside className="atelier-aside">
          <div className="atelier-brand-block">
            <div className="atelier-brand-mark">◈</div>
            <div>
              <p className="atelier-brand-name">{tenant?.name ?? "Revendedor"}</p>
              <p className="atelier-brand-sub">{tenant?.subdomain}</p>
            </div>
          </div>
          <nav className="atelier-nav">
            {nav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "atelier-nav-link active" : "atelier-nav-link"}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="atelier-aside-foot">
            <Link href="/sales" className="atelier-aside-cta">
              Abrir PDV
            </Link>
            <button type="button" className="atelier-logout" onClick={logout}>
              Sair
            </button>
          </div>
        </aside>
        <div className="atelier-main">{children}</div>
      </div>
    );
  }

  return (
    <div style={shellStyles.layout}>
      <aside style={shellStyles.aside}>
        <p style={shellStyles.brand}>Revendedor</p>
        <p style={shellStyles.store}>{tenant?.name ?? "Loja"}</p>
        <p style={shellStyles.sub}>{tenant?.subdomain}</p>
        <nav style={shellStyles.nav}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...shellStyles.link,
                ...(pathname === item.href ? shellStyles.linkActive : null),
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button type="button" style={shellStyles.logout} onClick={logout}>
          Sair
        </button>
      </aside>
      <main style={shellStyles.main}>{children}</main>
    </div>
  );
}

const shellStyles: Record<string, CSSProperties> = {
  layout: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateColumns: "minmax(180px, 220px) 1fr",
  },
  aside: {
    padding: "1.5rem 1.25rem",
    borderRight: "1px solid var(--line)",
    background: "rgba(15, 28, 24, 0.9)",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  brand: {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "1.6rem",
  },
  store: { margin: "0.75rem 0 0", fontWeight: 600 },
  sub: { margin: 0, color: "var(--muted)", fontSize: "0.85rem" },
  nav: {
    display: "grid",
    gap: "0.35rem",
    marginTop: "1.5rem",
  },
  link: {
    textDecoration: "none",
    padding: "0.55rem 0.65rem",
    color: "var(--muted)",
    border: "1px solid transparent",
  },
  linkActive: {
    color: "var(--ink)",
    borderColor: "var(--accent)",
    background: "var(--accent-soft)",
  },
  logout: {
    marginTop: "auto",
    background: "transparent",
    border: "1px solid var(--line)",
    color: "var(--muted)",
    padding: "0.6rem",
    cursor: "pointer",
  },
  main: {
    padding: "1.75rem",
  },
};

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function mediaUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${API}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export async function apiFetch(
  path: string,
  token: string,
  init?: RequestInit
) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : JSON.stringify(data.error ?? "Erro na API")
    );
  }
  return data;
}

export async function apiUpload(
  path: string,
  token: string,
  file: File,
  fieldName = "file"
) {
  const form = new FormData();
  form.append(fieldName, file);
  return apiFetch(path, token, { method: "POST", body: form });
}
