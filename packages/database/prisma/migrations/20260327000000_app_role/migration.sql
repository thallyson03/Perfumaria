-- Role de aplicação: sem superuser e sem BYPASSRLS (obrigatório para o RLS valer)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'revendedor_app') THEN
    CREATE ROLE revendedor_app LOGIN PASSWORD 'revendedor_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE revendedor TO revendedor_app;
GRANT USAGE ON SCHEMA public TO revendedor_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO revendedor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO revendedor_app;

ALTER DEFAULT PRIVILEGES FOR ROLE revendedor IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO revendedor_app;
ALTER DEFAULT PRIVILEGES FOR ROLE revendedor IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO revendedor_app;
