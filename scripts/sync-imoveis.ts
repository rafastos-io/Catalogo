/**
 * scripts/sync-imoveis.ts
 *
 * Script standalone para sincronização completa dos imóveis (XML → Turso).
 * Roda via GitHub Actions (sem limite de tempo do Vercel).
 *
 * Uso:
 *   npx tsx scripts/sync-imoveis.ts
 *
 * Variáveis de ambiente necessárias:
 *   TURSO_DATABASE_URL   — URL libsql:// do banco Turso
 *   TURSO_AUTH_TOKEN     — token de acesso (full-access)
 *   IMOVEIS_XML_URL      — URL do feed XML externo de imóveis
 */

import { syncImoveisFromXML } from '../lib/sync/xml-imoveis.js';

async function main() {
  console.log('[sync] Iniciando sincronização completa de imóveis (XML → Turso)...');
  console.log(`[sync] Horário: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (BRT)`);

  const start = Date.now();

  try {
    // Budget de 10 minutos
    const result = await syncImoveisFromXML(false, 600_000);

    const duration = ((Date.now() - start) / 1000).toFixed(1);

    console.log('\n✅ Sincronização concluída:');
    console.log(`   Sincronizados: ${result.synced}`);
    console.log(`   Erros:         ${result.errors}`);
    console.log(`   Pulados:       ${result.skipped}`);
    console.log(`   Tempo total:   ${duration}s`);

    const total = result.synced + result.errors;
    const errorRate = total > 0 ? result.errors / total : 0;

    if (result.errors > 0) {
      console.warn(`\n⚠️  ${result.errors} registros com erro (${(errorRate * 100).toFixed(1)}%).`);
    }

    // Só falha o CI se mais de 5% dos registros erraram
    if (errorRate > 0.05) {
      console.error('❌ Taxa de erro acima de 5% — abortando com exit 1.');
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro na sincronização:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
