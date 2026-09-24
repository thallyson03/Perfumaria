-- Estoque por lotes + ajustes de products + debt summaries + MV dashboard

-- 1) products: catálogo sem estoque/validade
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Migrar estoque legado para um lote sintético (se houver)
CREATE TABLE IF NOT EXISTS "product_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "batch_number" VARCHAR(100),
    "expiration_date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

INSERT INTO "product_batches" ("tenant_id", "product_id", "batch_number", "expiration_date", "quantity", "reserved_quantity")
SELECT
  p."tenant_id",
  p."id",
  'LEGACY',
  COALESCE(p."expiration_date", (CURRENT_DATE + INTERVAL '365 days')::date),
  COALESCE(p."stock_quantity", 0),
  0
FROM "products" p
WHERE COALESCE(p."stock_quantity", 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "product_batches" b WHERE b."product_id" = p."id"
  );

DROP INDEX IF EXISTS "products_tenant_id_expiration_date_idx";
ALTER TABLE "products" DROP COLUMN IF EXISTS "stock_quantity";
ALTER TABLE "products" DROP COLUMN IF EXISTS "expiration_date";

ALTER TABLE "product_batches"
  DROP CONSTRAINT IF EXISTS "product_batches_tenant_id_fkey";
ALTER TABLE "product_batches"
  ADD CONSTRAINT "product_batches_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_batches"
  DROP CONSTRAINT IF EXISTS "product_batches_product_id_fkey";
ALTER TABLE "product_batches"
  ADD CONSTRAINT "product_batches_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "product_batches_tenant_id_idx" ON "product_batches"("tenant_id");
CREATE INDEX IF NOT EXISTS "product_batches_tenant_id_product_id_idx" ON "product_batches"("tenant_id", "product_id");
CREATE INDEX IF NOT EXISTS "product_batches_tenant_id_expiration_date_idx" ON "product_batches"("tenant_id", "expiration_date");

ALTER TABLE product_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_batches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_batches ON product_batches;
CREATE POLICY tenant_isolation_batches ON product_batches
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

-- 2) Resumos de dívida
CREATE TABLE IF NOT EXISTS "customer_debt_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "total_debt" DECIMAL(12,2) NOT NULL,
    "overdue_debt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_debt_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_debt_summaries_customer_id_key"
  ON "customer_debt_summaries"("customer_id");
CREATE INDEX IF NOT EXISTS "customer_debt_summaries_tenant_id_total_debt_idx"
  ON "customer_debt_summaries"("tenant_id", "total_debt" DESC);

ALTER TABLE "customer_debt_summaries"
  DROP CONSTRAINT IF EXISTS "customer_debt_summaries_tenant_id_fkey";
ALTER TABLE "customer_debt_summaries"
  ADD CONSTRAINT "customer_debt_summaries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_debt_summaries"
  DROP CONSTRAINT IF EXISTS "customer_debt_summaries_customer_id_fkey";
ALTER TABLE "customer_debt_summaries"
  ADD CONSTRAINT "customer_debt_summaries_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE customer_debt_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_debt_summaries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_debt_summaries ON customer_debt_summaries;
CREATE POLICY tenant_isolation_debt_summaries ON customer_debt_summaries
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

-- 3) Materialized view de vendas mensais + view segura (RLS via session var)
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_sales CASCADE;
CREATE MATERIALIZED VIEW mv_monthly_sales AS
SELECT
    tenant_id,
    DATE_TRUNC('month', created_at) AS month,
    SUM(total_amount) AS total_sales,
    COUNT(id) AS total_orders
FROM invoices
WHERE status = 'paid'
GROUP BY tenant_id, DATE_TRUNC('month', created_at);

CREATE UNIQUE INDEX idx_mv_monthly_sales ON mv_monthly_sales(tenant_id, month);

CREATE OR REPLACE VIEW secure_monthly_sales AS
SELECT * FROM mv_monthly_sales
WHERE tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid;

-- Grants para role da aplicação
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO revendedor_app;
GRANT SELECT ON mv_monthly_sales TO revendedor_app;
GRANT SELECT ON secure_monthly_sales TO revendedor_app;
