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
| `scripts/sync-imoveis.ts` | Runner standalone (entry point) — budget 10 min |
| `lib/sync/xml-imoveis.ts` | Núcleo: fetch XML, parse, diff incremental, upsert |
| `schema.sql` | Schema da tabela `imoveis` (referência) |

## Variáveis de ambiente (GitHub Secrets)

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | URL `libsql://` do banco Turso |
| `TURSO_AUTH_TOKEN` | Token de acesso (full-access) |
| `IMOVEIS_XML_URL` | URL do feed XML externo de imóveis |

## Rodar localmente

```bash
cp .env.example .env   # preencha os 3 valores
npm install
npm run sync:imoveis
```

## Disparar manualmente

- **GitHub:** aba *Actions* → *Sync Imóveis* → *Run workflow*.
- A primeira execução faz carga completa (banco vazio). As seguintes são
  incrementais (só reescreve imóveis cuja `ultima_atualizacao` mudou).

## Notas sobre a migração Supabase → Turso

- `fotos_urls` (array no Postgres) vira **JSON serializado em TEXT** no SQLite.
- Booleanos do Postgres viram **INTEGER 0/1** no SQLite.
- `ON CONFLICT(codigo) DO UPDATE SET ...` substitui o `upsert`/`onConflict`
  do client Supabase.
- O path de cache via Supabase Storage foi removido (não se aplica ao Turso);
  o sync sempre baixa o XML direto da URL.
