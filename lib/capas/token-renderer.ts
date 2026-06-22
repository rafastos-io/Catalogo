// Port do lib/art/tokenRenderer.ts (MarketCenter) — subset imóvel.
// Substitui tokens {{...}} no HTML do template imovel-estatico-03.

import type { BrandKit } from './brand-kit.js';

export interface ImovelDados {
  codigo: string;
  tipo_imovel: string | null;
  subtipo_imovel: string | null;
  bairro: string | null;
  cidade: string | null;
  finalidade: string | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  area_util: number | null;
  valor_venda: number | null;
  valor_aluguel: number | null;
  foto_principal_url: string | null;
  fotos_urls: string | null; // JSON text
}

export interface TokenMap {
  [key: string]: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function containsCI(s: string | null, needle: string): boolean {
  return hasText(s) ? s.toLowerCase().includes(needle.toLowerCase()) : false;
}

/** Formata valor BRL: 2135000 → "R$ 2.135.000" */
function formatBRL(v: number | null): string {
  if (v == null || isNaN(v)) return '';
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function coalesce<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v != null) return v;
  return null;
}

// ── Token map ────────────────────────────────────────────────────────────────

export function buildTokenMap(
  im: ImovelDados,
  brand: BrandKit,
  logoDataUri: string,
  formato: string,
): TokenMap {
  const altura = formato === '1080x1920' ? '1920' : formato === '1080x1350' ? '1350' : '1080';

  // valor: venda se houver, senão aluguel
  const ehVenda = im.valor_venda != null && im.valor_venda > 0;
  const ehAluguel = im.valor_aluguel != null && im.valor_aluguel > 0;
  const valor = ehVenda ? formatBRL(im.valor_venda) : ehAluguel ? formatBRL(im.valor_aluguel) : '';
  const sufixoValor = ehAluguel && !ehVenda ? '/mês' : '';

  // foto: principal ou primeira das fotos_urls
  let fotoUrl = im.foto_principal_url ?? '';
  if (!fotoUrl && hasText(im.fotos_urls)) {
    try {
      const arr = JSON.parse(im.fotos_urls) as unknown;
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
        fotoUrl = arr[0];
      }
    } catch {
      // fotos_urls inválido
    }
  }

  // tipo: tipo_imovel ou subtipo
  const tipo = coalesce(im.tipo_imovel, im.subtipo_imovel) ?? '';

  // area_util com sufixo m²
  const areaUtil = im.area_util != null ? `${im.area_util} m²` : '';

  return {
    // Marca
    cor_primaria: brand.cor_primaria,
    cor_acento: brand.cor_acento,
    cor_fundo: brand.cor_fundo,
    logo_url: logoDataUri,
    logo_url_claro: logoDataUri,
    logo_url_escuro: logoDataUri,
    nome_marca: brand.nome_marca,
    fonte: brand.fonte,
    fonte_url: brand.fonte_url,

    // Corretor (fixo GRUPO URBAN)
    nome_corretor: brand.nome_corretor,
    creci: brand.creci,

    // Formato
    formato,
    largura: '1080',
    altura,

    // Imóvel
    codigo: im.codigo,
    tipo,
    bairro: im.bairro ?? '',
    cidade: im.cidade ?? '',
    quartos: im.quartos != null ? String(im.quartos) : '',
    suites: im.suites != null ? String(im.suites) : '',
    banheiros: im.banheiros != null ? String(im.banheiros) : '',
    vagas: im.vagas != null ? String(im.vagas) : '',
    salas: '',
    total_andares: '',
    area_util: areaUtil,
    area_total: '',
    valor_venda: formatBRL(im.valor_venda),
    valor_aluguel: formatBRL(im.valor_aluguel),
    valor,
    sufixo_valor: sufixoValor,
    finalidade: im.finalidade ?? '',
    subtipo: im.subtipo_imovel ?? '',
    foto_url: fotoUrl,
    ficha: '',
  };
}

// ── Substituição ─────────────────────────────────────────────────────────────

/** Substitui todos os {{token}} pelo valor. Token ausente → string vazia. */
export function substituteTokens(html: string, tokens: TokenMap): string {
  return html.replace(/\{\{(\w+)\}\}/g, (m, key: string) => {
    const v = tokens[key];
    return v != null ? v : '';
  });
}

/** Aplica tokens no HTML do template e devolve HTML pronto pro screenshot. */
export function renderTemplateHtml(
  templateHtml: string,
  im: ImovelDados,
  brand: BrandKit,
  logoDataUri: string,
  formato: string,
): string {
  const tokens = buildTokenMap(im, brand, logoDataUri, formato);
  return substituteTokens(templateHtml, tokens);
}
