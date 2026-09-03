// Storage de capas via SFTP (Hostinger) + HTTP para leitura publica.
//
// Hostinger derruba SSH se abrirmos várias conexões / retries em paralelo
 // ("Connection lost before handshake" → depois "authentication methods failed").
// Estratégia: UMA conexão + fila global (uma op SFTP por vez).
// Exists check: HTTP HEAD na URL publica (não usa SFTP).

import Client from 'ssh2-sftp-client';
import { request } from 'https';
import { dirname, posixJoin, normalizeRemotePath } from './path-utils.js';

export interface StorageConfig {
  sftpHost: string;
  sftpPort: number;
  sftpUser: string;
  sftpPass: string;
  publicUrl: string;
  remoteDir: string;
  poolSize: number; // ignorado — sempre 1 na Hostinger
}

let _client: Client | null = null;
let _opQueue: Promise<void> = Promise.resolve();
let _connecting: Promise<Client> | null = null;

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
  const sftpPort = sftpPortRaw ? parseInt(sftpPortRaw, 10) : 65002;
  if (isNaN(sftpPort)) throw new Error('STORAGE_SFTP_PORT invalido');
  return { sftpHost, sftpPort, sftpUser, sftpPass, publicUrl, remoteDir, poolSize: 1 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH|ENETUNREACH|handshake|Connection lost|getConnection|authentication methods failed|socket hang up|read ECONN|write ECONN|Network Error|aborted|SFTP op timeout/i.test(msg);
}

function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /authentication methods failed|All configured authentication/i.test(msg);
}

/** Enfileira trabalho SFTP — no máximo uma op por vez no processo inteiro. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = _opQueue.then(fn, fn);
  _opQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function discardClient(): Promise<void> {
  const c = _client;
  _client = null;
  _connecting = null;
  if (!c) return;
  try {
    await c.end();
  } catch {
    // best-effort
  }
}

async function connectFresh(cfg: StorageConfig): Promise<Client> {
  const c = new Client();
  // Silencia spam de end/close no stdout do Coolify
  c.on('end', () => {});
  c.on('close', () => {});
  await c.connect({
    host: cfg.sftpHost,
    port: cfg.sftpPort,
    username: cfg.sftpUser,
    password: cfg.sftpPass,
    readyTimeout: 45_000,
    keepaliveInterval: 20_000,
    keepaliveCountMax: 3,
    algorithms: {
      serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
    },
  });
  _client = c;
  return c;
}

/** Uma conexão viva; reconecta serializado se cair. */
async function getConnectedClient(): Promise<Client> {
  if (_client) return _client;
  if (_connecting) return _connecting;

  const cfg = getConfigFromEnv();
  _connecting = (async () => {
    try {
      return await connectFresh(cfg);
    } catch (err) {
      _connecting = null;
      throw err;
    } finally {
      // se connectFresh setou _client, limpa o lock; se falhou, já nullou acima
      if (_client) _connecting = null;
    }
  })();

  return _connecting;
}

/**
 * Executa uma op SFTP com fila global + retry. Nunca abre N conexões em paralelo.
 */
async function withClientRetry<T>(op: (c: Client) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    const MAX_ATTEMPTS = 5;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const c = await getConnectedClient();
        return await withTimeout(op(c), OP_TIMEOUT_MS, `attempt ${attempt + 1}`);
      } catch (err) {
        lastErr = err;
        await discardClient();
        if (attempt >= MAX_ATTEMPTS - 1) break;
        // Auth fail = Hostinger provavelmente bloqueou temporariamente → espera mais
        const delay = isAuthFailure(err)
          ? 5_000 * (attempt + 1)
          : isTransientError(err)
            ? 1_500 * (attempt + 1)
            : 2_000 * (attempt + 1);
        console.warn(`[sftp] retry ${attempt + 1}/${MAX_ATTEMPTS} em ${delay}ms: ${err instanceof Error ? err.message : err}`);
        await sleep(delay);
      }
    }
    throw lastErr;
  });
}

function remoteAbsPath(relativePath: string): string {
  const cfg = getConfigFromEnv();
  const safe = normalizeRemotePath(relativePath);
  const joined = posixJoin(cfg.remoteDir, safe);
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function publicRelativePath(key: string): string {
  return normalizeRemotePath(key);
}

export function publicUrlFor(key: string): string {
  const cfg = getConfigFromEnv();
  const base = cfg.publicUrl.replace(/\/$/, '');
  return `${base}/${publicRelativePath(key)}`;
}

const _ensuredDirs = new Set<string>();

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

export async function uploadBuffer(key: string, buf: Buffer, _contentType = 'image/jpeg'): Promise<string> {
  const absPath = remoteAbsPath(key);
  const parent = dirname(absPath);
  await mkdirp(parent);
  await withClientRetry(async (c) => c.put(buf, absPath));
  return publicUrlFor(key);
}

export async function uploadPng(key: string, buf: Buffer, contentType = 'image/jpeg'): Promise<string> {
  return uploadBuffer(key, buf, contentType);
}

export async function objectExists(key: string): Promise<boolean> {
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

export async function listAllKeys(): Promise<string[]> {
  const cfg = getConfigFromEnv();
  const items = await withClientRetry(async (c) => c.list(cfg.remoteDir));
  const keys: string[] = [];
  for (const item of items) {
    if (item.type === '-' && item.name) keys.push(item.name);
  }
  return keys;
}

export async function deleteKeys(keys: string[]): Promise<number> {
  let deleted = 0;
  for (const k of keys) {
    try {
      await deleteObject(k);
      deleted++;
    } catch {
      // best-effort
    }
  }
  return deleted;
}

export function capaKey(codigo: string, contentHash?: string | null): string {
  const code = codigo.toUpperCase();
  if (contentHash && contentHash.trim()) {
    const ver = contentHash.trim().replace(/[^a-fA-F0-9]/g, '').slice(0, 16);
    if (ver) return `${code}_${ver}.jpg`;
  }
  return `${code}.jpg`;
}

export const capaPublicId = capaKey;

export function closeStorageClient(): void {
  const c = _client;
  _client = null;
  _connecting = null;
  _opQueue = Promise.resolve();
  _ensuredDirs.clear();
  if (c) {
    try {
      c.end().catch(() => {});
    } catch {
      // best-effort
    }
  }
}
