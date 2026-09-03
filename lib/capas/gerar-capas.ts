// Orquestrador: le Turso, decide incremental, gera JPG, sobe via SFTP,
// atualiza capas_imoveis. Reaproveita browser e client SFTP entre os imoveis.

import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_KIT, logoToDataUri } from './brand-kit.js';
import { renderTemplateHtml, fotoParaDataUri, type ImovelDados } from './token-renderer.js';
import { screenshotBatch, closeBrowser, type ScreenshotOptions } from './screenshot.js';
import { uploadPng, capaKey, publicUrlFor, objectExists, deleteObject, closeStorageClient } from './storage.js';
import { computeContentHash, isCapaUpToDate } from './content-hash.js';

export interface GerarCapasOptions {
  limit?: number; // se setado, processa só N imóveis (dry-run)
  concurrency?: number; // padrão 10
  formato?: string; // padrão '1080x1080'
  templateSlug?: string; // padrão 'imovel-estatico-03'
  force?: boolean; // se true, ignora incremental e regera tudo
}

export interface GerarCapasResult {
  total: number;
  gerados: number;
  skippados: number;
  erros: number;
  durationMs: number;
  /** Amostra de mensagens de erro (pra /health e logs). */
  sampleErrors?: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTemplateHtml(slug: string): string {
  // lib/capas/ → ../../templates/{slug}/html.html
  const path = resolve(__dirname, '..', '..', 'templates', slug, 'html.html');
  return readFileSync(path, 'utf-8');
}

// Colunas necessárias do Turso pra montar o token map
const COLS_IMOVEL = [
  'codigo', 'tipo_imovel', 'subtipo_imovel', 'bairro', 'cidade', 'finalidade',
  'quartos', 'suites', 'banheiros', 'salas', 'vagas', 'area_util',
  'valor_venda', 'valor_aluguel', 'foto_principal_url', 'fotos_urls', 'ultima_atualizacao',
].join(', ');

interface ImovelRow extends ImovelDados {
  ultima_atualizacao: string | null;
}

export async function gerarCapasImoveis(opts: GerarCapasOptions = {}): Promise<GerarCapasResult> {
  const start = Date.now();
  const formato = opts.formato ?? '1080x1080';
  const templateSlug = opts.templateSlug ?? 'imovel-estatico-03';
  const concurrency = opts.concurrency ?? 10;
  const force = opts.force ?? false;

  // Turso
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN faltando');
  const turso: Client = createClient({ url, authToken });

  // Template HTML
  console.info(`[capas] Carregando template ${templateSlug} (formato ${formato})...`);
  const templateHtml = loadTemplateHtml(templateSlug);

  // Logo → data URI (1 download, reaproveitado em todos os renders)
  console.info('[capas] Baixando logo e convertendo pra data URI...');
  const logoDataUri = await logoToDataUri(BRAND_KIT.logo_url_escuro);
  console.info(`[capas] Logo pronto (${Math.round(logoDataUri.length / 1024)}KB data URI)`);

  // Lê imóveis ativos
  console.info('[capas] Lendo imóveis ativos do Turso (cursor pagination)...');
  const imoveis: ImovelRow[] = [];
  let cursor = '';
  while (true) {
    const rs = await turso.execute({
      sql: `SELECT ${COLS_IMOVEL} FROM imoveis WHERE status_anuncio = 'Ativo' AND codigo > ? ORDER BY codigo LIMIT 1000`,
      args: [cursor],
    });
    if (rs.rows.length === 0) break;
    for (const row of rs.rows) {
      imoveis.push(row as unknown as ImovelRow);
    }
    cursor = String(rs.rows[rs.rows.length - 1].codigo);
    if (rs.rows.length < 1000) break;
  }
  console.info(`[capas] ${imoveis.length} imóveis ativos carregados`);

  // Lê capas já geradas (controle incremental por content_hash).
  // Paginado pra evitar truncamento do @libsql/client em queries grandes.
  console.info('[capas] Lendo capas_imoveis do Turso (cursor pagination)...');
  const capasMap = new Map<string, { ultimaAtualizacaoGerada: string | null; contentHash: string | null; capaUrl: string | null }>();
  let capasCursor = '';
  while (true) {
    const capasRs = await turso.execute({
      sql: 'SELECT codigo, ultima_atualizacao_gerada, content_hash, capa_url FROM capas_imoveis WHERE codigo > ? ORDER BY codigo LIMIT 1000',
      args: [capasCursor],
    });
    if (capasRs.rows.length === 0) break;
    for (const row of capasRs.rows) {
      capasMap.set(String(row.codigo).toUpperCase(), {
        ultimaAtualizacaoGerada: (row.ultima_atualizacao_gerada as string | null) ?? null,
        contentHash: (row.content_hash as string | null) ?? null,
        capaUrl: (row.capa_url as string | null) ?? null,
      });
    }
    capasCursor = String(capasRs.rows[capasRs.rows.length - 1].codigo);
    if (capasRs.rows.length < 1000) break;
  }
  console.info(`[capas] ${capasMap.size} capas já geradas anteriormente`);

  // Decide quem precisa de capa (incremental AUTO-CORRETIVO).
  //   - force: regera tudo.
  //   - senao: pula so quem o banco CONFIRMA que ja tem a capa content-addressed
  //     no ar (isCapaUpToDate = content_hash atual E capa_url == URL esperada).
  //     Qualquer outro vira "candidato" e passa por uma checagem HEAD real no
  //     storage: arquivo existe → so atualiza o banco e pula render; arquivo
  //     faltando → renderiza. Isso e imune ao hash "envenenado" e conserta
  //     sozinho stragglers (upload que nao completou) num rerun rapido.
  let renderList: ImovelRow[];
  if (force) {
    renderList = imoveis;
    console.info(`[capas] Force: regerando todas as ${imoveis.length} capas`);
  } else {
    const candidates: ImovelRow[] = [];
    let upToDate = 0;
    for (const im of imoveis) {
      const existing = capasMap.get(im.codigo.toUpperCase());
      const currentHash = computeContentHash(im);
      const expectedUrl = publicUrlFor(capaKey(im.codigo, currentHash));
      if (isCapaUpToDate({ currentHash, expectedUrl, dbHash: existing?.contentHash ?? null, dbUrl: existing?.capaUrl ?? null })) {
        upToDate++;
      } else {
        candidates.push(im);
      }
    }
    console.info(`[capas] Incremental: ${upToDate} ja no ar (banco confirma) · ${candidates.length} candidatas de ${imoveis.length}`);

    // Checa existencia real no storage (HEAD paralelo) só pros candidatos.
    const needRender: ImovelRow[] = [];
    const skipExistentes: ImovelRow[] = [];
    const HEAD_CONCURRENCY = 20;
    let headCursor = 0;
    async function headWorker() {
      while (true) {
        const i = headCursor++;
        if (i >= candidates.length) return;
        const im = candidates[i];
        try {
          const exists = await objectExists(capaKey(im.codigo, computeContentHash(im)));
          if (exists) skipExistentes.push(im);
          else needRender.push(im);
        } catch {
          needRender.push(im); // em caso de erro no HEAD, renderiza
        }
      }
    }
    if (candidates.length > 0) {
      console.info('[capas] Checando existencia no storage (HEAD paralelo)...');
      await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, candidates.length) }, () => headWorker()));
      console.info(`[capas]   ${skipExistentes.length} ja no storage (so atualiza banco) · ${needRender.length} precisam render`);
    }
    // Pra quem ja tem o arquivo no storage mas o registro estava defasado, corrige o banco.
    for (const im of skipExistentes) {
      const currentHash = computeContentHash(im);
      const capaUrl = publicUrlFor(capaKey(im.codigo, currentHash));
      await turso.execute({
        sql: `INSERT INTO capas_imoveis (codigo, capa_url, ultima_atualizacao_gerada, content_hash, gerado_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET capa_url=excluded.capa_url, ultima_atualizacao_gerada=excluded.ultima_atualizacao_gerada, content_hash=excluded.content_hash, gerado_em=excluded.gerado_em`,
        args: [im.codigo.toUpperCase(), capaUrl, im.ultima_atualizacao ?? null, currentHash, new Date().toISOString()],
      });
    }
    renderList = needRender;
  }

  // Aplica limit (dry-run)
  if (opts.limit && opts.limit > 0) {
    renderList = renderList.slice(0, opts.limit);
    console.info(`[capas] Limit: renderizando só ${renderList.length} imóveis`);
  }

  if (renderList.length === 0) {
    console.info('[capas] Nada a renderizar — todas as capas já estão no ar');
    try { await closeBrowser(); } catch {}
    try { closeStorageClient(); } catch {}
    try { turso.close(); } catch {}
    return { total: imoveis.length, gerados: 0, skippados: imoveis.length, erros: 0, durationMs: Date.now() - start };
  }

  // Dimensões do screenshot
  const dims: ScreenshotOptions = {
    width: 1080,
    height: formato === '1080x1920' ? 1920 : formato === '1080x1350' ? 1350 : 1080,
  };

  // Render em batch (passo 1) + retry pass (passo 2) pra garantir resiliência.
  // HTML é gerado sob demanda (foto baixada em RAM como base64, sem arquivo temporário).
  console.info(`[capas] Renderizando ${renderList.length} capas (concurrency=${concurrency})...`);

  // Items: html é placeholder vazio — gerado on-demand no worker pra não manter
  // 10k strings HTML em RAM ao mesmo tempo.
  const items = renderList.map((im) => ({
    imovel: im,
    html: '', // preenchido on-demand em buildHtmlForItem
    opts: dims,
  }));

  /** Gera o HTML com foto em base64 (em RAM, descartável). */
  async function buildHtmlForItem(im: ImovelRow): Promise<string> {
    // Resolve a URL da foto principal
    let fotoUrl = im.foto_principal_url ?? '';
    if (!fotoUrl && im.fotos_urls) {
      try {
        const arr = JSON.parse(im.fotos_urls as unknown as string) as unknown;
        if (Array.isArray(arr) && arr.length > 0) fotoUrl = String(arr[0]);
      } catch { /* ignora */ }
    }
    // Baixa em RAM → data URI → GC descarta depois do render
    const fotoDataUri = fotoUrl ? await fotoParaDataUri(fotoUrl) : '';
    const imComFoto = { ...im, foto_principal_url: fotoDataUri, fotos_urls: null };
    return renderTemplateHtml(templateHtml, imComFoto, BRAND_KIT, logoDataUri, formato);
  }

  const status = new Map<number, 'ok' | 'error'>();
  const sampleErrors: string[] = [];

  const pushSample = (codigo: string, err: unknown) => {
    if (sampleErrors.length >= 5) return;
    const msg = err instanceof Error ? err.message : String(err);
    sampleErrors.push(`${codigo}: ${msg.slice(0, 120)}`);
  };

  // Upload + registro no banco + cleanup da versão antiga. Lança em caso de erro.
  const processUpload = async (im: ImovelRow, img: Buffer): Promise<void> => {
    const currentHash = computeContentHash(im);
    const key = capaKey(im.codigo, currentHash);
    const capaUrl = await uploadPng(key, img);
    await turso.execute({
      sql: `INSERT INTO capas_imoveis (codigo, capa_url, ultima_atualizacao_gerada, content_hash, gerado_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET capa_url=excluded.capa_url, ultima_atualizacao_gerada=excluded.ultima_atualizacao_gerada, content_hash=excluded.content_hash, gerado_em=excluded.gerado_em`,
      args: [im.codigo.toUpperCase(), capaUrl, im.ultima_atualizacao ?? null, currentHash, new Date().toISOString()],
    });
    // Deleta a versao antiga da capa (se houver) pra nao acumular orfaos no storage
    const existing = capasMap.get(im.codigo.toUpperCase());
    if (existing) {
      const oldKey = capaKey(im.codigo, existing.contentHash);
      if (oldKey !== key) {
        try {
          await deleteObject(oldKey);
        } catch {
          // best-effort: nao falha o processo se o delete da versao antiga errar
        }
      }
    }
  };

  // Processa um item (render já feito pelo screenshotBatch). Retorna void,
  // marca 'ok' ou 'error' no status map. Nunca lança — erros viram log + status.
  const handleResult = async (
    im: ImovelRow,
    img: Buffer | null,
    error: Error | null,
    label: string,
  ): Promise<boolean> => {
    if (error || !img) {
      console.error(`[capas] ❌ ${label} ${im.codigo}: ${error?.message ?? 'JPG nulo'}`);
      return false;
    }
    try {
      await processUpload(im, img);
      return true;
    } catch (err) {
      console.error(`[capas] ❌ ${label} ${im.codigo} upload/db: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  };

  /**
   * Renderiza um item: gera HTML on-demand (foto em base64 em RAM),
   * tira screenshot e faz upload. HTML e buffer são descartados pelo GC.
   */
  async function renderItem(im: ImovelRow): Promise<Buffer> {
    const html = await buildHtmlForItem(im);
    const [result] = await screenshotBatch([{ imovel: im, html, opts: dims }], 1);
    if (result.error) throw result.error;
    if (!result.png) throw new Error('screenshot retornou nulo');
    return result.png;
  }

  // Passo 1: render + upload em paralelo (concurrency limitada).
  {
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        const im = items[i].imovel;
        try {
          const img = await renderItem(im);
          await processUpload(im, img);
          status.set(i, 'ok');
        } catch (err) {
          console.error(`[capas] ❌ render ${im.codigo}: ${err instanceof Error ? err.message : err}`);
          pushSample(im.codigo, err);
          status.set(i, 'error');
        }
        const done = [...status.size ? status : new Map()].length;
        if (done % 50 === 0 || done === items.length) {
          console.info(`[capas] ${status.size}/${items.length} processados`);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  }

  // Passo 2: retry dos que falharam, com concurrency baixa (mais resiliente).
  const erroredIdxs = [...status.entries()].filter(([, s]) => s === 'error').map(([i]) => i);
  if (erroredIdxs.length > 0) {
    console.info(`[capas] Retry: ${erroredIdxs.length} capas com erro, retentando (concurrency=2)...`);
    let retryCursor = 0;
    async function retryWorker() {
      while (true) {
        const j = retryCursor++;
        if (j >= erroredIdxs.length) return;
        const origIdx = erroredIdxs[j];
        const im = items[origIdx].imovel;
        try {
          const img = await renderItem(im);
          await processUpload(im, img);
          status.set(origIdx, 'ok');
        } catch (err) {
          console.error(`[capas] ❌ retry ${im.codigo}: ${err instanceof Error ? err.message : err}`);
          pushSample(im.codigo, err);
          status.set(origIdx, 'error');
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, erroredIdxs.length) }, () => retryWorker()));
  }

  const gerados = [...status.values()].filter((s) => s === 'ok').length;
  const erros = [...status.values()].filter((s) => s === 'error').length;

  // Skips = tudo que não foi renderizado agora nem deu erro (já estava no ar).
  const skippados = imoveis.length - gerados - erros;

  // Cleanup (defensivo — nunca deixa exception escapar e derrubar o processo)
  try { await closeBrowser(); } catch {}
  try { closeStorageClient(); } catch {}
  try { turso.close(); } catch {}

  const durationMs = Date.now() - start;
  const min = Math.floor(durationMs / 60_000);
  const sec = Math.floor((durationMs % 60_000) / 1000);
  console.info(`\n[capas] Concluído em ${min}m${sec}s`);
  console.info(`[capas]   Gerados:    ${gerados}`);
  console.info(`[capas]   Skippados:  ${skippados}`);
  console.info(`[capas]   Erros:      ${erros}`);
  console.info(`[capas]   Total catálogo: ${imoveis.length}`);

  return { total: imoveis.length, gerados, skippados, erros, durationMs, sampleErrors };
}
