/**
 * scripts/test-capa-decision.ts
 *
 * Teste de LÓGICA PURA (não toca em Turso/SFTP/rede) da decisão incremental
 * de capas. Roda: npx tsx scripts/test-capa-decision.ts
 *
 * Valida:
 *   - computeContentHash: sensível a valor_venda; estável pra dados iguais.
 *   - capaKey: content-addressed ({codigo}_{hash}.jpg).
 *   - isCapaUpToDate: pula só quando banco confirma hash E capa_url esperada.
 *     (inclui o caso do "hash envenenado" — straggler que DEVE ser refeito.)
 *   - Simulação do filtro completo (candidato + HEAD) contra um storage fake,
 *     provando que o straggler é re-renderizado num rerun sem --force.
 */

import assert from 'node:assert/strict';
import { computeContentHash, isCapaUpToDate } from '../lib/capas/content-hash.js';
import { capaKey } from '../lib/capas/storage.js';
import type { ImovelDados } from '../lib/capas/token-renderer.js';

// URL pública fake só pra montar expectedUrl determinístico (não faz rede).
const BASE = 'https://capas.exemplo.app';
const urlFor = (codigo: string, hash: string) => `${BASE}/${capaKey(codigo, hash)}`;

let passed = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, `FALHOU: ${label}`);
  console.log(`  ✓ ${label}`);
  passed++;
}

function imovel(over: Partial<ImovelDados> = {}): ImovelDados {
  return {
    codigo: 'AP6819', tipo_imovel: 'Apartamento', subtipo_imovel: null,
    bairro: 'Jardim América', cidade: 'São Paulo', finalidade: 'Venda',
    quartos: 3, suites: 1, banheiros: 2, salas: 1, vagas: 1, area_util: 175,
    valor_venda: 2650000, valor_aluguel: null,
    foto_principal_url: 'https://x/f.jpg', fotos_urls: '["https://x/f.jpg"]',
    ...over,
  } as ImovelDados;
}

console.log('\n[test] computeContentHash');
{
  const base = imovel();
  const hBase = computeContentHash(base);
  const hSame = computeContentHash(imovel());
  const hPrice = computeContentHash(imovel({ valor_venda: 2650001 }));
  ok('hash estável pra dados idênticos', hBase === hSame);
  ok('hash muda quando o preço muda', hBase !== hPrice);
  ok('hash tem 16 chars hex', /^[a-f0-9]{16}$/.test(hBase));
}

console.log('\n[test] capaKey (content-addressed)');
{
  const h = computeContentHash(imovel());
  ok('capaKey usa o hash no nome', capaKey('AP6819', h) === `AP6819_${h}.jpg`);
  ok('capaKey uppercase no código', capaKey('ap6819', h) === `AP6819_${h}.jpg`);
  ok('capaKey sem hash → só código (compat)', capaKey('AP6819', null) === 'AP6819.jpg');
}

console.log('\n[test] isCapaUpToDate');
{
  const im = imovel();
  const hash = computeContentHash(im);
  const expectedUrl = urlFor('AP6819', hash);

  // 1) Tudo certo no banco → up-to-date (pula).
  ok('capa pronta (hash+url batem) → up-to-date', isCapaUpToDate({
    currentHash: hash, expectedUrl, dbHash: hash, dbUrl: expectedUrl,
  }) === true);

  // 2) Preço mudou → hash de banco antigo → NÃO up-to-date.
  ok('preço mudou (hash banco antigo) → candidato', isCapaUpToDate({
    currentHash: hash, expectedUrl, dbHash: 'aaaaaaaaaaaaaaaa', dbUrl: urlFor('AP6819', 'aaaaaaaaaaaaaaaa'),
  }) === false);

  // 3) CRÍTICO: hash "envenenado" (bate por acaso) mas capa_url é do esquema
  //    antigo por data (upload nunca completou) → NÃO up-to-date.
  ok('hash envenenado + url antiga por data → candidato (straggler)', isCapaUpToDate({
    currentHash: hash, expectedUrl, dbHash: hash, dbUrl: `${BASE}/AP6819_20260729.jpg`,
  }) === false);

  // 4) Nunca gerou (sem registro) → candidato.
  ok('nunca gerado (null) → candidato', isCapaUpToDate({
    currentHash: hash, expectedUrl, dbHash: null, dbUrl: null,
  }) === false);

  // 5) URL certa mas hash de banco divergente → candidato.
  ok('url certa mas hash divergente → candidato', isCapaUpToDate({
    currentHash: hash, expectedUrl, dbHash: 'bbbbbbbbbbbbbbbb', dbUrl: expectedUrl,
  }) === false);
}

console.log('\n[test] simulação do filtro completo (rerun sem --force)');
{
  // Fake DB (capas_imoveis) e fake storage (arquivos que existem).
  type Row = { contentHash: string | null; capaUrl: string | null };
  const im = (codigo: string, over: Partial<ImovelDados> = {}) => imovel({ codigo, ...over });

  const done = im('AP0001');            // já gerado corretamente
  const changed = im('AP0002', { valor_venda: 999000 }); // preço mudou hoje
  const straggler = im('AP9998');       // travou no run anterior (upload não completou)
  const novo = im('AP9999');            // novo, nunca gerado
  const all = [done, changed, straggler, novo];

  const hash = (x: ImovelDados) => computeContentHash(x);

  const db = new Map<string, Row>([
    ['AP0001', { contentHash: hash(done), capaUrl: urlFor('AP0001', hash(done)) }],
    // changed: banco tem o hash ANTIGO (antes da mudança de preço)
    ['AP0002', { contentHash: 'ffffffffffffffff', capaUrl: urlFor('AP0002', 'ffffffffffffffff') }],
    // straggler: hash ENVENENADO (== atual) mas url é do esquema antigo por data
    ['AP9998', { contentHash: hash(straggler), capaUrl: `${BASE}/AP9998_20260729.jpg` }],
    // novo: sem registro
  ]);

  // Storage fake: arquivos content-addressed que REALMENTE existem.
  const storage = new Set<string>([
    capaKey('AP0001', hash(done)), // done está no ar
    // changed/straggler/novo: NÃO existem no esquema novo
  ]);

  // Replica a decisão do orquestrador (isCapaUpToDate → candidato → HEAD).
  const candidates: ImovelDados[] = [];
  let upToDate = 0;
  for (const x of all) {
    const currentHash = hash(x);
    const expectedUrl = urlFor(x.codigo, currentHash);
    const row = db.get(x.codigo);
    if (isCapaUpToDate({ currentHash, expectedUrl, dbHash: row?.contentHash ?? null, dbUrl: row?.capaUrl ?? null })) upToDate++;
    else candidates.push(x);
  }
  const needRender = candidates.filter((x) => !storage.has(capaKey(x.codigo, hash(x))));
  const skipExists = candidates.filter((x) => storage.has(capaKey(x.codigo, hash(x))));

  ok('1 já no ar (AP0001) é pulado sem HEAD', upToDate === 1);
  ok('3 candidatos (changed, straggler, novo)', candidates.length === 3);
  ok('render inclui o straggler AP9998', needRender.some((x) => x.codigo === 'AP9998'));
  ok('render inclui changed e novo', needRender.some((x) => x.codigo === 'AP0002') && needRender.some((x) => x.codigo === 'AP9999'));
  ok('nenhum candidato indevidamente pulado por hash', skipExists.length === 0);
  ok('total a renderizar = 3', needRender.length === 3);
}

console.log(`\n✅ Todos os ${passed} asserts passaram.\n`);
