ALTER TABLE products
  ADD COLUMN sale_price DECIMAL(10, 2),
  ADD COLUMN sale_price_until TIMESTAMPTZ;
