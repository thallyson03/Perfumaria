ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(64);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "image_url" VARCHAR(500);

CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_id_barcode_key"
  ON "products"("tenant_id", "barcode");
