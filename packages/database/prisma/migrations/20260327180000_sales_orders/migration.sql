-- Tenant: canais de venda + WhatsApp + Mercado Pago
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS channel_whatsapp BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS channel_online_payment BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mercado_pago_access_token VARCHAR(512);

DO $$ BEGIN
  CREATE TYPE "OrderChannel" AS ENUM ('whatsapp', 'online_payment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('awaiting_seller', 'pending_payment', 'confirmed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "sales_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "public_code" VARCHAR(12) NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'awaiting_seller',
    "customer_name" VARCHAR(255),
    "customer_phone" VARCHAR(20),
    "customer_email" VARCHAR(255),
    "customer_id" UUID,
    "cart_id" VARCHAR(80),
    "total_amount" DECIMAL(10,2) NOT NULL,
    "invoice_id" UUID,
    "payment_provider" VARCHAR(32),
    "payment_external_id" VARCHAR(64),
    "payment_pix_code" VARCHAR(512),
    "payment_qr_base64" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_orders_tenant_id_public_code_key"
  ON "sales_orders"("tenant_id", "public_code");
CREATE INDEX IF NOT EXISTS "sales_orders_tenant_id_status_created_at_idx"
  ON "sales_orders"("tenant_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "sales_orders_payment_external_id_idx"
  ON "sales_orders"("payment_external_id");

CREATE TABLE IF NOT EXISTS "sales_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "line_total" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_order_items_tenant_id_idx" ON "sales_order_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "sales_order_items_tenant_id_order_id_idx"
  ON "sales_order_items"("tenant_id", "order_id");

ALTER TABLE "sales_orders"
  DROP CONSTRAINT IF EXISTS "sales_orders_tenant_id_fkey";
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_orders"
  DROP CONSTRAINT IF EXISTS "sales_orders_customer_id_fkey";
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_order_items"
  DROP CONSTRAINT IF EXISTS "sales_order_items_tenant_id_fkey";
ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_order_items"
  DROP CONSTRAINT IF EXISTS "sales_order_items_order_id_fkey";
ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sales_orders ON sales_orders;
CREATE POLICY tenant_isolation_sales_orders ON sales_orders
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_sales_order_items ON sales_order_items;
CREATE POLICY tenant_isolation_sales_order_items ON sales_order_items
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON sales_orders TO revendedor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_order_items TO revendedor_app;
