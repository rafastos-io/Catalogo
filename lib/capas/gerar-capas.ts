// Orquestrador: le Turso, decide incremental, gera JPG, sobe via SFTP,
// atualiza capas_imoveis. Reaproveita browser e client SFTP entre os imoveis.

import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_KIT, logoToDataUri } from './brand-kit.js';
import { renderTemplateHtml, type ImovelDados } from './token-renderer.js';
import { screenshotBatch, closeBrowser, type ScreenshotOptions } from './screenshot.js';
import { uploadPng, capaKey, publicUrlFor, objectExists, deleteObject, closeStorageClient } from './storage.js';
import { computeContentHash } from './content-hash.js';

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
  const capasMap = new Map<string, { ultimaAtualizacaoGerada: string | null; contentHash: string | null }>();
  let capasCursor = '';
  while (true) {
    const capasRs = await turso.execute({
      sql: 'SELECT codigo, ultima_atualizacao_gerada, content_hash FROM capas_imoveis WHERE codigo > ? ORDER BY codigo LIMIT 1000',
      args: [capasCursor],
    });
    if (capasRs.rows.length === 0) break;
    for (const row of capasRs.rows) {
      capasMap.set(String(row.codigo).toUpperCase(), {
        ultimaAtualizacaoGerada: (row.ultima_atualizacao_gerada as string | null) ?? null,
        contentHash: (row.content_hash as string | null) ?? null,
      });
    }
    capasCursor = String(capasRs.rows[capasRs.rows.length - 1].codigo);
    if (capasRs.rows.length < 1000) break;
  }
  console.info(`[capas] ${capasMap.size} capas já geradas anteriormente`);

  // Filtra quem precisa de capa (incremental por content_hash).
  // Compara o hash dos campos atuais do imovel com o hash gravado na ultima
  // geracao. Se for igual, a capa visualmente nao mudou → skipa. Se diferir
  // (ou se nunca gerou), processa.
  let toProcess: ImovelRow[] = imoveis;
  if (!force) {
    toProcess = imoveis.filter((im) => {
      const existing = capasMap.get(im.codigo.toUpperCase());
      if (existing == null) return true; // nunca gerou
      const currentHash = computeContentHash(im);
      return existing.contentHash !== currentHash; // hash mudou → regera
    });
    console.info(`[capas] Incremental: ${toProcess.length} de ${imoveis.length} a processar (por content_hash)`);
  } else {
    console.info(`[capas] Force: regerando todas as ${imoveis.length} capas`);
  }

  // Aplica limit (dry-run)
  if (opts.limit && opts.limit > 0) {
    toProcess = toProcess.slice(0, opts.limit);
    console.info(`[capas] Limit: processando só ${toProcess.length} imóveis`);
  }

  if (toProcess.length === 0) {
    console.info('[capas] Nada a processar — todas as capas estão atualizadas');
    try { await closeBrowser(); } catch {}
    try { closeStorageClient(); } catch {}
    try { turso.close(); } catch {}
    return { total: imoveis.length, gerados: 0, skippados: imoveis.length, erros: 0, durationMs: Date.now() - start };
  }

  // Pre-filtra quem ja tem JPG no storage (evita re-render quando capa existe mas
  // capas_imoveis esta desatualizada — edge case de migrations).
  // Skip inteiro se capasMap vazio (fresh load: todos precisam render mesmo).
  // Skip se force (vai regerar tudo independente).
  let renderList: ImovelRow[] = toProcess;
  if (!force && capasMap.size > 0 && toProcess.length > 0) {
    console.info('[capas] Checando existencia no storage (HEAD paralelo) pra skips adicionais...');
    const skipExistentes: ImovelRow[] = [];
    const needRender: ImovelRow[] = [];
    // HEAD checks paralelos (concurrency = 20) pra nao bloquear
    const HEAD_CONCURRENCY = 20;
    let headCursor = 0;
    async function headWorker() {
      while (true) {
        const i = headCursor++;
        if (i >= toProcess.length) return;
        const im = toProcess[i];
        try {
          const exists = await objectExists(capaKey(im.codigo, im.ultima_atualizacao));
          if (exists) skipExistentes.push(im);
          else needRender.push(im);
        } catch {
          needRender.push(im); // em caso de erro no HEAD, renderiza
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, toProcess.length) }, () => headWorker()));
    console.info(`[capas]   ${skipExistentes.length} ja no storage (skip) · ${needRender.length} precisam render`);
    renderList = needRender;
    // Pra quem ja ta no storage mas nao esta em capas_imoveis, atualiza o banco
    for (const im of skipExistentes) {
      const capaUrl = publicUrlFor(capaKey(im.codigo, im.ultima_atualizacao));
      const currentHash = computeContentHash(im);
      await turso.execute({
        sql: `INSERT INTO capas_imoveis (codigo, capa_url, ultima_atualizacao_gerada, content_hash, gerado_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET capa_url=excluded.capa_url, ultima_atualizacao_gerada=excluded.ultima_atualizacao_gerada, content_hash=excluded.content_hash, gerado_em=excluded.gerado_em`,
        args: [im.codigo.toUpperCase(), capaUrl, im.ultima_atualizacao ?? null, currentHash, new Date().toISOString()],
      });
    }
  }

  // Dimensões do screenshot
  const dims: ScreenshotOptions = {
    width: 1080,
    height: formato === '1080x1920' ? 1920 : formato === '1080x1350' ? 1350 : 1080,
  };

  // Render em batch (passo 1) + retry pass (passo 2) pra garantir resiliência.
  console.info(`[capas] Renderizando ${renderList.length} capas (concurrency=${concurrency})...`);

  const items = renderList.map((im) => ({
    imovel: im,
    html: renderTemplateHtml(templateHtml, im, BRAND_KIT, logoDataUri, formato),
    opts: dims,
  }));

  const status = new Map<number, 'ok' | 'error'>();

  // Upload + registro no banco + cleanup da versão antiga. Lança em caso de erro.
  const processUpload = async (im: ImovelRow, img: Buffer): Promise<void> => {
    const key = capaKey(im.codigo, im.ultima_atualizacao);
    const capaUrl = await uploadPng(key, img);
    const currentHash = computeContentHash(im);
    await turso.execute({
      sql: `INSERT INTO capas_imoveis (codigo, capa_url, ultima_atualizacao_gerada, content_hash, gerado_em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET capa_url=excluded.capa_url, ultima_atualizacao_gerada=excluded.ultima_atualizacao_gerada, content_hash=excluded.content_hash, gerado_em=excluded.gerado_em`,
      args: [im.codigo.toUpperCase(), capaUrl, im.ultima_atualizacao ?? null, currentHash, new Date().toISOString()],
    });
    // Deleta a versao antiga da capa (se houver) pra nao acumular orfaos no storage
    const existing = capasMap.get(im.codigo.toUpperCase());
    if (existing) {
      const oldKey = capaKey(im.codigo, existing.ultimaAtualizacaoGerada);
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

  // Passo 1: render + upload em paralelo (concurrency alta).
  await screenshotBatch(items, concurrency, async (item, idx, img, error) => {
    const im = (item as { imovel: ImovelRow }).imovel;
    const ok = await handleResult(im, img, error, 'render');
    status.set(idx, ok ? 'ok' : 'error');
  });

  // Passo 2: retry dos que falharam, com concurrency baixa (mais resiliente).
  const erroredIdxs = [...status.entries()].filter(([, s]) => s === 'error').map(([i]) => i);
  if (erroredIdxs.length > 0) {
    console.info(`[capas] Retry: ${erroredIdxs.length} capas com erro, retentando (concurrency=2)...`);
    const retryItems = erroredIdxs.map((origIdx) => ({ ...items[origIdx], _origIdx: origIdx }));
    await screenshotBatch(retryItems, 2, async (item, _retryIdx, img, error) => {
      const origIdx = (item as { _origIdx: number })._origIdx;
      const im = (item as { imovel: ImovelRow }).imovel;
      const ok = await handleResult(im, img, error, 'retry');
      status.set(origIdx, ok ? 'ok' : 'error');
    });
  }

  const gerados = [...status.values()].filter((s) => s === 'ok').length;
  const erros = [...status.values()].filter((s) => s === 'error').length;

  // Conta skips (capas que já existiam)
  const skippados = toProcess.length - gerados - erros;

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

  return { total: imoveis.length, gerados, skippados, erros, durationMs };
}
