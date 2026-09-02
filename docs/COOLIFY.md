# Coolify — Catálogo Meta

App: **Facebook / production / Catalogo**. Não recriar.

**Cutover 2026-09-02:** produção na VPS. GitHub Actions desligados. Meta puxa o XML desta URL.

## Produção

| | |
|--|--|
| Domínio | `https://catalogo.grupourban.cloud` (porta interna **3000**) |
| Health | `GET /health` |
| Feed | `/facebook-home-listings.xml` e `.csv` |
| Cron | **01:00 BRT** sync → capas (concurrency 3) → feed |
| Meta | diário **04:00** → XML acima |
| Capas | SFTP `capas.grupourban.app` |
| Banco | Turso `catalogo-imoveis` |

Custom Docker options (General → Runtime): `--shm-size=1g`

## Preview por PR

- URL: `https://catalogo-pr-{{pr_id}}.grupourban.cloud`
- Env: `SYNC_DESLIGADO=1` + Turso (sem SFTP)
- Capa: `/?codigo=AP0221` — só leitura
- Merge em `main` publica o código; **JPG novo no Hostinger só na rodada 01:00**

## GitHub Actions

Workflows **disabled_manually**. O repo continua existindo: é a origem do Coolify. Não apagar o GitHub.
