import { existsSync, readFileSync, watch } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import { BRAND_KIT, logoToDataUri } from './brand-kit.js';
import { renderTemplateHtml, type ImovelDados } from './token-renderer.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let turso: ReturnType<typeof createClient> | null = null;
let logoDataUri = '';
let revision = 0;

export function previewRevision(): number {
  return revision;
}

export function bumpPreviewRevision(): void {
  revision++;
  logoDataUri = '';
}

function getTurso() {
  if (turso) return turso;
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) throw new Error('TURSO_DATABASE_URL / TURSO_AUTH_TOKEN faltando');
  turso = createClient({ url, authToken: token });
  return turso;
}

async function fetchImovel(codigo: string): Promise<ImovelDados> {
  const db = getTurso();
  const rs = await db.execute({
    sql: `SELECT codigo, tipo_imovel, subtipo_imovel, bairro, cidade, finalidade,
                 quartos, suites, banheiros, salas, vagas, area_util,
                 valor_venda, valor_aluguel, foto_principal_url, fotos_urls
          FROM imoveis WHERE codigo = ? LIMIT 1`,
    args: [codigo.toUpperCase()],
  });
  if (rs.rows.length === 0) throw new Error(`Imóvel não encontrado: ${codigo}`);
  return rs.rows[0] as unknown as ImovelDados;
}

function loadTemplateHtml(slug: string): string {
  const p = join(ROOT, 'templates', slug, 'html.html');
  if (!existsSync(p)) throw new Error(`Template não encontrado: ${p}`);
  return readFileSync(p, 'utf8');
}

function toolbar(codigo: string, template: string, formato: string): string {
  return `
<div id="preview-toolbar" style="position:fixed;top:0;left:0;right:0;z-index:99999;background:#111;color:#eee;font:12px/1.4 monospace;padding:8px 12px;display:flex;gap:12px;align-items:center;border-bottom:1px solid #333;">
  <strong>CAPA PREVIEW</strong>
  <span>${codigo}</span>
  <span>${template}</span>
  <span>${formato}</span>
  <span style="opacity:.7">Só leitura — não grava Turso nem SFTP</span>
  <a href="/?codigo=${codigo}&template=${template}&formato=1080x1080" style="color:#c09c83">1080²</a>
  <a href="/?codigo=${codigo}&template=${template}&formato=1080x1350" style="color:#c09c83">1350</a>
  <a href="/?codigo=${codigo}&template=${template}&formato=1080x1920" style="color:#c09c83">1920</a>
</div>
<div style="height:36px"></div>`;
}

function liveReloadScript(currentRevision: number): string {
  return `
<script>
(function(){
  let v = ${currentRevision};
  setInterval(async () => {
    try {
      const r = await fetch('/__revision');
      const j = await r.json();
      if (j.revision !== v) location.reload();
    } catch {}
  }, 800);
})();
</script>`;
}

export async function renderPreviewPage(
  codigo: string,
  template: string,
  formato: string,
  withLiveReload: boolean,
): Promise<string> {
  if (!logoDataUri) logoDataUri = await logoToDataUri(BRAND_KIT.logo_url_escuro);
  const im = await fetchImovel(codigo);
  let html = renderTemplateHtml(loadTemplateHtml(template), im, BRAND_KIT, logoDataUri, formato);
  html = html.replace('<body>', `<body>${toolbar(codigo, template, formato)}`);
  if (withLiveReload) {
    html = html.replace('</head>', `${liveReloadScript(revision)}</head>`);
  }
  return html;
}

export function watchPreviewTemplate(template: string): void {
  const templateDir = join(ROOT, 'templates', template);
  const brandKit = join(ROOT, 'lib', 'capas', 'brand-kit.ts');
  for (const p of [templateDir, brandKit]) {
    if (!existsSync(p)) continue;
    watch(p, { recursive: true }, () => {
      bumpPreviewRevision();
      console.log(`[preview] reload #${revision}`);
    });
  }
}
