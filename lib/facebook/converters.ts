// Conversores puros para o catálogo Home Listings do Facebook.
// Entrada: linha da tabela `imoveis` (Turso). Saída: valores no formato/enum do Facebook.
// Sem I/O nem side-effects — fácil de testar isoladamente.

import type { Row } from '@libsql/client';

// ── Tipo da linha (subset da tabela imoveis que usamos no feed) ──────────────

export interface ImovelFB {
  codigo: string;
  titulo: string | null;
  descricao: string | null;
  status_anuncio: string | null;
  vendido_alugado: number; // 0/1 (SQLite)
  finalidade: string | null;
  tipo_imovel: string | null;
  subtipo_imovel: string | null;
  url_portal: string | null;
  endereco: string | null;
  numero_endereco: string | null;
  complemento: string | null;
  cep: string | null;
  pais: string | null;
  estado: string | null;
  cidade: string | null;
  bairro: string | null;
  regiao: string | null;
  latitude: number | null;
  longitude: number | null;
  nome_condominio: string | null;
  condominio_fechado: number;
  tipo_oferta: string | null;
  exclusividade: string | null;
  valor_venda: number | null;
  valor_aluguel: number | null;
  preco_medio_m2: number | null;
  condominio_mes: number | null;
  iptu_ano: number | null;
  area_util: number | null;
  area_total: number | null;
  area_privativa: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  salas: number | null;
  vagas: number | null;
  ano_construcao: number | null;
  ano_reforma: number | null;
  precisa_reforma: number;
  padrao_imovel: string | null;
  criacao: string | null;
  ultima_atualizacao: string | null;
  corretor_nome: string | null;
  filial: string | null;
  foto_principal_url: string | null;
  fotos_urls: string | null; // JSON text
  codigo_cliente: string | null;
  codigo_auxiliar: string | null;
  // features booleanas (0/1)
  ar_condicionado: number;
  varanda: number;
  varanda_gourmet: number;
  piscina: number;
  sauna: number;
  hidromassagem: number;
  quadra_poliesportiva: number;
  portao_eletronico: number;
  interfone: number;
  wc_empregada: number;
  escritorio: number;
  area_servico: number;
  deposito: number;
  churrasqueira: number;
  quintal: number;
  copa: number;
  lavabo: number;
  armario_closet: number;
  armario_dormitorio: number;
  armario_sala: number;
  armario_cozinha: number;
  armario_banheiro: number;
  armario_corredor: number;
  armario_area_servico: number;
  carpete_acrilico: number;
  servico_cozinha: number;
  aceita_pet: number;
  aceita_financiamento: number;
  aceita_negociacao: number;
}

/** Converte uma Row do Turso em ImovelFB tipado. */
export function rowToImovelFB(row: Row): ImovelFB {
  const g = <K extends keyof ImovelFB>(k: K): ImovelFB[K] => row[k] as ImovelFB[K];
  return {
    codigo: g('codigo') as string,
    titulo: g('titulo') as string | null,
    descricao: g('descricao') as string | null,
    status_anuncio: g('status_anuncio') as string | null,
    vendido_alugado: g('vendido_alugado') as number,
    finalidade: g('finalidade') as string | null,
    tipo_imovel: g('tipo_imovel') as string | null,
    subtipo_imovel: g('subtipo_imovel') as string | null,
    url_portal: g('url_portal') as string | null,
    endereco: g('endereco') as string | null,
    numero_endereco: g('numero_endereco') as string | null,
    complemento: g('complemento') as string | null,
    cep: g('cep') as string | null,
    pais: g('pais') as string | null,
    estado: g('estado') as string | null,
    cidade: g('cidade') as string | null,
    bairro: g('bairro') as string | null,
    regiao: g('regiao') as string | null,
    latitude: g('latitude') as number | null,
    longitude: g('longitude') as number | null,
    nome_condominio: g('nome_condominio') as string | null,
    condominio_fechado: g('condominio_fechado') as number,
    tipo_oferta: g('tipo_oferta') as string | null,
    exclusividade: g('exclusividade') as string | null,
    valor_venda: g('valor_venda') as number | null,
    valor_aluguel: g('valor_aluguel') as number | null,
    preco_medio_m2: g('preco_medio_m2') as number | null,
    condominio_mes: g('condominio_mes') as number | null,
    iptu_ano: g('iptu_ano') as number | null,
    area_util: g('area_util') as number | null,
    area_total: g('area_total') as number | null,
    area_privativa: g('area_privativa') as number | null,
    quartos: g('quartos') as number | null,
    suites: g('suites') as number | null,
    banheiros: g('banheiros') as number | null,
    salas: g('salas') as number | null,
    vagas: g('vagas') as number | null,
    ano_construcao: g('ano_construcao') as number | null,
    ano_reforma: g('ano_reforma') as number | null,
    precisa_reforma: g('precisa_reforma') as number,
    padrao_imovel: g('padrao_imovel') as string | null,
    criacao: g('criacao') as string | null,
    ultima_atualizacao: g('ultima_atualizacao') as string | null,
    corretor_nome: g('corretor_nome') as string | null,
    filial: g('filial') as string | null,
    foto_principal_url: g('foto_principal_url') as string | null,
    fotos_urls: g('fotos_urls') as string | null,
    codigo_cliente: g('codigo_cliente') as string | null,
    codigo_auxiliar: g('codigo_auxiliar') as string | null,
    ar_condicionado: g('ar_condicionado') as number,
    varanda: g('varanda') as number,
    varanda_gourmet: g('varanda_gourmet') as number,
    piscina: g('piscina') as number,
    sauna: g('sauna') as number,
    hidromassagem: g('hidromassagem') as number,
    quadra_poliesportiva: g('quadra_poliesportiva') as number,
    portao_eletronico: g('portao_eletronico') as number,
    interfone: g('interfone') as number,
    wc_empregada: g('wc_empregada') as number,
    escritorio: g('escritorio') as number,
    area_servico: g('area_servico') as number,
    deposito: g('deposito') as number,
    churrasqueira: g('churrasqueira') as number,
    quintal: g('quintal') as number,
    copa: g('copa') as number,
    lavabo: g('lavabo') as number,
    armario_closet: g('armario_closet') as number,
    armario_dormitorio: g('armario_dormitorio') as number,
    armario_sala: g('armario_sala') as number,
    armario_cozinha: g('armario_cozinha') as number,
    armario_banheiro: g('armario_banheiro') as number,
    armario_corredor: g('armario_corredor') as number,
    armario_area_servico: g('armario_area_servico') as number,
    carpete_acrilico: g('carpete_acrilico') as number,
    servico_cozinha: g('servico_cozinha') as number,
    aceita_pet: g('aceita_pet') as number,
    aceita_financiamento: g('aceita_financiamento') as number,
    aceita_negociacao: g('aceita_negociacao') as number,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isTrue = (n: number | null | undefined): boolean => Number(n) === 1;
const hasText = (s: string | null | undefined): boolean => !!s && s.trim().length > 0;
const containsCI = (s: string | null, needle: string): boolean =>
  hasText(s) ? (s as string).toLowerCase().includes(needle.toLowerCase()) : false;

/** Formata valor numérico como "NNNN.DD BRL" (formato do Facebook). */
export function formatMoneyBRL(valor: number | null): string | null {
  if (valor == null || isNaN(valor)) return null;
  return `${valor.toFixed(2)} BRL`;
}

/** Slugifica texto para uso em home_listing_group_id. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Sinais de intenção (venda/locação) baseados em PREÇO, não em finalidade ──
// finalidade no XML ValueGaia é a CATEGORIA (Residencial/Comercial/...).
// tipo_oferta é sempre "1" (inútil). A intenção real vem de quais preços existem.

const hasVenda = (i: ImovelFB): boolean => i.valor_venda != null && i.valor_venda > 0;
const hasAluguel = (i: ImovelFB): boolean => i.valor_aluguel != null && i.valor_aluguel > 0;

// ── Conversões de enum ───────────────────────────────────────────────────────

/** availability — ver §6.1 do de-para. Usa preços como sinal primário. */
export function toAvailability(i: ImovelFB): string {
  if (i.vendido_alugado === 1) {
    if (hasVenda(i)) return 'sold';
    if (hasAluguel(i)) return 'rented';
    return 'unavailable';
  }
  if (i.status_anuncio && i.status_anuncio.toLowerCase() === 'inativo') return 'unavailable';
  if (hasAluguel(i) && !hasVenda(i)) return 'for_rent';
  if (hasVenda(i)) return 'for_sale'; // "ambos" → venda é primária
  return 'unavailable'; // sem preço = não anunciável
}

/** price — ver §6.2. Venda é primária quando ambos existem; senão aluguel. */
export function toPrice(i: ImovelFB): string | null {
  if (hasVenda(i)) return formatMoneyBRL(i.valor_venda);
  if (hasAluguel(i)) return formatMoneyBRL(i.valor_aluguel);
  return null;
}

/** property_type — ver §6.3. */
export function toPropertyType(i: ImovelFB): string {
  const t = (i.tipo_imovel ?? '').toLowerCase();
  const st = (i.subtipo_imovel ?? '').toLowerCase();
  const joint = `${t} ${st}`;
  if (joint.includes('apartamento') || joint.includes('studio') || joint.includes('kitnet') || joint.includes('loft') || joint.includes('duplex')) return 'apartment';
  if (joint.includes('cobertura') || joint.includes('penthouse')) return 'condo';
  if (joint.includes('sobrado') || joint.includes('townhouse')) return 'townhouse';
  if (joint.includes('casa') || joint.includes('village') || joint.includes('chacara') || joint.includes('sitio')) return 'house';
  if (joint.includes('terreno') || joint.includes('area')) return 'land';
  return 'other';
}

/** listing_type — ver §6.4. Usa preços como sinal primário. */
export function toListingType(i: ImovelFB): string {
  const exclusivo = containsCI(i.exclusividade, 'sim') || i.exclusividade === '1';
  const ehVenda = hasVenda(i);
  const ehLoc = hasAluguel(i);
  if (i.vendido_alugado === 1) {
    if (ehVenda) return 'recently_sold';
    if (ehLoc) return 'recently_rented';
    return 'recently_sold';
  }
  // Aluguel-only → locação. Ambos ou venda-only → venda.
  if (ehLoc && !ehVenda) return exclusivo ? 'for_rent_by_agent' : 'for_rent_by_owner';
  if (ehVenda) return exclusivo ? 'for_sale_by_agent' : 'for_sale_by_owner';
  return 'for_sale';
}

/** ac_type — ver §6.5. */
export function toAcType(i: ImovelFB): string {
  return isTrue(i.ar_condicionado) ? 'central' : 'none';
}

/** pet_policy — ver §6.6. */
export function toPetPolicy(i: ImovelFB): string {
  return isTrue(i.aceita_pet) ? 'allowed' : 'not_allowed';
}

/** days_on_market — ver §6.7. Null se criacao nula. */
export function toDaysOnMarket(i: ImovelFB): number | null {
  if (!hasText(i.criacao)) return null;
  const d = new Date(i.criacao as string).getTime();
  if (isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

/** construction_status — ver §6.8. */
export function toConstructionStatus(i: ImovelFB): string {
  if (isTrue(i.precisa_reforma)) return 'under_construction';
  return 'ready';
}

/** tenure_type — Brasil é freehold por padrão. */
export function toTenureType(_i: ImovelFB): string {
  return 'freehold';
}

/** parking_type — inferir de vagas_cobertas não temos; usar genérico. */
export function toParkingType(i: ImovelFB): string | null {
  if (i.vagas == null || i.vagas === 0) return null;
  return 'garage';
}

// ── Endereço ─────────────────────────────────────────────────────────────────

export interface AddressFB {
  addr1: string | null;
  addr2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  unit_number: string | null;
}

export function toAddress(i: ImovelFB): AddressFB {
  const addr1 = [i.endereco, i.numero_endereco].filter(hasText).join(', ').trim() || null;
  return {
    addr1,
    addr2: i.complemento ?? null,
    city: i.cidade ?? null,
    region: i.estado ?? null,
    postal_code: i.cep ?? null,
    country: hasText(i.pais) ? i.pais : 'Brasil',
    unit_number: i.complemento ?? null,
  };
}

// ── Arrays multi-valor ───────────────────────────────────────────────────────

/** building_amenities — ver §7.1. */
export function toBuildingAmenities(i: ImovelFB): string[] {
  const out: string[] = [];
  if (isTrue(i.piscina)) out.push('pool');
  if (isTrue(i.churrasqueira)) out.push('bbq_grill');
  if (isTrue(i.sauna)) out.push('sauna');
  if (isTrue(i.hidromassagem)) out.push('hot_tub');
  if (isTrue(i.quadra_poliesportiva)) out.push('sports_court');
  if (isTrue(i.portao_eletronico)) out.push('gate');
  if (isTrue(i.interfone)) out.push('intercom');
  if (isTrue(i.condominio_fechado)) out.push('gated');
  if (isTrue(i.wc_empregada)) out.push('other');
  if (isTrue(i.escritorio)) out.push('other');
  if (isTrue(i.area_servico)) out.push('laundry');
  if (isTrue(i.deposito)) out.push('storage');
  if (isTrue(i.quintal)) out.push('garden');
  return out;
}

/** unit_features — ver §7.2. */
export function toUnitFeatures(i: ImovelFB): string[] {
  const out: string[] = [];
  if (isTrue(i.ar_condicionado)) out.push('air_conditioning');
  if (isTrue(i.varanda) || isTrue(i.varanda_gourmet)) out.push('balcony');
  if (isTrue(i.armario_closet) || isTrue(i.armario_dormitorio) || isTrue(i.armario_sala) ||
      isTrue(i.armario_cozinha) || isTrue(i.armario_banheiro) || isTrue(i.armario_corredor) ||
      isTrue(i.armario_area_servico)) out.push('wardrobe');
  if (isTrue(i.carpete_acrilico)) out.push('carpet');
  if (isTrue(i.lavabo)) out.push('half_bath');
  if (isTrue(i.copa)) out.push('pantry');
  if (isTrue(i.servico_cozinha)) out.push('kitchen');
  return out;
}

/** product_tags — ver §7.3. Tags para segmentação de campanhas. */
export function toProductTags(i: ImovelFB): string[] {
  const tags: string[] = [];
  if (i.quartos != null) {
    if (i.quartos === 1) tags.push('1_quarto');
    else if (i.quartos === 2) tags.push('2_quartos');
    else if (i.quartos === 3) tags.push('3_quartos');
    else if (i.quartos >= 4) tags.push('4+_quartos');
  }
  const v = i.valor_venda;
  if (v != null) {
    if (v < 500_000) tags.push('ate_500k');
    else if (v < 1_000_000) tags.push('500k_1M');
    else tags.push('1M+');
  }
  if (isTrue(i.aceita_financiamento)) tags.push('financiavel');
  if (isTrue(i.piscina)) tags.push('com_piscina');
  if (hasText(i.bairro)) tags.push(`bairro_${slugify(i.bairro as string)}`);
  return tags;
}

// ── Imagens ──────────────────────────────────────────────────────────────────

/** Faz parse de fotos_urls (JSON text) e devolve array de URLs. */
export function toImageUrls(i: ImovelFB): string[] {
  const urls: string[] = [];
  if (hasText(i.foto_principal_url)) urls.push(i.foto_principal_url as string);
  if (hasText(i.fotos_urls)) {
    try {
      const arr = JSON.parse(i.fotos_urls as string) as unknown;
      if (Array.isArray(arr)) {
        for (const u of arr) {
          if (typeof u === 'string' && u && !urls.includes(u)) urls.push(u);
        }
      }
    } catch {
      // fotos_urls inválido — ignora
    }
  }
  return urls;
}

// ── Custom labels / numbers (slots livres) — ver §5 ─────────────────────────

export interface CustomFields {
  custom_label_0: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  custom_label_4: string | null;
  custom_number_0: number | null;
  custom_number_1: number | null;
  custom_number_2: number | null;
  custom_number_3: number | null;
  custom_number_4: number | null;
}

export function toCustomFields(i: ImovelFB): CustomFields {
  return {
    custom_label_0: i.finalidade ?? null,
    custom_label_1: i.tipo_imovel ?? null,
    custom_label_2: i.padrao_imovel ?? null,
    custom_label_3: i.bairro ?? null,
    custom_label_4: i.codigo_auxiliar ?? i.codigo_cliente ?? null,
    custom_number_0: i.preco_medio_m2,
    custom_number_1: i.area_util,
    custom_number_2: i.quartos,
    custom_number_3: i.vagas,
    custom_number_4: i.suites,
  };
}

// ── Nome fallback ────────────────────────────────────────────────────────────

/** Se titulo vier nulo, gera um a partir de tipo + bairro + cidade. */
export function toName(i: ImovelFB): string {
  if (hasText(i.titulo)) return (i.titulo as string).slice(0, 255);
  const parts = [i.tipo_imovel, i.bairro, i.cidade].filter(hasText);
  if (parts.length === 0) return i.codigo;
  return `${parts[0]} em ${parts.slice(1).join(', ')}`.slice(0, 255);
}

/** home_listing_group_id a partir do nome do condomínio. */
export function toHomeListingGroupId(i: ImovelFB): string | null {
  if (!hasText(i.nome_condominio)) return null;
  return slugify(i.nome_condominio as string);
}

/** agent_company — filial ou fixo. */
export function toAgentCompany(i: ImovelFB): string | null {
  return i.filial ?? null;
}

/** min_price / max_price — para imóveis com venda+locação simultâneos (ambos preços). */
export function toMinMaxPrice(i: ImovelFB): { min: string | null; max: string | null } {
  if (hasVenda(i) && hasAluguel(i)) {
    return {
      min: formatMoneyBRL(i.valor_aluguel),
      max: formatMoneyBRL(i.valor_venda),
    };
  }
  return { min: null, max: null };
}
