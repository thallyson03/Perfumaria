import { CheckoutPaymentClient } from "@/components/checkout/checkout-payment-client";

export default async function CheckoutPaymentPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  return <CheckoutPaymentClient subdomain={subdomain} />;
}
