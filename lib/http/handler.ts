import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { feedOutDir, isSyncDesligado } from '../runtime/flags.js';
import { getStatus, requestCancel } from '../jobs/status.js';
import { isPipelineRunning, runNightlyPipeline } from '../jobs/pipeline.js';
import { previewRevision, renderPreviewPage } from '../capas/preview-page.js';
import { probeSftp } from '../capas/storage.js';

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function parseQuery(url: string): URL {
  return new URL(url, 'http://localhost');
}

function requireTriggerToken(u: URL, res: ServerResponse): boolean {
  const secret = process.env.PIPELINE_TRIGGER_TOKEN?.trim();
  if (!secret) {
    json(res, 503, { ok: false, error: 'PIPELINE_TRIGGER_TOKEN não configurado' });
    return false;
  }
  const token = u.searchParams.get('token') ?? '';
  if (token !== secret) {
    json(res, 401, { ok: false, error: 'token inválido' });
    return false;
  }
  return true;
}

function serveFeedFile(res: ServerResponse, fileName: string, type: string): void {
  const path = join(feedOutDir(), fileName);
  if (!existsSync(path)) {
    send(res, 503, 'feed ainda não gerado', 'text/plain; charset=utf-8');
    return;
  }
  const buf = readFileSync(path);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=300',
    'Last-Modified': statSync(path).mtime.toUTCString(),
  });
  res.end(buf);
}

async function handlePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = parseQuery(req.url ?? '/');
  if (u.pathname === '/health') {
    json(res, 200, { ok: true, sync_desligado: true, mode: 'preview' });
    return;
  }
  if (u.pathname === '/__revision') {
    json(res, 200, { revision: previewRevision() });
    return;
  }
  const codigo = u.searchParams.get('codigo') ?? 'AP0221';
  const template = u.searchParams.get('template') ?? 'imovel-estatico-03';
  const formato = u.searchParams.get('formato') ?? '1080x1350';
  const html = await renderPreviewPage(codigo, template, formato, true);
  send(res, 200, html, 'text/html; charset=utf-8');
}

async function handleProduction(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = parseQuery(req.url ?? '/');
  if (u.pathname === '/health' || u.pathname === '/') {
    json(res, 200, {
      ok: true,
      sync_desligado: false,
      mode: 'production',
      ...getStatus(),
    });
    return;
  }
  if (u.pathname === '/facebook-home-listings.csv') {
    serveFeedFile(res, 'facebook-home-listings.csv', 'text/csv; charset=utf-8');
    return;
  }
  if (u.pathname === '/facebook-home-listings.xml') {
    serveFeedFile(res, 'facebook-home-listings.xml', 'application/xml; charset=utf-8');
    return;
  }

  // ── Trigger manual do pipeline ──────────────────────────────────────────────
  if (u.pathname === '/trigger' && req.method === 'POST') {
    if (!requireTriggerToken(u, res)) return;
    if (isPipelineRunning()) {
      json(res, 409, { ok: false, error: 'pipeline já em andamento', ...getStatus() });
      return;
    }
    void runNightlyPipeline();
    json(res, 202, { ok: true, message: 'pipeline iniciado — acompanhe em /health' });
    return;
  }

  // ── Cancelar pipeline em andamento ─────────────────────────────────────────
  if (u.pathname === '/cancel' && req.method === 'POST') {
    if (!requireTriggerToken(u, res)) return;
    if (!isPipelineRunning()) {
      json(res, 200, { ok: true, message: 'nada rodando', ...getStatus() });
      return;
    }
    requestCancel('POST /cancel');
    json(res, 202, { ok: true, message: 'cancelamento solicitado — workers param no próximo item', ...getStatus() });
    return;
  }

  // ── Teste SFTP (credenciais Hostinger) ─────────────────────────────────────
  // GET /sftp-test?token=... — conecta, lista, sobe e apaga um arquivo minúsculo.
  if (u.pathname === '/sftp-test' && (req.method === 'GET' || req.method === 'POST')) {
    if (!requireTriggerToken(u, res)) return;
    if (isPipelineRunning()) {
      json(res, 409, { ok: false, error: 'pipeline em andamento — teste SFTP depois' });
      return;
    }
    const result = await probeSftp();
    json(res, result.ok ? 200 : 503, result);
    return;
  }

  send(res, 404, 'not found', 'text/plain; charset=utf-8');
}

export function startHttpServer(port: number): void {
  const preview = isSyncDesligado();
  const server = createServer((req, res) => {
    const run = preview ? handlePreview(req, res) : handleProduction(req, res);
    run.catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      send(res, 500, msg, 'text/plain; charset=utf-8');
    });
  });

  server.listen(port, () => {
    const mode = preview ? 'preview (SYNC_DESLIGADO)' : 'produção';
    console.log(`[http] ${mode} em :${port}`);
    if (preview) {
      console.log(`[http] capa: http://0.0.0.0:${port}/?codigo=AP0221`);
    } else {
      console.log(`[http] health: http://0.0.0.0:${port}/health`);
      console.log(`[http] feed:   http://0.0.0.0:${port}/facebook-home-listings.csv`);
    }
  });
}
