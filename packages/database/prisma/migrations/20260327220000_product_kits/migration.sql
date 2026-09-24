-- Kits virtuais: produto kind=kit + composição em kit_items

DO $$ BEGIN
  CREATE TYPE "ProductKind" AS ENUM ('simple', 'kit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS kind "ProductKind" NOT NULL DEFAULT 'simple';

CREATE INDEX IF NOT EXISTS products_tenant_id_kind_idx ON products(tenant_id, kind);

CREATE TABLE IF NOT EXISTS kit_items (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  kit_product_id UUID NOT NULL,
  component_product_id UUID NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT kit_items_pkey PRIMARY KEY (id),
  CONSTRAINT kit_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT kit_items_kit_component_distinct CHECK (kit_product_id <> component_product_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS kit_items_kit_product_id_component_product_id_key
  ON kit_items(kit_product_id, component_product_id);

CREATE INDEX IF NOT EXISTS kit_items_tenant_id_idx ON kit_items(tenant_id);
CREATE INDEX IF NOT EXISTS kit_items_tenant_id_kit_product_id_idx
  ON kit_items(tenant_id, kit_product_id);

ALTER TABLE kit_items
  DROP CONSTRAINT IF EXISTS kit_items_tenant_id_fkey;
ALTER TABLE kit_items
  ADD CONSTRAINT kit_items_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE kit_items
  DROP CONSTRAINT IF EXISTS kit_items_kit_product_id_fkey;
ALTER TABLE kit_items
  ADD CONSTRAINT kit_items_kit_product_id_fkey
  FOREIGN KEY (kit_product_id) REFERENCES products(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE kit_items
  DROP CONSTRAINT IF EXISTS kit_items_component_product_id_fkey;
ALTER TABLE kit_items
  ADD CONSTRAINT kit_items_component_product_id_fkey
  FOREIGN KEY (component_product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE kit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_kit_items ON kit_items;
CREATE POLICY tenant_isolation_kit_items ON kit_items
  FOR ALL
  USING (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON kit_items TO revendedor_app;
