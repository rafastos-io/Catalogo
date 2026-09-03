import { mkdirSync } from 'fs';
import { syncImoveisFromXML } from '../sync/xml-imoveis.js';
import { gerarCapasImoveis } from '../capas/gerar-capas.js';
import { gerarFeedFacebook } from '../facebook/gerar-feed.js';
import { capasConcurrency, feedOutDir } from '../runtime/flags.js';
import { getStatus, isCancelRequested, clearCancel, isPipelineRunning, markEnd, markStart, setPipelineRunning } from './status.js';
export { isPipelineRunning, requestCancel } from './status.js';

/**
 * Sequência noturna: sync → capas → feed.
 * O feed só roda depois das capas (não no relógio das 02:00), senão o CSV
 * sairia sem as capas geradas neste ciclo.
 */
export async function runNightlyPipeline(): Promise<void> {
  if (isPipelineRunning()) {
    console.warn('[pipeline] Já em andamento — ignorando disparo extra.');
    return;
  }

  clearCancel();
  setPipelineRunning(true);
  markStart('pipeline');
  const started = Date.now();
  console.log(
    `[pipeline] Início ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} BRT`,
  );

  try {
    if (!isCancelRequested()) await runIsolated('sync', runSync);
    if (!isCancelRequested()) await runIsolated('capas', runCapas);
    if (!isCancelRequested()) await runIsolated('feed', runFeed);
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    if (isCancelRequested()) {
      markEnd('pipeline', false, `cancelado após ${sec}s`);
      console.warn(`[pipeline] Cancelado após ${sec}s`);
    } else {
      markEnd('pipeline', true, `ok em ${sec}s`);
      console.log(`[pipeline] Concluído em ${sec}s`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markEnd('pipeline', false, msg);
    console.error('[pipeline] Falhou:', msg);
  } finally {
    setPipelineRunning(false);
    clearCancel();
    try {
      if (typeof (global as Record<string, unknown>).gc === 'function') {
        ((global as Record<string, unknown>).gc as () => void)();
        console.log('[pipeline] GC forçado após pipeline');
      }
    } catch { /* best-effort */ }
  }
}

async function runIsolated(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[pipeline] etapa ${name} falhou:`, err instanceof Error ? err.message : err);
  }
}

/** Só gera o CSV/XML a partir do Turso (sem sync/capas). Usado no boot de produção. */
export async function runFeed(): Promise<void> {
  markStart('feed');
  const outDir = feedOutDir();
  mkdirSync(outDir, { recursive: true });
  try {
    const r = await gerarFeedFacebook({ format: 'both', outDir });
    markEnd('feed', true, `${r.count} imóveis`);
    console.log(`[feed] ${r.count} imóveis → ${r.csvPath} / ${r.xmlPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markEnd('feed', false, msg);
    throw err;
  }
}

async function runSync(): Promise<void> {
  markStart('sync');
  try {
    const r = await syncImoveisFromXML(false, 0);
    const detail = `synced=${r.synced} inativos=${r.deactivated} erros=${r.errors} pulados=${r.skipped}`;
    const total = r.synced + r.errors;
    const errorRate = total > 0 ? r.errors / total : 0;
    if (errorRate > 0.05) {
      markEnd('sync', false, detail);
      throw new Error(`Taxa de erro do sync ${(errorRate * 100).toFixed(1)}% > 5%`);
    }
    markEnd('sync', true, detail);
    console.log(`[sync] ${detail}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markEnd('sync', false, msg);
    throw err;
  }
}

async function runCapas(): Promise<void> {
  markStart('capas');
  const concurrency = capasConcurrency();
  try {
    const r = await gerarCapasImoveis({ concurrency });
    const sample = r.sampleErrors?.length ? ` | ex: ${r.sampleErrors.slice(0, 2).join(' · ')}` : '';
    const detail = `gerados=${r.gerados} skip=${r.skippados} erros=${r.erros}${sample}`;
    const tentados = r.gerados + r.erros;
    const errorRate = tentados > 0 ? r.erros / tentados : 0;
    if (errorRate > 0.05) {
      markEnd('capas', false, detail);
      throw new Error(detail);
    }
    markEnd('capas', true, detail);
    console.log(`[capas] ${detail} concurrency=${concurrency}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Só sobrescreve se ainda não tiver contagem (ex.: crash antes do return)
    const prev = getStatus().jobs.capas;
    if (!prev.detail.startsWith('gerados=')) {
      markEnd('capas', false, msg);
    }
    throw err;
  }
}
