import { publicStoreUrl, storeRoutingMode } from "@/lib/store-url";

export default function HomePage() {
  const example =
    storeRoutingMode() === "path"
      ? publicStoreUrl("minhaloja")
      : "http://minhaloja.localhost:3002";

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>
        Vitrine Revendedor
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        Acesse a loja pelo caminho do subdomínio cadastrado, por exemplo{" "}
        <code>{example}</code>.
      </p>
    </main>
  );
}
