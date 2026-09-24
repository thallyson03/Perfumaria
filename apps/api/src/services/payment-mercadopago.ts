export type MercadoPagoPixResult = {
  id: string;
  status: string;
  pixCode: string | null;
  qrCodeBase64: string | null;
};

type MpPaymentResponse = {
  id: number;
  status: string;
  external_reference?: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
    };
  };
};

export async function createMercadoPagoPixPayment(params: {
  accessToken: string;
  orderId: string;
  publicCode: string;
  amount: number;
  payerEmail: string;
  payerName: string;
  description: string;
}): Promise<MercadoPagoPixResult> {
  const nameParts = params.payerName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? "Cliente";
  const lastName = nameParts.slice(1).join(" ") || firstName;

  const res = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": params.orderId,
    },
    body: JSON.stringify({
      transaction_amount: params.amount,
      description: params.description,
      payment_method_id: "pix",
      external_reference: params.orderId,
      payer: {
        email: params.payerEmail,
        first_name: firstName,
        last_name: lastName,
      },
    }),
  });

  const data = (await res.json()) as MpPaymentResponse & {
    message?: string;
    cause?: Array<{ description: string }>;
  };

  if (!res.ok) {
    const detail =
      data.message ??
      data.cause?.map((c) => c.description).join(", ") ??
      "Falha ao criar pagamento PIX";
    throw Object.assign(new Error(detail), { statusCode: 502 });
  }

  const txData = data.point_of_interaction?.transaction_data;

  return {
    id: String(data.id),
    status: data.status,
    pixCode: txData?.qr_code ?? null,
    qrCodeBase64: txData?.qr_code_base64 ?? null,
  };
}

export async function fetchMercadoPagoPayment(
  accessToken: string,
  paymentId: string
): Promise<MpPaymentResponse> {
  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    throw Object.assign(new Error("Pagamento não encontrado no Mercado Pago"), {
      statusCode: 404,
    });
  }
  return res.json() as Promise<MpPaymentResponse>;
}
