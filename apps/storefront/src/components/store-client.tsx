"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerAuthMenu } from "@/components/customer-auth-menu";
import {
  buildFulfillmentPayload,
  FulfillmentLocationMenu,
  FulfillmentPanel,
  isFulfillmentValid,
  type StoreDeliveryConfig,
} from "@/components/fulfillment-panel";
import { loadCustomerSession, type CustomerSession } from "@/lib/customer-session";
import {
  loadGuestDelivery,
  saveGuestDelivery,
  type FulfillmentSelection,
  type ShippingQuote,
} from "@/lib/delivery";
import { fetchPublicOrder } from "@/lib/orders";
import {
  adjustCartLine,
  releaseAllCartLines,
  syncCartReservations,
} from "@/lib/cart-api";
import { storeHref, tenantDomain } from "@/lib/store-url";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type StoreConfig = StoreDeliveryConfig & {
  name: string;
  channelWhatsapp: boolean;
  channelOnlinePayment: boolean;
  hasWhatsApp: boolean;
};

type Batch = { id: string; available: number; expirationDate: string };
type Product = {
  id: string;
  name: string;
  price: string;
  listPrice?: number;
  originalPrice?: number | null;
  onSale?: boolean;
  imageUrl: string | null;
  availableStock: number;
  batches: Batch[];
};

type CartItem = {
  productId: string;
  productName: string;
  imageUrl: string | null;
  batchId: string;
  quantity: number;
  unitPrice: number;
  maxQty: number;
  reservedQuantity?: number;
};

type CheckoutStep = "cart" | "fulfillment" | "whatsapp" | "pix" | "pix_waiting";

function cartStorageKey(subdomain: string) {
  return `revendedor_cart_${subdomain}`;
}

function mediaUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${API}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function formatPrice(value: number | string) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function pickFifoBatch(batches: Batch[]): Batch | null {
  const available = batches
    .filter((b) => b.available > 0)
    .sort(
      (a, b) =>
        new Date(a.expirationDate).getTime() -
        new Date(b.expirationDate).getTime()
    );
  return available[0] ?? null;
}

const OLFACTORY_FAMILIES = [
  { id: "floral", label: "Floral", notes: "Lírio, Rosa, Jasmim", icon: "❀" },
  { id: "amadeirado", label: "Amadeirado", notes: "Cedro, Sândalo", icon: "🌲" },
  { id: "oriental", label: "Oriental", notes: "Âmbar, Especiarias", icon: "✦" },
  { id: "citrico", label: "Cítrico", notes: "Bergamota, Néroli", icon: "◎" },
  { id: "gourmand", label: "Gourmand", notes: "Tonka, Baunilha", icon: "◈" },
] as const;

const FAMILY_KEYWORDS: Record<string, string[]> = {
  floral: ["lily", "flor", "rose", "rosa", "jasm", "malbec"],
  amadeirado: ["malbec", "impression", "cedar", "sândalo", "sandalo", "wood"],
  oriental: ["oriental", "âmbar", "ambar", "vanilla", "baunilha"],
  citrico: ["cítr", "citr", "bergam", "limão", "limao", "neroli"],
  gourmand: ["gourmand", "café", "cafe", "pralin", "tonka", "doce"],
};

export function StoreClient({ subdomain }: { subdomain: string }) {
  const router = useRouter();
  const domain = tenantDomain(subdomain);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cartId, setCartId] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [step, setStep] = useState<CheckoutStep>("cart");
  const [cartOpen, setCartOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cartLineBusy, setCartLineBusy] = useState<string | null>(null);
  const cartSyncedRef = useRef(false);
  const [pixData, setPixData] = useState<{
    publicCode: string;
    pixCode: string | null;
    qrCodeBase64: string | null;
  } | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentSelection>({
    fulfillmentType: "delivery",
    delivery: {
      recipientName: "",
      phone: "",
      zipCode: "",
      street: "",
      number: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
    },
  });
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"featured" | "price-asc" | "price-desc">(
    "featured"
  );

  const storeName = config?.name ?? subdomain;
  const cartCount = items.reduce((s, i) => s + i.quantity, 0);

  const subtotal = useMemo(
    () => items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    [items]
  );

  const shippingAmount = useMemo(() => {
    if (fulfillment.fulfillmentType !== "delivery") return 0;
    if (shippingQuote?.freeDelivery) return 0;
    return shippingQuote?.amount ?? 0;
  }, [fulfillment.fulfillmentType, shippingQuote]);

  const total = subtotal + shippingAmount;

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = products;
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (familyFilter) {
      const keywords = FAMILY_KEYWORDS[familyFilter] ?? [familyFilter];
      list = list.filter((p) =>
        keywords.some((k) => p.name.toLowerCase().includes(k))
      );
    }
    if (sortBy === "price-asc") {
      list = [...list].sort((a, b) => Number(a.price) - Number(b.price));
    } else if (sortBy === "price-desc") {
      list = [...list].sort((a, b) => Number(b.price) - Number(a.price));
    }
    return list;
  }, [products, searchQuery, familyFilter, sortBy]);

  function scrollToVitrine() {
    document.getElementById("vitrine")?.scrollIntoView({ behavior: "smooth" });
  }

  function openPickup() {
    setFulfillment((prev) => ({ ...prev, fulfillmentType: "pickup" }));
    setCartOpen(true);
    setStep("fulfillment");
  }

  const handleCustomerSession = useCallback((session: CustomerSession | null) => {
    if (session) {
      setCustomerName(session.customer.fullName);
      setCustomerEmail(session.customer.email);
      setCustomerPhone(session.customer.phone ?? "");
      if (session.customer.documentCpf) {
        setCustomerCpf(session.customer.documentCpf);
      }
    }
  }, []);

  useEffect(() => {
    const id =
      localStorage.getItem(`revendedor_cartid_${subdomain}`) ??
      crypto.randomUUID();
    localStorage.setItem(`revendedor_cartid_${subdomain}`, id);
    setCartId(id);

    const saved = localStorage.getItem(cartStorageKey(subdomain));
    if (saved) {
      const parsed = JSON.parse(saved) as CartItem[];
      setItems(
        parsed.map((item) => ({
          ...item,
          maxQty: item.maxQty ?? item.quantity,
        }))
      );
    }

    const savedDelivery = loadGuestDelivery(subdomain);
    if (savedDelivery) setFulfillment(savedDelivery);

    fetch(`${API}/v1/store/config`, {
      headers: { "X-Tenant-Domain": domain },
    })
      .then((r) => r.json())
      .then((data) => setConfig(data as StoreConfig))
      .catch(() =>
        setConfig({
          name: subdomain,
          channelWhatsapp: true,
          channelOnlinePayment: false,
          hasWhatsApp: false,
          deliveryEnabled: true,
          pickupEnabled: true,
          freeDeliveryMinAmount: null,
          deliveryMessage: null,
          pickupAddress: null,
        })
      );

    fetch(`${API}/v1/products/public`, {
      headers: { "X-Tenant-Domain": domain },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Erro");
        setProducts(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        setProducts([]);
        setMessage(err.message);
      });
  }, [subdomain, domain]);

  useEffect(() => {
    if (!cartId) return;
    localStorage.setItem(cartStorageKey(subdomain), JSON.stringify(items));
  }, [items, subdomain, cartId]);

  useEffect(() => {
    if (products.length === 0) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.imageUrl) return item;
        const product = products.find((p) => p.id === item.productId);
        if (!product?.imageUrl) return item;
        changed = true;
        return { ...item, imageUrl: product.imageUrl };
      });
      return changed ? next : prev;
    });
  }, [products]);

  useEffect(() => {
    if (!cartId || cartSyncedRef.current) return;
    if (items.length === 0) {
      cartSyncedRef.current = true;
      return;
    }
    cartSyncedRef.current = true;

    void (async () => {
      const synced = await syncCartReservations(domain, cartId, items);
      if (synced.length < items.length) {
        setMessage("Alguns itens foram removidos por falta de estoque.");
      }
      setItems((prev) =>
        prev
          .filter((item) => synced.some((s) => s.batchId === item.batchId))
          .map((item) => {
            const match = synced.find((s) => s.batchId === item.batchId);
            return {
              ...item,
              reservedQuantity: match?.reservedQuantity ?? item.quantity,
            };
          })
      );
    })();
  }, [cartId, domain, items.length]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    document.body.style.overflow = cartOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [cartOpen]);

  async function addToCart(product: Product) {
    const batch = pickFifoBatch(product.batches);
    if (!batch) {
      setMessage("Produto sem estoque no momento.");
      return;
    }
    if (!cartId) return;

    const existing = items.find((i) => i.batchId === batch.id);
    const nextQty = (existing?.quantity ?? 0) + 1;
    const maxQty = existing?.maxQty ?? batch.available;

    if (nextQty > maxQty) {
      setMessage("Quantidade máxima disponível atingida.");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      await adjustCartLine(
        domain,
        cartId,
        batch.id,
        existing?.reservedQuantity ?? existing?.quantity ?? 0,
        nextQty
      );

      setItems((prev) => {
        if (existing) {
          return prev.map((i) =>
            i.batchId === batch.id
              ? { ...i, quantity: nextQty, reservedQuantity: nextQty }
              : i
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            productName: product.name,
            imageUrl: product.imageUrl,
            batchId: batch.id,
            quantity: 1,
            unitPrice: Number(product.price),
            maxQty: batch.available,
            reservedQuantity: 1,
          },
        ];
      });
      setCartOpen(true);
      setMessage(`${product.name} adicionado à sacola`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sem estoque");
    } finally {
      setLoading(false);
    }
  }

  async function changeCartQuantity(batchId: string, delta: number) {
    const item = items.find((i) => i.batchId === batchId);
    if (!item || !cartId) return;

    const nextQty = item.quantity + delta;
    if (nextQty <= 0) {
      await removeCartItem(batchId);
      return;
    }
    if (nextQty > item.maxQty) {
      setMessage("Quantidade máxima disponível atingida.");
      return;
    }

    setCartLineBusy(batchId);
    setMessage(null);
    try {
      await adjustCartLine(
        domain,
        cartId,
        batchId,
        item.reservedQuantity ?? item.quantity,
        nextQty
      );
      setItems((prev) =>
        prev.map((i) =>
          i.batchId === batchId
            ? { ...i, quantity: nextQty, reservedQuantity: nextQty }
            : i
        )
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao atualizar sacola");
    } finally {
      setCartLineBusy(null);
    }
  }

  async function removeCartItem(batchId: string) {
    const item = items.find((i) => i.batchId === batchId);
    if (!item || !cartId) return;

    setCartLineBusy(batchId);
    setMessage(null);
    try {
      await adjustCartLine(
        domain,
        cartId,
        batchId,
        item.reservedQuantity ?? item.quantity,
        0
      );
      setItems((prev) => prev.filter((i) => i.batchId !== batchId));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao remover item");
    } finally {
      setCartLineBusy(null);
    }
  }

  async function clearCart() {
    if (cartId && items.length > 0) {
      try {
        await releaseAllCartLines(domain, cartId, items);
      } catch {
        // Libera o que conseguir; estado local sempre zera
      }
    }
    setItems([]);
    setStep("cart");
    setPixData(null);
  }

  function closeCart() {
    if (step === "pix_waiting") return;
    setCartOpen(false);
    if (step !== "cart") setStep("cart");
  }

  useEffect(() => {
    if (!config) return;
    if (!config.deliveryEnabled && config.pickupEnabled) {
      setFulfillment({ fulfillmentType: "pickup" });
    } else if (config.deliveryEnabled && !config.pickupEnabled) {
      setFulfillment((prev) =>
        prev.fulfillmentType === "pickup"
          ? {
              fulfillmentType: "delivery",
              delivery: prev.delivery ?? {
                recipientName: "",
                phone: "",
                zipCode: "",
                street: "",
                number: "",
                complement: "",
                neighborhood: "",
                city: "",
                state: "",
              },
            }
          : prev
      );
    }
  }, [config]);

  useEffect(() => {
    saveGuestDelivery(subdomain, fulfillment);
  }, [fulfillment, subdomain]);

  function orderHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tenant-Domain": domain,
    };
    const token = loadCustomerSession(subdomain)?.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  useEffect(() => {
    if (fulfillment.fulfillmentType === "pickup") {
      setShippingQuote(null);
    }
  }, [fulfillment.fulfillmentType]);

  useEffect(() => {
    if (step !== "pix_waiting" || !pixData) return;

    let cancelled = false;
    const interval = setInterval(() => {
      void fetchPublicOrder(domain, pixData.publicCode)
        .then((order) => {
          if (cancelled) return;
          if (order.status === "confirmed") {
            setItems([]);
            setCartOpen(false);
            setPixData(null);
            setStep("cart");
            router.push(
              storeHref(subdomain, `/pedido/${pixData.publicCode}?paid=1`)
            );
          } else if (
            order.status === "cancelled" ||
            order.status === "expired"
          ) {
            setMessage("O pedido expirou ou foi cancelado.");
            setStep("cart");
            setPixData(null);
          }
        })
        .catch(() => undefined);
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, pixData, domain, router]);

  async function submitWhatsApp(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    if (!config || !isFulfillmentValid(fulfillment, config)) {
      setMessage("Informe como deseja receber o pedido.");
      setStep("fulfillment");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/v1/store/orders/whatsapp`, {
        method: "POST",
        headers: orderHeaders(),
        body: JSON.stringify({
          cartId,
          customerName,
          customerPhone,
          customerDocumentCpf: customerCpf.replace(/\D/g, ""),
          fulfillment: buildFulfillmentPayload(fulfillment),
          items: items.map((i) => ({
            batchId: i.batchId,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Falha ao criar pedido");
        return;
      }
      clearCart();
      setCartOpen(false);
      window.open(data.whatsappUrl as string, "_blank");
      router.push(storeHref(subdomain, `/pedido/${data.publicCode as string}`));
    } finally {
      setLoading(false);
    }
  }

  async function submitPix(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    if (!config || !isFulfillmentValid(fulfillment, config)) {
      setMessage("Informe como deseja receber o pedido.");
      setStep("fulfillment");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/v1/store/orders/payment`, {
        method: "POST",
        headers: orderHeaders(),
        body: JSON.stringify({
          cartId,
          customerName,
          customerPhone,
          customerEmail,
          fulfillment: buildFulfillmentPayload(fulfillment),
          items: items.map((i) => ({
            batchId: i.batchId,
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Falha ao gerar PIX");
        return;
      }
      setPixData({
        publicCode: data.publicCode,
        pixCode: data.payment?.pixCode ?? null,
        qrCodeBase64: data.payment?.qrCodeBase64 ?? null,
      });
      setStep("pix_waiting");
      if (cartId && items.length > 0) {
        await releaseAllCartLines(domain, cartId, items);
      }
      setItems([]);
      setCartOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="store-page">
      <div className="store-topbar">
        {config?.freeDeliveryMinAmount ? (
          <span>
            <span className="store-topbar-gold">●</span> Frete grátis nas
            compras acima de {formatPrice(config.freeDeliveryMinAmount)}
          </span>
        ) : (
          <span>
            <span className="store-topbar-gold">●</span> Frete e retirada
            disponíveis na sua região
          </span>
        )}
        <span className="store-topbar-sep">|</span>
        <span>
          <span className="store-topbar-gold">✦</span> Atendimento boutique &amp;
          estoque em tempo real
        </span>
      </div>

      <header className="store-header">
        <div className="store-header-inner">
          <a
            href="#"
            className="store-logo"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="store-logo-name">{storeName}</span>
            <span className="store-logo-tag">
              Alta perfumaria · Coleção curada
            </span>
          </a>

          <div className="store-search">
            <span className="store-search-icon" aria-hidden>
              <SearchIcon />
            </span>
            <input
              type="search"
              placeholder="Buscar por fragrância, notas olfativas…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setFamilyFilter(null);
              }}
              aria-label="Buscar produtos"
            />
          </div>

          <div className="store-header-actions">
            {config && (
              <FulfillmentLocationMenu
                subdomain={subdomain}
                domain={domain}
                config={config}
                cartTotal={subtotal}
                itemCount={cartCount}
                value={fulfillment}
                onChange={setFulfillment}
                onQuoteChange={setShippingQuote}
              />
            )}
            <CustomerAuthMenu
              subdomain={subdomain}
              domain={domain}
              onSessionChange={handleCustomerSession}
            />
            <button
              type="button"
              className="store-cart-btn"
              onClick={() => router.push(storeHref(subdomain, "/checkout"))}
              aria-label={`Sacola com ${cartCount} itens`}
            >
              <ShoppingBagIcon />
              {cartCount > 0 && (
                <>
                  <span className="store-cart-count">{cartCount}</span>
                  <span className="store-cart-total">
                    {formatPrice(subtotal)}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <section className="store-hero" aria-label="Destaque">
        <div className="store-hero-inner">
          <h1 className="store-hero-brand">{storeName}</h1>
          <p className="store-hero-lead">
            A arte da alta perfumaria francesa e brasileira — coleções
            icônicas, entrega expressa ou retirada com o revendedor.
          </p>
          <div className="store-hero-ctas">
            <button
              type="button"
              className="btn-primary"
              onClick={scrollToVitrine}
            >
              Explorar vitrine
            </button>
            {config?.pickupEnabled !== false && (
              <button
                type="button"
                className="btn-outline"
                onClick={openPickup}
              >
                Retirar em loja
              </button>
            )}
          </div>
        </div>
      </section>

      <main className="store-main">
        <section aria-labelledby="families-title">
          <div className="store-section-head">
            <div>
              <span className="store-section-eyebrow">Curadoria sensorial</span>
              <h2 id="families-title" className="store-section-title">
                Famílias olfativas
              </h2>
              <p className="store-section-sub">
                Navegue pelas facetas e encontre sua assinatura
              </p>
            </div>
            <span className="store-section-eyebrow">
              {OLFACTORY_FAMILIES.length} famílias
            </span>
          </div>
          <div className="family-grid">
            {OLFACTORY_FAMILIES.map((family) => (
              <button
                key={family.id}
                type="button"
                className={`family-chip ${
                  familyFilter === family.id ? "active" : ""
                }`}
                onClick={() => {
                  setFamilyFilter((prev) =>
                    prev === family.id ? null : family.id
                  );
                  setSearchQuery("");
                  scrollToVitrine();
                }}
              >
                <span className="family-chip-icon" aria-hidden>
                  {family.icon}
                </span>
                <strong>{family.label}</strong>
                <span>{family.notes}</span>
              </button>
            ))}
          </div>
        </section>

        <section id="vitrine" aria-labelledby="vitrine-title">
          <div className="store-section-head">
            <div>
              <span className="store-section-eyebrow">
                Seleção especial da curadoria
              </span>
              <h2 id="vitrine-title" className="store-section-title">
                {searchQuery.trim()
                  ? `Resultados para “${searchQuery.trim()}”`
                  : familyFilter
                    ? `Família ${
                        OLFACTORY_FAMILIES.find((f) => f.id === familyFilter)
                          ?.label ?? ""
                      }`
                    : "Vitrine de alta perfumaria"}
              </h2>
              <p className="store-section-sub">
                {filteredProducts.length} produto
                {filteredProducts.length !== 1 ? "s" : ""} disponível
                {filteredProducts.length !== 1 ? "is" : ""}
              </p>
            </div>
            <label className="store-sort">
              Ordenar por
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as "featured" | "price-asc" | "price-desc"
                  )
                }
              >
                <option value="featured">Destaques</option>
                <option value="price-asc">Menor preço</option>
                <option value="price-desc">Maior preço</option>
              </select>
            </label>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="store-empty">
              {products.length === 0 ? (
                <>
                  <p>Nenhum produto com estoque no momento.</p>
                  <p>Cadastre lotes no painel do revendedor.</p>
                </>
              ) : (
                <p>
                  Nenhum produto encontrado
                  {searchQuery ? ` para “${searchQuery}”` : ""}.
                  {(familyFilter || searchQuery) && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="btn-outline"
                        style={{ marginTop: "1rem" }}
                        onClick={() => {
                          setSearchQuery("");
                          setFamilyFilter(null);
                        }}
                      >
                        Limpar filtros
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  loading={loading}
                  onAdd={() => addToCart(product)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="omni-section" aria-labelledby="omni-title">
          <div>
            <span className="store-section-eyebrow">Omnichannel</span>
            <h2 id="omni-title" className="store-section-title">
              Experiência integrada
            </h2>
            <p className="store-section-sub">
              Compre online e retire com o revendedor — ou receba em casa com
              frete calculado na hora.
            </p>
            <div className="omni-steps">
              <div className="omni-step">
                <span className="omni-step-num">01</span>
                <div>
                  <strong>Selecione online</strong>
                  <p>Escolha fragrâncias com estoque em tempo real.</p>
                </div>
              </div>
              <div className="omni-step">
                <span className="omni-step-num">02</span>
                <div>
                  <strong>Entrega ou retirada</strong>
                  <p>
                    Informe o CEP ou retire no ponto combinado com o vendedor.
                  </p>
                </div>
              </div>
              <div className="omni-step">
                <span className="omni-step-num">03</span>
                <div>
                  <strong>WhatsApp ou PIX</strong>
                  <p>
                    Finalize com o revendedor ou pague na hora com confirmação
                    automática.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="omni-map">
            <h3>{storeName}</h3>
            <p>
              {config?.pickupAddress
                ? config.pickupAddress
                : "Combine o horário e o local de retirada após o pedido."}
            </p>
            {config?.pickupEnabled !== false && (
              <button
                type="button"
                className="btn-primary"
                onClick={openPickup}
              >
                Preferir retirada
              </button>
            )}
          </div>
        </section>

        <section className="club-section">
          <h2>O cercle privé da perfumaria</h2>
          <p>
            Crie sua conta na loja para salvar endereços, acompanhar pedidos e
            receber novidades da curadoria.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const links = document.querySelectorAll<HTMLButtonElement>(
                ".store-header-actions .store-auth .store-header-link"
              );
              links[0]?.click();
            }}
          >
            Acessar minha conta
          </button>
        </section>
      </main>

      <footer className="store-footer">
        <div className="store-footer-inner">
          <div>
            <h3>{storeName}</h3>
            <p>
              Loja virtual do revendedor — fragrâncias e cuidados selecionados,
              com atendimento próximo e estoque real.
            </p>
          </div>
          <div>
            <h3>Atendimento</h3>
            <ul>
              <li>Pedidos via WhatsApp ou PIX</li>
              <li>Entrega e retirada</li>
              <li>Acompanhe em Meus pedidos</li>
            </ul>
          </div>
          <div>
            <h3>Garantia</h3>
            <ul>
              <li>Estoque reservado na compra</li>
              <li>Produtos originais da curadoria</li>
              <li>Suporte direto com o revendedor</li>
            </ul>
          </div>
        </div>
        <p className="store-footer-copy">
          © {new Date().getFullYear()} {storeName} · Powered by Revendedor
        </p>
      </footer>

      {message && <div className="store-toast">{message}</div>}

      <div
        className={`cart-overlay ${cartOpen ? "open" : ""}`}
        onClick={closeCart}
        aria-hidden={!cartOpen}
      />

      <aside
        className={`cart-drawer ${cartOpen ? "open" : ""}`}
        aria-label="Sacola de compras"
        aria-hidden={!cartOpen}
      >
        <div className="cart-drawer-header">
          <h2>
            {step === "pix_waiting"
              ? "Pagamento PIX"
              : step === "whatsapp"
                ? "Finalizar no WhatsApp"
                : step === "pix"
                  ? "Pagar com PIX"
                  : step === "fulfillment"
                    ? "Entrega ou retirada"
                    : "Minha sacola"}
          </h2>
          <button
            type="button"
            className="cart-close"
            onClick={closeCart}
            aria-label="Fechar sacola"
          >
            ×
          </button>
        </div>

        <div className="cart-drawer-body">
          {step === "pix_waiting" && pixData ? (
            <div className="pix-box">
              <p>
                Pedido <strong>#PED-{pixData.publicCode}</strong>
                <br />
                Pague o PIX para confirmar automaticamente.
              </p>
              {pixData.qrCodeBase64 && (
                <img
                  src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                  alt="QR Code PIX"
                  width={200}
                  height={200}
                />
              )}
              {pixData.pixCode && (
                <>
                  <textarea readOnly value={pixData.pixCode} />
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(pixData.pixCode!);
                      setMessage("Código PIX copiado!");
                    }}
                  >
                    Copiar código PIX
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  router.push(
                    storeHref(subdomain, `/pedido/${pixData.publicCode}`)
                  );
                }}
              >
                Ver pedido
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setStep("cart");
                  setPixData(null);
                  setCartOpen(false);
                }}
              >
                Voltar à loja
              </button>
            </div>
          ) : step === "fulfillment" && config ? (
            <>
              <FulfillmentPanel
                subdomain={subdomain}
                domain={domain}
                config={config}
                cartTotal={subtotal}
                itemCount={cartCount}
                value={fulfillment}
                onChange={setFulfillment}
                onQuoteChange={setShippingQuote}
              />
              <div className="cart-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setStep("cart")}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!isFulfillmentValid(fulfillment, config)}
                  onClick={() => setStep("cart")}
                >
                  Confirmar entrega
                </button>
              </div>
            </>
          ) : step === "whatsapp" ? (
            <form className="checkout-form" onSubmit={submitWhatsApp}>
              <input
                placeholder="Seu nome"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
              <input
                placeholder="CPF (somente números)"
                value={customerCpf}
                onChange={(e) =>
                  setCustomerCpf(e.target.value.replace(/\D/g, "").slice(0, 11))
                }
                inputMode="numeric"
                minLength={11}
                maxLength={11}
                required
              />
              <input
                placeholder="WhatsApp com DDD"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                required
              />
              <p className="checkout-hint">
                Seu CPF identifica seu cadastro na loja — sem senha nem e-mail.
              </p>
              <div className="cart-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setStep("fulfillment")}
              >
                Voltar
              </button>
              <button
                type="submit"
                className="btn-whatsapp"
                disabled={loading}
              >
                Abrir WhatsApp
              </button>
            </div>
          </form>
          ) : step === "pix" ? (
            <form className="checkout-form" onSubmit={submitPix}>
              <input
                placeholder="Seu nome"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
              />
              <input
                placeholder="Telefone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                required
              />
              <input
                type="email"
                placeholder="E-mail"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                required
              />
              <div className="cart-actions">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setStep("fulfillment")}
                >
                  Voltar
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  Gerar PIX
                </button>
              </div>
            </form>
          ) : items.length === 0 ? (
            <div className="store-empty">
              <p>Sua sacola está vazia.</p>
              <p>Adicione produtos para continuar.</p>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <CartLineItem
                  key={item.batchId}
                  item={item}
                  busy={cartLineBusy === item.batchId}
                  onIncrease={() => void changeCartQuantity(item.batchId, 1)}
                  onDecrease={() => void changeCartQuantity(item.batchId, -1)}
                  onRemove={() => void removeCartItem(item.batchId)}
                />
              ))}
            </>
          )}
        </div>

        {step === "cart" && items.length > 0 && (
          <div className="cart-drawer-footer">
            <CartTotals
              subtotal={subtotal}
              shippingAmount={shippingAmount}
              fulfillmentType={fulfillment.fulfillmentType}
              shippingQuote={shippingQuote}
              total={total}
            />
            <button
              type="button"
              className="cart-clear-btn"
              disabled={loading || cartLineBusy !== null}
              onClick={() => void clearCart()}
            >
              Limpar sacola
            </button>
            <div className="cart-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={loading}
                onClick={() => {
                  setCartOpen(false);
                  router.push(storeHref(subdomain, "/checkout"));
                }}
              >
                Ir para a sacola
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  setCartOpen(false);
                  router.push(storeHref(subdomain, "/checkout/entrega"));
                }}
              >
                Seguir para identificação
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function ShoppingBagIcon() {
  return (
    <svg
      className="store-cart-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 7h12l-1 14H7L6 7z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function CartTotals({
  subtotal,
  shippingAmount,
  fulfillmentType,
  shippingQuote,
  total,
}: {
  subtotal: number;
  shippingAmount: number;
  fulfillmentType: "delivery" | "pickup";
  shippingQuote: ShippingQuote | null;
  total: number;
}) {
  return (
    <div className="cart-totals">
      <div className="cart-total-row">
        <span>Subtotal</span>
        <span>{formatPrice(subtotal)}</span>
      </div>
      {fulfillmentType === "delivery" && (
        <div className="cart-total-row">
          <span>Frete</span>
          <span>
            {shippingQuote?.freeDelivery
              ? "Grátis"
              : shippingQuote?.amount != null
                ? formatPrice(shippingAmount)
                : "A combinar"}
          </span>
        </div>
      )}
      <div className="cart-total cart-total--grand">
        <span>Total</span>
        <span>{formatPrice(total)}</span>
      </div>
    </div>
  );
}

function CartLineItem({
  item,
  busy,
  onIncrease,
  onDecrease,
  onRemove,
}: {
  item: CartItem;
  busy: boolean;
  onIncrease: () => void;
  onDecrease: () => void;
  onRemove: () => void;
}) {
  const img = mediaUrl(item.imageUrl);
  const atMax = item.quantity >= item.maxQty;

  return (
    <div className="cart-item">
      <div className="cart-item-thumb">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" />
        ) : (
          <span aria-hidden>📦</span>
        )}
      </div>
      <div className="cart-item-info">
        <div className="cart-item-name">{item.productName}</div>
        <div className="cart-item-qty">{formatPrice(item.unitPrice)} cada</div>
        <div className="cart-qty-controls">
          <button
            type="button"
            className="cart-qty-btn"
            aria-label="Diminuir quantidade"
            disabled={busy}
            onClick={onDecrease}
          >
            −
          </button>
          <span className="cart-qty-value">{item.quantity}</span>
          <button
            type="button"
            className="cart-qty-btn"
            aria-label="Aumentar quantidade"
            disabled={busy || atMax}
            onClick={onIncrease}
          >
            +
          </button>
        </div>
      </div>
      <div className="cart-item-side">
        <strong className="cart-item-price">
          {formatPrice(item.unitPrice * item.quantity)}
        </strong>
        <button
          type="button"
          className="cart-item-remove"
          disabled={busy}
          onClick={onRemove}
        >
          Remover
        </button>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  loading,
  onAdd,
}: {
  product: Product;
  loading: boolean;
  onAdd: () => void;
}) {
  const img = mediaUrl(product.imageUrl);
  const outOfStock = product.availableStock <= 0;
  const price = Number(product.price);
  const installments = Math.min(6, Math.max(1, Math.floor(price / 40)));
  const installmentValue = price / installments;

  return (
    <article className="product-card">
      <div className="product-card-image">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={product.name} loading="lazy" />
        ) : (
          <span className="product-card-placeholder" aria-hidden>
            ◈
          </span>
        )}
        <div className="product-card-badges">
          {product.onSale && (
            <span className="product-badge product-badge--sale">Promoção</span>
          )}
          {!outOfStock && (
            <span className="product-badge product-badge--stock">
              Em estoque
            </span>
          )}
        </div>
      </div>
      <div className="product-card-body">
        <div className="product-card-meta">
          {product.availableStock} unidade
          {product.availableStock !== 1 ? "s" : ""} · curadoria
        </div>
        <h3 className="product-card-name">{product.name}</h3>
        <div className="product-card-price-row">
          <div className="product-card-price">
            {product.onSale && product.originalPrice != null && (
              <span className="product-card-price-old">
                {formatPrice(product.originalPrice)}
              </span>
            )}
            {formatPrice(product.price)}
            <small>
              {installments > 1
                ? `em até ${installments}x de ${formatPrice(installmentValue)}`
                : `${product.availableStock} disponível${
                    product.availableStock !== 1 ? "is" : ""
                  }`}
            </small>
          </div>
        </div>
      </div>
      <div className="product-card-actions">
        <button
          type="button"
          className="product-card-btn"
          onClick={onAdd}
          disabled={loading || outOfStock}
        >
          {outOfStock ? "Indisponível" : "Adicionar à sacola"}
        </button>
      </div>
    </article>
  );
}
