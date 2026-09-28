/**
 * Idade do feed servido. A fonte é o mtime do XML em disco, que sobrevive
 * a restart. A memória do processo não entra nessa conta.
 *
 * Vencido quando:
 * - não há arquivo;
 * - a idade passa de 14 horas (perdeu uma janela, com folga);
 * - depois das 04:30 BRT o arquivo ainda é anterior ao ciclo das 01:00 do mesmo dia
 *   (a janela de pull da Meta às 04:00 ficou sem o ciclo da madrugada).
 *
 * America/Sao_Paulo é UTC−3 o ano inteiro desde 2019.
 */

const STALE_AFTER_MS = 14 * 60 * 60 * 1000;
const BRT_OFFSET_HOURS = 3;

export type FeedFreshness = {
  feedAgeHours: number | null;
  feedStale: boolean;
};

export function assessFeedFreshness(mtime: Date | null, now: Date): FeedFreshness {
  if (!mtime || Number.isNaN(mtime.getTime())) {
    return { feedAgeHours: null, feedStale: true };
  }

  const ageMs = now.getTime() - mtime.getTime();
  const feedAgeHours = Math.round((ageMs / 3_600_000) * 10) / 10;
  if (ageMs > STALE_AFTER_MS) {
    return { feedAgeHours, feedStale: true };
  }

  const wall = brtWall(now);
  const afterMetaWindow = wall.hour > 4 || (wall.hour === 4 && wall.minute >= 30);
  if (afterMetaWindow) {
    const cycleStart = brtWallToUtc(wall.year, wall.month, wall.day, 1, 0);
    if (mtime.getTime() < cycleStart.getTime()) {
      return { feedAgeHours, feedStale: true };
    }
  }

  return { feedAgeHours, feedStale: false };
}

/**
 * `ok` do JSON de /health. HTTP continua 200.
 * Agregado ainda não rodado neste processo (null) não derruba o ok:
 * o restart apaga a memória e o arquivo é a fonte da idade.
 * Agregado explicitamente falso, ou feed vencido, derruba o ok.
 */
export function productionHealthOk(feedStale: boolean, pipelineOk: boolean | null): boolean {
  return !feedStale && pipelineOk !== false;
}

function brtWall(now: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  let hour = num('hour');
  if (hour === 24) hour = 0;
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour,
    minute: num('minute'),
  };
}

function brtWallToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + BRT_OFFSET_HOURS, minute, 0, 0));
}
