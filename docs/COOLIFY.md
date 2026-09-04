# Coolify — Catálogo Meta

App: **Facebook / production / Catalogo**. Não recriar.

**Cutover 2026-09-02:** produção na VPS. GitHub Actions desligados. Meta puxa o XML desta URL.

## Produção

| | |
|--|--|
| Domínio | `https://catalogo.grupourban.cloud` (porta interna **3000**) |
| Health | `GET /health` (inclui progresso das capas e `cancelRequested`) |
| Feed | `/facebook-home-listings.xml` e `.csv` |
| Cron | **01:00 e 12:00 BRT** — sync → capas → feed (pipeline completo) |
| Trigger | `POST /trigger?token=$PIPELINE_TRIGGER_TOKEN` |
| Cancel | `POST /cancel?token=…` |
| Teste storage | `GET /sftp-test?token=…` (FTPS probe) |
| Meta | diário **04:00** → XML acima |
| Capas | **FTPS porta 21** → `capas.grupourban.app` |
| Banco | Turso `catalogo-imoveis` |
| Concurrency | `CAPAS_CONCURRENCY=1` |

Custom Docker options (General → Runtime): `--shm-size=1g`

### Por que 01:00 e 12:00?

1. **01:00 BRT** — atualiza Turso/capas/feed **antes** do Meta puxar às 04:00.  
2. **12:00 BRT** — a mídia Gaia (`IMOVEIS_XML_URL`) costuma atrasar horas em relação ao Kenlo / “Histórico de cargas”; o meio-dia pega imóveis que entraram no XML de manhã.

Cada janela dispara **uma vez** (`ymd@hora`). Se o pipeline da 01h ainda estiver rodando às 12h, o segundo disparo é ignorado (`pipeline já em andamento`) — raro, jobs costumam fechar em minutos.

### Env storage (Hostinger)

```
STORAGE_SFTP_HOST=82.112.247.242
STORAGE_SFTP_PORT=21
STORAGE_SFTP_USER=u237475489.urbangrupobr
STORAGE_SFTP_PASS=<senha Contas FTP → Mudar senha da conta urbangrupobr>
STORAGE_REMOTE_DIR=/
STORAGE_PUBLIC_URL=https://capas.grupourban.app
STORAGE_POOL_SIZE=1
```

**Não use porta 65002** com essa conta FTP — SFTP falha com `authentication methods failed`. FTPS:21 é o protocolo correto.

Mudou só senha/env → **Restart**. Mudou código → **Deploy** (rebuild com Chromium pode levar vários minutos).

Evite colar **Show Debug Logs** em chats: o Coolify injeta secrets como `ARG` e o log pode vazar tokens.

## Preview por PR

- URL: `https://catalogo-pr-{{pr_id}}.grupourban.cloud`
- Env: `SYNC_DESLIGADO=1` + Turso (sem storage de escrita)
- Capa: `/?codigo=AP0221` — só leitura
- Merge em `main` publica o código; **JPG novo no Hostinger** nas rodadas 01:00 / 12:00 ou via `/trigger`

## GitHub Actions

Workflows **disabled_manually**. O repo continua existindo: é a origem do Coolify. Não apagar o GitHub.
