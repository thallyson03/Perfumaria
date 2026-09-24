"use client";

import "@/styles/login.css";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [storeName, setStoreName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("revendedor_token")) {
      router.replace("/dashboard");
      return;
    }
    const saved = localStorage.getItem("revendedor_login_email");
    const savedSub = localStorage.getItem("revendedor_login_subdomain");
    if (saved) setEmail(saved);
    if (savedSub) setSubdomain(savedSub);
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const path = mode === "register" ? "/v1/auth/register" : "/v1/auth/login";
      const body =
        mode === "register"
          ? { storeName, subdomain, email, password }
          : { subdomain, email, password };

      const res = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(formatApiError(data.error) ?? "Falha na autenticação");
        return;
      }

      localStorage.setItem("revendedor_token", data.token);
      localStorage.setItem("revendedor_tenant", JSON.stringify(data.tenant));
      if (remember) {
        localStorage.setItem("revendedor_login_email", email);
        localStorage.setItem("revendedor_login_subdomain", subdomain);
      } else {
        localStorage.removeItem("revendedor_login_email");
        localStorage.removeItem("revendedor_login_subdomain");
      }
      router.replace("/dashboard");
    } catch {
      setMessage("API indisponível. Suba o Docker e a API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <header className="login-topbar">
        <div className="login-topbar-left">
          <span className="login-dot" />
          <span>
            Infraestrutura ERP segura · Omnichannel sincronizado
          </span>
        </div>
        <div className="login-topbar-right">
          <span>TLS 1.3 / AES-256</span>
          <span>·</span>
          <span>Revendedor Atelier</span>
        </div>
      </header>

      <div className="login-shell">
        <aside className="login-brand">
          <div>
            <div className="login-brand-mark">
              <div className="login-brand-icon">◈</div>
              <div>
                <p className="login-brand-name">Haute Parfumerie</p>
                <p className="login-brand-sub">Portal do revendedor</p>
              </div>
            </div>
            <span className="login-badge">Rede curadora credenciada</span>
            <h1>Portal de gestão integrada & omnichannel de alta perfumaria</h1>
            <p className="login-brand-lead">
              Plataforma operacional para estoque, lotes, PDV, vitrine e
              conciliação financeira da sua boutique.
            </p>
            <div className="login-portfolio">
              <span className="login-portfolio-label">Portfólio</span>
              <div className="login-tags">
                <span className="login-tag login-tag--boticario">
                  O Boticário
                </span>
                <span className="login-tag login-tag--eudora">Eudora</span>
                <span className="login-tag login-tag--oui">O.U.i Paris</span>
              </div>
            </div>
          </div>

          <blockquote className="login-quote">
            <p>
              “A excelência olfativa reside no equilíbrio entre arte rara, lote
              preservado e entrega sem atritos.”
            </p>
            <cite>Conselho consultor · Alta perfumaria</cite>
          </blockquote>

          <div className="login-brand-foot">
            <div className="login-foot-item">
              <span>◈</span>
              Vitrine omnichannel
            </div>
            <div className="login-foot-item">
              <span>⚡</span>
              PDV & crediário
            </div>
            <div className="login-foot-item">
              <span>✓</span>
              Estoque por lote
            </div>
          </div>
        </aside>

        <main className="login-panel">
          <div className="login-panel-inner">
            <div className="login-panel-meta">
              <span className="login-secure">Ambiente de acesso restrito</span>
              <span className="login-terminal">Painel gestor</span>
            </div>

            <h2>
              {mode === "register"
                ? "Abra sua loja no Atelier"
                : "Entre com suas credenciais"}
            </h2>
            <p className="login-panel-lead">
              {mode === "register"
                ? "Crie a franquia, defina o subdomínio da vitrine e acesse o ERP."
                : "Informe o subdomínio da loja, e-mail e senha para autenticar."}
            </p>

            <div className="login-tabs">
              <button
                type="button"
                className={`login-tab ${mode === "login" ? "active" : ""}`}
                onClick={() => {
                  setMode("login");
                  setMessage(null);
                }}
              >
                Login
              </button>
              <button
                type="button"
                className={`login-tab ${mode === "register" ? "active" : ""}`}
                onClick={() => {
                  setMode("register");
                  setMessage(null);
                }}
              >
                Criar loja
              </button>
            </div>

            <form className="login-form" onSubmit={onSubmit}>
              {mode === "register" && (
                <label className="login-field">
                  Nome da loja
                  <input
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    required
                    autoComplete="organization"
                    placeholder="Maison Haute Parfumerie"
                  />
                </label>
              )}

              <label className="login-field">
                Subdomínio da franquia
                <input
                  value={subdomain}
                  onChange={(e) =>
                    setSubdomain(
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
                    )
                  }
                  placeholder="minhaloja"
                  minLength={2}
                  required
                  autoComplete="off"
                />
                <span className="login-hint">
                  Só minúsculas, números e hífen · vitrine em{" "}
                  {subdomain || "loja"}.localhost
                </span>
              </label>

              <label className="login-field">
                E-mail corporativo
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="gestor@franquia.com.br"
                />
              </label>

              <label className="login-field">
                Senha de acesso
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    style={{ paddingRight: "4.5rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      position: "absolute",
                      right: "0.65rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      border: 0,
                      background: "transparent",
                      color: "#897173",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
                <span className="login-hint">Mínimo 8 caracteres</span>
              </label>

              <div className="login-row">
                <label className="login-check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Lembrar e-mail neste terminal
                </label>
                <span className="login-cert">Certificado ativo</span>
              </div>

              <button className="login-cta" type="submit" disabled={loading}>
                {loading
                  ? "Autenticando…"
                  : mode === "register"
                    ? "Criar conta e entrar"
                    : "Acessar Atelier Prestige ERP"}
              </button>

              {message && <p className="login-message">{message}</p>}
            </form>

            <div className="login-divider">Acesso do gestor</div>
            <div className="login-alt">
              <button type="button" disabled title="Em breve">
                Biometria / FIDO2
              </button>
              <button type="button" disabled title="Em breve">
                2FA (em breve)
              </button>
            </div>
          </div>
        </main>
      </div>

      <footer className="login-footer">
        <p>
          <strong>Conexão criptografada</strong> · Conformidade LGPD & auditoria
          fiscal
        </p>
        <p style={{ marginTop: "0.35rem" }}>
          Uso monitorado. Estoque, faturamento e vitrine sob o contrato da
          franquia.
        </p>
      </footer>
    </div>
  );
}

function formatApiError(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);

  const flat = error as {
    formErrors?: string[];
    fieldErrors?: Record<string, string[] | undefined>;
  };

  const fields = flat.fieldErrors
    ? Object.entries(flat.fieldErrors)
        .filter(([, msgs]) => msgs && msgs.length > 0)
        .map(([field, msgs]) => `${field}: ${msgs!.join(", ")}`)
    : [];

  const parts = [...(flat.formErrors ?? []), ...fields];
  if (parts.length > 0) return parts.join(" · ");

  try {
    return JSON.stringify(error);
  } catch {
    return "Falha na autenticação";
  }
}
