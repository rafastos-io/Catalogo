// Upload de PNGs para Cloudflare R2 via @aws-sdk/client-s3 (R2 é S3-compatible).
// URL pública final: ${R2_PUBLIC_URL}/${key} — ex: https://pub-xxx.r2.dev/AC0001.png

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string; // ex: https://pub-xxxx.r2.dev (sem barra final)
}

let _client: S3Client | null = null;

function getConfigFromEnv(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
    throw new Error(
      'R2 env vars faltando. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL.',
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function getClient(): S3Client {
  if (_client) return _client;
  const cfg = getConfigFromEnv();
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return _client;
}

/** Faz upload de um Buffer PNG para o R2. Retorna a URL pública completa. */
export async function uploadPng(key: string, png: Buffer, contentType = 'image/png'): Promise<string> {
  const cfg = getConfigFromEnv();
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucketName,
      Key: key,
      Body: png,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable', // 1 ano — capas mudam só se regerar
    }),
  );
  return `${cfg.publicUrl}/${key}`;
}

/**
 * Verifica se um objeto já existe no R2 (pra skip de reupload).
 * Retorna false se não existir (ou em caso de erro 404/403 access denied).
 */
export async function objectExists(key: string): Promise<boolean> {
  const cfg = getConfigFromEnv();
  const client = getClient();
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: cfg.bucketName, Key: key }),
    );
    return true;
  } catch (err) {
    if (err instanceof S3ServiceException && (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound')) {
      return false;
    }
    // Em alguns casos o R2 retorna 403 quando o objeto não existe (depende do escopo do token)
    if (err instanceof S3ServiceException && err.$metadata?.httpStatusCode === 403) {
      return false;
    }
    throw err;
  }
}

/** Constrói a URL pública esperada pra um key (sem fazer upload). */
export function publicUrlFor(key: string): string {
  const cfg = getConfigFromEnv();
  return `${cfg.publicUrl}/${key}`;
}

/**
 * Key padrão do PNG da capa: {codigo}_{ultima_atualizacao}.png
 * Versão com data no nome → URL única por versão → cache CDN imutável sem
 * risco de servir capa antiga quando o imóvel é atualizado e regerado.
 * Se ultimaAtualizacao for null/vazio, usa só o codigo (compat).
 */
export function capaKey(codigo: string, ultimaAtualizacao?: string | null): string {
  const code = codigo.toUpperCase();
  if (ultimaAtualizacao && ultimaAtualizacao.trim()) {
    // remove hifens da data ISO (2026-06-21 → 20260621) pra key mais limpa
    const ver = ultimaAtualizacao.replace(/-/g, '').slice(0, 8);
    return `${code}_${ver}.png`;
  }
  return `${code}.png`;
}

/** Fecha o client (chamar no fim do processo). */
export function closeR2Client(): void {
  if (_client) {
    _client.destroy();
    _client = null;
  }
}
