// Storage de capas via SFTP (Hostinger) + HTTP para leitura publica.
// Substitui r2-storage.ts e a versao Cloudinary.
//
// URL publica final: ${STORAGE_PUBLIC_URL}/${relativePath}
// Ex: https://capas.seudominio.com.br/AC0001_20260623.jpg
//
// Estrategia:
// - Upload/delete/list: SFTP (Hostinger porta 65002 — varia por conta)
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
}

let _client: Client | null = null;
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
      'STORAGE env vars faltando. Configure STORAGE_SFTP_HOST, STORAGE_SFTP_PORT (6502), STORAGE_SFTP_USER, STORAGE_SFTP_PASS, STORAGE_PUBLIC_URL, STORAGE_REMOTE_DIR.',
    );
  }
  const sftpPort = sftpPortRaw ? parseInt(sftpPortRaw, 10) : 6502;
  if (isNaN(sftpPort)) throw new Error('STORAGE_SFTP_PORT invalido');
  return { sftpHost, sftpPort, sftpUser, sftpPass, publicUrl, remoteDir };
}

async function getClient(): Promise<Client> {
  if (_client) return _client;
  if (_connecting) return _connecting;
  const cfg = getConfigFromEnv();
  _connecting = (async () => {
    const c = new Client();
    await c.connect({
      host: cfg.sftpHost,
      port: cfg.sftpPort,
      username: cfg.sftpUser,
      password: cfg.sftpPass,
      readyTimeout: 30_000,
      // Hostinger usa chaveECDSA — algumas versoes de ssh2 precisam disso:
      algorithms: {
        serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'],
      },
    });
    _client = c;
    _connecting = null;
    return c;
  })();
  return _connecting;
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

/** Cria pastas recursivamente (mkdir -p). */
async function mkdirp(absPath: string): Promise<void> {
  const c = await getClient();
  const parts = absPath.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : `/${p}`;
    try {
      await c.mkdir(cur, true);
    } catch (err) {
      const e = err as Error;
      if (!/already exists/i.test(e.message)) throw e;
    }
  }
}

/** Faz upload de um Buffer (JPG/PNG) pro SFTP. Retorna a URL publica. */
export async function uploadBuffer(key: string, buf: Buffer, _contentType = 'image/jpeg'): Promise<string> {
  const absPath = remoteAbsPath(key);
  const parent = dirname(absPath);
  await mkdirp(parent);
  const c = await getClient();
  await c.put(buf, absPath);
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

/** Deleta um arquivo no SFTP (best-effort — nao lanca se 404). */
export async function deleteObject(key: string): Promise<void> {
  const absPath = remoteAbsPath(key);
  const c = await getClient();
  try {
    await c.delete(absPath);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'ENOENT' || /no such file/i.test(e.message)) return;
    throw err;
  }
}

/**
 * Lista todas as keys (caminhos relativos) dentro de remoteDir.
 * Retorna array de strings (keys com extensao).
 */
export async function listAllKeys(): Promise<string[]> {
  const cfg = getConfigFromEnv();
  const c = await getClient();
  const items = await c.list(cfg.remoteDir);
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
 * Key padrao da capa: {codigo}_{ultima_atualizacao}.jpg
 * Versao com data no nome -> URL unica por versao -> cache CDN imutavel.
 * Se ultimaAtualizacao for null/vazio, usa so o codigo (compat).
 */
export function capaKey(codigo: string, ultimaAtualizacao?: string | null): string {
  const code = codigo.toUpperCase();
  if (ultimaAtualizacao && ultimaAtualizacao.trim()) {
    const ver = ultimaAtualizacao.replace(/-/g, '').slice(0, 8);
    return `${code}_${ver}.jpg`;
  }
  return `${code}.jpg`;
}

/** Alias pra compat com gerar-capas (capaPublicId era sem extensao no Cloudinary). */
export const capaPublicId = capaKey;

/** Fecha o client SFTP (chamar no fim do processo). */
export function closeStorageClient(): void {
  if (_client) {
    _client.end().catch(() => {});
    _client = null;
  }
  _connecting = null;
}
