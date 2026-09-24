# Deploy no Coolify

Este monorepo sobe com **Docker Compose** (`docker-compose.prod.yml`).

## Pré-requisitos

1. Servidor com Coolify instalado e domínio apontando (A/AAAA) para o server.
2. DNS:
   - `api.seudominio.com` → servidor
   - `admin.seudominio.com` → servidor
   - `*.lojas.seudominio.com` → servidor (wildcard das vitrines)
3. Repositório Git conectado (ex.: [thallyson03/Perfumaria](https://github.com/thallyson03/Perfumaria)).

## Criar o recurso

1. Coolify → **New Resource** → **Docker Compose**.
2. Selecione o repositório e o arquivo `docker-compose.prod.yml`.
3. Em **Environment Variables**, preencha com base em `.env.production.example`:

| Variável | Exemplo |
| --- | --- |
| `ROOT_DOMAIN` | `lojas.seudominio.com` |
| `NEXT_PUBLIC_API_URL` | `https://api.seudominio.com` |
| `POSTGRES_PASSWORD` | senha forte |
| `APP_DB_PASSWORD` | senha forte (role `revendedor_app`) |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `N8N_ALERTS_WEBHOOK_URL` | (opcional) webhook n8n |

Na Coolify, **não** publique portas no host (`ports:`). O proxy acessa os containers pela rede interna (`expose`). Domínios são atribuídos na UI por serviço (api 3001, admin 3000, storefront 3002).


Na primeira subida a API roda `prisma migrate deploy` e sincroniza a senha do role `revendedor_app`.

## O que sobe

| Serviço | Função |
| --- | --- |
| `postgres` | Banco + RLS |
| `redis` | Cache de tenant, TTL carrinho/pedidos |
| `api` | Fastify + workers |
| `admin` | Painel Next.js |
| `storefront` | Vitrine por subdomínio |

Volumes persistentes: `postgres_data`, `redis_data`, `uploads_data` (fotos de produto).

## Rebuild quando mudar env pública

`NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_ROOT_DOMAIN` (`ROOT_DOMAIN`) entram no **build** do Next. Se alterar, force **rebuild** do `admin` e do `storefront`.

## Teste local do compose de produção

```bash
cp .env.production.example .env.prod
# edite .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Health da API: `http://localhost:3001/health`

## Checklist pós-deploy

- [ ] `GET https://api…/health` → `"status":"ok"`
- [ ] Abrir painel, criar loja / login
- [ ] Abrir `https://{subdominio}.{ROOT_DOMAIN}`
- [ ] Upload de produto persiste após restart (volume `uploads_data`)
