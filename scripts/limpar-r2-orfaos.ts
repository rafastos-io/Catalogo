/**
 * scripts/limpar-r2-orfaos.ts
 *
 * One-shot: remove do R2 todas as capas que nao sao a versao "viva" atual.
 *
 * Considera "viva" a key = capaKey(codigo, ultima_atualizacao_gerada) pra cada
 * row em capas_imoveis. Qualquer outra key no bucket (versao antiga de um imovel
 * que foi atualizado, ou capa de imovel que sumiu do catalogo) = orfao.
 *
 * Uso:
 *   npx tsx scripts/limpar-r2-orfaos.ts [--dry-run]
 *
 * Variaveis de ambiente:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 */

import { createClient } from '@libsql/client';
import { capaKey, listAllKeys, deleteKeys, closeR2Client } from '../lib/capas/r2-storage.js';

function parseBool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const dryRun = parseBool('dry-run');

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN faltando');

  const turso = createClient({ url, authToken });

  console.log('[limpar-orfaos] Lendo capas_imoveis do Turso...');
  const rs = await turso.execute('SELECT codigo, ultima_atualizacao_gerada FROM capas_imoveis');
  const liveKeys = new Set<string>();
  for (const row of rs.rows) {
    const codigo = String(row.codigo);
    const ver = (row.ultima_atualizacao_gerada as string | null) ?? null;
    liveKeys.add(capaKey(codigo, ver));
  }
  console.log(`[limpar-orfaos] ${liveKeys.size} capas vivas registradas no banco`);

  console.log('[limpar-orfaos] Listando todos os objetos do R2 (isso pode levar alguns instantes)...');
  const allKeys = await listAllKeys();
  console.log(`[limpar-orfaos] ${allKeys.length} objetos no bucket R2`);

  const orphans = allKeys.filter((k) => !liveKeys.has(k));
  console.log(`[limpar-orfaos] ${orphans.length} orfaos detectados`);

  if (orphans.length === 0) {
    console.log('[limpar-orfaos] Nada a limpar. Bucket ja esta enxuto.');
    closeR2Client();
    turso.close();
    process.exit(0);
  }

  // amostra pra conferencia visual
  const amostra = orphans.slice(0, 10);
  console.log(`[limpar-orfaos] Amostra (primeiros ${amostra.length}):`);
  for (const k of amostra) console.log(`  - ${k}`);
  if (orphans.length > amostra.length) {
    console.log(`  ... e mais ${orphans.length - amostra.length}`);
  }

  if (dryRun) {
    console.log(`\n[limpar-orfaos] DRY-RUN: nenhum objeto foi deletado.`);
    console.log('[limpar-orfaos] Rode sem --dry-run pra deletar de verdade.');
    closeR2Client();
    turso.close();
    process.exit(0);
  }

  console.log(`\n[limpar-orfaos] Deletando ${orphans.length} orfaos (lotes de 1000)...`);
  const deleted = await deleteKeys(orphans);
  console.log(`[limpar-orfaos] ${deleted} objetos deletados.`);
  console.log('[limpar-orfaos] Concluido.');

  closeR2Client();
  turso.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[limpar-orfaos] Erro:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
