# Deploy no Coolify

Este monorepo sobe com **Docker Compose** (`docker-compose.prod.yml`).

## Pré-requisitos

1. Servidor com Coolify instalado e domínio apontando (A/AAAA) para o server.
2. DNS no Hostry (registros **A** → IP do VPS):
   - `api`
   - `admin`
   - `lojas`  ← vitrine (todas as lojas neste host)
3. Repositório Git: [thallyson03/Perfumaria](https://github.com/thallyson03/Perfumaria).

## Domains no Coolify (obrigatório com porta)

```text
api:        https://api.chatia.qzz.io:3001
admin:      https://admin.chatia.qzz.io:3000
storefront: https://lojas.chatia.qzz.io:3002
```

**Não** use `*.lojas...` no Coolify.

## Environment Variables

| Variável | Exemplo |
| --- | --- |
| `ROOT_DOMAIN` | `lojas.chatia.qzz.io` |
| `NEXT_PUBLIC_API_URL` | `https://api.chatia.qzz.io` |
| `POSTGRES_PASSWORD` | senha forte |
| `APP_DB_PASSWORD` | senha forte |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `N8N_ALERTS_WEBHOOK_URL` | (opcional) |

`NEXT_PUBLIC_STORE_ROUTING=path` já vai no build do storefront via compose.

## Vitrine (milhares de lojas)

Modo **path**:

```text
https://lojas.chatia.qzz.io/{subdominio}
```

Ex.: subdomínio `rosas-perfumes` →  
`https://lojas.chatia.qzz.io/rosas-perfumes`

Não cadastrar cada loja no Coolify. Um domínio cobre todas.

## O que sobe

| Serviço | Função |
| --- | --- |
| `postgres` | Banco + RLS |
| `redis` | Cache / TTL |
| `api` | Fastify + workers |
| `admin` | Painel |
| `storefront` | Vitrine |

## Checklist

- [ ] `GET https://api…/health` → ok
- [ ] Admin login / criar loja
- [ ] Abrir `https://lojas…/{subdominio}`
- [ ] Connect To Predefined Network marcado
- [ ] Domains com `:3000` / `:3001` / `:3002`
