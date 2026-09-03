// Storage de capas via SFTP (Hostinger) + HTTP para leitura publica.
// Substitui r2-storage.ts e a versao Cloudinary.
//
// URL publica final: ${STORAGE_PUBLIC_URL}/${relativePath}
// Ex: https://capas.seudominio.com.br/AC0001_20260623.jpg
//
// Estrategia:
// - Upload/delete/list: SFTP (Hostinger porta 65002 — varia por conta)
// - Pool de conexoes SFTP (default 5) pra paralelizar uploads
// - Exists check: HTTP HEAD na URL publica (mais rapido e nao consome SFTP)
// - Garantia de pasta: mkdir -p recursivo no primeiro upload

import Client from 'ssh2-sftp-client';
import { request } from 'https';
import { dirname, posixJoin, normalizeRemotePath } from './path-utils.js';

export interface StorageConfig {
  sftpHost: string;
  sftpPort: number;
  sftpUser: string;
  sftpPass: string;
  publicUrl: string;
  remoteDir: string; // caminho absoluto da pasta capas/ no servidor
  poolSize: number; // numero de conexoes SFTP concorrentes
}

// Hostinger derruba handshake se várias conexões SSH abrem juntas
// ("Connection lost before handshake"). Pool pequeno + handshake serial.
const DEFAULT_POOL_SIZE = 2;

let _pool: Array<Client | null> = [];
let _poolReady: Array<Promise<Client | null>> = [];
let _slotLocks: Array<Promise<void>> = [];
let _poolInitStarted = false;
let _rrIndex = 0; // round-robin index
let _handshakeQueue: Promise<void> = Promise.resolve();

function getConfigFromEnv(): StorageConfig {
  const sftpHost = process.env.STORAGE_SFTP_HOST;
  const sftpPortRaw = process.env.STORAGE_SFTP_PORT;
  const sftpUser = process.env.STORAGE_SFTP_USER;
  const sftpPass = process.env.STORAGE_SFTP_PASS;
  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  const remoteDir = process.env.STORAGE_REMOTE_DIR;
  if (!sftpHost || !sftpUser || !sftpPass || !publicUrl || !remoteDir) {
    throw new Error(
      'STORAGE env vars faltando. Configure STORAGE_SFTP_HOST, STORAGE_SFTP_PORT, STORAGE_SFTP_USER, STORAGE_SFTP_PASS, STORAGE_PUBLIC_URL, STORAGE_REMOTE_DIR.',
    );
  }
  const sftpPort = sftpPortRaw ? parseInt(sftpPortRaw, 10) : 65002; // porta SFTP/SSH padrao da Hostinger
  if (isNaN(sftpPort)) throw new Error('STORAGE_SFTP_PORT invalido');
  const poolSizeRaw = process.env.STORAGE_POOL_SIZE;
  const requested = poolSizeRaw ? Math.max(1, parseInt(poolSizeRaw, 10)) : DEFAULT_POOL_SIZE;
  const poolSize = Math.min(2, requested || DEFAULT_POOL_SIZE);
  return { sftpHost, sftpPort, sftpUser, sftpPass, publicUrl, remoteDir, poolSize };
}

function buildClient(cfg: StorageConfig): Client {
  const c = new Client();
  return c;
}

function withHandshakeLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _handshakeQueue.then(fn, fn);
  _handshakeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function connectClient(c: Client, cfg: StorageConfig): Promise<Client> {
  return withHandshakeLock(async () => {
    await sleep(250);
    await c.connect({
      host: cfg.sftpHost,
      port: cfg.sftpPort,
      username: cfg.sftpUser,
      password: cfg.sftpPass,
      readyTimeout: 45_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 4,
      algorithms: {
        serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
      },
    });
    return c;
  });
}

/** Inicializa (ou tenta) um slot do pool. Retorna Client ou null se falhar. */
async function initSlot(i: number, cfg: StorageConfig): Promise<Client | null> {
  try {
    const c = buildClient(cfg);
    await connectClient(c, cfg);
    _pool[i] = c;
    return c;
  } catch {
    _pool[i] = null;
    return null;
  }
}

/**
 * Inicializa o pool de conexoes SFTP (lazy, na primeira chamada).
 * Slots que falham ficam null e sao (re)conectados sob demanda pelo getClient.
 * Nunca lanca — uma conexao ruim nao derruba as outras (Promise.allSettled).
 */
async function ensurePool(): Promise<void> {
  if (_poolInitStarted) return;
  _poolInitStarted = true;
  const cfg = getConfigFromEnv();
  const size = Math.max(1, cfg.poolSize);
  _pool = new Array<Client | null>(size).fill(null);
  _poolReady = new Array<Promise<Client | null>>(size);
  _slotLocks = Array.from({ length: size }, () => Promise.resolve());
  // Sequencial: 5 handshakes paralelos na Hostinger = Connection lost.
  for (let i = 0; i < size; i++) {
    _poolReady[i] = initSlot(i, cfg);
    await _poolReady[i];
  }
}

/**
 * Pega uma conexao usavel do pool (round-robin). Reconecta slots mortos
 * de forma lazy. Se todo o pool falhar, cria conexao ad-hoc. Nunca retorna
 * undefined — retorna Client conectado ou lanca.
 */
async function getClient(): Promise<{ client: Client; slot: number }> {
  await ensurePool();
  const size = _pool.length;
  const cfg = getConfigFromEnv();
  if (size === 0) {
    return { client: await connectClient(buildClient(cfg), cfg), slot: -1 };
  }
  for (let attempt = 0; attempt < size; attempt++) {
    const i = _rrIndex;
    _rrIndex = (_rrIndex + 1) % size;
    const c = _pool[i];
    if (c) return { client: c, slot: i };
    const reconnected = await initSlot(i, cfg);
    if (reconnected) return { client: reconnected, slot: i };
  }
  return { client: await connectClient(buildClient(cfg), cfg), slot: -1 };
}

function withSlotLock<T>(slot: number, fn: () => Promise<T>): Promise<T> {
  if (slot < 0) return fn();
  if (!_slotLocks[slot]) _slotLocks[slot] = Promise.resolve();
  const run = _slotLocks[slot].then(fn, fn);
  _slotLocks[slot] = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Timeout de UMA operacao SFTP individual (put/mkdir/delete/list).
 * Sem isso, um socket "meio-morto" (servidor para de responder mas nao envia
 * RST) faz o put pendurar pra sempre -> Promise.all nunca resolve -> o processo
 * inteiro congela (foi o que travou o run de capas por ~1h30). Com timeout, a op
 * vira erro transiente -> withClientRetry descarta a conexao e reconecta.
 */
const OP_TIMEOUT_MS = Number(process.env.STORAGE_OP_TIMEOUT_MS) || 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SFTP op timeout (${label}) apos ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** True se o erro indicar problema de conexao/transiente. */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH|ENETUNREACH|handshake|Connection lost|getConnection|socket hang up|read ECONN|write ECONN|Network Error|aborted|SFTP op timeout/i.test(msg);
}

/**
 * Executa uma operacao SFTP com retry automatico. Se a conexao morrer
 * mid-op, descarta-a do pool, pega outra e tenta de novo (ate 4x com backoff).
 */
async function withClientRetry<T>(op: (c: Client) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 6;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let got: { client: Client; slot: number };
    try {
      got = await getClient();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(800 * (attempt + 1));
      continue;
    }
    try {
      return await withSlotLock(got.slot, () =>
        withTimeout(op(got.client), OP_TIMEOUT_MS, `attempt ${attempt + 1}`),
      );
    } catch (err) {
      lastErr = err;
      const idx = got.slot >= 0 ? got.slot : _pool.indexOf(got.client);
      if (idx >= 0) _pool[idx] = null;
      try {
        await got.client.end();
      } catch {
        // best-effort
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = isTransientError(err) ? 800 * (attempt + 1) : 1500 * (attempt + 1);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

/** Caminho absoluto do arquivo no servidor = remoteDir + relativePath. Sempre com barra inicial. */
function remoteAbsPath(relativePath: string): string {
  const cfg = getConfigFromEnv();
  const safe = normalizeRemotePath(relativePath);
  const joined = posixJoin(cfg.remoteDir, safe);
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/** Caminho relativo dentro da pasta capas/ (pra construir URL publica). */
function publicRelativePath(key: string): string {
  return normalizeRemotePath(key);
}

/** URL publica completa pra uma key (ex: AC0001.jpg -> https://dom/capas/AC0001.jpg). */
export function publicUrlFor(key: string): string {
  const cfg = getConfigFromEnv();
  const base = cfg.publicUrl.replace(/\/$/, '');
  return `${base}/${publicRelativePath(key)}`;
}

// Cache de pastas ja garantidas nesta execucao. Sem isso, mkdirp rodava antes
// de CADA upload (10k+ uploads na mesma pasta = dezenas de milhares de mkdir
// SFTP redundantes -> martelava a Hostinger e alimentava o flood de ECONNRESET).
const _ensuredDirs = new Set<string>();

/** Cria pastas recursivamente (mkdir -p). Resiliente a conexoes mortas. Idempotente via cache. */
async function mkdirp(absPath: string): Promise<void> {
  if (_ensuredDirs.has(absPath)) return;
  const parts = absPath.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : `/${p}`;
    if (_ensuredDirs.has(cur)) continue;
    await withClientRetry(async (c) => {
      try {
        await c.mkdir(cur, true);
      } catch (err) {
        const e = err as Error;
        if (!/already exists/i.test(e.message)) throw e;
      }
    });
    _ensuredDirs.add(cur);
  }
  _ensuredDirs.add(absPath);
}

/** Faz upload de um Buffer (JPG/PNG) pro SFTP. Retorna a URL publica. Resiliente a falhas transientes. */
export async function uploadBuffer(key: string, buf: Buffer, _contentType = 'image/jpeg'): Promise<string> {
  const absPath = remoteAbsPath(key);
  const parent = dirname(absPath);
  await mkdirp(parent);
  await withClientRetry(async (c) => c.put(buf, absPath));
  return publicUrlFor(key);
}

/** Alias mantido pra compat com a assinatura anterior (uploadPng). */
export async function uploadPng(key: string, buf: Buffer, contentType = 'image/jpeg'): Promise<string> {
  return uploadBuffer(key, buf, contentType);
}

/** HEAD na URL publica — retorna true se 200, false se 404. */
export async function objectExists(key: string): Promise<boolean> {
  const cfg = getConfigFromEnv();
  const url = publicUrlFor(key);
  return new Promise<boolean>((resolve) => {
    const req = request(url, { method: 'HEAD', timeout: 10_000 }, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      if (code === 200) resolve(true);
      else if (code === 404) resolve(false);
      else if (code >= 400 && code < 500) resolve(false);
      else resolve(false);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Deleta um arquivo no SFTP (best-effort — nao lanca se 404). Resiliente a falhas transientes. */
export async function deleteObject(key: string): Promise<void> {
  const absPath = remoteAbsPath(key);
  await withClientRetry(async (c) => {
    try {
      await c.delete(absPath);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'ENOENT' || /no such file/i.test(e.message)) return;
      throw err;
    }
  });
}

/**
 * Lista todas as keys (caminhos relativos) dentro de remoteDir.
 * Retorna array de strings (keys com extensao). Resiliente a falhas transientes.
 */
export async function listAllKeys(): Promise<string[]> {
  const cfg = getConfigFromEnv();
  const items = await withClientRetry(async (c) => c.list(cfg.remoteDir));
  const keys: string[] = [];
  for (const item of items) {
    if (item.type === '-' && item.name) keys.push(item.name);
  }
  return keys;
}

/** Deleta um lote de keys. Retorna o numero de objetos deletados. */
export async function deleteKeys(keys: string[]): Promise<number> {
  let deleted = 0;
  for (const k of keys) {
    try {
      await deleteObject(k);
      deleted++;
    } catch {
      // best-effort: continua mesmo se um falhar
    }
  }
  return deleted;
}

/**
 * Key padrao da capa: {codigo}_{content_hash}.jpg
 *
 * Versionada pelo CONTENT HASH (nao pela data): a URL passa a ser funcao pura
 * do conteudo visual da capa (preco, fotos, quartos, etc). Consequencias:
 *   - Conteudo muda -> hash muda -> nome/URL muda -> Facebook rebusca a imagem
 *     (cache-bust automatico) e a checagem "ja existe no storage?" retorna false
 *     corretamente, forcando o render.
 *   - Conteudo igual -> hash igual -> mesma URL -> cache CDN/FB imutavel, sem
 *     regerar a toa (mesmo que a data de atualizacao do XML mude todo dia).
 *
 * Isso mantem a chave do arquivo COERENTE com a decisao de regeração (que usa
 * o mesmo content_hash). Se contentHash for null/vazio, usa so o codigo (compat).
 */
export function capaKey(codigo: string, contentHash?: string | null): string {
  const code = codigo.toUpperCase();
  if (contentHash && contentHash.trim()) {
    // Sanitiza: mantem so hex (o hash e sha256 hex de 16 chars). Evita qualquer
    // caractere que quebre o caminho no SFTP/URL.
    const ver = contentHash.trim().replace(/[^a-fA-F0-9]/g, '').slice(0, 16);
    if (ver) return `${code}_${ver}.jpg`;
  }
  return `${code}.jpg`;
}

/** Alias pra compat com gerar-capas (capaPublicId era sem extensao no Cloudinary). */
export const capaPublicId = capaKey;

/** Fecha todas as conexoes do pool SFTP (chamar no fim do processo). Nunca lanca. */
export function closeStorageClient(): void {
  for (const c of _pool) {
    if (c) {
      try {
        c.end().catch(() => {});
      } catch {
        // best-effort
      }
    }
  }
  _pool = [];
  _poolReady = [];
  _slotLocks = [];
  _poolInitStarted = false;
  _rrIndex = 0;
  _handshakeQueue = Promise.resolve();
  _ensuredDirs.clear();
}
