"use client";

import "@/styles/inventory.css";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { PhotoField } from "@/components/photo-field";
import {
  AdminShell,
  apiFetch,
  apiUpload,
  mediaUrl,
  useAuthSession,
} from "@/components/admin-shell";

type Batch = {
  id: string;
  batchNumber: string | null;
  expirationDate: string;
  quantity: number;
  reservedQuantity: number;
};

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  kind?: "simple" | "kit";
  price: string;
  cost: string;
  salePrice?: string | null;
  salePriceUntil?: string | null;
  listPrice?: number;
  effectivePrice?: number;
  onSale?: boolean;
  availableStock: number;
  batches: Batch[];
  kitItems?: Array<{
    id?: string;
    componentProductId: string;
    componentName: string;
    quantity: number;
  }>;
};

type StatusFilter = "all" | "ok" | "expiring" | "low" | "out";
type ModalMode = null | "product" | "batch" | "edit" | "kit";

function toDateInputValue(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function promoEndIso(date: string) {
  if (!date) return null;
  return new Date(`${date}T23:59:59`).toISOString();
}

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function daysUntil(iso: string) {
  const end = new Date(iso);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.ceil((target.getTime() - start.getTime()) / 86400000);
}

function expiryStatus(days: number): "ok" | "warn" | "danger" {
  if (days < 30) return "danger";
  if (days < 90) return "warn";
  return "ok";
}

function nearestBatch(batches: Batch[] | undefined): Batch | null {
  if (!batches?.length) return null;
  return [...batches].sort(
    (a, b) =>
      new Date(a.expirationDate).getTime() -
      new Date(b.expirationDate).getTime()
  )[0];
}

export default function ProductsPage() {
  const { token, ready } = useAuthSession();
  const [items, setItems] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [modal, setModal] = useState<ModalMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // create product
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("10");
  const [cost, setCost] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [salePriceUntil, setSalePriceUntil] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  // batch
  const [selectedProduct, setSelectedProduct] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [quantity, setQuantity] = useState("10");

  // edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editSalePrice, setEditSalePrice] = useState("");
  const [editSalePriceUntil, setEditSalePriceUntil] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // kit
  const [kitName, setKitName] = useState("");
  const [kitPrice, setKitPrice] = useState("100");
  const [kitCost, setKitCost] = useState("");
  const [kitRows, setKitRows] = useState<
    Array<{ componentProductId: string; quantity: string }>
  >([{ componentProductId: "", quantity: "1" }]);
  const [editingKitId, setEditingKitId] = useState<string | null>(null);

  async function load(t: string) {
    const data = (await apiFetch("/v1/products", t)) as Product[];
    setItems(data);
    if (!selectedProduct && data[0]) setSelectedProduct(data[0].id);
  }

  useEffect(() => {
    if (!ready || !token) return;
    load(token).catch((e: Error) => setError(e.message));
  }, [ready, token]);

  const kpis = useMemo(() => {
    let alertLots = 0;
    let criticalProducts = 0;
    for (const p of items) {
      if (p.availableStock <= 2) criticalProducts += 1;
      for (const b of p.batches ?? []) {
        const d = daysUntil(b.expirationDate);
        if (d < 90) alertLots += 1;
      }
    }
    return {
      skus: items.length,
      alertLots,
      criticalProducts,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.barcode ?? "").includes(q) ||
          p.batches?.some((b) =>
            (b.batchNumber ?? "").toLowerCase().includes(q)
          );
        if (!hit) return false;
      }
      const batch = nearestBatch(p.batches);
      const days = batch ? daysUntil(batch.expirationDate) : null;
      if (status === "out" && p.availableStock > 0) return false;
      if (status === "low" && (p.availableStock === 0 || p.availableStock > 5))
        return false;
      if (status === "expiring") {
        if (days == null || days >= 90) return false;
      }
      if (status === "ok") {
        if (p.availableStock <= 5) return false;
        if (days != null && days < 90) return false;
      }
      return true;
    });
  }, [items, query, status]);

  function flash(ok: string) {
    setMsg(ok);
    setTimeout(() => setMsg(null), 2500);
  }

  function openKitModal(product?: Product) {
    setError(null);
    if (product && product.kind === "kit") {
      setEditingKitId(product.id);
      setKitName(product.name);
      setKitPrice(String(product.listPrice ?? Number(product.price)));
      setKitCost(String(Number(product.cost) || ""));
      setKitRows(
        product.kitItems?.length
          ? product.kitItems.map((i) => ({
              componentProductId: i.componentProductId,
              quantity: String(i.quantity),
            }))
          : [{ componentProductId: "", quantity: "1" }]
      );
      setImageUrl(product.imageUrl);
    } else {
      setEditingKitId(null);
      setKitName("");
      setKitPrice("100");
      setKitCost("");
      setKitRows([{ componentProductId: "", quantity: "1" }]);
      setImageUrl(null);
    }
    setModal("kit");
  }

  async function saveKit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    const components = kitRows
      .filter((r) => r.componentProductId)
      .map((r) => ({
        componentProductId: r.componentProductId,
        quantity: Number(r.quantity),
      }));
    if (components.length < 1) {
      setError("Inclua ao menos um componente no kit.");
      return;
    }
    if (components.some((c) => !c.quantity || c.quantity < 1)) {
      setError("Quantidade de cada componente deve ser ≥ 1.");
      return;
    }
    const priceNum = Number(kitPrice);
    const costNum = Number(kitCost);
    if (!kitName.trim() || Number.isNaN(priceNum) || priceNum <= 0) {
      setError("Informe nome e preço do kit.");
      return;
    }
    if (Number.isNaN(costNum) || costNum <= 0) {
      setError("Informe o custo do kit (maior que zero).");
      return;
    }
    try {
      if (editingKitId) {
        await apiFetch(`/v1/products/${editingKitId}`, token, {
          method: "PATCH",
          body: JSON.stringify({
            name: kitName.trim(),
            price: priceNum,
            cost: costNum,
            imageUrl: imageUrl || undefined,
          }),
        });
        await apiFetch(`/v1/products/${editingKitId}/kit-items`, token, {
          method: "PUT",
          body: JSON.stringify({ items: components }),
        });
        flash("Kit atualizado");
      } else {
        await apiFetch("/v1/products", token, {
          method: "POST",
          body: JSON.stringify({
            name: kitName.trim(),
            kind: "kit",
            price: priceNum,
            cost: costNum,
            imageUrl: imageUrl || undefined,
            kitItems: components,
          }),
        });
        flash("Kit cadastrado");
      }
      setModal(null);
      setEditingKitId(null);
      setImageUrl(null);
      await load(token);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openProductModal() {
    setModal("product");
    setError(null);
    setLookupMsg(null);
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }

  function openBatchModal(productId?: string) {
    if (productId) setSelectedProduct(productId);
    setModal("batch");
    setError(null);
  }

  function openEdit(product: Product) {
    setEditingId(product.id);
    setEditPrice(String(product.listPrice ?? Number(product.price)));
    setEditCost(String(Number(product.cost) || ""));
    setEditSalePrice(
      product.salePrice && Number(product.salePrice) > 0
        ? String(Number(product.salePrice))
        : ""
    );
    setEditSalePriceUntil(toDateInputValue(product.salePriceUntil));
    setModal("edit");
    setError(null);
  }

  function closeModal() {
    setModal(null);
    setEditingId(null);
    setEditingKitId(null);
  }

  async function onImageChange(file: File | null) {
    if (!file || !token) return;
    setUploading(true);
    setError(null);
    try {
      const data = await apiUpload("/v1/products/upload-image", token, file);
      setImageUrl(data.imageUrl as string);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function lookupBarcode(code: string) {
    if (!token || !code.trim()) return;
    setLookupMsg(null);
    try {
      const product = await apiFetch(
        `/v1/products/by-barcode/${encodeURIComponent(code.trim())}`,
        token
      );
      setLookupMsg(`Já cadastrado: ${product.name}`);
      setSelectedProduct(product.id);
    } catch {
      setLookupMsg("Código novo — preencha os dados e salve.");
      setSku((prev) => prev || code.trim());
    }
  }

  async function createProduct(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    const costNum = Number(cost);
    const priceNum = Number(price);
    if (!cost.trim() || Number.isNaN(costNum) || costNum <= 0) {
      setError("Informe o custo de compra (maior que zero).");
      return;
    }
    if (priceNum <= costNum) {
      setError("O preço de venda deve ser maior que o custo.");
      return;
    }
    const saleNum = salePrice.trim() ? Number(salePrice) : null;
    if (saleNum != null) {
      if (Number.isNaN(saleNum) || saleNum <= 0) {
        setError("Preço promocional inválido.");
        return;
      }
      if (saleNum >= priceNum) {
        setError("Preço promocional deve ser menor que o preço normal.");
        return;
      }
      if (saleNum <= costNum) {
        setError("Preço promocional deve ser maior que o custo.");
        return;
      }
    }
    try {
      await apiFetch("/v1/products", token, {
        method: "POST",
        body: JSON.stringify({
          name,
          sku: sku || undefined,
          barcode: barcode || undefined,
          imageUrl: imageUrl || undefined,
          price: priceNum,
          cost: costNum,
          salePrice: saleNum,
          salePriceUntil: saleNum ? promoEndIso(salePriceUntil) : null,
        }),
      });
      setName("");
      setSku("");
      setBarcode("");
      setCost("");
      setSalePrice("");
      setSalePriceUntil("");
      setImageUrl(null);
      setLookupMsg(null);
      closeModal();
      await load(token);
      flash("Produto cadastrado");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createBatch(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedProduct) return;
    setError(null);
    try {
      await apiFetch(`/v1/products/${selectedProduct}/batches`, token, {
        method: "POST",
        body: JSON.stringify({
          batchNumber: batchNumber || undefined,
          expirationDate,
          quantity: Number(quantity),
        }),
      });
      setBatchNumber("");
      setExpirationDate("");
      setQuantity("10");
      closeModal();
      await load(token);
      flash("Entrada de lote registrada");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!token || !editingId) return;
    const costNum = Number(editCost);
    const priceNum = Number(editPrice);
    if (!editCost.trim() || Number.isNaN(costNum) || costNum <= 0) {
      setError("Informe o custo de compra (maior que zero).");
      return;
    }
    if (Number.isNaN(priceNum) || priceNum <= costNum) {
      setError("O preço de venda deve ser maior que o custo.");
      return;
    }
    const saleNum = editSalePrice.trim() ? Number(editSalePrice) : null;
    if (saleNum != null) {
      if (Number.isNaN(saleNum) || saleNum <= 0) {
        setError("Preço promocional inválido.");
        return;
      }
      if (saleNum >= priceNum) {
        setError("Preço promocional deve ser menor que o preço normal.");
        return;
      }
      if (saleNum <= costNum) {
        setError("Preço promocional deve ser maior que o custo.");
        return;
      }
    }
    setSavingEdit(true);
    setError(null);
    try {
      await apiFetch(`/v1/products/${editingId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          price: priceNum,
          cost: costNum,
          salePrice: saleNum,
          salePriceUntil: saleNum ? promoEndIso(editSalePriceUntil) : null,
        }),
      });
      closeModal();
      await load(token);
      flash("Produto atualizado");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function refresh() {
    if (!token) return;
    try {
      await load(token);
      flash("Estoque sincronizado");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <AdminShell variant="atelier">
      <div className="inv-page">
        <div className="inv-header">
          <div>
            <div className="inv-crumb">
              Controle · <span>Estoque & lotes</span>
            </div>
            <h1>Inventário & rastreabilidade de lotes</h1>
          </div>
          <div className="inv-actions">
            <button type="button" className="inv-btn" onClick={() => void refresh()}>
              Sincronizar estoque
            </button>
            <button
              type="button"
              className="inv-btn"
              onClick={() => openBatchModal()}
            >
              Dar entrada em lote
            </button>
            <button
              type="button"
              className="inv-btn inv-btn--primary"
              onClick={openProductModal}
            >
              + Cadastrar produto
            </button>
            <button
              type="button"
              className="inv-btn"
              onClick={() => openKitModal()}
            >
              + Montar kit
            </button>
            <Link href="/sales" className="inv-btn inv-btn--primary">
              Novo pedido POS
            </Link>
          </div>
        </div>

        <div className="inv-kpis">
          <div className="inv-kpi">
            <div>
              <span className="inv-kpi-label">Total de SKUs ativos</span>
              <div className="inv-kpi-value">{kpis.skus}</div>
              <p className="inv-kpi-meta">Integrados ao PDV e à vitrine</p>
            </div>
            <div className="inv-kpi-icon">◈</div>
          </div>
          <div className="inv-kpi inv-kpi--warn">
            <div>
              <span className="inv-kpi-label">Lotes em alerta</span>
              <div className="inv-kpi-value">{kpis.alertLots}</div>
              <p className="inv-kpi-meta">Validade em menos de 90 dias</p>
            </div>
            <div className="inv-kpi-icon">!</div>
          </div>
          <div className="inv-kpi inv-kpi--danger">
            <div>
              <span className="inv-kpi-label">Ruptura / crítico</span>
              <div className="inv-kpi-value">{kpis.criticalProducts}</div>
              <p className="inv-kpi-meta">≤ 2 unidades disponíveis</p>
            </div>
            <div className="inv-kpi-icon">↓</div>
          </div>
        </div>

        <div className="inv-filters">
          <div className="inv-filters-row">
            <div className="inv-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar por nome, SKU, EAN ou lote…"
              />
            </div>
            <label className="inv-status-select">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
              >
                <option value="all">Todos os status</option>
                <option value="ok">Estoque normal</option>
                <option value="expiring">Validade &lt; 90 dias</option>
                <option value="low">Estoque baixo</option>
                <option value="out">Ruptura total</option>
              </select>
            </label>
          </div>
        </div>

        <div className="inv-table-wrap">
          {filtered.length === 0 ? (
            <div className="inv-empty">
              Nenhum produto encontrado. Cadastre o primeiro SKU para começar.
            </div>
          ) : (
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Lote & validade</th>
                  <th>Físico vs reservado</th>
                  <th>Custo / venda</th>
                  <th>Margem</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const isKit = p.kind === "kit";
                  const batches = p.batches ?? [];
                  const batch = nearestBatch(batches);
                  const days = batch ? daysUntil(batch.expirationDate) : null;
                  const exp = days == null ? null : expiryStatus(days);
                  const physical = isKit
                    ? p.availableStock
                    : batches.reduce(
                        (s, b) =>
                          s + Math.max(0, b.quantity - b.reservedQuantity),
                        0
                      );
                  const reserved = isKit
                    ? 0
                    : batches.reduce((s, b) => s + b.reservedQuantity, 0);
                  const totalUnits = Math.max(physical + reserved, 1);
                  const sale = p.effectivePrice ?? Number(p.price);
                  const list = p.listPrice ?? Number(p.price);
                  const costNum = Number(p.cost);
                  const marginPct =
                    sale > 0 ? ((sale - costNum) / sale) * 100 : 0;
                  const img = mediaUrl(p.imageUrl);
                  const stockClass =
                    physical <= 0 ? "is-out" : physical <= 5 ? "is-low" : "";

                  return (
                    <tr key={p.id}>
                      <td data-label="Produto">
                        <div className="inv-product-cell">
                          <div className="inv-thumb">
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" />
                            ) : (
                              "◈"
                            )}
                          </div>
                          <div>
                            <p className="inv-product-name">
                              {p.name}
                              {isKit ? (
                                <span className="inv-badge inv-badge--ok">
                                  {" "}
                                  Kit
                                </span>
                              ) : null}
                            </p>
                            <p className="inv-product-meta">
                              SKU {p.sku ?? "—"}
                              {p.barcode ? ` · EAN ${p.barcode}` : ""}
                              {p.onSale ? " · Promo ativa" : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td data-label="Lote">
                        {isKit ? (
                          <div className="inv-lot">
                            <span className="inv-product-meta">
                              Composição virtual
                            </span>
                            <ul className="inv-batches-list">
                              {(p.kitItems ?? []).map((i) => (
                                <li key={i.componentProductId}>
                                  {i.quantity}× {i.componentName}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : batch ? (
                          <div className="inv-lot">
                            <span className="inv-lot-num">
                              {batch.batchNumber ?? "Sem nº"}
                            </span>
                            <span
                              className={`inv-badge inv-badge--${
                                exp === "ok"
                                  ? "ok"
                                  : exp === "warn"
                                    ? "warn"
                                    : "danger"
                              }`}
                            >
                              {exp === "ok" && "Seguro"}
                              {exp === "warn" && `Atenção · ${days}d`}
                              {exp === "danger" &&
                                (days != null && days < 0
                                  ? "Vencido"
                                  : `Crítico · ${days}d`)}
                            </span>
                            <span className="inv-product-meta">
                              Vence {batch.expirationDate.slice(0, 10)}
                            </span>
                            {batches.length > 1 && (
                              <ul className="inv-batches-list">
                                {batches.slice(0, 3).map((b) => (
                                  <li key={b.id}>
                                    {b.batchNumber ?? "lote"} · {b.quantity} un ·{" "}
                                    {b.expirationDate.slice(0, 10)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          <span className="inv-product-meta">Sem lotes</span>
                        )}
                      </td>
                      <td data-label="Estoque">
                        <div className="inv-stock">
                          <div className="inv-stock-bar">
                            <div
                              className={`inv-stock-fill inv-stock-fill--free ${stockClass}`}
                              style={{
                                width: `${(physical / totalUnits) * 100}%`,
                              }}
                            />
                            <div
                              className="inv-stock-fill inv-stock-fill--res"
                              style={{
                                width: `${(reserved / totalUnits) * 100}%`,
                              }}
                            />
                          </div>
                          <div className="inv-stock-legend">
                            <span>{physical} un loja</span>
                            <span>{reserved} un resv</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Preço">
                        <div className="inv-prices">
                          <span>Custo {formatBrl(costNum)}</span>
                          {p.onSale && list > sale ? (
                            <>
                              <s>{formatBrl(list)}</s>
                              <strong>{formatBrl(sale)}</strong>
                            </>
                          ) : (
                            <strong>{formatBrl(sale)}</strong>
                          )}
                        </div>
                      </td>
                      <td data-label="Margem">
                        <span
                          className={`inv-margin ${
                            marginPct < 20 || costNum <= 0 ? "is-bad" : ""
                          }`}
                        >
                          {costNum > 0
                            ? `${marginPct >= 0 ? "+" : ""}${marginPct.toFixed(1)}%`
                            : "—"}
                        </span>
                      </td>
                      <td data-label="Ações">
                        <div className="inv-row-actions">
                          {isKit ? (
                            <button
                              type="button"
                              className="inv-link"
                              onClick={() => openKitModal(p)}
                            >
                              Editar kit
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="inv-link"
                                onClick={() => openEdit(p)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="inv-link"
                                onClick={() => openBatchModal(p.id)}
                              >
                                + Lote
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modal === "product" && (
        <div className="inv-overlay" onClick={closeModal}>
          <form
            className="inv-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={createProduct}
          >
            <h2>Cadastrar novo produto</h2>
            <div className="inv-field inv-field--full">
              Código de barras
              <div className="pdv-scan-row">
                <input
                  ref={barcodeRef}
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value.replace(/\s/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void lookupBarcode(barcode);
                    }
                  }}
                  placeholder="Escaneie ou digite e Enter"
                  autoComplete="off"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="inv-scan-cam"
                  onClick={() => setScannerOpen(true)}
                >
                  Câmera
                </button>
              </div>
              <span className="inv-hint">
                Leitor USB, digitação ou câmera do celular.
              </span>
            </div>
            {lookupMsg && <p className="inv-hint">{lookupMsg}</p>}
            <label className="inv-field inv-field--full">
              Nome
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <div className="inv-modal-grid">
              <label className="inv-field">
                SKU
                <input value={sku} onChange={(e) => setSku(e.target.value)} />
              </label>
              <div className="inv-field inv-field--full">
                <PhotoField
                  uploading={uploading}
                  previewUrl={mediaUrl(imageUrl)}
                  onFile={(file) => void onImageChange(file)}
                />
              </div>
              <label className="inv-field">
                Preço de venda *
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
              </label>
              <label className="inv-field">
                Custo de compra *
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  required
                />
              </label>
              <label className="inv-field">
                Preço promocional
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                />
              </label>
              <label className="inv-field">
                Promo até
                <input
                  type="date"
                  value={salePriceUntil}
                  onChange={(e) => setSalePriceUntil(e.target.value)}
                />
              </label>
            </div>
            {uploading && <p className="inv-hint">Enviando imagem…</p>}
            <div className="inv-modal-actions">
              <button type="button" className="inv-btn" onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" className="inv-btn inv-btn--primary">
                Criar produto
              </button>
            </div>
          </form>
        </div>
      )}

      {modal === "batch" && (
        <div className="inv-overlay" onClick={closeModal}>
          <form
            className="inv-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={createBatch}
          >
            <h2>Dar entrada em lote</h2>
            <label className="inv-field inv-field--full">
              Produto
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                required
              >
                <option value="">Selecione</option>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="inv-modal-grid">
              <label className="inv-field">
                Nº do lote
                <input
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                />
              </label>
              <label className="inv-field">
                Quantidade
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </label>
              <label className="inv-field inv-field--full">
                Validade
                <input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="inv-modal-actions">
              <button type="button" className="inv-btn" onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" className="inv-btn inv-btn--primary">
                Registrar entrada
              </button>
            </div>
          </form>
        </div>
      )}

      {modal === "edit" && (
        <div className="inv-overlay" onClick={closeModal}>
          <form
            className="inv-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveEdit}
          >
            <h2>Editar preço, custo e promoção</h2>
            <div className="inv-modal-grid">
              <label className="inv-field">
                Preço de venda
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  required
                />
              </label>
              <label className="inv-field">
                Custo de compra
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                  required
                />
              </label>
              <label className="inv-field">
                Preço promocional
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editSalePrice}
                  onChange={(e) => setEditSalePrice(e.target.value)}
                  placeholder="Sem promoção"
                />
              </label>
              <label className="inv-field">
                Promo até
                <input
                  type="date"
                  value={editSalePriceUntil}
                  onChange={(e) => setEditSalePriceUntil(e.target.value)}
                />
              </label>
            </div>
            <p className="inv-hint">
              Limpe o preço promocional para encerrar a promoção.
            </p>
            <div className="inv-modal-actions">
              <button type="button" className="inv-btn" onClick={closeModal}>
                Cancelar
              </button>
              <button
                type="submit"
                className="inv-btn inv-btn--primary"
                disabled={savingEdit}
              >
                {savingEdit ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {modal === "kit" && (
        <div className="inv-overlay" onClick={closeModal}>
          <form
            className="inv-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveKit}
          >
            <h2>{editingKitId ? "Editar kit" : "Montar kit virtual"}</h2>
            <p className="inv-product-meta">
              O estoque do kit é calculado pelos componentes (FIFO nos lotes).
            </p>
            <label className="inv-field inv-field--full">
              Nome do kit
              <input
                value={kitName}
                onChange={(e) => setKitName(e.target.value)}
                required
              />
            </label>
            <label className="inv-field">
              Preço de venda
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={kitPrice}
                onChange={(e) => setKitPrice(e.target.value)}
                required
              />
            </label>
            <label className="inv-field">
              Custo
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={kitCost}
                onChange={(e) => setKitCost(e.target.value)}
                required
              />
            </label>
            <div className="inv-field inv-field--full">
              <PhotoField
                uploading={uploading}
                previewUrl={mediaUrl(imageUrl)}
                onFile={(file) => void onImageChange(file)}
                label="Foto do kit"
              />
              {uploading && <span className="inv-hint">Enviando…</span>}
            </div>

            <div className="inv-field inv-field--full">
              <strong>Componentes</strong>
              {kitRows.map((row, idx) => (
                <div key={idx} className="inv-kit-row">
                  <select
                    value={row.componentProductId}
                    onChange={(e) =>
                      setKitRows((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? { ...r, componentProductId: e.target.value }
                            : r
                        )
                      )
                    }
                    required
                  >
                    <option value="">Produto…</option>
                    {items
                      .filter((p) => p.kind !== "kit")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={row.quantity}
                    onChange={(e) =>
                      setKitRows((prev) =>
                        prev.map((r, i) =>
                          i === idx ? { ...r, quantity: e.target.value } : r
                        )
                      )
                    }
                    required
                  />
                  <button
                    type="button"
                    className="inv-link"
                    onClick={() =>
                      setKitRows((prev) =>
                        prev.length <= 1
                          ? prev
                          : prev.filter((_, i) => i !== idx)
                      )
                    }
                  >
                    Remover
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="inv-link"
                style={{ marginTop: "0.75rem" }}
                onClick={() =>
                  setKitRows((prev) => [
                    ...prev,
                    { componentProductId: "", quantity: "1" },
                  ])
                }
              >
                + Componente
              </button>
            </div>

            <div className="inv-modal-actions">
              <button type="button" className="inv-btn" onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" className="inv-btn inv-btn--primary">
                {editingKitId ? "Salvar kit" : "Criar kit"}
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <div className="inv-toast">{error}</div>}
      {msg && <div className="inv-toast inv-toast--ok">{msg}</div>}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(code) => {
          setScannerOpen(false);
          setBarcode(code);
          void lookupBarcode(code);
        }}
      />
    </AdminShell>
  );
}
