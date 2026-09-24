CREATE TABLE IF NOT EXISTS "invoice_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_items_tenant_id_idx" ON "invoice_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "invoice_items_tenant_id_invoice_id_idx" ON "invoice_items"("tenant_id", "invoice_id");

ALTER TABLE "invoice_items"
  DROP CONSTRAINT IF EXISTS "invoice_items_tenant_id_fkey";
ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_items"
  DROP CONSTRAINT IF EXISTS "invoice_items_invoice_id_fkey";
ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_items"
  DROP CONSTRAINT IF EXISTS "invoice_items_product_id_fkey";
ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_invoice_items ON invoice_items;
CREATE POLICY tenant_isolation_invoice_items ON invoice_items
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_items TO revendedor_app;
