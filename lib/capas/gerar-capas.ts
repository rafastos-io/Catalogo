// Orquestrador: lê Turso, decide incremental, gera PNG, sobe pro R2,
// atualiza capas_imoveis. Reaproveita browser e client R2 entre os imóveis.

import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { BRAND_KIT, logoToDataUri } from './brand-kit.js';
import { renderTemplateHtml, type ImovelDados } from './token-renderer.js';
import { screenshotBatch, closeBrowser, type ScreenshotOptions } from './screenshot.js';
import { uploadPng, capaKey, publicUrlFor, objectExists, closeR2Client } from './r2-storage.js';

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

  // Lê capas já geradas (controle incremental)
  const capasRs = await turso.execute('SELECT codigo, ultima_atualizacao_gerada FROM capas_imoveis');
  const capasMap = new Map<string, string | null>();
  for (const row of capasRs.rows) {
    capasMap.set(String(row.codigo).toUpperCase(), (row.ultima_atualizacao_gerada as string | null) ?? null);
  }
  console.info(`[capas] ${capasMap.size} capas já geradas anteriormente`);

  // Filtra quem precisa de capa (incremental)
  let toProcess: ImovelRow[] = imoveis;
  if (!force) {
    toProcess = imoveis.filter((im) => {
      const lastGen = capasMap.get(im.codigo.toUpperCase());
      if (lastGen == null) return true; // nunca gerou
      const imDate = im.ultima_atualizacao ?? '';
      if (!imDate) return false; // sem data no imóvel → confia na capa existente
      return imDate > lastGen; // imóvel atualizado depois da capa
    });
    console.info(`[capas] Incremental: ${toProcess.length} de ${imoveis.length} a processar`);
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
    closeBrowser();
    closeR2Client();
    turso.close();
    return { total: imoveis.length, gerados: 0, skippados: imoveis.length, erros: 0, durationMs: Date.now() - start };
  }

  // Pré-filtra quem já tem PNG no R2 (evita re-render quando capa existe mas
  // capas_imoveis está desatualizada — edge case de migrations).
  // Só vale a pena se NÃO for force.
  let renderList: ImovelRow[] = toProcess;
  if (!force && toProcess.length > 0) {
    console.info('[capas] Checando existência no R2 (HEAD) pra skips adicionais...');
    const skipR2: ImovelRow[] = [];
    const needRender: ImovelRow[] = [];
    for (const im of toProcess) {
      const exists = await objectExists(capaKey(im.codigo));
      if (exists) skipR2.push(im);
      else needRender.push(im);
    }
    console.info(`[capas]   ${skipR2.length} já no R2 (skip) · ${needRender.length} precisam render`);
    renderList = needRender;
    // Pra quem já tá no R2 mas não está em capas_imoveis, atualiza o banco
    for (const im of skipR2) {
      const capaUrl = publicUrlFor(capaKey(im.codigo));
      await turso.execute({
        sql: `INSERT INTO capas_imoveis (codigo, capa_url, ultima_atualizacao_gerada, gerado_em) VALUES (?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET capa_url=excluded.capa_url, ultima_atualizacao_gerada=excluded.ultima_atualizacao_gerada, gerado_em=excluded.gerado_em`,
        args: [im.codigo.toUpperCase(), capaUrl, im.ultima_atualizacao ?? null, new Date().toISOString()],
      });
    }
  }

  // Dimensões do screenshot
  const dims: ScreenshotOptions = {
    width: 1080,
    height: formato === '1080x1920' ? 1920 : formato === '1080x1350' ? 1350 : 1080,
  };

  // Render em batch
  let gerados = 0;
  let erros = 0;
  console.info(`[capas] Renderizando ${renderList.length} capas (concurrency=${concurrency})...`);

  const items = renderList.map((im) => ({
    imovel: im,
    html: renderTemplateHtml(templateHtml, im, BRAND_KIT, logoDataUri, formato),
    opts: dims,
  }));

  const results = await screenshotBatch(items, concurrency, async (item, _idx, png, error) => {
    const im = (item as { imovel: ImovelRow }).imovel;
    if (error || !png) {
      erros++;
      console.error(`[capas] ❌ ${im.codigo}: ${error?.message ?? 'PNG nulo'}`);
      return;
    }
    try {
      const key = capaKey(im.codigo);
      const capaUrl = await uploadPng(key, png);
      // Atualiza capas_imoveis
      await turso.execute({
        sql: `INSERT INTO capas_imoveis (codigo, capa_url, ultima_atualizacao_gerada, gerado_em) VALUES (?, ?, ?, ?) ON CONFLICT(codigo) DO UPDATE SET capa_url=excluded.capa_url, ultima_atualizacao_gerada=excluded.ultima_atualizacao_gerada, gerado_em=excluded.gerado_em`,
        args: [im.codigo.toUpperCase(), capaUrl, im.ultima_atualizacao ?? null, new Date().toISOString()],
      });
      gerados++;
    } catch (err) {
      erros++;
      console.error(`[capas] ❌ ${im.codigo} upload/db: ${err instanceof Error ? err.message : err}`);
    }
  });

  // Conta skips (capas que já existiam)
  const skippados = toProcess.length - gerados - erros;

  // Cleanup
  closeBrowser();
  closeR2Client();
  turso.close();

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
