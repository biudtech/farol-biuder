import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESFECHOS_DA_CONTESTACAO, FILTROS_DE_DESFECHO, PUBLICADOS, ROTULO_DA_ACAO, ROTULO_DO_STATUS, foiPublicado, parecerQueDifere,
  textoDoDesfecho, textoDoPublicado, textoDoStatus,
} from './rotulos';

// O motor é lido por texto, como em src/contratos/snapshot.test.ts: importar os arquivos dele
// subiria o motor.
const RAIZ = path.resolve(import.meta.dirname, '../../..');
const doMotor = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

// Todo arquivo de lib/engine que grava uma decisão: os que chamam resolveIntoHistory ou
// recordDecision. A lista sai da varredura da pasta, e não de nomes fixos: arquivo novo que
// passe a resolver revisão entra sozinho.
const QUEM_RESOLVE = fs.readdirSync(path.join(RAIZ, 'lib/engine'))
  .filter((nome) => nome.endsWith('.js'))
  .map((nome) => `lib/engine/${nome}`)
  .filter((arquivo) => /\b(?:resolveIntoHistory|recordDecision)\(/.test(doMotor(arquivo)));

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

describe('a varredura do motor', () => {
  it('acha os arquivos que resolvem revisão, inclusive os que a tabela cita', () => {
    for (const arquivo of ['decision.js', 'desfecho-da-revisao.js', 'espera-ci.js', 'espera-pr-proprio.js', 'espera-prova-decidida.js', 'postagem-recusada.js']) {
      expect(QUEM_RESOLVE, arquivo).toContain(`lib/engine/${arquivo}`);
    }
  });
});

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

  it('publicado é só o que o motor conta como publicado (PUBLICADOS de historico-paginado.js)', () => {
    const lista = /const PUBLICADOS = Object\.freeze\(\[([^\]]*)\]\)/.exec(doMotor('lib/engine/historico-paginado.js'));
    if (!lista) throw new Error('não achei PUBLICADOS no motor');
    expect([...PUBLICADOS]).toEqual(literais(lista[1] as string));
    for (const action of PUBLICADOS) expect(foiPublicado(action)).toBe(true);
    for (const action of ['skip', 'merge', 'toString', '', undefined]) expect(foiPublicado(action), String(action)).toBe(false);
  });

  it('o rótulo diz o que foi publicado; ausente e desconhecido não contam como publicado, e o desconhecido aparece cru', () => {
    expect(textoDoPublicado({ action: 'approve' })).toBe('Aprovação');
    expect(textoDoPublicado({ action: 'request_changes' })).toBe('Pedido de mudanças');
    expect(textoDoPublicado({ action: 'comment' })).toBe('Comentário');
    expect(textoDoPublicado({ action: 'skip' })).toBe('Nada publicado');
    expect(textoDoPublicado({})).toBe('Nada publicado');
    expect(textoDoPublicado({ action: 'merge' })).toBe('Nada publicado (o motor registrou "merge")');
    expect(textoDoPublicado({ action: 'toString' })).toBe('Nada publicado (o motor registrou "toString")');
  });

  it('a pendência da mesa ainda não publicou nada, mesmo que traga action', () => {
    expect(textoDoPublicado({ status: 'pending' })).toBe('Nada publicado ainda');
    expect(textoDoPublicado({ status: 'pending', action: 'approve' })).toBe('Nada publicado ainda');
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
