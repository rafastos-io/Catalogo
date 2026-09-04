# Preview vs produção (sync)

| | Produção (`main`) | Preview (`SYNC_DESLIGADO=1`) |
|--|-------------------|------------------------------|
| HTTP | `/health` + feed CSV/XML | `/health` + capa visual |
| Cron 01:00 | sync → capas → feed | **desligado** |
| Turso | leitura e escrita | **só leitura** |
| SFTP/FTPS capas.grupourban.app | sim (FTPS:21) | **não** |
| Uso | dia a dia | mudança visual de capa |

Sem `SYNC_DESLIGADO=1` no preview, um PR reescreve o catálogo de produção e sobe JPG na Hostinger.

**Próxima alteração de capa:** branch + PR → conferir no preview → merge. As JPGs de produção atualizam na madrugada (01:00), não no instante do merge.
