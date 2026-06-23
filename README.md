# Catalogo Sync (XML → Turso)

Sync incremental do feed XML de imóveis para o banco **Turso** (libSQL/SQLite).
Roda diariamente via GitHub Actions (19h BRT) e faz upsert apenas dos imóveis
novos ou alterados.

```
┌─────────────────┐   cron diário    ┌──────────────────────┐
│ GitHub Actions  │ ───────────────► │ scripts/             │
│ sync-imoveis.yml│  19:00 BRT       │ sync-imoveis.ts      │
└─────────────────┘                  └──────────┬───────────┘
                                                 │ chama
                                                 ▼
                           ┌─────────────────────────────────────┐
                           │ lib/sync/xml-imoveis.ts             │
                           │ syncImoveisFromXML()                │
                           │  1. fetch XML externo               │
                           │  2. parse + mapImovel()             │
                           │  3. diff incremental vs. banco      │
                           │  4. batch upsert (ON CONFLICT)      │
                           └──────────────────┬──────────────────┘
                                              ▼
                                   ┌──────────────────────┐
                                   │ Turso (libSQL)       │
                                   │ tabela `imoveis`     │
                                   └──────────────────────┘
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `.github/workflows/sync-imoveis.yml` | Gatilho — cron diário + secrets |
| `.github/workflows/gerar-feed-facebook.yml` | Gatilho — após sync, gera e publica feed Facebook |
| `scripts/sync-imoveis.ts` | Runner standalone (entry point) — budget 10 min |
| `scripts/gerar-feed-facebook.ts` | Runner do feed Facebook |
| `lib/sync/xml-imoveis.ts` | Núcleo: fetch XML, parse, diff incremental, upsert |
| `lib/facebook/converters.ts` | Conversores puros (Turso → Facebook enums/formatos) |
| `lib/facebook/gerar-feed.ts` | Gera CSV + XML no formato Home Listings |
| `lib/capas/storage.ts` | Upload de JPGs via SFTP pra Hostinger (URL pública + controle incremental) |
| `lib/capas/r2-storage.ts` | **Legado** — só usado pelos scripts de limpeza do R2 (`r2:limpar-*`) |
| `schema.sql` | Schema da tabela `imoveis` (referência) |

## Variáveis de ambiente (GitHub Secrets)

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | URL `libsql://` do banco Turso |
| `TURSO_AUTH_TOKEN` | Token de acesso (full-access) |
| `IMOVEIS_XML_URL` | URL do feed XML externo de imóveis |
| `STORAGE_SFTP_HOST` | Host do SFTP Hostinger (ex: `srvXXX.main-hosting.eu`) |
| `STORAGE_SFTP_PORT` | Porta SFTP (sempre `6502` na Hostinger) |
| `STORAGE_SFTP_USER` | Usuário da conta FTP dedicada (ex: `u123456789.capas`) |
| `STORAGE_SFTP_PASS` | Senha da conta FTP dedicada |
| `STORAGE_PUBLIC_URL` | URL pública do domínio (ex: `https://seudominio.com.br`) |
| `STORAGE_REMOTE_DIR` | Caminho absoluto da pasta `capas/` no servidor |

## Scripts npm

| Script | O que faz |
|---|---|
| `npm run sync:imoveis` | Sincroniza XML → Turso (incremental) |
| `npm run feed:facebook` | Gera feed Facebook (CSV + XML) em `out/` |
| `npm run capas:imoveis` | Gera capas (JPG 1080x1080 q85) e sobe via SFTP pra Hostinger |
| `npm run r2:limpar-orfaos` | **Legado** — limpa capas órfãs do R2 |
| `npm run r2:limpar-capas` | **Legado** — remove todas as capas do R2 |
| `npm run storage:limpar-orfaos` | Limpa capas órfãs do Cloudinary |
| `npm run typecheck` | Verifica tipos TypeScript |

## Rodar localmente

```bash
cp .env.example .env   # preencha os 3 valores
npm install
npm run sync:imoveis
```

## Disparar manualmente

- **Sync:** GitHub → aba *Actions* → *Sync Imóveis* → *Run workflow*.
- **Feed Facebook:** GitHub → aba *Actions* → *Gerar Feed Facebook* → *Run workflow*.
- O feed também roda automaticamente após cada sync bem-sucedido.

## Feed Facebook (Home Listings)

Após rodar, o workflow publica os arquivos na branch `feed` (orphan, 1 commit):

- **CSV:** `https://raw.githubusercontent.com/rafastos-io/Catalogo/feed/facebook-home-listings.csv`
- **XML:** `https://raw.githubusercontent.com/rafastos-io/Catalogo/feed/facebook-home-listings.xml`

Use uma dessas URLs no **Facebook Commerce Manager** → *Catalog* → *Data Sources*
→ *Add feed* → *Scheduled feed*. O Facebook busca diariamente.

O mapeamento completo campo-a-campo está em
`../exports-funcionalidades/de-para-facebook-home-listings.md`.

## Notas sobre a migração Supabase → Turso

- `fotos_urls` (array no Postgres) vira **JSON serializado em TEXT** no SQLite.
- Booleanos do Postgres viram **INTEGER 0/1** no SQLite.
- `ON CONFLICT(codigo) DO UPDATE SET ...` substitui o `upsert`/`onConflict`
  do client Supabase.
- O path de cache via Supabase Storage foi removido (não se aplica ao Turso);
  o sync sempre baixa o XML direto da URL.
