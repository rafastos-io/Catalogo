# Catalogo Sync (XML → Turso)

Sync incremental do feed XML de imóveis para o banco **Turso** (libSQL/SQLite).

**Produção:** VPS Coolify — `https://catalogo.grupourban.cloud` (`npm start`).  
Cron interno **01:00 BRT**: sync → capas → feed. O Meta puxa o XML às **04:00**.

O **GitHub não executa mais o catálogo.** O repo só guarda o código. Push em `main` → Coolify publica na VPS. Preview de PR → `catalogo-pr-{n}.grupourban.cloud` (capas visuais, sem gravar).

```
XML Kenlo  →  VPS 01:00 BRT  →  Turso
                 │
                 ├─ capas → SFTP capas.grupourban.app
                 └─ feed  → catalogo.grupourban.cloud
                              ↓
                    Meta Commerce Manager 04:00
```

Docs: `docs/COOLIFY.md` · `docs/PREVIEW-E-SYNC.md`

## Como desenvolver (vai para a VPS)

```
1. git checkout -b feature/ajuste-capa
2. commit + push
3. Abrir UM PR → Coolify sobe preview (SYNC_DESLIGADO=1)
   → https://catalogo-pr-{n}.grupourban.cloud/?codigo=AP0221
4. Merge em main → produção atualiza
5. Capas novas no storage saem na rodada das 01:00 (não no merge)
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `scripts/server.ts` | Processo Coolify: HTTP + cron 01:00 |
| `lib/sync/xml-imoveis.ts` | Fetch XML, diff incremental, upsert |
| `lib/facebook/gerar-feed.ts` | CSV + XML Home Listings |
| `lib/capas/gerar-capas.ts` | JPG 1080×1080 → SFTP Hostinger |
| `lib/capas/storage.ts` | Upload SFTP + URL pública |
| `Dockerfile` | Node 22 + Chromium |
| `schema.sql` | Schema `imoveis` (referência) |
| `.github/workflows/*` | **Desligados.** Rollback só se reativar no GitHub |

## Variáveis (Coolify, não GitHub Secrets)

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | URL `libsql://` do banco Turso |
| `TURSO_AUTH_TOKEN` | Token de acesso (full-access) |
| `IMOVEIS_XML_URL` | URL do feed XML externo de imóveis |
| `STORAGE_SFTP_*` | Hostinger das capas |
| `STORAGE_PUBLIC_URL` | `https://capas.grupourban.app` |
| `SYNC_DESLIGADO` | `1` só no preview |
| `CAPAS_CONCURRENCY` | Padrão `3` na VPS |

## Scripts npm

| Script | O que faz |
|---|---|
| `npm start` | Servidor Coolify (produção / preview) |
| `npm run sync:imoveis` | XML → Turso (incremental) |
| `npm run feed:facebook` | Gera CSV + XML em `out/` |
| `npm run capas:imoveis` | Gera capas e sobe via SFTP |
| `npm run capas:preview` | Preview local da capa |
| `npm run typecheck` | Verifica tipos TypeScript |

## Feed Facebook (Home Listings)

URL no Commerce Manager (produção):

- **XML:** `https://catalogo.grupourban.cloud/facebook-home-listings.xml`
- **CSV:** `https://catalogo.grupourban.cloud/facebook-home-listings.csv`

A branch GitHub `feed` é legado e **não** alimenta mais o Meta.

## Notas sobre a migração Supabase → Turso

- `fotos_urls` (array no Postgres) vira **JSON serializado em TEXT** no SQLite.
- Booleanos do Postgres viram **INTEGER 0/1** no SQLite.
- `ON CONFLICT(codigo) DO UPDATE SET ...` substitui o `upsert`/`onConflict`
  do client Supabase.
