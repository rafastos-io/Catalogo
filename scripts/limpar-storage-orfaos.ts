/**
 * scripts/limpar-storage-orfaos.ts
 *
 * One-shot: remove do storage SFTP (Hostinger) todas as capas que nao sao
 * a versao "viva" atual.
 *
 * Considera "viva" a key derivada do capa_url gravado em capas_imoveis
 * (basename da URL). Isso e independente do esquema de nomes da capa —
 * sempre reflete o arquivo que o feed realmente aponta. Qualquer outro
 * arquivo .jpg na pasta capas/ do storage que nao casa e orfao.
 *
 * Uso:
 *   npx tsx scripts/limpar-storage-orfaos.ts [--dry-run]
 *
 * Variaveis de ambiente:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *   STORAGE_SFTP_HOST, STORAGE_SFTP_PORT, STORAGE_SFTP_USER, STORAGE_SFTP_PASS,
 *   STORAGE_PUBLIC_URL, STORAGE_REMOTE_DIR
 */

import { createClient } from '@libsql/client';
import { listAllKeys, deleteKeys, closeStorageClient } from '../lib/capas/storage.js';

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
  const rs = await turso.execute('SELECT capa_url FROM capas_imoveis');
  const liveKeys = new Set<string>();
  for (const row of rs.rows) {
    const url = (row.capa_url as string | null) ?? '';
    if (!url) continue;
    const key = url.split('/').pop(); // basename = key (arquivos ficam na raiz de capas/)
    if (key) liveKeys.add(key);
  }
  console.log(`[limpar-orfaos] ${liveKeys.size} capas vivas registradas no banco`);

  console.log('[limpar-storage] Listando todos os arquivos da pasta capas/ no SFTP...');
  const allKeys = await listAllKeys();
  console.log(`[limpar-storage] ${allKeys.length} arquivos no storage`);

  const orphans = allKeys.filter((id) => !liveKeys.has(id));
  console.log(`[limpar-storage] ${orphans.length} orfaos detectados`);

  if (orphans.length === 0) {
    console.log('[limpar-storage] Nada a limpar. Storage ja esta enxuto.');
    closeStorageClient();
    turso.close();
    process.exit(0);
  }

  const amostra = orphans.slice(0, 10);
  console.log(`[limpar-storage] Amostra (primeiros ${amostra.length}):`);
  for (const k of amostra) console.log(`  - ${k}`);
  if (orphans.length > amostra.length) {
    console.log(`  ... e mais ${orphans.length - amostra.length}`);
  }

  if (dryRun) {
    console.log(`\n[limpar-storage] DRY-RUN: nenhum arquivo deletado.`);
    console.log('[limpar-storage] Rode sem --dry-run pra deletar de verdade.');
    closeStorageClient();
    turso.close();
    process.exit(0);
  }

  console.log(`\n[limpar-storage] Deletando ${orphans.length} orfaos...`);
  const deleted = await deleteKeys(orphans);
  console.log(`[limpar-storage] ${deleted} arquivos deletados. Concluido.`);

  closeStorageClient();
  turso.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[limpar-storage] Erro:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
