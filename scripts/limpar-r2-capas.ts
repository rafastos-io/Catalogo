/**
 * scripts/limpar-r2-capas.ts
 *
 * Remove TODAS as capas do R2 (todas versoes de todos os imoveis conhecidos).
 * Preserva outros objetos do bucket que nao sejam capas.
 *
 * Identificacao de capa: key = "{CODIGO}.png" ou "{CODIGO}_{ver}.png",
 * onde CODIGO eh um codigo presente na tabela imoveis. Assim nao tocamos
 * em outros objetos do R2 que possam existir (logos, assets, etc).
 *
 * Uso:
 *   npx tsx scripts/limpar-r2-capas.ts [--dry-run]
 *
 * Variaveis de ambiente:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 */

import { createClient } from '@libsql/client';
import { listAllKeys, deleteKeys, closeR2Client } from '../lib/capas/r2-storage.js';

function parseBool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const dryRun = parseBool('dry-run');

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN faltando');

  const turso = createClient({ url, authToken });

  console.log('[limpar-capas] Lendo codigos do Turso...');
  const rs = await turso.execute('SELECT codigo FROM imoveis');
  const codigos = new Set<string>();
  for (const row of rs.rows) {
    codigos.add(String(row.codigo).toUpperCase());
  }
  console.log(`[limpar-capas] ${codigos.size} codigos no catalogo`);

  console.log('[limpar-capas] Listando todos os objetos do R2...');
  const allKeys = await listAllKeys();
  console.log(`[limpar-capas] ${allKeys.length} objetos no bucket R2`);

  const capaKeys: string[] = [];
  for (const key of allKeys) {
    const upper = key.toUpperCase();
    for (const code of codigos) {
      if (upper === `${code}.PNG` || (upper.startsWith(`${code}_`) && upper.endsWith('.PNG'))) {
        capaKeys.push(key);
        break;
      }
    }
  }
  console.log(`[limpar-capas] ${capaKeys.length} capas detectadas no R2 (de ${codigos.size} imoveis conhecidos)`);

  if (capaKeys.length === 0) {
    console.log('[limpar-capas] Nenhuma capa para limpar.');
    closeR2Client();
    turso.close();
    process.exit(0);
  }

  const amostra = capaKeys.slice(0, 10);
  console.log(`[limpar-capas] Amostra (primeiros ${amostra.length}):`);
  for (const k of amostra) console.log(`  - ${k}`);
  if (capaKeys.length > amostra.length) {
    console.log(`  ... e mais ${capaKeys.length - amostra.length}`);
  }

  if (dryRun) {
    console.log(`\n[limpar-capas] DRY-RUN: nenhum objeto deletado.`);
    console.log('[limpar-capas] Rode sem --dry-run pra deletar de verdade.');
    closeR2Client();
    turso.close();
    process.exit(0);
  }

  console.log(`\n[limpar-capas] Deletando ${capaKeys.length} capas (lotes de 1000)...`);
  const deleted = await deleteKeys(capaKeys);
  console.log(`[limpar-capas] ${deleted} objetos deletados. Concluido.`);

  closeR2Client();
  turso.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[limpar-capas] Erro:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
