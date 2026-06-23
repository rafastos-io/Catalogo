// Utilitarios de path POSIX (independente do OS host).
// Usado pelo storage.ts pra garantir caminhos consistentes no servidor Linux
// da Hostinger, mesmo quando rodamos local no Windows.

export function normalizeRemotePath(p: string): string {
  if (!p) return '';
  let s = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  s = s.replace(/^\.\//, '');
  if (s === '/') s = '';
  return s;
}

export function posixJoin(...parts: string[]): string {
  const filtered = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return filtered.join('/');
}

export function dirname(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx);
}
