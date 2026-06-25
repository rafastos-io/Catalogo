/**
 * scripts/popular-content-hash.ts
 *
 * One-shot: popula content_hash em capas_imoveis para todas as capas
 * existentes, sem regerar nada. Roda uma vez apos adicionar a coluna.
 *
 * Uso: npx tsx scripts/popular-content-hash.ts
 *
 * Variaveis de ambiente:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

import { createClient } from '@libsql/client';
import { computeContentHash } from '../lib/capas/content-hash.js';

const COLS = [
  'codigo', 'tipo_imovel', 'subtipo_imovel', 'bairro', 'cidade', 'finalidade',
  'quartos', 'suites', 'banheiros', 'salas', 'vagas', 'area_util',
  'valor_venda', 'valor_aluguel', 'foto_principal_url', 'fotos_urls',
].join(', ');

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN faltando');

  const turso = createClient({ url, authToken });

  console.log('[hash] Lendo imoveis ativos do Turso (cursor pagination)...');
  const imoveis: Array<Record<string, unknown> & { codigo: string }> = [];
  let cursor = '';
  while (true) {
    const rs = await turso.execute({
      sql: `SELECT ${COLS} FROM imoveis WHERE status_anuncio = 'Ativo' AND codigo > ? ORDER BY codigo LIMIT 1000`,
      args: [cursor],
    });
    if (rs.rows.length === 0) break;
    for (const row of rs.rows) imoveis.push(row as unknown as Record<string, unknown> & { codigo: string });
    cursor = String(rs.rows[rs.rows.length - 1].codigo);
    if (rs.rows.length < 1000) break;
  }
  console.log(`[hash] ${imoveis.length} imoveis ativos carregados`);

  console.log('[hash] Populando content_hash em capas_imoveis...');
  let updated = 0;
  let skipped = 0;
  const BATCH = 50;
  for (let i = 0; i < imoveis.length; i += BATCH) {
    const batch = imoveis.slice(i, i + BATCH);
    const promises = batch.map(async (im) => {
      const hash = computeContentHash(im as never);
      const code = String(im.codigo).toUpperCase();
      const r = await turso.execute({
        sql: 'UPDATE capas_imoveis SET content_hash = ? WHERE codigo = ? AND (content_hash IS NULL OR content_hash != ?)',
        args: [hash, code, hash],
      });
      if (r.rowsAffected > 0) updated++;
      else skipped++;
    });
    await Promise.all(promises);
    if ((i + BATCH) % 1000 === 0 || i + BATCH >= imoveis.length) {
      console.log(`[hash]   ${Math.min(i + BATCH, imoveis.length)}/${imoveis.length} processados (updated: ${updated}, skipped: ${skipped})`);
    }
  }

  console.log(`\n[hash] Concluido: ${updated} atualizados, ${skipped} ja tinham hash (ou sem capa).`);
  turso.close();
}

main().catch((err) => {
  console.error('\n[hash] Erro:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
