export default function HomePage() {
  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>
        Vitrine Revendedor
      </h1>
      <p style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        Em desenvolvimento local, acesse via subdomínio, por exemplo{" "}
        <code>loja.localhost:3002</code>. O middleware reescreve para{" "}
        <code>/[subdomain]</code> e a API resolve o tenant pelo header{" "}
        <code>X-Tenant-Domain</code>.
      </p>
    </main>
  );
}
