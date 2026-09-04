/**
 * Processo longo do Coolify: HTTP + cron diário (produção)
 * ou preview visual de capas (SYNC_DESLIGADO=1).
 *
 *   npm start
 *
 * Crons BRT (produção):
 *   01:00 — pipeline completo (sync → capas → feed)
 *   12:00 — idem (pega XML Gaia que atrasa após a carga noturna)
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { isSyncDesligado, listenPort } from '../lib/runtime/flags.js';
import { startHttpServer } from '../lib/http/handler.js';
import { runFeed, runNightlyPipeline } from '../lib/jobs/pipeline.js';
import { watchPreviewTemplate } from '../lib/capas/preview-page.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'America/Sao_Paulo';

/** Horários BRT (hora cheia) em que o pipeline roda 1x por janela. */
const CRON_HOURS_BRT = [1, 12] as const;

function loadDotEnv(): void {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}

function brtClock(): { ymd: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

function startNightlyScheduler(): void {
  // Chave = `${ymd}@${hour}` — permite 01h e 12h no mesmo dia, sem re-disparo na mesma janela.
  const fired = new Set<string>();
  const tick = () => {
    const { ymd, hour } = brtClock();
    if (!(CRON_HOURS_BRT as readonly number[]).includes(hour)) return;
    const key = `${ymd}@${hour}`;
    if (fired.has(key)) return;
    fired.add(key);
    // Mantém só chaves do dia corrente.
    for (const k of [...fired]) {
      if (!k.startsWith(`${ymd}@`)) fired.delete(k);
    }
    console.log(`[cron] Disparo do pipeline ${ymd} ${String(hour).padStart(2, '0')}:h BRT`);
    void runNightlyPipeline();
  };
  setInterval(tick, 20_000);
  tick();
  console.log(
    `[cron] Pipeline diário: ${CRON_HOURS_BRT.map((h) => `${String(h).padStart(2, '0')}:00`).join(' e ')} BRT (sync → capas → feed)`,
  );
}

async function main(): Promise<void> {
  loadDotEnv();
  const port = listenPort();
  const preview = isSyncDesligado();

  startHttpServer(port);

  if (preview) {
    watchPreviewTemplate('imovel-estatico-03');
    console.log('[boot] Preview: sem cron, sem FTPS, sem escrita no Turso.');
    return;
  }

  try {
    await runFeed();
  } catch (err) {
    console.warn('[boot] Feed inicial falhou (sobe mesmo assim):', err instanceof Error ? err.message : err);
  }

  startNightlyScheduler();
}

main().catch((err) => {
  console.error('[boot] Fatal:', err);
  process.exit(1);
});
