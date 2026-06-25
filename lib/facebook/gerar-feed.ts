// Gerador de feed Facebook Home Listings a partir do Turso.
// Lê a tabela imoveis, converte cada linha via converters.ts e produz CSV + XML.
// Sem I/O externo além do Turso (leitura) e filesystem (escrita dos arquivos).

import { createClient, type Client } from '@libsql/client';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  rowToImovelFB,
  toAvailability,
  toPrice,
  toPropertyType,
  toListingType,
  toAcType,
  toPetPolicy,
  toDaysOnMarket,
  toConstructionStatus,
  toTenureType,
  toParkingType,
  toAddress,
  toBuildingAmenities,
  toUnitFeatures,
  toProductTags,
  toImageUrls,
  toCustomFields,
  toInternalLabels,
  toImageUrlsWithCapa,
  toName,
  toHomeListingGroupId,
  toAgentCompany,
  toMinMaxPrice,
  formatMoneyBRL,
  normalizeUrl,
  type ImovelFB,
} from './converters.js';

export type FeedFormat = 'csv' | 'xml' | 'both';

export interface FeedResult {
  count: number;
  csvPath: string | null;
  xmlPath: string | null;
  durationMs: number;
}

export interface FeedOptions {
  format: FeedFormat;
  outDir: string;
  csvFileName?: string;
  xmlFileName?: string;
  feedTitle?: string;
  maxImages?: number; // default 10
  maxArrayItems?: number; // default 10 (amenities, features, tags)
}

// ── Colunas do CSV (ordem fixa, subset útil do template Facebook) ────────────

const CSV_COLUMNS: Array<{ key: string; get: (i: ImovelFB) => string | null }> = [
  { key: 'home_listing_id', get: (i) => i.codigo },
  { key: 'name', get: (i) => toName(i) },
  { key: 'description', get: (i) => (i.descricao ?? '').slice(0, 5000) || null },
  { key: 'availability', get: (i) => toAvailability(i) },
  { key: 'price', get: (i) => toPrice(i) },
  // image[0..N] geradas dinamicamente no loop (capa + fotos originais)
  { key: 'url', get: (i) => normalizeUrl(i.url_portal) },
  { key: 'address.addr1', get: (i) => toAddress(i).addr1 },
  { key: 'address.addr2', get: (i) => toAddress(i).addr2 },
  { key: 'address.city', get: (i) => toAddress(i).city },
  { key: 'address.region', get: (i) => toAddress(i).region },
  { key: 'address.postal_code', get: (i) => toAddress(i).postal_code },
  { key: 'address.country', get: (i) => toAddress(i).country },
  { key: 'address.unit_number', get: (i) => toAddress(i).unit_number },
  { key: 'latitude', get: (i) => (i.latitude != null && i.latitude !== 0 ? String(i.latitude) : null) },
  { key: 'longitude', get: (i) => (i.longitude != null && i.longitude !== 0 ? String(i.longitude) : null) },
  { key: 'neighborhood[0]', get: (i) => i.bairro },
  { key: 'area_size', get: (i) => (i.area_util != null ? String(i.area_util) : null) },
  { key: 'built_up_area_size', get: (i) => (i.area_privativa != null ? String(i.area_privativa) : null) },
  { key: 'land_area_size', get: (i) => (i.area_total != null ? String(i.area_total) : null) },
  { key: 'area_unit', get: (_i) => 'square_meters' },
  { key: 'num_baths', get: (i) => (i.banheiros != null ? String(i.banheiros) : null) },
  { key: 'num_beds', get: (i) => (i.quartos != null ? String(i.quartos) : null) },
  { key: 'num_rooms', get: (i) => (i.salas != null ? String(i.salas) : null) },
  { key: 'parking_spaces', get: (i) => (i.vagas != null ? String(i.vagas) : null) },
  { key: 'parking_type', get: (i) => toParkingType(i) },
  { key: 'year_built', get: (i) => (i.ano_construcao != null ? String(i.ano_construcao) : null) },
  { key: 'property_tax', get: (i) => formatMoneyBRL(i.iptu_ano) },
  { key: 'condo_fee', get: (i) => formatMoneyBRL(i.condominio_mes) },
  { key: 'agent_name', get: (i) => i.corretor_nome },
  { key: 'agent_company', get: (i) => toAgentCompany(i) },
  { key: 'property_type', get: (i) => toPropertyType(i) },
  { key: 'listing_type', get: (i) => toListingType(i) },
  { key: 'ac_type', get: (i) => toAcType(i) },
  { key: 'pet_policy', get: (i) => toPetPolicy(i) },
  { key: 'tenure_type', get: (i) => toTenureType(i) },
  { key: 'construction_status', get: (i) => toConstructionStatus(i) },
  { key: 'days_on_market', get: (i) => { const d = toDaysOnMarket(i); return d != null ? String(d) : null; } },
  { key: 'home_listing_group_id', get: (i) => toHomeListingGroupId(i) },
  { key: 'min_price', get: (i) => toMinMaxPrice(i).min },
  { key: 'max_price', get: (i) => toMinMaxPrice(i).max },
  // custom labels/numbers — split inteligente (ver converters.toCustomFields)
  { key: 'custom_label_0', get: (i) => toCustomFields(i).custom_label_0 }, // tipo_imovel
  { key: 'custom_label_1', get: (i) => toCustomFields(i).custom_label_1 }, // bairro
  { key: 'custom_number_0', get: (i) => { const v = toCustomFields(i).custom_number_0; return v != null ? String(v) : null; } },
  { key: 'custom_number_1', get: (i) => { const v = toCustomFields(i).custom_number_1; return v != null ? String(v) : null; } },
  { key: 'custom_number_2', get: (i) => { const v = toCustomFields(i).custom_number_2; return v != null ? String(v) : null; } },
  { key: 'custom_number_3', get: (i) => { const v = toCustomFields(i).custom_number_3; return v != null ? String(v) : null; } },
  { key: 'custom_number_4', get: (i) => { const v = toCustomFields(i).custom_number_4; return v != null ? String(v) : null; } },
];

// ── Escapes ──────────────────────────────────────────────────────────────────

function csvEscape(v: string | null): string {
  if (v == null) return '';
  const needsQuote = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function xmlEscape(v: string | null): string {
  if (v == null) return '';
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Geradores ────────────────────────────────────────────────────────────────

function gerarCsv(
  imoveis: ImovelFB[],
  outPath: string,
  maxImages: number,
  maxArray: number,
  capasMap: Map<string, string>,
): void {
  // Cabeçalho dinâmico: colunas fixas + image[0..N] + arrays indexados
  const header: string[] = CSV_COLUMNS.map((c) => c.key);
  for (let n = 0; n < maxImages; n++) {
    header.push(`image[${n}].url`);
    header.push(`image[${n}].tag[0]`);
  }
  for (let n = 0; n < maxArray; n++) {
    header.push(`building_amenities[${n}]`);
  }
  for (let n = 0; n < maxArray; n++) {
    header.push(`unit_features[${n}]`);
  }
  for (let n = 0; n < maxArray; n++) {
    header.push(`product_tags[${n}]`);
  }
  // internal_label — até 3 (finalidade, padrao, cod_aux)
  const maxInternal = 3;
  for (let n = 0; n < maxInternal; n++) {
    header.push(`internal_label[${n}]`);
  }

  const lines: string[] = [header.join(',')];

  for (const im of imoveis) {
    const row: string[] = CSV_COLUMNS.map((c) => csvEscape(c.get(im)));

    // Imagens 0..N: capa (se houver) + fotos originais
    const capaUrl = capasMap.get(im.codigo.toUpperCase()) ?? null;
    const { urls: imgs, tags: imgTags } = toImageUrlsWithCapa(im, capaUrl);
    for (let n = 0; n < maxImages; n++) {
      row.push(csvEscape(imgs[n] ?? null));
      row.push(csvEscape(imgTags[n] ?? null));
    }

    // Arrays
    const amenities = toBuildingAmenities(im);
    const features = toUnitFeatures(im);
    const tags = toProductTags(im);
    for (let n = 0; n < maxArray; n++) row.push(csvEscape(amenities[n] ?? null));
    for (let n = 0; n < maxArray; n++) row.push(csvEscape(features[n] ?? null));
    for (let n = 0; n < maxArray; n++) row.push(csvEscape(tags[n] ?? null));

    // internal_label
    const internal = toInternalLabels(im);
    for (let n = 0; n < maxInternal; n++) row.push(csvEscape(internal[n] ?? null));

    lines.push(row.join(','));
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
}

function gerarXml(
  imoveis: ImovelFB[],
  outPath: string,
  feedTitle: string,
  maxImages: number,
  capasMap: Map<string, string>,
): void {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="utf-8"?>');
  parts.push('<listings>');
  parts.push(`  <title>${xmlEscape(feedTitle)}</title>`);

  for (const im of imoveis) {
    const addr = toAddress(im);
    const capaUrl = capasMap.get(im.codigo.toUpperCase()) ?? null;
    const { urls: imgs, tags: imgTags } = toImageUrlsWithCapa(im, capaUrl);
    const imgsSliced = imgs.slice(0, maxImages);
    const amenities = toBuildingAmenities(im);
    const features = toUnitFeatures(im);
    const tags = toProductTags(im);
    const price = toPrice(im);
    const minmax = toMinMaxPrice(im);
    const days = toDaysOnMarket(im);

    parts.push('  <listing>');
    // Imagens: capa (com tag "Capa") + fotos originais (com tag "Foto original")
    for (let n = 0; n < imgsSliced.length; n++) {
      parts.push('    <image>');
      parts.push(`      <url>${xmlEscape(imgsSliced[n])}</url>`);
      if (imgTags[n]) parts.push(`      <tag>${xmlEscape(imgTags[n])}</tag>`);
      parts.push('    </image>');
    }
    parts.push(`    <home_listing_id>${xmlEscape(im.codigo)}</home_listing_id>`);
    parts.push(`    <name>${xmlEscape(toName(im))}</name>`);
    if (im.descricao) parts.push(`    <description>${xmlEscape(im.descricao.slice(0, 5000))}</description>`);
    parts.push(`    <availability>${xmlEscape(toAvailability(im))}</availability>`);
    if (price) parts.push(`    <price>${xmlEscape(price)}</price>`);
    if (minmax.min) parts.push(`    <min_price>${xmlEscape(minmax.min)}</min_price>`);
    if (minmax.max) parts.push(`    <max_price>${xmlEscape(minmax.max)}</max_price>`);
    const urlNorm = normalizeUrl(im.url_portal);
    if (urlNorm) parts.push(`    <url>${xmlEscape(urlNorm)}</url>`);

    // Endereço
    parts.push('    <address format="simple">');
    if (addr.addr1) parts.push(`      <component name="addr1">${xmlEscape(addr.addr1)}</component>`);
    if (addr.addr2) parts.push(`      <component name="addr2">${xmlEscape(addr.addr2)}</component>`);
    if (addr.unit_number) parts.push(`      <component name="unit_number">${xmlEscape(addr.unit_number)}</component>`);
    if (addr.city) parts.push(`      <component name="city">${xmlEscape(addr.city)}</component>`);
    if (addr.region) parts.push(`      <component name="region">${xmlEscape(addr.region)}</component>`);
    if (addr.postal_code) parts.push(`      <component name="postal_code">${xmlEscape(addr.postal_code)}</component>`);
    if (addr.country) parts.push(`      <component name="country">${xmlEscape(addr.country)}</component>`);
    parts.push('    </address>');

    if (im.latitude != null && im.latitude !== 0) parts.push(`    <latitude>${im.latitude}</latitude>`);
    if (im.longitude != null && im.longitude !== 0) parts.push(`    <longitude>${im.longitude}</longitude>`);
    if (im.bairro) parts.push(`    <neighborhood>${xmlEscape(im.bairro)}</neighborhood>`);

    // Áreas
    if (im.area_util != null) parts.push(`    <area_size>${im.area_util}</area_size>`);
    if (im.area_privativa != null) parts.push(`    <built_up_area_size>${im.area_privativa}</built_up_area_size>`);
    if (im.area_total != null) parts.push(`    <land_area_size>${im.area_total}</land_area_size>`);
    parts.push('    <area_unit>square_meters</area_unit>');

    // Cômodos
    if (im.banheiros != null) parts.push(`    <num_baths>${im.banheiros}</num_baths>`);
    if (im.quartos != null) parts.push(`    <num_beds>${im.quartos}</num_beds>`);
    if (im.salas != null) parts.push(`    <num_rooms>${im.salas}</num_rooms>`);
    if (im.vagas != null) parts.push(`    <parking_spaces>${im.vagas}</parking_spaces>`);
    if (im.ano_construcao != null) parts.push(`    <year_built>${im.ano_construcao}</year_built>`);

    // Taxas
    const iptu = formatMoneyBRL(im.iptu_ano);
    const condominio = formatMoneyBRL(im.condominio_mes);
    if (iptu) parts.push(`    <property_tax>${xmlEscape(iptu)}</property_tax>`);
    if (condominio) parts.push(`    <condo_fee>${xmlEscape(condominio)}</condo_fee>`);

    // Corretor
    if (im.corretor_nome) parts.push(`    <agent_name>${xmlEscape(im.corretor_nome)}</agent_name>`);
    if (im.filial) parts.push(`    <agent_company>${xmlEscape(im.filial)}</agent_company>`);

    // Enums
    parts.push(`    <property_type>${xmlEscape(toPropertyType(im))}</property_type>`);
    parts.push(`    <listing_type>${xmlEscape(toListingType(im))}</listing_type>`);
    parts.push(`    <ac_type>${xmlEscape(toAcType(im))}</ac_type>`);
    parts.push(`    <pet_policy>${xmlEscape(toPetPolicy(im))}</pet_policy>`);
    parts.push(`    <tenure_type>${xmlEscape(toTenureType(im))}</tenure_type>`);
    parts.push(`    <construction_status>${xmlEscape(toConstructionStatus(im))}</construction_status>`);
    if (days != null) parts.push(`    <days_on_market>${days}</days_on_market>`);

    const groupId = toHomeListingGroupId(im);
    if (groupId) parts.push(`    <home_listing_group_id>${xmlEscape(groupId)}</home_listing_group_id>`);

    // Arrays (elementos repetidos)
    for (const a of amenities) parts.push(`    <building_amenities>${xmlEscape(a)}</building_amenities>`);
    for (const f of features) parts.push(`    <unit_features>${xmlEscape(f)}</unit_features>`);
    for (const t of tags) parts.push(`    <product_tags>${xmlEscape(t)}</product_tags>`);

    // Custom labels (split: só 0 e 1 vão como custom_label — ver converters)
    const cf = toCustomFields(im);
    if (cf.custom_label_0) parts.push(`    <custom_label_0>${xmlEscape(cf.custom_label_0)}</custom_label_0>`);
    if (cf.custom_label_1) parts.push(`    <custom_label_1>${xmlEscape(cf.custom_label_1)}</custom_label_1>`);
    if (cf.custom_number_0 != null) parts.push(`    <custom_number_0>${cf.custom_number_0}</custom_number_0>`);
    if (cf.custom_number_1 != null) parts.push(`    <custom_number_1>${cf.custom_number_1}</custom_number_1>`);
    if (cf.custom_number_2 != null) parts.push(`    <custom_number_2>${cf.custom_number_2}</custom_number_2>`);
    if (cf.custom_number_3 != null) parts.push(`    <custom_number_3>${cf.custom_number_3}</custom_number_3>`);
    if (cf.custom_number_4 != null) parts.push(`    <custom_number_4>${cf.custom_number_4}</custom_number_4>`);

    // internal_label — sem revisão de política do Facebook
    const internal = toInternalLabels(im);
    for (const il of internal) parts.push(`    <internal_label>${xmlEscape(il)}</internal_label>`);

    parts.push('  </listing>');
  }

  parts.push('</listings>');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, parts.join('\n') + '\n', 'utf8');
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function gerarFeedFacebook(opts: FeedOptions): Promise<FeedResult> {
  const start = Date.now();
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL não configurada');
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN não configurado');

  const client: Client = createClient({ url, authToken });
  const maxImages = opts.maxImages ?? 10;
  const maxArray = opts.maxArrayItems ?? 10;
  const feedTitle = opts.feedTitle ?? 'Urban Imóveis - Catálogo de Imóveis';

  // Lê todos os imóveis ativos via cursor pagination (OFFSET em SQLite é O(n²)).
  // SELECT explícito das colunas usadas para reduzir payload (fotos_urls é o maior).
  console.info('[fb-feed] Lendo imoveis ativos do Turso (cursor pagination)...');
  const COLS = [
    'codigo', 'titulo', 'descricao', 'status_anuncio', 'vendido_alugado',
    'finalidade', 'tipo_imovel', 'subtipo_imovel', 'url_portal',
    'endereco', 'numero_endereco', 'complemento', 'cep', 'pais', 'estado',
    'cidade', 'bairro', 'regiao', 'latitude', 'longitude',
    'nome_condominio', 'condominio_fechado', 'tipo_oferta', 'exclusividade',
    'valor_venda', 'valor_aluguel', 'preco_medio_m2', 'condominio_mes', 'iptu_ano',
    'area_util', 'area_total', 'area_privativa', 'quartos', 'suites',
    'banheiros', 'salas', 'vagas', 'ano_construcao', 'ano_reforma',
    'precisa_reforma', 'padrao_imovel', 'criacao', 'ultima_atualizacao',
    'corretor_nome', 'filial', 'foto_principal_url', 'fotos_urls',
    'codigo_cliente', 'codigo_auxiliar',
    'ar_condicionado', 'varanda', 'varanda_gourmet', 'piscina', 'sauna',
    'hidromassagem', 'quadra_poliesportiva', 'portao_eletronico', 'interfone',
    'wc_empregada', 'escritorio', 'area_servico', 'deposito', 'churrasqueira',
    'quintal', 'copa', 'lavabo', 'armario_closet', 'armario_dormitorio',
    'armario_sala', 'armario_cozinha', 'armario_banheiro', 'armario_corredor',
    'armario_area_servico', 'carpete_acrilico', 'servico_cozinha',
    'aceita_pet', 'aceita_financiamento', 'aceita_negociacao',
  ].join(', ');
  const imoveis: ImovelFB[] = [];
  const PAGE = 1000;
  let cursor = '';
  while (true) {
    const rs = await client.execute({
      sql: `SELECT ${COLS} FROM imoveis WHERE status_anuncio = 'Ativo' AND codigo > ? ORDER BY codigo LIMIT ?`,
      args: [cursor, PAGE],
    });
    if (rs.rows.length === 0) break;
    for (const row of rs.rows) imoveis.push(rowToImovelFB(row));
    cursor = String(rs.rows[rs.rows.length - 1].codigo);
    console.info(`[fb-feed]   lidos ${imoveis.length}...`);
    if (rs.rows.length < PAGE) break;
  }
  console.info(`[fb-feed] ${imoveis.length} imoveis ativos carregados`);

  // Lê mapa de capas geradas (codigo uppercase → capa_url no storage SFTP).
  // Paginado (igual leitura de imoveis) — @libsql/client pode truncar queries
  // grandes sem paginacao, causando capas faltando no feed.
  console.info('[fb-feed] Lendo capas_imoveis do Turso (cursor pagination)...');
  const capasMap = new Map<string, string>();
  let capasCursor = '';
  while (true) {
    const capasRs = await client.execute({
      sql: 'SELECT codigo, capa_url FROM capas_imoveis WHERE codigo > ? ORDER BY codigo LIMIT 1000',
      args: [capasCursor],
    });
    if (capasRs.rows.length === 0) break;
    for (const row of capasRs.rows) {
      capasMap.set(String(row.codigo).toUpperCase(), String(row.capa_url));
    }
    capasCursor = String(capasRs.rows[capasRs.rows.length - 1].codigo);
    if (capasRs.rows.length < 1000) break;
  }
  console.info(`[fb-feed] ${capasMap.size} capas disponíveis (storage)`);

  let csvPath: string | null = null;
  let xmlPath: string | null = null;

  if (opts.format === 'csv' || opts.format === 'both') {
    csvPath = `${opts.outDir}/${opts.csvFileName ?? 'facebook-home-listings.csv'}`;
    console.info(`[fb-feed] Gerando CSV: ${csvPath}`);
    gerarCsv(imoveis, csvPath, maxImages, maxArray, capasMap);
  }

  if (opts.format === 'xml' || opts.format === 'both') {
    xmlPath = `${opts.outDir}/${opts.xmlFileName ?? 'facebook-home-listings.xml'}`;
    console.info(`[fb-feed] Gerando XML: ${xmlPath}`);
    gerarXml(imoveis, xmlPath, feedTitle, maxImages, capasMap);
  }

  client.close();
  const durationMs = Date.now() - start;
  console.info(`[fb-feed] Concluído: ${imoveis.length} imóveis em ${durationMs}ms`);
  return { count: imoveis.length, csvPath, xmlPath, durationMs };
}
