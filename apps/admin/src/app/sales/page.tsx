"use client";

import "@/styles/pdv.css";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AdminShell,
  apiFetch,
  mediaUrl,
  useAuthSession,
} from "@/components/admin-shell";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { receiptPath } from "@/components/sale-receipt";

type Customer = {
  id: string;
  fullName: string;
  phone: string | null;
  documentCpf: string | null;
  totalDebt?: number;
};

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
  cost?: string | number;
  effectivePrice?: number;
  listPrice?: number;
  onSale?: boolean;
  isActive?: boolean;
  availableStock: number;
  batches: Batch[];
  kitItems?: Array<{
    componentProductId: string;
    componentName: string;
    quantity: number;
  }>;
};

type KitComponentLine = {
  batchId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type CartLine = {
  lineId: string;
  kind: "simple" | "kit";
  batchId: string;
  productId: string;
  productName: string;
  sku: string | null;
  unitPrice: number;
  cost: number;
  listPrice: number;
  onSale: boolean;
  quantity: number;
  maxQty: number;
  /** Quantidade que já estava nesta venda. 0 se o item foi incluído agora. */
  originQty: number;
  components?: KitComponentLine[];
};

type QueueOrder = {
  id: string;
  publicCode: string;
  status: string;
  channel: string;
  customerName: string | null;
  totalAmount: string;
  createdAt: string;
  fulfillmentType: string;
};

type PayMethod = "pix" | "credit" | "debit" | "cash";
type MainTab = "catalog" | "queue";
type CatalogFilter = "all" | "stock" | "sale";

function pickFifoBatch(batches: Batch[]): Batch | null {
  const available = batches
    .filter((b) => b.quantity - b.reservedQuantity > 0)
    .sort(
      (a, b) =>
        new Date(a.expirationDate).getTime() -
        new Date(b.expirationDate).getTime()
    );
  return available[0] ?? null;
}

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isoInDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dueLabel(iso: string, extraDays: number) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d + extraDays)).toLocaleDateString(
    "pt-BR",
    { timeZone: "UTC" }
  );
}

function maskCpf(cpf: string | null | undefined) {
  if (!cpf) return null;
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_seller: "Aguardando você",
  pending_payment: "Aguardando PIX",
};

export default function SalesPage() {
  const { token, ready } = useAuthSession();
  const [tab, setTab] = useState<MainTab>("catalog");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [walletBalance, setWalletBalance] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [scanFlash, setScanFlash] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>("pix");
  const [installments, setInstallments] = useState("1");
  const [payNow, setPayNow] = useState(true);
  const [sellAtCost, setSellAtCost] = useState(false);
  const [firstDueDate, setFirstDueDate] = useState("");
  const [useWalletAmount, setUseWalletAmount] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const editLoaded = useRef<string | null>(null);
  const productsRef = useRef(products);
  productsRef.current = products;
  const barcodeRef = useRef<HTMLInputElement>(null);

  function linePrice(line: CartLine) {
    return sellAtCost ? line.cost : line.unitPrice;
  }

  const total = useMemo(
    () => cart.reduce((s, line) => s + linePrice(line) * line.quantity, 0),
    [cart, sellAtCost]
  );
  const itemCount = useMemo(
    () => cart.reduce((s, line) => s + line.quantity, 0),
    [cart]
  );
  const stockUnits = useMemo(
    () => products.reduce((s, p) => s + (p.availableStock ?? 0), 0),
    [products]
  );
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const filteredProducts = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (p.isActive === false) return false;
      if (filter === "stock" && (p.availableStock ?? 0) <= 0) return false;
      if (filter === "sale" && !p.onSale) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").includes(q)
      );
    });
  }, [products, catalogQuery, filter]);

  const loadCatalog = useCallback(async (t: string) => {
    const data = (await apiFetch("/v1/products", t)) as Product[];
    setProducts(data);
    setCatalogReady(true);
  }, []);

  const loadCustomers = useCallback(async (t: string) => {
    const data = await apiFetch("/v1/customers", t);
    const list = (Array.isArray(data) ? data : data.items) as Customer[];
    setCustomers(list);
    setCustomerId((prev) => prev || list[0]?.id || "");
  }, []);

  const loadQueue = useCallback(async (t: string) => {
    const [awaiting, pending] = await Promise.all([
      apiFetch("/v1/orders?status=awaiting_seller", t),
      apiFetch("/v1/orders?status=pending_payment", t),
    ]);
    const merged = [...(awaiting as QueueOrder[]), ...(pending as QueueOrder[])].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    setQueue(merged);
  }, []);

  const loadWallet = useCallback(async (t: string, cid: string) => {
    if (!cid) {
      setWalletBalance(0);
      return;
    }
    const data = await apiFetch(`/v1/finance/wallet/${cid}/balance`, t);
    setWalletBalance(Number(data.balance ?? 0));
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    const invoice = new URLSearchParams(window.location.search).get("invoice");
    if (invoice) setEditInvoiceId(invoice);
    Promise.all([
      loadCatalog(token),
      loadCustomers(token),
      loadQueue(token),
    ]).catch((e: Error) => setError(e.message));
  }, [ready, token, loadCatalog, loadCustomers, loadQueue]);

  useEffect(() => {
    if (!token || !editInvoiceId || !catalogReady) return;
    if (editLoaded.current === editInvoiceId) return;
    let cancelled = false;
    apiFetch(`/v1/finance/invoices/${editInvoiceId}`, token)
      .then((data) => {
        if (cancelled) return;
        editLoaded.current = editInvoiceId;
        const invoice = data as {
          customerId: string;
          items: Array<{
            id: string;
            productId: string | null;
            productName: string;
            quantity: number;
            unitPrice: number;
          }>;
        };
        setCustomerId(invoice.customerId);
        setSellAtCost(false);
        setCart(
          invoice.items
            .filter((item) => item.productId)
            .map((item) => {
              const product = productsRef.current.find(
                (entry) => entry.id === item.productId
              );
              const available = product?.availableStock ?? 0;
              return {
                lineId: `edit:${item.id}`,
                kind: "simple" as const,
                batchId: `edit:${item.id}`,
                productId: item.productId as string,
                productName: item.productName,
                sku: product?.sku ?? null,
                unitPrice: item.unitPrice,
                cost: Number(product?.cost) || item.unitPrice,
                listPrice: product?.listPrice ?? item.unitPrice,
                onSale: false,
                quantity: item.quantity,
                maxQty: item.quantity + available,
                originQty: item.quantity,
              };
            })
        );
      })
      .catch((err: Error) => {
        editLoaded.current = null;
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, editInvoiceId, catalogReady]);

  useEffect(() => {
    if (!token || !customerId) return;
    loadWallet(token, customerId).catch(() => setWalletBalance(0));
  }, [token, customerId, loadWallet]);

  useEffect(() => {
    if (tab === "catalog") barcodeRef.current?.focus();
  }, [ready, cart.length, tab]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        setTab("catalog");
        barcodeRef.current?.focus();
        barcodeRef.current?.select();
      }
      if (e.key === "F9") {
        e.preventDefault();
        setPayMethod("pix");
        setPayNow(true);
        setInstallments("1");
      }
      if (e.key === "F10") {
        e.preventDefault();
        const form = document.getElementById("pdv-sale-form") as HTMLFormElement | null;
        form?.requestSubmit();
      }
      if (e.key === "Escape" && cart.length > 0) {
        // don't wipe accidentally — only blur
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length]);

  useEffect(() => {
    if (payMethod === "credit") {
      setPayNow(false);
      if (Number(installments) < 2) setInstallments("2");
      setFirstDueDate((prev) => prev || isoInDays(30));
    } else {
      setPayNow(true);
      setInstallments("1");
    }
  }, [payMethod]);

  async function addKitToCart(product: Product, nextKitQty: number) {
    if (!token) return;
    if (nextKitQty <= 0) {
      setCart((prev) => prev.filter((l) => l.productId !== product.id || l.kind !== "kit"));
      return;
    }
    try {
      const allocation = (await apiFetch(
        `/v1/products/${product.id}/allocate-kit`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ quantity: nextKitQty }),
        }
      )) as {
        unitPrice: number;
        availableKits: number;
        kitName: string;
        components: KitComponentLine[];
      };
      setError(null);
      setCart((prev) => {
        const idx = prev.findIndex(
          (l) => l.kind === "kit" && l.productId === product.id
        );
        const line: CartLine = {
          lineId: `kit:${product.id}`,
          kind: "kit",
          batchId: `kit:${product.id}`,
          productId: product.id,
          productName: allocation.kitName || product.name,
          sku: product.sku,
          unitPrice: allocation.unitPrice,
          cost: Number(product.cost) || allocation.unitPrice,
          listPrice: product.listPrice ?? Number(product.price),
          onSale: Boolean(product.onSale),
          quantity: nextKitQty,
          maxQty: allocation.availableKits,
          originQty: 0,
          components: allocation.components,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = line;
          return next;
        }
        return [...prev, line];
      });
      setScanFlash(true);
      setTimeout(() => setScanFlash(false), 450);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function addProductToCart(product: Product) {
    if (product.kind === "kit") {
      const existing = cart.find(
        (l) => l.kind === "kit" && l.productId === product.id
      );
      const nextQty = (existing?.quantity ?? 0) + 1;
      const maxQty = existing?.maxQty ?? product.availableStock;
      if (nextQty > maxQty) {
        setError("Quantidade máxima de kits atingida");
        return;
      }
      void addKitToCart(product, nextQty);
      return;
    }
    if (editInvoiceId) {
      const origin = cart.find(
        (line) =>
          line.originQty > 0 &&
          line.kind === "simple" &&
          line.productId === product.id
      );
      if (origin && origin.quantity < origin.maxQty) {
        setError(null);
        setCart((prev) =>
          prev.map((line) =>
            line.lineId === origin.lineId
              ? { ...line, quantity: line.quantity + 1 }
              : line
          )
        );
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 450);
        return;
      }
    }
    const batch = pickFifoBatch(product.batches ?? []);
    if (!batch) {
      setError(`Sem estoque para ${product.name}`);
      return;
    }
    const maxQty = batch.quantity - batch.reservedQuantity;
    if (maxQty <= 0) {
      setError("Sem estoque disponível neste lote");
      return;
    }
    setError(null);
    const unitPrice = product.effectivePrice ?? Number(product.price);
    const listPrice = product.listPrice ?? Number(product.price);
    setCart((prev) => {
      const idx = prev.findIndex(
        (l) => l.kind !== "kit" && l.batchId === batch.id
      );
      if (idx >= 0) {
        const next = [...prev];
        const line = next[idx];
        next[idx] = {
          ...line,
          quantity: Math.min(line.quantity + 1, line.maxQty),
        };
        return next;
      }
      return [
        ...prev,
        {
          lineId: batch.id,
          kind: "simple" as const,
          batchId: batch.id,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          unitPrice,
          cost: Number(product.cost) || unitPrice,
          listPrice,
          onSale: Boolean(product.onSale),
          quantity: 1,
          maxQty,
          originQty: 0,
        },
      ];
    });
    setScanFlash(true);
    setTimeout(() => setScanFlash(false), 450);
  }

  async function lookupBarcode(code: string) {
    if (!token || !code.trim()) return;
    setError(null);
    try {
      const product = (await apiFetch(
        `/v1/products/by-barcode/${encodeURIComponent(code.trim())}`,
        token
      )) as Product;
      if (product.isActive === false) {
        setError("Produto inativo");
        return;
      }
      addProductToCart(product);
      setBarcode("");
    } catch (err) {
      // fallback: search local catalog by sku/barcode/name exact-ish
      const q = code.trim().toLowerCase();
      const local = products.find(
        (p) =>
          p.barcode === code.trim() ||
          (p.sku ?? "").toLowerCase() === q ||
          p.name.toLowerCase() === q
      );
      if (local) {
        addProductToCart(local);
        setBarcode("");
        return;
      }
      setError((err as Error).message);
    }
  }

  function onBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void lookupBarcode(barcode);
    }
  }

  function updateQty(lineId: string, delta: number) {
    const line = cart.find((l) => l.lineId === lineId || l.batchId === lineId);
    if (!line) return;
    const nextQty = Math.max(0, Math.min(line.maxQty, line.quantity + delta));
    if (line.kind === "kit") {
      const product = products.find((p) => p.id === line.productId);
      if (!product) {
        setError("Kit não encontrado no catálogo — atualize o estoque");
        return;
      }
      void addKitToCart(product, nextQty);
      return;
    }
    setCart((prev) =>
      prev
        .map((l) =>
          l.lineId === line.lineId
            ? {
                ...l,
                quantity: nextQty,
              }
            : l
        )
        .filter((l) => l.quantity > 0)
    );
  }

  function removeLine(lineId: string) {
    setCart((prev) =>
      prev.filter((l) => l.lineId !== lineId && l.batchId !== lineId)
    );
  }

  function clearSale() {
    setCart([]);
    setSellAtCost(false);
    setUseWalletAmount("0");
    setBarcode("");
    setError(null);
    setMsg(null);
    barcodeRef.current?.focus();
  }

  async function refreshStock() {
    if (!token) return;
    setError(null);
    try {
      await Promise.all([loadCatalog(token), loadQueue(token)]);
      setMsg("Estoque e fila sincronizados");
      setTimeout(() => setMsg(null), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitSale(e: FormEvent) {
    e.preventDefault();
    if (!token || cart.length === 0) return;
    if (!customerId) {
      setError("Selecione um cliente para finalizar a venda");
      return;
    }
    if (payMethod === "credit" && !firstDueDate) {
      setError("Informe o vencimento da primeira parcela");
      return;
    }
    setSubmitting(true);
    setError(null);
    setMsg(null);
    try {
      const wallet = payNow ? Number(useWalletAmount) || 0 : 0;
      const items = cart.flatMap((l): Array<{
        batchId?: string;
        productId?: string;
        quantity: number;
        unitPrice: number;
        productName: string;
      }> => {
            if (editInvoiceId && l.originQty > 0 && l.kind !== "kit") {
              return [
                {
                  productId: l.productId,
                  quantity: l.quantity,
                  unitPrice: linePrice(l),
                  productName: l.productName,
                },
              ];
            }
            if (l.kind === "kit" && l.components?.length) {
              const target = Number((linePrice(l) * l.quantity).toFixed(2));
              const base = l.components.reduce((s, c) => s + c.lineTotal, 0);
              let allocated = 0;
              return l.components.map((c, index) => {
                const isLast = index === l.components!.length - 1;
                const lineTotal =
                  !sellAtCost || base <= 0
                    ? c.lineTotal
                    : isLast
                      ? Number((target - allocated).toFixed(2))
                      : Number((c.lineTotal * (target / base)).toFixed(2));
                allocated += lineTotal;
                return {
                  batchId: c.batchId,
                  quantity: c.quantity,
                  unitPrice: Number((lineTotal / c.quantity).toFixed(4)),
                  productName: c.productName,
                };
              });
            }
            return [
              {
                batchId: l.batchId,
                quantity: l.quantity,
                unitPrice: linePrice(l),
                productName: l.productName,
              },
            ];
          });
      const result = await apiFetch(
        editInvoiceId
          ? `/v1/finance/sales/${editInvoiceId}`
          : "/v1/finance/sales",
        token,
        {
          method: editInvoiceId ? "PATCH" : "POST",
          body: JSON.stringify({
          customerId,
          items,
          installments: Number(installments) || 1,
          firstDueDate: payMethod === "credit" ? firstDueDate : undefined,
          payNow,
          useWalletAmount: wallet,
        }),
      });
      setMsg(
        `${editInvoiceId ? "Venda atualizada" : "Venda registrada"} · ${formatBrl(Number(result.totalAmount))}` +
          (result.paidNow > 0
            ? ` · recebido ${formatBrl(Number(result.paidNow))}`
            : "")
      );
      setLastInvoiceId(result.invoiceId as string);
      setCart([]);
      setSellAtCost(false);
      if (editInvoiceId) {
        setEditInvoiceId(null);
        editLoaded.current = null;
        window.history.replaceState(null, "", "/sales");
      }
      setBarcode("");
      setUseWalletAmount("0");
      await Promise.all([
        loadCatalog(token),
        loadWallet(token, customerId),
        loadQueue(token),
      ]);
      barcodeRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminShell variant="pos">
      <div className="pdv-layout">
        <section className="pdv-panel">
          <div className="pdv-panel-head">
            <div className="pdv-tabs">
              <button
                type="button"
                className={`pdv-tab ${tab === "catalog" ? "active" : ""}`}
                onClick={() => setTab("catalog")}
              >
                Balcão & venda rápida
              </button>
              <button
                type="button"
                className={`pdv-tab ${tab === "queue" ? "active" : ""}`}
                onClick={() => setTab("queue")}
              >
                Fila e-commerce
                {queue.length > 0 && (
                  <span className="pdv-tab-badge">{queue.length}</span>
                )}
              </button>
            </div>
            <div className="pdv-metrics">
              <span>
                Estoque local: <strong>{stockUnits} un</strong>
              </span>
              <span>·</span>
              <span>Leitor ativo</span>
              <button
                type="button"
                className="pdv-btn-ghost"
                onClick={() => void refreshStock()}
              >
                Sincronizar
              </button>
            </div>
          </div>

          {tab === "catalog" ? (
            <>
              <div className="pdv-controls">
                <div className="pdv-scan-row">
                  <div className="pdv-scan-wrap">
                    <input
                      ref={barcodeRef}
                      value={barcode}
                      onChange={(e) =>
                        setBarcode(e.target.value.replace(/\s/g, ""))
                      }
                      onKeyDown={onBarcodeKeyDown}
                      placeholder="Bipe EAN, digite SKU ou código…"
                      className={scanFlash ? "flash" : ""}
                      autoComplete="off"
                      inputMode="numeric"
                    />
                    <span className="pdv-scan-hint">Enter · F2</span>
                  </div>
                  <button
                    type="button"
                    className="pdv-scan-cam"
                    onClick={() => setScannerOpen(true)}
                  >
                    Câmera
                  </button>
                  <input
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Filtrar por nome…"
                    style={{
                      width: "min(14rem, 40%)",
                      height: "2.6rem",
                      padding: "0 0.75rem",
                      border: "1px solid rgba(220, 192, 193, 0.55)",
                      borderRadius: "0.5rem",
                      background: "#fdf8f6",
                      font: "inherit",
                    }}
                  />
                </div>
                <div className="pdv-chips">
                  <button
                    type="button"
                    className={`pdv-chip ${filter === "all" ? "active" : ""}`}
                    onClick={() => setFilter("all")}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    className={`pdv-chip pdv-chip--stock ${
                      filter === "stock" ? "active" : ""
                    }`}
                    onClick={() => setFilter("stock")}
                  >
                    Em estoque
                  </button>
                  <button
                    type="button"
                    className={`pdv-chip pdv-chip--sale ${
                      filter === "sale" ? "active" : ""
                    }`}
                    onClick={() => setFilter("sale")}
                  >
                    Em promoção
                  </button>
                </div>
              </div>

              <div className="pdv-catalog">
                {filteredProducts.length === 0 ? (
                  <div className="pdv-empty">
                    Nenhum produto encontrado. Cadastre itens em Produtos.
                  </div>
                ) : (
                  <div className="pdv-grid">
                    {filteredProducts.map((product) => {
                      const price =
                        product.effectivePrice ?? Number(product.price);
                      const list = product.listPrice ?? Number(product.price);
                      const img = mediaUrl(product.imageUrl);
                      const isKit = product.kind === "kit";
                      const out = (product.availableStock ?? 0) <= 0;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          className="pdv-product"
                          disabled={out}
                          onClick={() => addProductToCart(product)}
                        >
                          <div className="pdv-product-thumb">
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" />
                            ) : (
                              "◈"
                            )}
                            {product.onSale && (
                              <span className="pdv-sale-badge">Promo</span>
                            )}
                            {isKit && (
                              <span className="pdv-sale-badge" style={{ left: "auto", right: "0.4rem", top: "0.4rem", background: "#2d5a4a" }}>
                                Kit
                              </span>
                            )}
                            <span className="pdv-stock-badge">
                              {product.availableStock}{" "}
                              {isKit ? "kits" : "un"}
                            </span>
                          </div>
                          <div className="pdv-product-sku">
                            {isKit
                              ? "Kit virtual"
                              : product.sku
                                ? `SKU: ${product.sku}`
                                : product.barcode
                                  ? `EAN: ${product.barcode}`
                                  : "Sem SKU"}
                          </div>
                          <h3 className="pdv-product-name">{product.name}</h3>
                          <div className="pdv-product-foot">
                            <div>
                              <span className="pdv-product-price-label">
                                Preço balcão
                              </span>
                              <div className="pdv-product-price">
                                {product.onSale && list > price && (
                                  <s>{formatBrl(list)}</s>
                                )}
                                {formatBrl(price)}
                              </div>
                            </div>
                            <span className="pdv-add">+</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="pdv-queue">
              {queue.length === 0 ? (
                <div className="pdv-empty">
                  Nenhum pedido e-commerce aguardando ação.
                </div>
              ) : (
                queue.map((order) => (
                  <Link
                    key={order.id}
                    href="/orders"
                    className="pdv-queue-item"
                  >
                    <div className="pdv-queue-top">
                      <div>
                        <strong>#PED-{order.publicCode}</strong>
                        <div style={{ fontSize: "0.8rem", color: "#897173" }}>
                          {order.customerName ?? "Cliente"} ·{" "}
                          {order.fulfillmentType === "pickup"
                            ? "Retirada"
                            : "Entrega"}
                        </div>
                      </div>
                      <span
                        className={`pdv-status pdv-status--${order.status}`}
                      >
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.85rem",
                      }}
                    >
                      <span>
                        {new Date(order.createdAt).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      <strong>{formatBrl(Number(order.totalAmount))}</strong>
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </section>

        <aside className="pdv-panel pdv-cart">
          <div className="pdv-cart-title">
            <h2>{editInvoiceId ? "Editar venda" : "Cesta do PDV"}</h2>
            <span className="pdv-pill">
              {itemCount} {itemCount === 1 ? "item" : "itens"}
            </span>
          </div>

          <div className="pdv-customer">
            <span className="pdv-customer-label">Cliente fidelidade</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              disabled={Boolean(editInvoiceId)}
            >
              <option value="">Selecione o cliente</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </select>
            {editInvoiceId && (
              <div className="pdv-customer-meta">
                Inclua produtos, diminua a quantidade ou remova itens. O
                estoque e as parcelas em aberto são atualizados ao salvar.
              </div>
            )}
            {selectedCustomer && (
              <div className="pdv-customer-meta">
                {selectedCustomer.documentCpf && (
                  <span>CPF: {maskCpf(selectedCustomer.documentCpf)}</span>
                )}
                <span>
                  Carteira: <strong>{formatBrl(walletBalance)}</strong>
                </span>
                {(selectedCustomer.totalDebt ?? 0) > 0 && (
                  <span>
                    Dívida: {formatBrl(selectedCustomer.totalDebt ?? 0)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="pdv-lines">
            {cart.length === 0 ? (
              <div className="pdv-empty">
                Escaneie ou toque em um produto para montar a cesta.
              </div>
            ) : (
              cart.map((line) => (
                <div key={line.lineId} className="pdv-line">
                  <div>
                    <h3>
                      {line.productName}
                      {line.kind === "kit" ? " · Kit" : ""}
                    </h3>
                    <div className="pdv-line-meta">
                      {line.kind === "kit"
                        ? `${formatBrl(linePrice(line))} / kit`
                        : `${line.sku ? `SKU ${line.sku} · ` : ""}${sellAtCost ? "Custo" : "Unit."} ${formatBrl(linePrice(line))}`}
                      {!sellAtCost && line.onSale && line.listPrice > line.unitPrice
                        ? " · promo"
                        : ""}
                      {sellAtCost ? " · preço de custo" : ""}
                    </div>
                    {line.kind === "kit" && line.components && (
                      <div
                        className="pdv-line-meta"
                        style={{ marginTop: "0.25rem" }}
                      >
                        {line.components
                          .map((c) => c.productName.replace(/^.*·\s*/, ""))
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .join(" + ")}
                      </div>
                    )}
                    <div className="pdv-line-controls">
                      <div className="pdv-qty">
                        <button
                          type="button"
                          onClick={() => updateQty(line.lineId, -1)}
                        >
                          −
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          type="button"
                          disabled={line.quantity >= line.maxQty}
                          onClick={() => updateQty(line.lineId, 1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="pdv-line-remove"
                        onClick={() => removeLine(line.lineId)}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  <div className="pdv-line-total">
                    {formatBrl(linePrice(line) * line.quantity)}
                  </div>
                </div>
              ))
            )}
          </div>

          <form id="pdv-sale-form" className="pdv-footer" onSubmit={submitSale}>
            <div className="pdv-totals">
              <div className="pdv-totals-row">
                <span>Subtotal</span>
                <span>{formatBrl(total)}</span>
              </div>
              <div className="pdv-totals-row pdv-totals-grand">
                <span>Total a pagar</span>
                <span>{formatBrl(total)}</span>
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 800,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "#897173",
                  marginBottom: "0.4rem",
                }}
              >
                Forma de pagamento rápida
              </div>
              <div className="pdv-pay-methods">
                {(
                  [
                    ["pix", "PIX (F9)"],
                    ["credit", "Crédito"],
                    ["debit", "Débito"],
                    ["cash", "Dinheiro"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`pdv-pay-method ${
                      payMethod === id ? "active" : ""
                    }`}
                    onClick={() => setPayMethod(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pdv-pay-extra">
              {payMethod === "credit" && (
                <>
                  <label className="pdv-field">
                    Parcelas
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={installments}
                      onChange={(e) => setInstallments(e.target.value)}
                    />
                  </label>
                  <label className="pdv-field">
                    Vencimento da 1ª parcela
                    <input
                      type="date"
                      value={firstDueDate}
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      required
                    />
                  </label>
                  {firstDueDate && (
                    <p className="pdv-line-meta" style={{ margin: 0 }}>
                      {Array.from(
                        {
                          length: Math.min(
                            12,
                            Math.max(1, Number(installments) || 1)
                          ),
                        },
                        (_, i) =>
                          `${i + 1}ª ${dueLabel(firstDueDate, 30 * i)}`
                      ).join(" · ")}
                    </p>
                  )}
                </>
              )}
              <label className="pdv-field pdv-field--check">
                <input
                  type="checkbox"
                  checked={sellAtCost}
                  onChange={(e) => setSellAtCost(e.target.checked)}
                />
                Compra a preço de custo
              </label>
              <label className="pdv-field pdv-field--check">
                <input
                  type="checkbox"
                  checked={payNow}
                  onChange={(e) => setPayNow(e.target.checked)}
                />
                Receber agora
              </label>
              {payNow && walletBalance > 0 && (
                <label className="pdv-field">
                  Usar carteira (R$)
                  <input
                    type="number"
                    min={0}
                    max={walletBalance}
                    step="0.01"
                    value={useWalletAmount}
                    onChange={(e) => setUseWalletAmount(e.target.value)}
                  />
                </label>
              )}
            </div>

            <button
              type="submit"
              className="pdv-btn-primary"
              disabled={submitting || cart.length === 0 || !customerId}
            >
              {submitting
                ? "Registrando…"
                : editInvoiceId
                  ? `Salvar venda · ${formatBrl(total)}`
                  : `Finalizar venda (F10) · ${formatBrl(total)}`}
            </button>

            <div className="pdv-btn-row">
              <button
                type="button"
                className="pdv-btn-secondary"
                onClick={clearSale}
                disabled={cart.length === 0}
              >
                Cancelar venda
              </button>
              {lastInvoiceId ? (
                <Link
                  href={receiptPath(lastInvoiceId)}
                  target="_blank"
                  className="pdv-btn-secondary"
                  style={{
                    textAlign: "center",
                    textDecoration: "none",
                    lineHeight: "1.2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  Ver comprovante
                </Link>
              ) : (
                <button
                  type="button"
                  className="pdv-btn-secondary"
                  onClick={() => void refreshStock()}
                >
                  Atualizar estoque
                </button>
              )}
            </div>

            {lastInvoiceId && (
              <Link
                href={receiptPath(lastInvoiceId)}
                target="_blank"
                className="pdv-receipt-link"
              >
                Abrir comprovante da última venda →
              </Link>
            )}
          </form>
        </aside>
      </div>

      <div className="pdv-hotkeys">
        <span>
          F2 Busca · F9 PIX · F10 Finalizar · Enter bipe
        </span>
        <span>Terminal PDV · Atelier Prestige</span>
      </div>

      {error && <div className="pdv-toast pdv-toast--err">{error}</div>}
      {msg && <div className="pdv-toast pdv-toast--ok">{msg}</div>}
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
