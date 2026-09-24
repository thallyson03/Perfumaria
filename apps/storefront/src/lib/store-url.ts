/**
 * Rotas da vitrine.
 * - path (produção Coolify): https://lojas.dominio/{subdomain}/...
 * - host (dev local): https://{subdomain}.localhost/...
 */

export type StoreRouting = "path" | "host";

export function storeRoutingMode(): StoreRouting {
  const explicit = process.env.NEXT_PUBLIC_STORE_ROUTING;
  if (explicit === "path" || explicit === "host") return explicit;
  // Default: path em produção, host em desenvolvimento
  return process.env.NODE_ENV === "production" ? "path" : "host";
}

export function rootDomain() {
  return (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
    process.env.ROOT_DOMAIN ??
    "localhost"
  );
}

/** Valor enviado em X-Tenant-Domain (API aceita subdomain ou host completo). */
export function tenantDomain(subdomain: string) {
  if (storeRoutingMode() === "path") return subdomain;
  return `${subdomain}.${rootDomain()}`;
}

/** Href interno da vitrine (sempre com leading slash). */
export function storeHref(subdomain: string, path = "/") {
  const clean =
    !path || path === "/"
      ? ""
      : path.startsWith("/")
        ? path
        : `/${path}`;

  if (storeRoutingMode() === "path") {
    return `/${subdomain}${clean}`;
  }
  return clean || "/";
}

/** URL pública absoluta da loja (para exibir no admin). */
export function publicStoreUrl(subdomain: string) {
  const root = rootDomain();
  const base =
    process.env.NEXT_PUBLIC_STORE_PUBLIC_ORIGIN ??
    (root === "localhost"
      ? "http://localhost:3002"
      : `https://${root}`);

  if (storeRoutingMode() === "path") {
    return `${base.replace(/\/$/, "")}/${subdomain}`;
  }
  if (root === "localhost") {
    return `http://${subdomain}.localhost:3002`;
  }
  return `https://${subdomain}.${root}`;
}
