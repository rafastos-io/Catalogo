/** Preview / Coolify: não roda sync, capas de produção nem SFTP. */
export function isSyncDesligado(): boolean {
  const v = (process.env.SYNC_DESLIGADO ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function listenPort(): number {
  const n = Number(process.env.PORT);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export function feedOutDir(): string {
  return process.env.FEED_OUT_DIR?.trim() || 'out';
}

export function capasConcurrency(): number {
  const n = Number(process.env.CAPAS_CONCURRENCY);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
