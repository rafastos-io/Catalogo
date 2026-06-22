// Brand kit fixo do Grupo Urban — usado no render das capas.
// Conforme decidido: brand fixo hardcoded, sem depender de Supabase.

import { readFileSync } from 'fs';

export interface BrandKit {
  cor_primaria: string;
  cor_acento: string;
  cor_fundo: string;
  logo_url_escuro: string;
  logo_url_claro: string;
  nome_marca: string;
  fonte: string;
  fonte_url: string;
  creci: string;
  nome_corretor: string;
}

// Logo URL pública no Supabase Storage (público) — baixado 1x e virando data URI
// base64 no render pra não depender de Vercel/Supabase durante o screenshot.
const LOGO_URL_PUBLICA =
  'https://drqhlfvqkudmafaeshcd.supabase.co/storage/v1/object/public/brand-assets/grupo-urban/logos/s-branco%26bege-urban-hor.png';

export const BRAND_KIT: BrandKit = {
  cor_primaria: '#222223',
  cor_acento: '#c09c83',
  cor_fundo: '#fcfcff',
  logo_url_escuro: LOGO_URL_PUBLICA,
  logo_url_claro: LOGO_URL_PUBLICA,
  nome_marca: 'GRUPO URBAN',
  fonte: 'Montserrat',
  fonte_url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap',
  creci: '32.734-J',
  nome_corretor: 'GRUPO URBAN',
};

/**
 * Baixa o logo uma única vez e converte para data URI base64.
 * Puppeteer no render usa o data URI direto no <img src> — sem fetch externo,
 * sem depender de Vercel/Supabase, sem rate limit.
 *
 * Aceita URL http(s) ou path de arquivo local. Se já for data URI, passa direto.
 */
export async function logoToDataUri(logoUrl: string): Promise<string> {
  // Já é data URI → passa direto
  if (logoUrl.startsWith('data:')) return logoUrl;

  // Path local → ler do disco
  if (logoUrl.startsWith('file://') || !logoUrl.startsWith('http')) {
    const path = logoUrl.replace(/^file:\/\//, '');
    const buf = readFileSync(path);
    const ext = path.toLowerCase().endsWith('.png') ? 'png' : 'svg+xml';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  }

  // URL http(s) → baixar
  const res = await fetch(logoUrl);
  if (!res.ok) throw new Error(`Falha baixar logo: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? 'image/png';
  return `data:${ct};base64,${buf.toString('base64')}`;
}
