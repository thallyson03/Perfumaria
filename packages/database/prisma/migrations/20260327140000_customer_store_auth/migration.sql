-- Auth do cliente final na vitrine
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "password_hash" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_id_email_key"
  ON "customers"("tenant_id", "email");
