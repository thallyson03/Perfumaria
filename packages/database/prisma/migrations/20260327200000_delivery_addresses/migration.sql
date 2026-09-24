-- Entrega: endereços, config da loja e snapshot no pedido

DO $$ BEGIN
  CREATE TYPE "FulfillmentType" AS ENUM ('delivery', 'pickup');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pickup_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_delivery_min_amount DECIMAL(10,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS delivery_message VARCHAR(500);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pickup_address VARCHAR(500);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(32);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shipping_origin_zip_code VARCHAR(9);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS melhor_envio_token VARCHAR(512);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS correios_contract_code VARCHAR(64);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  label VARCHAR(50) NOT NULL DEFAULT 'Casa',
  recipient_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  zip_code VARCHAR(9) NOT NULL,
  street VARCHAR(255) NOT NULL,
  number VARCHAR(20) NOT NULL,
  complement VARCHAR(100),
  neighborhood VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(2) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_addresses_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS customer_addresses_tenant_id_customer_id_idx
  ON customer_addresses(tenant_id, customer_id);

ALTER TABLE customer_addresses
  DROP CONSTRAINT IF EXISTS customer_addresses_tenant_id_fkey;
ALTER TABLE customer_addresses
  ADD CONSTRAINT customer_addresses_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE customer_addresses
  DROP CONSTRAINT IF EXISTS customer_addresses_customer_id_fkey;
ALTER TABLE customer_addresses
  ADD CONSTRAINT customer_addresses_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS fulfillment_type "FulfillmentType" NOT NULL DEFAULT 'delivery';
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_address_id UUID;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_recipient_name VARCHAR(255);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_phone VARCHAR(20);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_zip_code VARCHAR(9);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_street VARCHAR(255);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_number VARCHAR(20);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_complement VARCHAR(100);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_neighborhood VARCHAR(100);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_city VARCHAR(100);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS delivery_state VARCHAR(2);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS shipping_quote_amount DECIMAL(10,2);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS shipping_quote_days INTEGER;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(32);

ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_delivery_address_id_fkey;
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_delivery_address_id_fkey
  FOREIGN KEY (delivery_address_id) REFERENCES customer_addresses(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_customer_addresses ON customer_addresses;
CREATE POLICY tenant_isolation_customer_addresses ON customer_addresses
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_addresses TO revendedor_app;
