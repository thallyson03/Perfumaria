import { StoreClient } from "@/components/store-client";

export default async function StorePage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  return <StoreClient subdomain={subdomain} />;
}
