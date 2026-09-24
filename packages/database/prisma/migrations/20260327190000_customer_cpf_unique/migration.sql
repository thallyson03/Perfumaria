-- CPF único por loja (clientes identificados na vitrine/WhatsApp)
CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_id_document_cpf_key"
  ON "customers" ("tenant_id", "document_cpf")
  WHERE "document_cpf" IS NOT NULL AND "document_cpf" <> '';

ALTER TABLE "sales_orders"
  ADD COLUMN IF NOT EXISTS "customer_document_cpf" VARCHAR(14);
