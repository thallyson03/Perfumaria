import { normalizeZipCode } from "./address.js";

export type ViaCepResult = {
  zipCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export async function fetchViaCep(zipCode: string): Promise<ViaCepResult | null> {
  const digits = zipCode.replace(/\D/g, "");
  if (digits.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
    };

    if (data.erro) return null;

    return {
      zipCode: normalizeZipCode(digits),
      street: data.logradouro ?? "",
      neighborhood: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
    };
  } catch {
    return null;
  }
}
