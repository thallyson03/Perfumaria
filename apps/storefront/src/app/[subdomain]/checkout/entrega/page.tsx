import { CheckoutDeliveryClient } from "@/components/checkout/checkout-delivery-client";

export default async function CheckoutDeliveryPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  return <CheckoutDeliveryClient subdomain={subdomain} />;
}
