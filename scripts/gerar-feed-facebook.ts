/**
 * scripts/gerar-feed-facebook.ts
 *
 * Gera o feed de Home Listings do Facebook a partir do Turso.
 * Produz CSV + XML em out/ (configurável).
 *
 * Uso:
 *   npx tsx scripts/gerar-feed-facebook.ts [--format=csv|xml|both] [--out=out]
 *
 * Variáveis de ambiente:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

import { gerarFeedFacebook, type FeedFormat } from '../lib/facebook/gerar-feed.js';

function parseArg(name: string): string | null {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

async function main() {
  const format = (parseArg('format') as FeedFormat) ?? 'both';
  const out = parseArg('out') ?? 'out';

  console.log('[fb-feed] Iniciando geração do feed Facebook...');
  console.log(`[fb-feed] Formato: ${format} | Saída: ${out}/`);

  try {
    const r = await gerarFeedFacebook({ format, outDir: out });
    console.log('\n✅ Feed gerado:');
    console.log(`   Imóveis:  ${r.count}`);
    console.log(`   CSV:      ${r.csvPath ?? '—'}`);
    console.log(`   XML:      ${r.xmlPath ?? '—'}`);
    console.log(`   Tempo:    ${r.durationMs}ms`);
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Erro ao gerar feed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
