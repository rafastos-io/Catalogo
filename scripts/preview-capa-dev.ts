/**
 * Preview local da capa com hot-reload.
 *
 *   npm run capas:preview
 *   npm run capas:preview -- --codigo=AP7826 --template=imovel-estatico-03 --formato=1080x1080
 *
 * Abre http://localhost:3939 — edite templates/.../html.html e salve; o browser recarrega.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  previewRevision,
  renderPreviewPage,
  watchPreviewTemplate,
} from '../lib/capas/preview-page.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PREVIEW_PORT) || 3939;

function loadEnv(): void {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
  }
}

function parseArgs() {
  const get = (name: string, def: string) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : def;
  };
  return {
    codigo: get('codigo', 'AP0221'),
    template: get('template', 'imovel-estatico-03'),
    formato: get('formato', '1080x1350'),
  };
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

loadEnv();
const defaults = parseArgs();
watchPreviewTemplate(defaults.template);

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const run = async () => {
    const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (u.pathname === '/__revision') {
      send(res, 200, JSON.stringify({ revision: previewRevision() }), 'application/json');
      return;
    }
    const codigo = u.searchParams.get('codigo') ?? defaults.codigo;
    const template = u.searchParams.get('template') ?? defaults.template;
    const formato = u.searchParams.get('formato') ?? defaults.formato;
    const html = await renderPreviewPage(codigo, template, formato, true);
    send(res, 200, html, 'text/html; charset=utf-8');
  };
  run().catch((err) => {
    send(res, 500, `Erro preview: ${err instanceof Error ? err.message : err}`, 'text/plain; charset=utf-8');
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/?codigo=${defaults.codigo}&template=${defaults.template}&formato=${defaults.formato}`;
  console.log(`\n[preview] ${url}`);
  console.log('[preview] Ctrl+C para parar\n');
});
