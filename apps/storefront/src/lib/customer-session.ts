const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type CustomerProfile = {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  documentCpf?: string | null;
};

export type CustomerSession = {
  token: string;
  customer: CustomerProfile;
};

function storageKey(subdomain: string) {
  return `revendedor_customer_${subdomain}`;
}

export function loadCustomerSession(
  subdomain: string
): CustomerSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(storageKey(subdomain));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CustomerSession;
  } catch {
    return null;
  }
}

export function saveCustomerSession(
  subdomain: string,
  session: CustomerSession
) {
  localStorage.setItem(storageKey(subdomain), JSON.stringify(session));
}

export function clearCustomerSession(subdomain: string) {
  localStorage.removeItem(storageKey(subdomain));
}

export async function fetchCustomerProfile(
  domain: string,
  token: string
): Promise<CustomerProfile | null> {
  const res = await fetch(`${API}/v1/store/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Tenant-Domain": domain,
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as CustomerProfile | null;
  return data;
}

export function parseApiError(data: unknown): string {
  if (!data || typeof data !== "object" || !("error" in data)) {
    return "Erro inesperado. Tente novamente.";
  }
  const err = (data as { error: unknown }).error;
  if (typeof err === "string") return err;
  return "Verifique os dados informados.";
}

export async function loginCustomer(
  domain: string,
  email: string,
  password: string
): Promise<CustomerSession> {
  const res = await fetch(`${API}/v1/store/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Domain": domain,
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(parseApiError(data));
  return data as CustomerSession;
}

export async function registerCustomer(
  domain: string,
  payload: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    documentCpf: string;
  }
): Promise<CustomerSession> {
  const res = await fetch(`${API}/v1/store/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Domain": domain,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(parseApiError(data));
  return data as CustomerSession;
}
