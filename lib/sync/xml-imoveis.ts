import { XMLParser } from 'fast-xml-parser';
import { createClient, type Client, type InValue } from '@libsql/client';

// ── Types ───────────────────────────────────────────────────────────────────

export type SyncResult = {
  synced: number;
  errors: number;
  skipped: number;
  duration_ms: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extrai string de valor que pode ser array (formato xml2js) ou escalar */
function str(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v ?? '');
}

function num(v: unknown): number | null {
  const n = parseFloat(str(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function int(v: unknown): number | null {
  const n = parseInt(str(v), 10);
  return isNaN(n) ? null : n;
}

function bool(v: unknown): boolean {
  return str(v) === '1';
}

/** Converte "DD/MM/AAAA" ou "DD/MM/AAAA HH:MM:SS" → "AAAA-MM-DD" */
function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

// ── Mapeamento de um <Imovel> do XML para a linha da tabela ────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapImovel(raw: Record<string, any>): Record<string, unknown> {
  // ── Fotos ──────────────────────────────────────────────────────────────
  const fotosRaw = raw.Fotos?.[0]?.Foto ?? raw.Fotos?.Foto ?? [];
  const fotosArr: Array<Record<string, unknown>> = Array.isArray(fotosRaw) ? fotosRaw : [fotosRaw];

  const fotos_urls: string[] = fotosArr
    .map((f) => str(f.URLArquivo))
    .filter(Boolean);

  const principal = fotosArr.find((f) => str(f.Principal) === '1');
  const foto_principal_url = principal ? str(principal.URLArquivo) : (fotos_urls[0] ?? null);

  // ── Status e flags ─────────────────────────────────────────────────────
  const status_anuncio = str(raw.Publicar) === '1' ? 'Ativo' : 'Inativo';

  const statusComercial = str(raw.StatusComercial ?? '').toLowerCase();
  const vendido_alugado = statusComercial.includes('vendido') ||
    statusComercial.includes('alugado') ||
    str(raw.Vendido ?? '') === '1';

  // ── Benefícios (concatenado para exibição rápida) ──────────────────────
  const BOOL_LABELS: Record<string, string> = {
    Churrasqueira:       'Churrasqueira',
    Hidromassagem:       'Hidromassagem',
    Quintal:             'Quintal',
    AreaServico:         'Área de Serviço',
    Copa:                'Copa',
    Lavabo:              'Lavabo',
    Deposito:            'Depósito',
    PortaoEletronico:    'Portão Eletrônico',
    ArmarioCloset:       'Armário/Closet',
    Interfone:           'Interfone',
    Agua:                'Água',
    Esgoto:              'Esgoto',
    EnergiaEletrica:     'Energia Elétrica',
    ServicoCozinha:      'Serviço Cozinha',
    ArmarioDormitorio:   'Armário Dormitório',
    ArmarioBanheiro:     'Armário Banheiro',
    ArCondicionado:      'Ar Condicionado',
    AceitaPet:           'Aceita Pet',
    VarandaGourmet:      'Varanda Gourmet',
    Varanda:             'Varanda',
    Piscina:             'Piscina',
    Sauna:               'Sauna',
    QuadraPoliEsportiva: 'Quadra Poliesportiva',
    WCEmpregada:         'WC Empregada',
    Escritorio:          'Escritório',
    ArmarioCorredor:     'Armário Corredor',
    ArmarioSala:         'Armário Sala',
    ArmarioCozinha:      'Armário Cozinha',
    ArmarioAreaServico:  'Armário Área Serviço',
    CarpeteAcrilico:     'Carpete/Acrílico',
    AceitaFinanciamento: 'Aceita Financiamento',
    AceitaNegociacao:    'Aceita Negociação',
  };

  const beneficiosList = Object.entries(BOOL_LABELS)
    .filter(([key]) => str(raw[key]) === '1')
    .map(([, label]) => label);
  const beneficios = beneficiosList.length > 0 ? beneficiosList.join(', ') : null;

  // ── Corretor ───────────────────────────────────────────────────────────
  const corretorRaw = raw.corretor;
  const corretor = Array.isArray(corretorRaw) ? corretorRaw[0] : (corretorRaw ?? {});

  return {
    // ── Identificação ──────────────────────────────────────────────────
    codigo:                   str(raw.CodigoImovel).trim().toUpperCase(),
    filial:                   str(raw.Filial)                 || null,
    codigo_cliente:           str(raw.CodigoCliente)          || null,
    codigo_auxiliar:          str(raw.CodigoImovelAuxiliar)   || null,
    tipo_imovel:              str(raw.TipoImovel)             || null,
    subtipo_imovel:           str(raw.SubTipoImovel)          || null,
    finalidade:               str(raw.Finalidade)             || null,
    categoria_imovel:         str(raw.CategoriaImovel)        || null,
    titulo:                   str(raw.TituloImovel)           || null,
    url_portal:               str(raw.URLGaiaSite)            || null,

    // ── Localização ────────────────────────────────────────────────────
    pais:                     str(raw.Pais)                   || null,
    estado:                   str(raw.Estado)                 || null,
    cidade:                   str(raw.Cidade)                 || null,
    bairro:                   str(raw.Bairro)                 || null,
    bairro_oficial:           str(raw.BairroOficial)          || null,
    regiao:                   str(raw.Regiao)                 || null,
    endereco:                 str(raw.Endereco)               || null,
    numero_endereco:          str(raw.Numero)                 || null,
    complemento:              str(raw.ComplementoEndereco)    || null,
    cep:                      str(raw.CEP)                    || null,
    latitude:                 num(raw.latitude),
    longitude:                num(raw.longitude),

    // ── Condomínio ─────────────────────────────────────────────────────
    nome_condominio:          str(raw.NomeCondominio || raw.NomeEdificio) || null,
    condominio_fechado:       bool(raw.CondominioFechado),

    // ── Status e Comercial ─────────────────────────────────────────────
    status_anuncio,
    vendido_alugado,
    tipo_oferta:              str(raw.TipoOferta)             || null,
    publica_valores:          str(raw.PublicaValores)         || null,
    exclusividade:            str(raw.Exclusividade)          || null,

    // ── Financeiro ─────────────────────────────────────────────────────
    valor_venda:              num(raw.PrecoVenda),
    valor_aluguel:            num(raw.PrecoLocacao) ?? num(raw.PrecoAluguel),
    preco_medio_m2:           num(raw.PrecoMedioM2Venda),
    condominio_mes:           num(raw.PrecoCondominio),
    iptu_ano:                 num(raw.PrecoIptu),

    // ── Áreas ──────────────────────────────────────────────────────────
    area_util:                num(raw.AreaUtil),
    area_total:               num(raw.AreaTotal),
    area_privativa:           num(raw.AreaPrivativa),

    // ── Cômodos e quantitativos ────────────────────────────────────────
    quartos:                  int(raw.QtdDormitorios),
    suites:                   int(raw.QtdSuites),
    banheiros:                int(raw.QtdBanheiros),
    salas:                    int(raw.QtdSalas),
    vagas:                    int(raw.QtdVagas),
    vagas_cobertas:           int(raw.QtdVagasCobertas),
    numero_andar:             int(raw.NumeroAndar),
    total_andares:            int(raw.QtdAndar),

    // ── Histórico ──────────────────────────────────────────────────────
    ano_construcao:           int(raw.AnoConstrucao),
    ano_reforma:              int(raw.AnoReforma),
    precisa_reforma:          bool(raw.PrecisaReforma),

    // ── Padrão e situação ──────────────────────────────────────────────
    padrao_imovel:            str(raw.PadraoImovel)           || null,
    padrao_localizacao:       str(raw.PadraoLocalizacao)      || null,
    ocupacao:                 str(raw.Ocupacao)               || null,
    ocupador:                 str(raw.Ocupador)               || null,
    face_imovel:              str(raw.FaceImovel)             || null,

    // ── Negociação ─────────────────────────────────────────────────────
    aceita_negociacao:        bool(raw.AceitaNegociacao),
    aceita_financiamento:     bool(raw.AceitaFinanciamento),
    aceita_pet:               bool(raw.AceitaPet),

    // ── Conteúdo ───────────────────────────────────────────────────────
    descricao:                str(raw.Observacao)             || null,
    beneficios,

    // ── Features booleanas individuais ────────────────────────────────
    ar_condicionado:          bool(raw.ArCondicionado),
    varanda_gourmet:          bool(raw.VarandaGourmet),
    varanda:                  bool(raw.Varanda),
    piscina:                  bool(raw.Piscina),
    sauna:                    bool(raw.Sauna),
    quadra_poliesportiva:     bool(raw.QuadraPoliEsportiva),
    wc_empregada:             bool(raw.WCEmpregada),
    escritorio:               bool(raw.Escritorio),
    armario_corredor:         bool(raw.ArmarioCorredor),
    armario_sala:             bool(raw.ArmarioSala),
    armario_cozinha:          bool(raw.ArmarioCozinha),
    armario_area_servico:     bool(raw.ArmarioAreaServico),
    carpete_acrilico:         bool(raw.CarpeteAcrilico),
    churrasqueira:            bool(raw.Churrasqueira),
    hidromassagem:            bool(raw.Hidromassagem),
    quintal:                  bool(raw.Quintal),
    area_servico:             bool(raw.AreaServico),
    copa:                     bool(raw.Copa),
    lavabo:                   bool(raw.Lavabo),
    deposito:                 bool(raw.Deposito),
    portao_eletronico:        bool(raw.PortaoEletronico),
    armario_closet:           bool(raw.ArmarioCloset),
    interfone:                bool(raw.Interfone),
    servico_cozinha:          bool(raw.ServicoCozinha),
    armario_dormitorio:       bool(raw.ArmarioDormitorio),
    armario_banheiro:         bool(raw.ArmarioBanheiro),

    // ── Corretor ───────────────────────────────────────────────────────
    corretor_nome:            str(corretor?.nome)             || null,
    corretor_email:           str(corretor?.email)            || null,
    corretor_telefone:        str(corretor?.telefone)         || null,
    corretor_celular:         str(corretor?.celular)          || null,

    // ── Fotos ──────────────────────────────────────────────────────────
    foto_principal_url:       foto_principal_url              || null,
    fotos_urls:               fotos_urls.length > 0 ? fotos_urls : null,

    // ── Datas ──────────────────────────────────────────────────────────
    criacao:                  parseDate(raw.DataCadastro),
    ultima_atualizacao:       parseDate(raw.DataAtualizacao ?? raw.DataAtualizacaoImovel),
    data_atualizacao_imovel:  parseDate(raw.DataAtualizacaoImovel),

    // ── Controle ───────────────────────────────────────────────────────
    updated_at:               new Date().toISOString(),
  };
}

// ── Schema / SQL (Turso · libSQL/SQLite) ────────────────────────────────────

/** Colunas em ordem, espelhando schema.sql */
const COLUMNS = [
  'codigo', 'filial', 'codigo_cliente', 'codigo_auxiliar', 'tipo_imovel',
  'subtipo_imovel', 'finalidade', 'categoria_imovel', 'titulo', 'url_portal',
  'pais', 'estado', 'cidade', 'bairro', 'bairro_oficial', 'regiao', 'endereco',
  'numero_endereco', 'complemento', 'cep', 'latitude', 'longitude',
  'nome_condominio', 'condominio_fechado', 'status_anuncio', 'vendido_alugado',
  'tipo_oferta', 'publica_valores', 'exclusividade', 'valor_venda',
  'valor_aluguel', 'preco_medio_m2', 'condominio_mes', 'iptu_ano', 'area_util',
  'area_total', 'area_privativa', 'quartos', 'suites', 'banheiros', 'salas',
  'vagas', 'vagas_cobertas', 'numero_andar', 'total_andares', 'ano_construcao',
  'ano_reforma', 'precisa_reforma', 'padrao_imovel', 'padrao_localizacao',
  'ocupacao', 'ocupador', 'face_imovel', 'aceita_negociacao',
  'aceita_financiamento', 'aceita_pet', 'descricao', 'beneficios',
  'ar_condicionado', 'varanda_gourmet', 'varanda', 'piscina', 'sauna',
  'quadra_poliesportiva', 'wc_empregada', 'escritorio', 'armario_corredor',
  'armario_sala', 'armario_cozinha', 'armario_area_servico', 'carpete_acrilico',
  'churrasqueira', 'hidromassagem', 'quintal', 'area_servico', 'copa', 'lavabo',
  'deposito', 'portao_eletronico', 'armario_closet', 'interfone',
  'servico_cozinha', 'armario_dormitorio', 'armario_banheiro', 'corretor_nome',
  'corretor_email', 'corretor_telefone', 'corretor_celular', 'foto_principal_url',
  'fotos_urls', 'criacao', 'ultima_atualizacao', 'data_atualizacao_imovel',
  'updated_at',
] as const;

/** Colunas INTEGER que armazenam booleanos (0/1) no SQLite */
const BOOL_COLUMNS = new Set<string>([
  'condominio_fechado', 'vendido_alugado', 'precisa_reforma', 'aceita_negociacao',
  'aceita_financiamento', 'aceita_pet', 'ar_condicionado', 'varanda_gourmet',
  'varanda', 'piscina', 'sauna', 'quadra_poliesportiva', 'wc_empregada',
  'escritorio', 'armario_corredor', 'armario_sala', 'armario_cozinha',
  'armario_area_servico', 'carpete_acrilico', 'churrasqueira', 'hidromassagem',
  'quintal', 'area_servico', 'copa', 'lavabo', 'deposito', 'portao_eletronico',
  'armario_closet', 'interfone', 'servico_cozinha', 'armario_dormitorio',
  'armario_banheiro',
]);

const PLACEHOLDERS = COLUMNS.map(() => '?').join(', ');
const UPDATE_CLAUSE = COLUMNS
  .filter((c) => c !== 'codigo')
  .map((c) => `${c}=excluded.${c}`)
  .join(', ');

const UPSERT_SQL =
  `INSERT INTO imoveis (${COLUMNS.join(', ')}) VALUES (${PLACEHOLDERS}) ` +
  `ON CONFLICT(codigo) DO UPDATE SET ${UPDATE_CLAUSE}`;

/** Converte um registro mapeado em array de args posicionais (SQLite). */
function recordToArgs(rec: Record<string, unknown>): InValue[] {
  return COLUMNS.map((col): InValue => {
    const v = rec[col];
    if (col === 'fotos_urls') {
      return Array.isArray(v) ? JSON.stringify(v) : null;
    }
    if (BOOL_COLUMNS.has(col)) {
      return v ? 1 : 0;
    }
    return (v ?? null) as string | number | null;
  });
}

// ── Batch upsert com divide-and-retry (isola registros problemáticos) ───────

async function upsertBatch(
  client: Client,
  records: Array<Record<string, unknown>>,
): Promise<{ synced: number; errors: number }> {
  try {
    const stmts = records.map((r) => ({ sql: UPSERT_SQL, args: recordToArgs(r) }));
    await client.batch(stmts, 'write');
    return { synced: records.length, errors: 0 };
  } catch (err) {
    // Em lote unitário não há como subdividir — registra erro.
    if (records.length <= 1) {
      console.error(
        `[xml-sync] Erro no registro (codigo ${(records[0] as Record<string, unknown>)?.codigo ?? '?'}):`,
        err instanceof Error ? err.message : err,
      );
      return { synced: 0, errors: 1 };
    }
    // Divide o lote ao meio e retenta cada metade (isola o registro problemático).
    const mid = Math.ceil(records.length / 2);
    console.warn(`[xml-sync] Falha no batch de ${records.length} — dividindo em ${mid}+${records.length - mid}...`);
    const [a, b] = await Promise.all([
      upsertBatch(client, records.slice(0, mid)),
      upsertBatch(client, records.slice(mid)),
    ]);
    return { synced: a.synced + b.synced, errors: a.errors + b.errors };
  }
}

// ── Core sync ───────────────────────────────────────────────────────────────

export async function syncImoveisFromXML(_useCache = false, budgetMs = 600_000): Promise<SyncResult> {
  const start = Date.now();

  // Setup Turso (libSQL)
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL não configurada');
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN não configurado');

  const client = createClient({ url, authToken });

  // Fetch + parse XML externo
  const xmlUrl = process.env.IMOVEIS_XML_URL;
  if (!xmlUrl) throw new Error('IMOVEIS_XML_URL não configurada');

  const res = await fetch(xmlUrl, {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' },
  });
  if (!res.ok) throw new Error(`Falha ao buscar XML: HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['Imovel', 'Foto', 'corretor'].includes(name),
    parseTagValue: false,
  });
  const root = parser.parse(xml);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listaRaw: Array<Record<string, any>> =
    root?.Carga?.Imoveis?.Imovel ??
    root?.Carga?.Imoveis?.[0]?.Imovel ??
    root?.Imoveis?.Imovel ??
    [];

  if (listaRaw.length === 0) {
    console.warn('[xml-sync] Nenhum imóvel encontrado no XML. Verifique a estrutura.');
  }

  const records = listaRaw
    .filter((r) => str(r.CodigoImovel).trim())
    .map(mapImovel);

  const totalXML = records.length;
  console.info(`[xml-sync] XML parseado: ${totalXML} imóveis`);

  // Sync incremental — lê todos os códigos + ultima_atualizacao do banco
  const rs = await client.execute('SELECT codigo, ultima_atualizacao FROM imoveis');
  const existingRows = rs.rows as unknown as ReadonlyArray<{ codigo: string; ultima_atualizacao: string | null }>;

  let toUpsert = records;

  if (existingRows.length > 0) {
    const dbMap = new Map<string, string | null>(
      existingRows.map((r) => [String(r.codigo).toUpperCase(), r.ultima_atualizacao ?? null]),
    );
    toUpsert = records.filter((r) => {
      const code = String(r.codigo).toUpperCase();
      if (!dbMap.has(code)) return true; // novo
      const xmlDate = (r.ultima_atualizacao as string | null) ?? null;
      if (!xmlDate) return true; // sem data no XML → reescreve
      return dbMap.get(code) !== xmlDate; // mudou?
    });
    console.info(`[xml-sync] Incremental: ${toUpsert.length} de ${totalXML} a sincronizar`);
  } else {
    console.info(`[xml-sync] Banco vazio — carga completa de ${totalXML} imóveis`);
  }

  let synced = 0;
  let errors = 0;
  let skipped = 0;
  const BATCH = 50;
  const BUDGET_MS = budgetMs;

  for (let i = 0; i < toUpsert.length; i += BATCH) {
    if (Date.now() - start > BUDGET_MS) {
      console.warn(`[xml-sync] Budget atingido em ${i} — interrompendo.`);
      skipped += toUpsert.length - i;
      break;
    }
    const batch = toUpsert.slice(i, i + BATCH);
    const result = await upsertBatch(client, batch);
    synced += result.synced;
    errors += result.errors;
  }

  const duration_ms = Date.now() - start;
  console.info(`[xml-sync] Concluído: ${synced} upserts, ${errors} erros, ${skipped} ignorados, ${duration_ms}ms`);

  client.close();
  return { synced, errors, skipped, duration_ms };
}

/**
 * Busca e parseia o XML, retorna o array de imóveis mapeados.
 * Usado por lookups em tempo real — não escreve no banco.
 */
export async function parseImoveisFromXML(): Promise<Array<Record<string, unknown>>> {
  const xmlUrl = process.env.IMOVEIS_XML_URL;
  if (!xmlUrl) return [];

  const res = await fetch(xmlUrl);
  if (!res.ok) return [];
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name) => ['Imovel', 'Foto', 'corretor'].includes(name),
    parseTagValue: false,
  });
  const root = parser.parse(xml);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listaRaw: Array<Record<string, any>> =
    root?.Carga?.Imoveis?.Imovel ??
    root?.Carga?.Imoveis?.[0]?.Imovel ??
    root?.Imoveis?.Imovel ??
    [];

  return listaRaw
    .filter((r) => str(r.CodigoImovel).trim())
    .map(mapImovel);
}
