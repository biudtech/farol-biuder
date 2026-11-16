import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESFECHOS_DA_CONTESTACAO, FILTROS_DE_DESFECHO, ROTULO_DA_ACAO, ROTULO_DO_STATUS, parecerQueDifere, textoDaAcao,
  textoDoDesfecho, textoDoStatus,
} from './rotulos';

// O motor é lido por texto, como em src/contratos/snapshot.test.ts: importar os arquivos dele
// subiria o motor.
const RAIZ = path.resolve(import.meta.dirname, '../../..');
const doMotor = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

// Os arquivos que resolvem uma revisão para o histórico (quem chama resolveIntoHistory ou
// recordDecision com `status`).
const QUEM_RESOLVE = [
  'lib/engine/decision.js', 'lib/engine/desfecho-da-revisao.js', 'lib/engine/desfecho-automatico.js', 'lib/engine/espera-ci.js',
  'lib/engine/espera-pr-proprio.js', 'lib/engine/espera-prova-decidida.js', 'lib/engine/postagem-recusada.js',
];

const literais = (trecho: string): string[] => [...trecho.matchAll(/'([a-z][a-z_]*)'/g)].map((m) => m[1] as string);

// Todo literal que aparece no valor de um `status:` (ou de `const status =`) nesses arquivos,
// mais os valores do mapa STATUS de desfecho-automatico.js.
function statusDoMotor(): Set<string> {
  const achados = new Set<string>();
  for (const arquivo of QUEM_RESOLVE) {
    const fonte = doMotor(arquivo);
    for (const m of fonte.matchAll(/\bstatus(?::| =(?!=))([^,;}\n]*)/g)) for (const valor of literais(m[1] as string)) achados.add(valor);
  }
  const mapa = /const STATUS = \{([^}]*)\}/.exec(doMotor('lib/engine/desfecho-automatico.js'));
  if (!mapa) throw new Error('não achei o mapa STATUS no motor');
  for (const m of (mapa[1] as string).matchAll(/:\s*'([a-z_]+)'/g)) achados.add(m[1] as string);
  return achados;
}

function acoesDoMotor(): Set<string> {
  const achados = new Set<string>();
  for (const arquivo of QUEM_RESOLVE) {
    for (const m of doMotor(arquivo).matchAll(/\baction: '([a-z_]+)'/g)) achados.add(m[1] as string);
  }
  const mapa = /const REVIEW_STATE_ACTION = \{([^}]*)\}/.exec(doMotor('lib/engine/decision.js'));
  if (!mapa) throw new Error('não achei REVIEW_STATE_ACTION no motor');
  for (const m of (mapa[1] as string).matchAll(/:\s*'([a-z_]+)'/g)) achados.add(m[1] as string);
  const historico = doMotor('lib/engine/historico-paginado.js');
  const publicados = /const PUBLICADOS = Object\.freeze\(\[([^\]]*)\]\)/.exec(historico);
  const naoPostado = /const NAO_POSTADO = '([a-z_]+)'/.exec(historico);
  if (!publicados || !naoPostado) throw new Error('não achei os vereditos de historico-paginado.js');
  for (const valor of literais(publicados[1] as string)) achados.add(valor);
  achados.add(naoPostado[1] as string);
  return achados;
}

describe('rótulos de status', () => {
  const ESPERADOS = [
    'auto_approved', 'auto_rejected', 'commented_own_pr', 'posted', 'already_reviewed', 'approval_not_needed', 'already_merged',
    'already_closed', 'skipped', 'superseded',
  ];

  it('a leitura do motor acha todos os status de item resolvido que este front conhece', () => {
    const lidos = statusDoMotor();
    for (const status of ESPERADOS) expect(lidos.has(status), status).toBe(true);
  });

  it('todo status que o motor grava tem rótulo', () => {
    const semRotulo = [...statusDoMotor()].filter((status) => !Object.hasOwn(ROTULO_DO_STATUS, status));
    expect(semRotulo).toEqual([]);
  });

  it('a tabela não guarda rótulo de status que o motor não grava', () => {
    const lidos = statusDoMotor();
    lidos.add('pending');
    expect(Object.keys(ROTULO_DO_STATUS).filter((status) => !lidos.has(status))).toEqual([]);
  });

  it('cada rótulo é uma frase, e o desconhecido aparece cru', () => {
    for (const status of [...ESPERADOS, 'pending']) expect(textoDoStatus(status)).toMatch(/^[A-ZÁ-Ú]/);
    expect(textoDoStatus('posted')).toBe('Publicado por você');
    expect(textoDoStatus('status_novo')).toBe('status_novo');
    expect(textoDoStatus('constructor')).toBe('constructor');
    expect(textoDoStatus(undefined)).toBe('Sem registro de como foi resolvida');
  });
});

describe('rótulos de action', () => {
  it('os valores do motor são exatamente os quatro da tabela', () => {
    expect([...acoesDoMotor()].sort()).toEqual(Object.keys(ROTULO_DA_ACAO).sort());
    expect(Object.keys(ROTULO_DA_ACAO).sort()).toEqual(['approve', 'comment', 'request_changes', 'skip']);
  });

  it('o rótulo diz o que foi publicado, e o desconhecido aparece cru', () => {
    expect(textoDaAcao('approve')).toBe('Aprovação');
    expect(textoDaAcao('request_changes')).toBe('Pedido de mudanças');
    expect(textoDaAcao('comment')).toBe('Comentário');
    expect(textoDaAcao('skip')).toBe('Nada publicado');
    expect(textoDaAcao('merge')).toBe('merge');
    expect(textoDaAcao('toString')).toBe('toString');
    expect(textoDaAcao(undefined)).toBe('Sem registro do que foi publicado');
  });

  it('o filtro de desfecho oferece os mesmos quatro valores, com rótulo do que foi publicado', () => {
    expect(FILTROS_DE_DESFECHO.map(([valor]) => valor).sort()).toEqual(Object.keys(ROTULO_DA_ACAO).sort());
    expect(FILTROS_DE_DESFECHO.map(([, rotulo]) => rotulo)).toEqual(['Aprovados', 'Mudanças pedidas', 'Comentados', 'Não publicados']);
    const vereditos = /const VEREDITOS = Object\.freeze\(\[\.\.\.PUBLICADOS, NAO_POSTADO\]\)/.test(doMotor('lib/engine/historico-paginado.js'));
    expect(vereditos).toBe(true);
  });
});

describe('parecer da revisão', () => {
  it('só aparece quando difere do que foi publicado', () => {
    expect(parecerQueDifere({ verdict: 'approve', action: 'approve' })).toBe('');
    expect(parecerQueDifere({ verdict: 'approve', action: 'request_changes' })).toBe('aprovar');
    expect(parecerQueDifere({ verdict: 'request_changes', action: 'skip' })).toBe('pedir mudanças');
    expect(parecerQueDifere({ verdict: 'approve' })).toBe('aprovar');
    expect(parecerQueDifere({ action: 'skip' })).toBe('');
    expect(parecerQueDifere({ verdict: 'outro', action: 'skip' })).toBe('outro');
  });
});

describe('desfechos de contestação', () => {
  it('são os PUSHBACK_OUTCOMES do motor', () => {
    const lista = /const PUSHBACK_OUTCOMES = \[([^\]]*)\]/.exec(doMotor('lib/taxonomy.js'));
    if (!lista) throw new Error('não achei PUSHBACK_OUTCOMES no motor');
    expect(DESFECHOS_DA_CONTESTACAO.map(([valor]) => valor)).toEqual(literais(lista[1] as string));
  });

  it('desfecho desconhecido aparece cru', () => {
    expect(textoDoDesfecho('author_right')).toBe('O autor tinha razão');
    expect(textoDoDesfecho('novo')).toBe('novo');
  });
});
