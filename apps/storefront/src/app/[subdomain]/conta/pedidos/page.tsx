import { MyOrdersPageClient } from "@/components/my-orders-page-client";

export default async function MyOrdersPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  return <MyOrdersPageClient subdomain={subdomain} />;
}
