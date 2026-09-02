/**
 * Processo longo do Coolify: HTTP + cron noturno (produção)
 * ou preview visual de capas (SYNC_DESLIGADO=1).
 *
 *   npm start
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
  let lastYmd = '';
  const tick = () => {
    const { ymd, hour } = brtClock();
    if (ymd === lastYmd) return;
    // Janela 01:00–01:59 BRT. Sem catch-up de tarde (não compete com o Tracking).
    if (hour === 1) {
      lastYmd = ymd;
      console.log(`[cron] Disparo do pipeline ${ymd} 01:h BRT`);
      void runNightlyPipeline();
    }
  };
  setInterval(tick, 20_000);
  tick();
  console.log('[cron] Pipeline diário: 01:00 BRT (sync → capas → feed, em sequência)');
}

async function main(): Promise<void> {
  loadDotEnv();
  const port = listenPort();
  const preview = isSyncDesligado();

  startHttpServer(port);

  if (preview) {
    watchPreviewTemplate('imovel-estatico-03');
    console.log('[boot] Preview: sem cron, sem SFTP, sem escrita no Turso.');
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
