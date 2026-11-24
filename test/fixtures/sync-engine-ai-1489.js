// O caso real do sync por herança, na forma do engine-ai#1489 (24/11/2026, "sync da homologation
// na development"): 65 arquivos no diff, 57 idênticos à ponta da homologation que o merge trouxe e
// 8 misturados. Contra a base no momento do merge (o primeiro pai), a base tinha tocado 2 dos 57 e
// apagado o `quadros-do-turno.ts`; contra a ponta atual da development, seriam 33 dos 57. Os nomes
// sem registro no caso real são sintéticos e determinísticos. O `schema.prisma` é misturado: os
// repositórios que importam `@prisma/client` (e o serviço que os importa) voltam à leitura, e um
// módulo que importa um barril fora do diff (`herdado/index.ts`, que reexporta o mapa de zonas
// misturado) também volta. Todo `.ts` importa `@nestjs/common`, declarado no package.json da raiz.
// Duas traduções `.json` idênticas à foto herdam, e o módulo que importa uma delas também.
import { FOTO, P1, BASE_PONTA, HEAD_DO_SYNC, cenarioDoSync, commitDaOrigem, mergeDoSync } from '../helpers/github-do-sync.js';

const doisDigitos = (n) => String(n).padStart(2, '0');
const arquivo = (path) => ({ path, sha: 'e'.repeat(40), status: 'modified', additions: 1, deletions: 1,
  patch: '@@ -1 +1 @@\n-antes\n+depois', patchStatus: 'available' });

const MISTURADOS = [
  'prisma/schema.prisma',
  'common/zone-ownership/mapa-de-zonas.ts',
  'apps/engine-ai/src/mia-whatsapp/whatsapp-chat.service.ts',
  ...Array.from({ length: 5 }, (_, i) => `apps/engine-ai/src/misturado/misturado-${i + 1}.ts`),
];
const GUARDA = 'apps/engine-ai/src/zonas/zona.guard.ts';
const PAINEL = 'apps/engine-ai/src/turno/painel-do-turno.ts';
const APAGADO_NA_BASE = 'apps/engine-ai/src/turno/quadros-do-turno.ts';
const modulo = (n) => `apps/engine-ai/src/herdado/modulo-${String(n).padStart(2, '0')}.ts`;
// os repositórios do Prisma, o serviço que importa um deles e o módulo que importa o barril
const REPOSITORIOS_PRISMA = [2, 3, 4, 5, 6, 7].map(modulo);
const SERVICO_DO_PRISMA = modulo(8);
const PELO_BARRIL = modulo(9);
// dado idêntico importado por um módulo: herda e não contamina quem o importa
const TRADUCOES = ['apps/engine-ai/src/i18n/pt-01.json', 'apps/engine-ai/src/i18n/pt-02.json'];
const COM_TRADUCAO = modulo(10);
const BARRIL = 'apps/engine-ai/src/herdado/index.ts';
const PACOTES = { porPasta: { '': ['@nestjs/common', '@prisma/client'] }, workspace: [] };
const PACKAGE_JSON = JSON.stringify({ dependencies: { '@nestjs/common': '10.0.0', '@prisma/client': '5.0.0' } });
// os 57 idênticos à foto: os dois que a base tocou primeiro, depois o resto
const TOCADOS_NA_BASE = ['apps/engine-ai/src/herdado/modulo-01.ts', 'docs/herdado/nota-01.md'];
const IDENTICOS = [
  ...TOCADOS_NA_BASE,
  ...Array.from({ length: 39 }, (_, i) => `apps/engine-ai/src/herdado/modulo-${doisDigitos(i + 2)}.ts`),
  ...Array.from({ length: 12 }, (_, i) => `docs/herdado/nota-${doisDigitos(i + 2)}.md`),
  ...TRADUCOES,
  GUARDA, PAINEL,
];

function casoEngineAi1489() {
  const caminhos = [...MISTURADOS, ...IDENTICOS];
  const arquivos = caminhos.map(arquivo);
  const diferemDaFoto = [...MISTURADOS];
  const mexidosNaBase = [...TOCADOS_NA_BASE, APAGADO_NA_BASE];
  const mexidosDesdeAPonta = [...IDENTICOS.slice(0, 33), APAGADO_NA_BASE];
  const codigo = caminhos.filter((p) => p.endsWith('.ts'));
  const mapa = {
    files: [...codigo, BARRIL].map((path) => ({ path, backend: 'babel', limitations: [] })),
    relations: [{ from: GUARDA, to: 'common/zone-ownership/mapa-de-zonas.ts' }, { from: SERVICO_DO_PRISMA, to: REPOSITORIOS_PRISMA[0] },
      { from: PELO_BARRIL, to: BARRIL }, { from: COM_TRADUCAO, to: TRADUCOES[0] }, { from: BARRIL, to: 'common/zone-ownership/mapa-de-zonas.ts' }],
    unresolved: [{ from: PAINEL, specifier: './quadros-do-turno' },
      ...codigo.map((from) => ({ from, specifier: '@nestjs/common' })),
      ...REPOSITORIOS_PRISMA.map((from) => ({ from, specifier: '@prisma/client' }))],
  };
  const cenario = cenarioDoSync({
    numero: 1489,
    commits: [commitDaOrigem(1), commitDaOrigem(2), commitDaOrigem(3),
      mergeDoSync({ primeiroPai: P1, foto: FOTO, mensagem: "Merge branch 'homologation' into sync/homologation-into-development-20261124" })],
  });
  cenario.comparacoes[`${FOTO}...${HEAD_DO_SYNC}`] = { behind: 0, mergeBase: FOTO, files: diferemDaFoto };
  cenario.comparacoes[`${FOTO}...${P1}`] = { behind: 2, mergeBase: 'a0c0'.padEnd(40, '0'), files: mexidosNaBase };
  cenario.comparacoes[`${FOTO}...${BASE_PONTA}`] = { behind: 9, mergeBase: 'a0c0'.padEnd(40, '0'), files: mexidosDesdeAPonta };
  return { arquivos, diferemDaFoto, mexidosNaBase, mexidosDesdeAPonta, mapa, pacotes: PACOTES, packageJson: PACKAGE_JSON, cenario, BASE_PONTA,
    GUARDA, PAINEL, REPOSITORIOS_PRISMA, SERVICO_DO_PRISMA, PELO_BARRIL, TRADUCOES, COM_TRADUCAO };
}

export { casoEngineAi1489 };
