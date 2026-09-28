/**
 * scripts/test-pipeline-health.ts
 *
 * Teste de lógica local. Não toca Turso, storage, rede nem o pipeline real.
 * Roda: npm run test:pipeline
 *
 * Valida:
 *   - agregado do pipeline fica falso se sync, capas ou feed falha;
 *   - a etapa seguinte não roda;
 *   - ciclo com as três etapas ok continua ok;
 *   - feed vencido: sem arquivo, mais de 14 h, ou depois das 04:30 BRT
 *     ainda anterior ao ciclo das 01:00 do mesmo dia.
 */

import assert from 'node:assert/strict';
import { assessFeedFreshness, productionHealthOk } from '../lib/jobs/feed-freshness.js';
import { runNightlyPipeline, type PipelineStages } from '../lib/jobs/pipeline.js';
import { getStatus, markEnd, markStart, resetStatus } from '../lib/jobs/status.js';

let passed = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, `FALHOU: ${label}`);
  console.log(`  ✓ ${label}`);
  passed++;
}

function utc(iso: string): Date {
  return new Date(iso);
}

const ran: string[] = [];

function succeed(name: 'sync' | 'capas' | 'feed'): () => Promise<void> {
  return async () => {
    ran.push(name);
    markStart(name);
    markEnd(name, true, 'ok');
  };
}

function fail(name: 'sync' | 'capas' | 'feed'): () => Promise<void> {
  return async () => {
    ran.push(name);
    markStart(name);
    markEnd(name, false, 'erro de teste');
    throw new Error('erro de teste');
  };
}

console.log('\n[test] agregado do pipeline');
{
  resetStatus();
  ran.length = 0;
  await runNightlyPipeline({ sync: fail('sync'), capas: succeed('capas'), feed: succeed('feed') });
  const jobs = getStatus().jobs;
  ok('falha no sync marca o agregado como falso', jobs.pipeline.ok === false);
  ok('falha no sync não roda capas nem feed', ran.join(',') === 'sync');
  ok('detalhe cita a etapa que falhou', (jobs.pipeline.detail ?? '').includes('sync'));
}

{
  resetStatus();
  ran.length = 0;
  const stages: PipelineStages = { sync: succeed('sync'), capas: fail('capas'), feed: succeed('feed') };
  await runNightlyPipeline(stages);
  const jobs = getStatus().jobs;
  ok('falha nas capas marca o agregado como falso', jobs.pipeline.ok === false);
  ok('falha nas capas não roda o feed', ran.join(',') === 'sync,capas');
}

{
  resetStatus();
  ran.length = 0;
  await runNightlyPipeline({ sync: succeed('sync'), capas: succeed('capas'), feed: fail('feed') });
  ok('falha no feed marca o agregado como falso', getStatus().jobs.pipeline.ok === false);
  ok('as três etapas foram tentadas quando só o feed falha', ran.join(',') === 'sync,capas,feed');
}

{
  resetStatus();
  ran.length = 0;
  await runNightlyPipeline({ sync: succeed('sync'), capas: succeed('capas'), feed: succeed('feed') });
  const jobs = getStatus().jobs;
  ok('ciclo saudável mantém o agregado ok', jobs.pipeline.ok === true);
  ok('ciclo saudável roda sync, capas e feed', ran.join(',') === 'sync,capas,feed');
  ok('health ok com feed fresco e agregado ok', productionHealthOk(false, jobs.pipeline.ok));
  ok('health deixa de estar ok quando o agregado falhou', productionHealthOk(false, false) === false);
  ok('restart com agregado ainda não rodado não derruba o health se o feed está fresco', productionHealthOk(false, null) === true);
}

console.log('\n[test] feed vencido');
{
  const missing = assessFeedFreshness(null, utc('2026-09-28T13:00:00.000Z'));
  ok('sem arquivo o feed está vencido', missing.feedStale === true && missing.feedAgeHours === null);

  const morning = utc('2026-09-28T13:00:00.000Z'); // 10:00 BRT
  const freshFile = utc('2026-09-28T04:05:00.000Z'); // 01:05 BRT
  const fresh = assessFeedFreshness(freshFile, morning);
  ok('arquivo das 01:05 ainda fresco às 10:00 BRT', fresh.feedStale === false && fresh.feedAgeHours === 8.9);

  const old = assessFeedFreshness(utc('2026-09-27T20:00:00.000Z'), utc('2026-09-28T10:00:01.000Z'));
  ok('mais de 14 horas vence o feed', old.feedStale === true);

  const beforeWindow = utc('2026-09-28T06:00:00.000Z'); // 03:00 BRT
  const yesterdayAfternoon = utc('2026-09-27T17:00:00.000Z'); // 14:00 BRT, idade 13 h
  const stillInMargin = assessFeedFreshness(yesterdayAfternoon, beforeWindow);
  ok('antes das 04:30 BRT, 13 horas ainda não vencem', stillInMargin.feedStale === false);

  const afterWindow = utc('2026-09-28T08:00:00.000Z'); // 05:00 BRT
  const missedDawn = utc('2026-09-27T19:00:00.000Z'); // 16:00 BRT, idade 13 h
  const staleForMeta = assessFeedFreshness(missedDawn, afterWindow);
  ok('depois das 04:30 BRT, arquivo anterior às 01:00 do dia vence', staleForMeta.feedStale === true);

  const atCutoff = utc('2026-09-28T07:30:00.000Z'); // 04:30 BRT
  const justBeforeCutoff = utc('2026-09-28T07:29:00.000Z'); // 04:29 BRT
  const evening = utc('2026-09-27T21:00:00.000Z'); // 18:00 BRT, idade < 14 h
  ok('04:29 BRT ainda não aplica a janela da Meta', assessFeedFreshness(evening, justBeforeCutoff).feedStale === false);
  ok('04:30 BRT aplica a janela da Meta', assessFeedFreshness(evening, atCutoff).feedStale === true);
}

console.log(`\n[test] ${passed} asserts ok`);
