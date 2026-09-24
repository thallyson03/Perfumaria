import { CheckoutCartClient } from "@/components/checkout/checkout-cart-client";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  return <CheckoutCartClient subdomain={subdomain} />;
}
