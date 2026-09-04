# Catalogo Sync (XML → Turso → capas → feed Meta)

Sync incremental do feed XML de imóveis para o **Turso**, geração de capas JPG e feed Facebook Home Listings.

**Produção:** VPS Coolify — `https://catalogo.grupourban.cloud` (`npm start`).  
Crons internos **01:00 e 12:00 BRT**: sync → capas → feed. O Meta puxa o XML às **04:00**.

O **GitHub não executa mais o catálogo.** O repo só guarda o código. Push em `main` → Coolify publica na VPS. Preview de PR → `catalogo-pr-{n}.grupourban.cloud` (capas visuais, sem gravar).

```
XML Gaia/Kenlo  →  VPS 01:00 e 12:00 BRT  →  Turso
                      │
                      ├─ capas → FTPS Hostinger (porta 21) → capas.grupourban.app
                      └─ feed  → catalogo.grupourban.cloud
                                   ↓
                         Meta Commerce Manager 04:00
```

Docs: [`docs/COOLIFY.md`](docs/COOLIFY.md) · [`docs/PREVIEW-E-SYNC.md`](docs/PREVIEW-E-SYNC.md)

## Como desenvolver (vai para a VPS)

```
1. git checkout -b feature/ajuste-capa
2. commit + push
3. Abrir UM PR → Coolify sobe preview (SYNC_DESLIGADO=1)
   → https://catalogo-pr-{n}.grupourban.cloud/?codigo=AP0221
4. Merge em main → produção atualiza
5. Capas novas no storage saem nas rodadas 01:00 / 12:00 (ou via POST /trigger)
```

**Env nova no Coolify:** em geral basta **Restart**. **Deploy** completo só quando muda código/Dockerfile (rebuild demora por causa do Chromium).

## Arquivos

| Arquivo | Papel |
|---|---|
| `scripts/server.ts` | Processo Coolify: HTTP + cron 01:00 e 12:00 BRT |
| `lib/sync/xml-imoveis.ts` | Fetch XML, diff incremental, upsert |
| `lib/facebook/gerar-feed.ts` | CSV + XML Home Listings |
| `lib/capas/gerar-capas.ts` | JPG → FTPS Hostinger (incremental + fail-fast) |
| `lib/capas/storage.ts` | Upload **FTPS** (porta 21) + URL pública |
| `lib/capas/screenshot.ts` | Puppeteer offline (foto/logo em data URI) |
| `lib/jobs/pipeline.ts` | Orquestra sync → capas → feed |
| `Dockerfile` | Node 22 + Chromium |
| `schema.sql` | Schema `imoveis` (referência) |

## Endpoints (produção)

| Método | Path | Auth | Uso |
|---|---|---|---|
| `GET` | `/health` | — | Status + progresso dos jobs |
| `GET` | `/facebook-home-listings.xml` / `.csv` | — | Feed Meta |
| `POST` | `/trigger?token=…` | `PIPELINE_TRIGGER_TOKEN` | Dispara pipeline agora |
| `POST` | `/cancel?token=…` | idem | Pede cancelamento do pipeline |
| `GET` | `/sftp-test?token=…` | idem | Testa FTPS (sobe e apaga probe) |

Exemplo:

```bash
curl -X POST "https://catalogo.grupourban.cloud/trigger?token=$PIPELINE_TRIGGER_TOKEN"
curl "https://catalogo.grupourban.cloud/sftp-test?token=$PIPELINE_TRIGGER_TOKEN"
```

## Variáveis (Coolify)

| Variável | Descrição |
|---|---|
| `TURSO_DATABASE_URL` | URL `libsql://` do banco Turso |
| `TURSO_AUTH_TOKEN` | Token full-access |
| `IMOVEIS_XML_URL` | URL do feed XML Gaia (`GaiaWebServiceImovel`) |
| `STORAGE_SFTP_HOST` | IP/host Hostinger (ex. `82.112.247.242`) |
| `STORAGE_SFTP_PORT` | **`21`** (FTPS). Não usar `65002` — conta FTP não autentica em SFTP |
| `STORAGE_SFTP_USER` | Conta FTP capas (ex. `u237475489.urbangrupobr`) |
| `STORAGE_SFTP_PASS` | Senha da conta FTP (hPanel → Contas FTP → **Mudar senha** da conta de baixo) |
| `STORAGE_REMOTE_DIR` | `/` (chroot na pasta capas) |
| `STORAGE_PUBLIC_URL` | `https://capas.grupourban.app` |
| `STORAGE_POOL_SIZE` | `1` |
| `CAPAS_CONCURRENCY` | **`1`** (Hostinger não aguenta upload paralelo) |
| `PIPELINE_TRIGGER_TOKEN` | Segredo para `/trigger`, `/cancel`, `/sftp-test` |
| `SYNC_DESLIGADO` | `1` só no preview |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` |

## Storage Hostinger (FTPS)

A conta FTP dedicada às capas autentica em **FTP/FTPS porta 21**, **não** em SFTP `65002`.

1. hPanel → Arquivos → Contas FTP  
2. Conta `…urbangrupobr` (diretório = `…/public_html/capas`) → **Mudar senha** (botão de baixo, não “Alterar senha FTP” da conta principal)  
3. Coolify: mesma senha em `STORAGE_SFTP_PASS`, porta `21`  
4. Validar: `GET /sftp-test?token=…` → `ok: true`, `uploaded/deleted: true`

FileZilla (teste manual): Host `ftp://IP` ou `sftp://` só se for SSH; para esta conta use **FTP/FTPS porta 21**.

## Capas (comportamento)

- Incremental por **content hash** — só regenera o que mudou ou falta no storage  
- Foto do imóvel baixada em RAM (data URI); Chromium sem rede externa  
- **Fail-fast:** 5 erros de storage seguidos → aborta (não fica horas em retry)  
- Progresso no `/health`: `em andamento X/Y ok=… erros=…`

## Cron e atraso do XML Gaia

A mídia `GaiaWebServiceImovel` (`IMOVEIS_XML_URL`) **atrasa** em relação ao Kenlo IMOB e ao “Histórico de cargas”:

- Imóvel **Ativo** no painel Kenlo ≠ necessariamente no XML na mesma hora  
- A carga automática (ex. 22:05) pode aparecer na URL do midia só horas depois  
- Por isso há **dois** pipelines/dia: **01:00** (antes do Meta 04:00) e **12:00** (pega o que entrou de manhã)

O sync só enxerga o que a URL entrega naquele momento. Contagem Kenlo “ativados ontem” pode incluir códigos que **nunca** vão para essa mídia.

## Scripts npm

| Script | O que faz |
|---|---|
| `npm start` | Servidor Coolify (produção / preview) |
| `npm run sync:imoveis` | XML → Turso (incremental) |
| `npm run feed:facebook` | Gera CSV + XML em `out/` |
| `npm run capas:imoveis` | Gera capas e sobe via FTPS |
| `npm run capas:preview` | Preview local da capa |
| `npm run typecheck` | Verifica tipos TypeScript |

## Feed Facebook (Home Listings)

- **XML:** `https://catalogo.grupourban.cloud/facebook-home-listings.xml`
- **CSV:** `https://catalogo.grupourban.cloud/facebook-home-listings.csv`

A branch GitHub `feed` é legado e **não** alimenta mais o Meta.

## Notas

- Captação no CRM ≠ imóvel novo no XML.  
- `fotos_urls` no Turso é JSON em TEXT; booleanos são INTEGER 0/1.
