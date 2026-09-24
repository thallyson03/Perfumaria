"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  clearCustomerSession,
  fetchCustomerProfile,
  loadCustomerSession,
  loginCustomer,
  registerCustomer,
  saveCustomerSession,
  type CustomerSession,
} from "@/lib/customer-session";
import { storeHref } from "@/lib/store-url";

type Props = {
  subdomain: string;
  domain: string;
  onSessionChange?: (session: CustomerSession | null) => void;
};

type AuthMode = "login" | "register";

export function CustomerAuthMenu({ subdomain, domain, onSessionChange }: Props) {
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [documentCpf, setDocumentCpf] = useState("");
  const [password, setPassword] = useState("");

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const saved = loadCustomerSession(subdomain);
      if (!saved?.token) {
        if (!cancelled) {
          setSession(null);
          setReady(true);
          onSessionChange?.(null);
        }
        return;
      }

      const profile = await fetchCustomerProfile(domain, saved.token);
      if (cancelled) return;

      if (!profile) {
        clearCustomerSession(subdomain);
        setSession(null);
        onSessionChange?.(null);
      } else {
        const next: CustomerSession = {
          token: saved.token,
          customer: profile,
        };
        saveCustomerSession(subdomain, next);
        setSession(next);
        onSessionChange?.(next);
      }
      setReady(true);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [subdomain, domain]);

  useEffect(() => {
    if (!menuOpen && !modalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModalOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, modalOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  function openModal(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setModalOpen(true);
    setMenuOpen(false);
  }

  function applySession(next: CustomerSession) {
    saveCustomerSession(subdomain, next);
    setSession(next);
    onSessionChange?.(next);
    setModalOpen(false);
    setPassword("");
    setError(null);
  }

  function logout() {
    clearCustomerSession(subdomain);
    setSession(null);
    onSessionChange?.(null);
    setMenuOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") {
        const next = await loginCustomer(domain, email.trim(), password);
        applySession(next);
      } else {
        const next = await registerCustomer(domain, {
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          documentCpf: documentCpf.replace(/\D/g, ""),
        });
        applySession(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  }

  const displayName = session?.customer.fullName.split(" ")[0] ?? "Entrar";

  return (
    <>
      <div className="store-auth" ref={menuRef}>
        <button
          type="button"
          className="store-header-link"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <UserIcon />
          <span className="store-header-link-label">
            {ready && session ? displayName : "Entrar"}
          </span>
          <ChevronIcon />
        </button>

        {menuOpen && (
          <div className="store-auth-panel" role="menu">
            {session ? (
              <>
                <div className="store-auth-panel-body store-auth-panel-body--user">
                  <strong>{session.customer.fullName}</strong>
                  <span>{session.customer.email}</span>
                </div>
                <div className="store-auth-panel-footer store-auth-panel-footer--stack">
                  <a
                    href={storeHref(subdomain, "/conta/pedidos")}
                    className="store-auth-orders-link"
                  >
                    Meus pedidos
                  </a>
                  <button type="button" onClick={logout}>
                    Sair
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="store-auth-panel-body">
                  <button
                    type="button"
                    className="store-auth-panel-cta"
                    role="menuitem"
                    onClick={() => openModal("login")}
                  >
                    Acessar minha conta
                  </button>
                </div>
                <div className="store-auth-panel-footer">
                  <span>
                    Não tem conta?{" "}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openModal("register")}
                    >
                      Cadastrar.
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="auth-overlay"
          onClick={() => !loading && setModalOpen(false)}
        >
          <div
            className="auth-modal"
            role="dialog"
            aria-labelledby="auth-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="auth-modal-header">
              <h2 id="auth-modal-title">
                {mode === "login" ? "Entrar na loja" : "Criar conta"}
              </h2>
              <button
                type="button"
                className="auth-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <div className="auth-tabs">
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Entrar
              </button>
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
              >
                Criar conta
              </button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              {mode === "register" && (
                <>
                  <label>
                    Nome completo
                    <input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Telefone (opcional)
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                    />
                  </label>
                  <label>
                    CPF
                    <input
                      value={documentCpf}
                      onChange={(e) =>
                        setDocumentCpf(
                          e.target.value.replace(/\D/g, "").slice(0, 11)
                        )
                      }
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="Somente números"
                      minLength={11}
                      maxLength={11}
                    />
                  </label>
                </>
              )}

              <label>
                E-mail
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>

              <label>
                Senha
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === "register" ? 8 : 1}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                />
              </label>

              {mode === "register" && (
                <p className="auth-hint">A senha deve ter no mínimo 8 caracteres.</p>
              )}

              {error && <p className="auth-error">{error}</p>}

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading
                  ? "Aguarde…"
                  : mode === "login"
                    ? "Entrar"
                    : "Criar conta"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function UserIcon() {
  return (
    <svg
      className="store-header-link-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.3 2.7-6 7-6s7 2.7 7 6" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="store-header-link-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
