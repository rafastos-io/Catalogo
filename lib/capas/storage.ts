// Storage de capas via FTPS (Hostinger, porta 21) + HTTP para leitura publica.
//
// A conta FTP `urbangrupobr` autentica em FTP/FTPS:21, mas NAO em SFTP:65002.
// Por isso usamos basic-ftp (FTPS), nao ssh2-sftp-client.
//
// Estrategia: UMA conexao + fila global (uma op por vez).
// Exists check: HTTP HEAD na URL publica (nao usa FTP).

import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { request } from 'https';
import { dirname, posixJoin, normalizeRemotePath } from './path-utils.js';

export interface StorageConfig {
  sftpHost: string;
  sftpPort: number;
  sftpUser: string;
  sftpPass: string;
  publicUrl: string;
  remoteDir: string;
  poolSize: number;
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
  // Default 21 = FTPS Hostinger (conta FTP). 65002 era SFTP/SSH e nao autentica essa conta.
  const sftpPort = sftpPortRaw ? parseInt(sftpPortRaw, 10) : 21;
  if (isNaN(sftpPort)) throw new Error('STORAGE_SFTP_PORT invalido');
  return { sftpHost, sftpPort, sftpUser, sftpPass, publicUrl, remoteDir, poolSize: 1 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const OP_TIMEOUT_MS = Number(process.env.STORAGE_OP_TIMEOUT_MS) || 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`FTP op timeout (${label}) apos ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH|ENETUNREACH|handshake|Connection lost|socket hang up|read ECONN|write ECONN|Network Error|aborted|FTP op timeout|Timeout|421|425|426|450|451/i.test(msg);
}

function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /530|Login incorrect|authentication|Authentication failed|Login failed/i.test(msg);
}

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
    c.close();
  } catch {
    // best-effort
  }
}

async function connectFresh(cfg: StorageConfig): Promise<Client> {
  const c = new Client(OP_TIMEOUT_MS);
  c.ftp.verbose = false;
  // Hostinger usa FTPS (TLS). Cert wildcard hostinger.com — aceitar no Node.
  await c.access({
    host: cfg.sftpHost,
    port: cfg.sftpPort,
    user: cfg.sftpUser,
    password: cfg.sftpPass,
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });
  // Conta chroot na pasta capas: remoteDir "/" = raiz da conta.
  if (cfg.remoteDir && cfg.remoteDir !== '/') {
    await c.cd(cfg.remoteDir);
  }
  _client = c;
  return c;
}

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
      if (_client) _connecting = null;
    }
  })();

  return _connecting;
}

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
        const delay = isAuthFailure(err)
          ? 5_000 * (attempt + 1)
          : isTransientError(err)
            ? 1_500 * (attempt + 1)
            : 2_000 * (attempt + 1);
        console.warn(`[ftp] retry ${attempt + 1}/${MAX_ATTEMPTS} em ${delay}ms: ${err instanceof Error ? err.message : err}`);
        await sleep(delay);
      }
    }
    throw lastErr;
  });
}

/** Path relativo na conta FTP (chroot). remoteDir=/ → so o nome do arquivo. */
function remoteAbsPath(relativePath: string): string {
  const cfg = getConfigFromEnv();
  const safe = normalizeRemotePath(relativePath);
  if (!cfg.remoteDir || cfg.remoteDir === '/') {
    return safe.replace(/^\//, '');
  }
  const joined = posixJoin(cfg.remoteDir, safe);
  return joined.replace(/^\//, '');
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
  // Conta chroot: uploads na raiz — sem mkdir. Subpastas: ensureDir.
  const dir = absPath.includes('/') ? dirname(`/${absPath}`).replace(/^\//, '') : '';
  if (!dir || dir === '.' || dir === '/') {
    _ensuredDirs.add(absPath);
    return;
  }
  if (_ensuredDirs.has(dir)) return;
  await withClientRetry(async (c) => {
    await c.ensureDir(dir);
    // ensureDir muda o cwd — volta pra raiz da conta
    await c.cd('/');
  });
  _ensuredDirs.add(dir);
}

export async function uploadBuffer(key: string, buf: Buffer, _contentType = 'image/jpeg'): Promise<string> {
  const absPath = remoteAbsPath(key);
  const parent = dirname(`/${absPath}`);
  if (parent && parent !== '/') await mkdirp(absPath);
  await withClientRetry(async (c) => {
    await c.uploadFrom(Readable.from(buf), absPath);
  });
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
      await c.remove(absPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/550|no such file|not found|doesn't exist/i.test(msg)) return;
      throw err;
    }
  });
}

export async function listAllKeys(): Promise<string[]> {
  const items = await withClientRetry(async (c) => c.list('/'));
  const keys: string[] = [];
  for (const item of items) {
    if (item.isFile && item.name) keys.push(item.name);
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
      c.close();
    } catch {
      // best-effort
    }
  }
}

/** Teste rapido FTPS: sobe e apaga um arquivo probe. */
export async function probeSftp(): Promise<{
  ok: boolean;
  host: string;
  port: number;
  user: string;
  remoteDir: string;
  protocol: string;
  uploaded: boolean;
  deleted: boolean;
  error?: string;
  ms: number;
}> {
  const started = Date.now();
  const cfg = getConfigFromEnv();
  const base = {
    host: cfg.sftpHost,
    port: cfg.sftpPort,
    user: cfg.sftpUser,
    remoteDir: cfg.remoteDir,
    protocol: 'ftps',
    uploaded: false,
    deleted: false,
  };
  try {
    const probeKey = `__probe_${Date.now()}.txt`;
    await uploadBuffer(probeKey, Buffer.from(`probe ${new Date().toISOString()}\n`), 'text/plain');
    base.uploaded = true;
    await deleteObject(probeKey);
    base.deleted = true;
    closeStorageClient();
    return { ok: true, ...base, ms: Date.now() - started };
  } catch (err) {
    closeStorageClient();
    return {
      ok: false,
      ...base,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}
