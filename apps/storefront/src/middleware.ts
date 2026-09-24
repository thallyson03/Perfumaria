import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
  process.env.ROOT_DOMAIN ??
  "localhost";

const ROUTING =
  process.env.NEXT_PUBLIC_STORE_ROUTING ??
  (process.env.NODE_ENV === "production" ? "path" : "host");

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const hostWithoutPort = hostname.split(":")[0];
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  // localhost / 127.0.0.1 → página de orientação (sem rewrite)
  if (hostWithoutPort === "localhost" || hostWithoutPort === "127.0.0.1") {
    return NextResponse.next();
  }

  const isRootHost =
    hostWithoutPort === ROOT_DOMAIN ||
    hostWithoutPort === `www.${ROOT_DOMAIN}`;

  // Modo path (produção): https://lojas.dominio/{loja}/...
  // O App Router já resolve /[subdomain]/... — não reescrever.
  if (ROUTING === "path" || isRootHost) {
    return NextResponse.next();
  }

  // Modo host (dev): loja.localhost → /loja/...
  let subdomain = hostWithoutPort;
  if (hostWithoutPort.endsWith(`.${ROOT_DOMAIN}`)) {
    subdomain = hostWithoutPort.slice(0, -(ROOT_DOMAIN.length + 1));
  } else {
    subdomain = hostWithoutPort.split(".")[0] ?? hostWithoutPort;
  }

  if (!subdomain || subdomain === "www") {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = `/${subdomain}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
