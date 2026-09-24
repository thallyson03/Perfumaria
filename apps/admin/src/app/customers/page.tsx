"use client";

import "@/styles/inventory.css";
import "@/styles/crm.css";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AdminShell,
  apiFetch,
  useAuthSession,
} from "@/components/admin-shell";

type Customer = {
  id: string;
  fullName: string;
  phone: string | null;
  documentCpf: string | null;
  email: string | null;
  createdAt: string;
  totalDebt: number;
  overdueDebt: number;
  pendingCount: number;
};

type Stats = {
  total: number;
  withDebt: number;
  overdue: number;
  withEmail: number;
  avgTicket: number;
  ltv: number;
};

type View = "list" | "create";

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function maskCpf(cpf: string | null | undefined) {
  if (!cpf) return "—";
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const emptyAddress = {
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

export default function CustomersPage() {
  const { token, ready } = useAuthSession();
  const [view, setView] = useState<View>("list");
  const [items, setItems] = useState<Customer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lgpd, setLgpd] = useState(true);
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [secondaryPhone, setSecondaryPhone] = useState("");
  const [documentCpf, setDocumentCpf] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState(emptyAddress);
  const [includeAddress, setIncludeAddress] = useState(false);

  async function load(t: string) {
    const data = await apiFetch("/v1/customers", t);
    if (Array.isArray(data)) {
      setItems(data);
      setStats(null);
    } else {
      setItems(data.items as Customer[]);
      setStats(data.stats as Stats);
    }
  }

  useEffect(() => {
    if (!ready || !token) return;
    load(token).catch((e: Error) => setError(e.message));
  }, [ready, token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.documentCpf ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
    );
  }, [items, query]);

  function resetForm() {
    setFullName("");
    setPhone("");
    setSecondaryPhone("");
    setDocumentCpf("");
    setEmail("");
    setAddress(emptyAddress);
    setIncludeAddress(false);
    setLgpd(true);
    setWhatsappOptIn(true);
  }

  function openCreate() {
    resetForm();
    setError(null);
    setView("create");
  }

  async function saveCustomer(openPos = false) {
    if (!token) return;
    if (!lgpd) {
      setError("É necessário o consentimento LGPD para concluir o cadastro.");
      return;
    }
    if (fullName.trim().length < 2) {
      setError("Informe o nome completo.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        documentCpf: documentCpf.replace(/\D/g, "") || undefined,
        email: email.trim() || undefined,
      };
      if (includeAddress) {
        body.address = {
          recipientName: fullName.trim(),
          phone: phone.trim() || secondaryPhone.trim() || undefined,
          zipCode: address.zipCode,
          street: address.street,
          number: address.number,
          complement: address.complement || null,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
          label: "Residencial",
        };
      }
      await apiFetch("/v1/customers", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      resetForm();
      await load(token);
      setMsg("Cliente cadastrado com sucesso");
      setTimeout(() => setMsg(null), 2500);
      if (openPos) {
        window.location.href = "/sales";
        return;
      }
      setView("list");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await saveCustomer(false);
  }

  const computedStats = stats ?? {
    total: items.length,
    withDebt: items.filter((c) => c.totalDebt > 0).length,
    overdue: items.filter((c) => c.overdueDebt > 0).length,
    withEmail: items.filter((c) => Boolean(c.email)).length,
    avgTicket: 0,
    ltv: 0,
  };

  return (
    <AdminShell variant="atelier">
      <div className="crm-page">
        <header className="crm-header">
          <div>
            <div className="crm-crumb">
              Início / CRM & clientes /{" "}
              <span>
                {view === "create" ? "Novo cadastro" : "Carteira"}
              </span>
            </div>
            <div className="crm-title-row">
              <h1>
                {view === "create"
                  ? "Cadastro de cliente & perfil"
                  : "CRM & clientes"}
              </h1>
              <span className="crm-badge">Fidelidade Prestige</span>
            </div>
            <p>
              Gestão cadastral omnichannel, histórico de compras e cobranças da
              carteira.
            </p>
          </div>
          <div className="crm-actions">
            {view === "list" ? (
              <>
                <Link href="/finance" className="inv-btn">
                  Ver cobranças
                </Link>
                <button
                  type="button"
                  className="inv-btn inv-btn--primary"
                  onClick={openCreate}
                >
                  + Novo cadastro
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="inv-btn"
                  onClick={() => setView("list")}
                >
                  Voltar à carteira
                </button>
                <button
                  type="submit"
                  form="crm-create-form"
                  className="inv-btn inv-btn--primary"
                  disabled={saving}
                >
                  {saving ? "Salvando…" : "Salvar cadastro"}
                </button>
              </>
            )}
          </div>
        </header>

        <section className="crm-kpis">
          <article className="crm-kpi">
            <div>
              <span className="crm-kpi-label">Clientes ativos</span>
              <div className="crm-kpi-value">{computedStats.total}</div>
              <p className="crm-kpi-meta">Carteira cadastrada na loja</p>
            </div>
            <div className="crm-kpi-icon">◎</div>
          </article>
          <article className="crm-kpi">
            <div>
              <span className="crm-kpi-label">Com e-mail / clube</span>
              <div className="crm-kpi-value">{computedStats.withEmail}</div>
              <p className="crm-kpi-meta">
                {computedStats.total
                  ? `${((computedStats.withEmail / computedStats.total) * 100).toFixed(0)}% da carteira`
                  : "Sem base ainda"}
              </p>
            </div>
            <div className="crm-kpi-icon">★</div>
          </article>
          <article className="crm-kpi">
            <div>
              <span className="crm-kpi-label">Ticket médio</span>
              <div className="crm-kpi-value">
                {formatBrl(computedStats.avgTicket)}
              </div>
              <p className="crm-kpi-meta">Média por fatura emitida</p>
            </div>
            <div className="crm-kpi-icon">$</div>
          </article>
          <article className="crm-kpi">
            <div>
              <span className="crm-kpi-label">LTV médio</span>
              <div className="crm-kpi-value">{formatBrl(computedStats.ltv)}</div>
              <p className="crm-kpi-meta">
                {computedStats.overdue} cliente(s) em atraso
              </p>
            </div>
            <div className="crm-kpi-icon">◈</div>
          </article>
        </section>

        {view === "list" ? (
          <>
            <div className="crm-toolbar">
              <div className="crm-search">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por CPF, nome, telefone ou e-mail…"
                />
              </div>
              <span style={{ fontSize: "0.8rem", color: "#897173" }}>
                {filtered.length} resultado(s)
              </span>
            </div>

            <div className="crm-table-wrap">
              {filtered.length === 0 ? (
                <div className="crm-empty">
                  Nenhum cliente encontrado. Cadastre o primeiro para abrir
                  atendimento no PDV.
                </div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Contato</th>
                      <th>Situação</th>
                      <th>Dívida</th>
                      <th style={{ textAlign: "right" }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="crm-name">{c.fullName}</div>
                          <div className="crm-meta">
                            CPF {maskCpf(c.documentCpf)}
                          </div>
                        </td>
                        <td>
                          <div>{c.phone ?? "Sem telefone"}</div>
                          <div className="crm-meta">{c.email ?? "Sem e-mail"}</div>
                        </td>
                        <td>
                          {c.overdueDebt > 0 ? (
                            <span className="crm-pill crm-pill--danger">
                              Em atraso
                            </span>
                          ) : c.totalDebt > 0 ? (
                            <span className="crm-pill crm-pill--warn">
                              Parcelas abertas
                            </span>
                          ) : (
                            <span className="crm-pill">Em dia</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`crm-debt ${
                              c.totalDebt > 0 ? "is-bad" : ""
                            }`}
                          >
                            {formatBrl(c.totalDebt)}
                          </span>
                          {c.pendingCount > 0 && (
                            <div className="crm-meta">
                              {c.pendingCount} parcela(s)
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Link
                            href={`/customers/${c.id}`}
                            className="crm-link"
                          >
                            Ver histórico
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <form
            id="crm-create-form"
            className="crm-page"
            style={{ gap: "1rem", paddingBottom: 0 }}
            onSubmit={(e) => void onSubmit(e)}
          >
            <section className="crm-section">
              <div className="crm-section-head">
                <div className="crm-section-letter">A</div>
                <div>
                  <h2>Dados pessoais & fiscais (NF-e)</h2>
                  <p>
                    Identificação do titular, documentação e canais de contato
                    preferenciais.
                  </p>
                </div>
              </div>
              <div className="crm-form-grid">
                <label className="crm-field crm-field--full">
                  Nome completo
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </label>
                <label className="crm-field">
                  CPF fiscal
                  <input
                    value={documentCpf}
                    onChange={(e) =>
                      setDocumentCpf(
                        e.target.value.replace(/\D/g, "").slice(0, 11)
                      )
                    }
                    inputMode="numeric"
                    placeholder="Somente números"
                  />
                </label>
                <label className="crm-field">
                  WhatsApp / celular
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    placeholder="Com DDD"
                  />
                </label>
                <label className="crm-field">
                  E-mail principal (NF-e & clube)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </label>
                <label className="crm-field">
                  Telefone secundário
                  <input
                    value={secondaryPhone}
                    onChange={(e) => setSecondaryPhone(e.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <label className="crm-check crm-field--full">
                  <input
                    type="checkbox"
                    checked={whatsappOptIn}
                    onChange={(e) => setWhatsappOptIn(e.target.checked)}
                  />
                  <span>
                    Receber convites de lançamentos e notificações de lote
                    reservado via WhatsApp (preferência da loja).
                  </span>
                </label>
              </div>
            </section>

            <section className="crm-section">
              <div className="crm-section-head">
                <div className="crm-section-letter">B</div>
                <div>
                  <h2>Endereço principal & entrega</h2>
                  <p>
                    Localização para entregas ou retirada — opcional no
                    cadastro inicial.
                  </p>
                </div>
              </div>
              <label className="crm-check">
                <input
                  type="checkbox"
                  checked={includeAddress}
                  onChange={(e) => setIncludeAddress(e.target.checked)}
                />
                <span>Incluir endereço residencial agora</span>
              </label>
              {includeAddress && (
                <div className="crm-form-grid">
                  <label className="crm-field">
                    CEP
                    <input
                      value={address.zipCode}
                      onChange={(e) =>
                        setAddress((a) => ({
                          ...a,
                          zipCode: e.target.value.replace(/\D/g, "").slice(0, 8),
                        }))
                      }
                      required={includeAddress}
                      inputMode="numeric"
                    />
                  </label>
                  <label className="crm-field">
                    UF
                    <input
                      value={address.state}
                      onChange={(e) =>
                        setAddress((a) => ({
                          ...a,
                          state: e.target.value
                            .replace(/[^a-zA-Z]/g, "")
                            .slice(0, 2)
                            .toUpperCase(),
                        }))
                      }
                      required={includeAddress}
                      maxLength={2}
                    />
                  </label>
                  <label className="crm-field crm-field--full">
                    Rua / logradouro
                    <input
                      value={address.street}
                      onChange={(e) =>
                        setAddress((a) => ({ ...a, street: e.target.value }))
                      }
                      required={includeAddress}
                    />
                  </label>
                  <label className="crm-field">
                    Número
                    <input
                      value={address.number}
                      onChange={(e) =>
                        setAddress((a) => ({ ...a, number: e.target.value }))
                      }
                      required={includeAddress}
                    />
                  </label>
                  <label className="crm-field">
                    Complemento
                    <input
                      value={address.complement}
                      onChange={(e) =>
                        setAddress((a) => ({
                          ...a,
                          complement: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="crm-field">
                    Bairro
                    <input
                      value={address.neighborhood}
                      onChange={(e) =>
                        setAddress((a) => ({
                          ...a,
                          neighborhood: e.target.value,
                        }))
                      }
                      required={includeAddress}
                    />
                  </label>
                  <label className="crm-field">
                    Cidade
                    <input
                      value={address.city}
                      onChange={(e) =>
                        setAddress((a) => ({ ...a, city: e.target.value }))
                      }
                      required={includeAddress}
                    />
                  </label>
                </div>
              )}
            </section>

            <div className="crm-footer">
              <label className="crm-check" style={{ maxWidth: "28rem" }}>
                <input
                  type="checkbox"
                  checked={lgpd}
                  onChange={(e) => setLgpd(e.target.checked)}
                />
                <span>
                  O cliente autorizou o tratamento dos dados para emissão de
                  NF-e, cobrança e atendimento, em conformidade com a LGPD.
                </span>
              </label>
              <div className="crm-footer-actions">
                <button
                  type="button"
                  className="inv-btn"
                  onClick={() => setView("list")}
                >
                  Cancelar / voltar
                </button>
                <button
                  type="submit"
                  className="inv-btn"
                  disabled={saving}
                >
                  Salvar cadastro
                </button>
                <button
                  type="button"
                  className="inv-btn inv-btn--primary"
                  disabled={saving}
                  onClick={() => void saveCustomer(true)}
                >
                  Concluir & abrir PDV
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {error && <div className="crm-toast">{error}</div>}
      {msg && <div className="crm-toast crm-toast--ok">{msg}</div>}
    </AdminShell>
  );
}
