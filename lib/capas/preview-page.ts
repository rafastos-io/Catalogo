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

export async function fetchRandomCodigo(exclude?: string): Promise<string> {
  const db = getTurso();
  const rs = exclude
    ? await db.execute({
        sql: `SELECT codigo FROM imoveis
              WHERE status_anuncio = 'Ativo'
                AND foto_principal_url IS NOT NULL AND foto_principal_url != ''
                AND codigo != ?
              ORDER BY RANDOM() LIMIT 1`,
        args: [exclude.toUpperCase()],
      })
    : await db.execute(`
        SELECT codigo FROM imoveis
        WHERE status_anuncio = 'Ativo'
          AND foto_principal_url IS NOT NULL AND foto_principal_url != ''
        ORDER BY RANDOM() LIMIT 1
      `);
  const codigo = rs.rows[0]?.codigo;
  if (!codigo) throw new Error('Nenhum imóvel com foto');
  return String(codigo);
}

function loadTemplateHtml(slug: string): string {
  const p = join(ROOT, 'templates', slug, 'html.html');
  if (!existsSync(p)) throw new Error(`Template não encontrado: ${p}`);
  return readFileSync(p, 'utf8');
}

function toolbar(codigo: string, template: string, formato: string): string {
  const q = `template=${template}&formato=${formato}`;
  return `
<div id="preview-toolbar" style="position:fixed;bottom:16px;left:16px;z-index:99999;background:rgba(10,10,10,.88);color:#eee;font:12px/1.4 monospace;padding:8px 12px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(8px);max-width:1040px;">
  <strong>CAPA PREVIEW</strong>
  <span>${codigo}</span>
  <a href="/__sortear?${q}&exceto=${codigo}" style="color:#c09c83">outra foto</a>
  <form method="get" action="/" style="display:flex;gap:6px;align-items:center;margin:0;">
    <input type="hidden" name="template" value="${template}">
    <input type="hidden" name="formato" value="${formato}">
    <input name="codigo" value="${codigo}" style="width:92px;background:#1a1a1b;color:#eee;border:1px solid #444;padding:4px 6px;font:12px monospace;">
    <button type="submit" style="background:#c09c83;color:#222;border:0;padding:4px 8px;cursor:pointer;font:12px monospace;">ir</button>
  </form>
</div>`;
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
