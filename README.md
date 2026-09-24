# Revendedor — SaaS multi-tenant (Fase 1)

Fundação com **Node (Fastify)**, **Next.js**, **Prisma**, **PostgreSQL + RLS** e **Redis**.

## Estrutura

```
apps/api          API Fastify (JWT, tenant middleware, withTenant/RLS)
apps/admin        Painel do revendedor (porta 3000)
apps/storefront   Vitrine por subdomínio (porta 3002)
packages/database Prisma + helper withTenant()
```

## Pré-requisitos

- Node 20+
- Docker Desktop **em execução**

> Se `npm install` ou o Prisma falharem com erro de certificado (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), use temporariamente:
> `npm install --strict-ssl false` e ` $env:NODE_OPTIONS="--use-system-ca"` (PowerShell) antes do `prisma generate` / migrate.

## Setup rápido (dev)

```bash
# 1. Infra local
cp .env.example .env
cp .env.example packages/database/.env
cp .env.example apps/api/.env
cp .env.example apps/admin/.env.local
cp .env.example apps/storefront/.env.local

npm run docker:up
npm install
npm run db:generate

# 2. Schema + RLS
$env:NODE_OPTIONS="--use-system-ca"   # se houver erro de certificado SSL
npm run db:migrate:dev

# 3. Subir serviços (3 terminais)
npm run dev:api
npm run dev:admin
npm run dev:storefront
```

> **Portas locais:** Postgres `5434`, Redis `6380` (5432/6379 já estavam ocupadas na máquina).

- Painel: http://localhost:3000  
- API health: http://localhost:3001/health  
- Vitrine (ex.): http://loja.localhost:3002  

## Produção (Coolify)

Guia completo: [`docs/COOLIFY.md`](docs/COOLIFY.md)

Resumo: recurso **Docker Compose** apontando para `docker-compose.prod.yml`, variáveis de `.env.production.example`, domínios `api` / `admin` / wildcard da vitrine.

## Segurança multi-tenant

1. Toda tabela sensível tem `tenant_id` + **RLS** + **FORCE RLS**.
2. A API conecta com o role `revendedor_app` (**sem** `BYPASSRLS`). Migrations usam o superuser `revendedor`.
3. Antes das queries a API roda `SET LOCAL app.current_tenant = '<uuid>'` dentro de uma transação (`withTenant`).
4. JWT do painel e da vitrine carregam `tenantId`; checkout compara JWT × domínio (`X-Tenant-Domain`).
5. Resolução de subdomínio → UUID usa **Redis** (`tenant_domain:*`) com fallback no Postgres (`tenants` sem RLS).

## Status da implementação (atual)

- Fase 1: multi-tenant + RLS + JWT + Redis domain cache — **ok**
- Estoque por **lotes** + reserva `FOR UPDATE` + TTL Redis + **listener de expiração** — **ok**
- Ledger / faturas / parcelas / pagamento atômico — **ok**
- Dashboard: Redis (hoje) + `secure_monthly_sales` + top dívidas — **ok**
- Workers: overdue, debt summaries, fila `alerts:whatsapp`, refresh MV — **ok**
- Vitrine: carrinho + login cliente + checkout (validação dupla JWT×domínio) — **ok**
- Deploy Coolify (Docker Compose + Dockerfiles) — **ok** (configure DNS + envs)
