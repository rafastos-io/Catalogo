# Coolify — Catálogo Meta

App já criado: **Facebook / production / Catalogo**. Não recriar.

Depois do merge (ou no preview do PR), no painel:

## Build

1. **General → Build strategy:** `Dockerfile` (sair do Railpack / Nixpacks)
2. Porta interna: `3000`
3. Domínio: `https://catalogo.grupourban.cloud:3000` (já está)
4. **Advanced → Custom Docker options:** `--shm-size=1g`  
   (Chromium precisa de /dev/shm maior; o código também usa `--disable-dev-shm-usage`)

## Healthcheck (ligar só com este código no ar)

- Enable
- GET `http` `localhost` porta **3000** path **`/health`** (não 80, não `/`)
- Expected 200
- Start period 40s

## Preview

- Template: `https://catalogo-pr-{{pr_id}}.grupourban.cloud:3000`
- Env: `SYNC_DESLIGADO=1` + Turso (sem SFTP)
- Abre `/?codigo=AP0221` para ver a capa. Não grava banco nem Hostinger.

## Produção

Cron interno 01:00 BRT: sync → capas (concurrency 3) → feed, em sequência.  
Feed público:

- `https://catalogo.grupourban.cloud/facebook-home-listings.csv`
- `https://catalogo.grupourban.cloud/facebook-home-listings.xml`

**Não trocar a URL no Commerce Manager** até o teste passar. O GitHub Actions segue no ar.

## Resource Limits (Operations, final da sidebar)

Teto sugerido: Memory **2048 MB**, CPU **2**. Não é reserva — o idle usa pouco.
