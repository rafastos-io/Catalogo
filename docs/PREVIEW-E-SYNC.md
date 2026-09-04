# Preview vs produção (sync)

| | Produção (`main`) | Preview (`SYNC_DESLIGADO=1`) |
|--|-------------------|------------------------------|
| HTTP | `/health` + feed CSV/XML | `/health` + capa visual |
| Cron 01:00 e 12:00 BRT | sync → capas → feed | **desligado** |
| Turso | leitura e escrita | **só leitura** |
| FTPS capas.grupourban.app | sim (porta 21) | **não** |
| Uso | dia a dia | mudança visual de capa |

Sem `SYNC_DESLIGADO=1` no preview, um PR reescreve o catálogo de produção e sobe JPG na Hostinger.

**Próxima alteração de capa:** branch + PR → conferir no preview → merge. As JPGs de produção atualizam nas rodadas **01:00 / 12:00 BRT** (ou `/trigger`), não no instante do merge.

**XML Gaia:** a URL do midia atrasa vs Kenlo — por isso o segundo cron ao meio-dia. Detalhes em `README.md` e `docs/COOLIFY.md`.
