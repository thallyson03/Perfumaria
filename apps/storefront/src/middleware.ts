import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_ROOT_DOMAIN ??
  process.env.ROOT_DOMAIN ??
  "localhost";

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const hostWithoutPort = hostname.split(":")[0];

  // localhost puro → página de orientação
  if (hostWithoutPort === "localhost" || hostWithoutPort === "127.0.0.1") {
    return NextResponse.next();
  }

  let subdomain = hostWithoutPort;
  if (hostWithoutPort.endsWith(`.${ROOT_DOMAIN}`)) {
    subdomain = hostWithoutPort.replace(`.${ROOT_DOMAIN}`, "");
  } else {
    subdomain = hostWithoutPort.split(".")[0];
  }

  // Evita reescrever assets / rotas internas
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = `/${subdomain}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
