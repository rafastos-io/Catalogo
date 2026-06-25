// Hash deterministico dos campos do imovel que afetam a capa visualmente.
// Usado pelo gerar-capas pra decidir se uma capa precisa ser regerada:
// se o hash mudou, regera; se e o mesmo, skipa.
//
// Resolve o problema do XML fonte que seta DataAtualizacao = hoje em quase
// todos os imoveis todo dia, fazendo o incremental anterior regerar ~10.000
// capas diariamente a toa.

import { createHash } from 'crypto';
import type { ImovelDados } from './token-renderer.js';

/**
 * Campos que afetam a capa visualmente (template imovel-estatico-03).
 * Se qualquer um mudar, a capa regenerada sera visualmente diferente.
 */
function serializeImovelForHash(im: ImovelDados): string {
  return [
    im.codigo ?? '',
    im.tipo_imovel ?? '',
    im.subtipo_imovel ?? '',
    im.bairro ?? '',
    im.cidade ?? '',
    im.finalidade ?? '',
    im.quartos ?? '',
    im.suites ?? '',
    im.banheiros ?? '',
    im.salas ?? '',
    im.vagas ?? '',
    im.area_util ?? '',
    im.valor_venda ?? '',
    im.valor_aluguel ?? '',
    im.foto_principal_url ?? '',
    im.fotos_urls ?? '',
  ].join('|');
}

/** Retorna hash SHA-256 hex de 16 chars (64 bits — suficiente pra evitar colisoes). */
export function computeContentHash(im: ImovelDados): string {
  const serialized = serializeImovelForHash(im);
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}
