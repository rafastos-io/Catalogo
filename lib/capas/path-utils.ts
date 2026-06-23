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

/**
 * Join de partes POSIX. Preserva a barra inicial se o primeiro argumento
 * comecar com / (pra formar caminho absoluto, exigido por SFTP).
 */
export function posixJoin(...parts: string[]): string {
  const leadingSlash = parts.length > 0 && parts[0].startsWith('/');
  const filtered = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  const joined = filtered.join('/');
  return leadingSlash ? `/${joined}` : joined;
}

export function dirname(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '/';
  return normalized.slice(0, idx);
}
