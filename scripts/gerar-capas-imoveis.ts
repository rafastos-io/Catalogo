/**
 * scripts/gerar-capas-imoveis.ts
 *
 * Gera capas (PNG 1080x1080) para os imóveis do catálogo usando o template
 * imovel-estatico-03. Sobe os PNGs para Cloudflare R2 e registra em
 * capas_imoveis (Turso) para controle incremental.
 *
 * Uso:
 *   npx tsx scripts/gerar-capas-imoveis.ts [--limit=N] [--concurrency=N] [--force]
 *
 * Variáveis de ambiente:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 *   PUPPETEER_EXECUTABLE_PATH (opcional — default: detecta Chrome do sistema)
 */

import { gerarCapasImoveis } from '../lib/capas/gerar-capas.js';

function parseArg(name: string): string | null {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

function parseNum(name: string, def: number): number {
  const v = parseArg(name);
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

function parseBool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const limit = parseNum('limit', 0);
  const concurrency = parseNum('concurrency', 10);
  const force = parseBool('force');
  const formato = parseArg('formato') ?? '1080x1080';
  const templateSlug = parseArg('template') ?? 'imovel-estatico-03';

  console.log('[capas] Iniciando geração de capas...');
  console.log(`[capas] Template: ${templateSlug} | Formato: ${formato} | Concurrency: ${concurrency}`);
  if (limit > 0) console.log(`[capas] DRY-RUN: limit=${limit}`);
  if (force) console.log('[capas] FORCE: regerando tudo (ignora incremental)');

  try {
    const r = await gerarCapasImoveis({ limit: limit > 0 ? limit : undefined, concurrency, formato, templateSlug, force });
    console.log('\n✅ Geração de capas concluída:');
    console.log(`   Total catálogo: ${r.total}`);
    console.log(`   Gerados:        ${r.gerados}`);
    console.log(`   Skippados:      ${r.skippados}`);
    console.log(`   Erros:          ${r.erros}`);
    console.log(`   Tempo:          ${Math.floor(r.durationMs / 1000)}s`);

    // Só falha o CI se mais de 5% dos processados erraram
    const tentados = r.gerados + r.erros;
    const errorRate = tentados > 0 ? r.erros / tentados : 0;
    if (errorRate > 0.05) {
      console.error(`❌ Taxa de erro ${(errorRate * 100).toFixed(1)}% > 5% — abortando com exit 1.`);
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro na geração de capas:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
