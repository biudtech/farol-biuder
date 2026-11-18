// A leitura de uma config antiga: só o liga e desliga da revisão atravessa.
//
// Até 17/11/2026 a regra aqui era "ler uma config antiga nunca deixa a conta mais permissiva do
// que ela era", nos quatro campos da política. A regra do dono de 17/11/2026 (o revisor nunca
// espera decisão de gente) tirou o desfecho em espera (`wait`): os três desfechos são sempre os
// autônomos, e o `wait` de um arquivo antigo cai no padrão. O que continua não afrouxando é o
// `autoReview`, o liga e desliga do monitoramento: a receita de instância de teste
// (`{"port": 47180, "autoReview": false}`), a config de antes da primeira migração e a lista só de
// contas silenciadas não passam a revisar sozinhas.
//
// A referência é a regra ANTIGA do `autoReview` escrita à mão aqui (`antes`), como era em
// lib/engine/contas-config.js até 30/09/2026, mais uma tabela literal de casos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizarConfig } = await import('../lib/settings.js');
const C = (await import('../lib/engine/contas-config.js')).default;

// A config em memória era `{ ...padrões, ...arquivo }`, com `autoReview: true` e
// `autoApproveAll: false` nos padrões, e as duas leituras eram `!== false`.
function antes(geral, conta) {
  const cfg = { autoReview: true, ...geral };
  const escolheuRevisao = conta.autoReview === true || conta.autoReview === false;
  return { revisa: escolheuRevisao ? conta.autoReview : cfg.autoReview !== false, limpo: 'approve', ressalva: 'approve', reprova: 'request_changes' };
}

// O que o motor responde hoje com a conta que a carga devolveu.
function efetiva(conta) {
  const e = { config: {}, accountList: () => [conta] };
  return {
    revisa: C.revisaSozinho(e, conta.user), limpo: C.acaoAoAprovar(e, conta.user, true),
    ressalva: C.acaoAoAprovar(e, conta.user, false), reprova: C.acaoAoReprovar(e, conta.user),
  };
}
const depois = (config) => efetiva(normalizarConfig(config).conta);

function combinacoes(eixos) {
  return eixos.reduce((acc, [chave, valores]) => acc.flatMap((o) => valores.map((v) => (v === undefined ? o : { ...o, [chave]: v }))), [{}]);
}
const GERAIS = combinacoes([['autoReview', [undefined, true, false]], ['autoApproveAll', [undefined, true, false]]]);
const CONTAS = combinacoes([
  ['autoReview', [undefined, true, false]], ['onClean', [undefined, 'approve', 'wait']],
  ['onCaveats', [undefined, 'approve', 'wait']], ['onReject', [undefined, 'wait', 'request_changes']],
]);

// As formas em que a mesma conta chegava num arquivo antigo.
const FORMAS = {
  'lista de contas': (geral, conta) => ({ ...geral, accounts: [{ user: 'x', owners: [], ...conta }] }),
  'lista com silenciada na frente': (geral, conta) => ({ ...geral, accounts: [{ user: 'calada', muted: true, onReject: 'request_changes' }, { user: 'x', owners: [], ...conta }] }),
  'conta do formato novo com chave geral antiga': (geral, conta) => ({ ...geral, conta: { user: 'x', owners: [], ...conta } }),
};
const naoAfrouxa = (a, d, rotulo) => {
  assert.ok(a.revisa || !d.revisa, `${rotulo}: não passa a revisar sozinha`);
};

test('a tabela inteira: a revisão faz o que fazia antes, e os desfechos são os autônomos', () => {
  assert.equal(GERAIS.length * CONTAS.length, 729);
  for (const [nome, forma] of Object.entries(FORMAS)) {
    // o formato novo sem chave geral nenhuma não é config antiga: vale o padrão de hoje
    const gerais = nome.startsWith('conta do formato novo') ? GERAIS.filter((g) => Object.keys(g).length) : GERAIS;
    for (const geral of gerais) {
      for (const conta of CONTAS) {
        const a = antes(geral, conta);
        const d = depois(forma(geral, conta));
        const rotulo = `${nome}: ${JSON.stringify(conta)} com geral ${JSON.stringify(geral)}`;
        naoAfrouxa(a, d, rotulo);
        // os desfechos são sempre os autônomos, com ou sem `wait` no arquivo
        assert.deepEqual(d, a, rotulo);
      }
    }
  }
});

test('chave geral antiga de revisão presente nunca afrouxa, com o marcador de esquema gravado ou não', () => {
  for (const esquemaConfig of [1, 2, '2']) {
    for (const geral of GERAIS.filter((g) => Object.keys(g).length)) {
      for (const conta of CONTAS) {
        const a = antes(geral, conta);
        const d = depois({ esquemaConfig, ...geral, accounts: [{ user: 'x', owners: [], ...conta }] });
        naoAfrouxa(a, d, `esquema ${esquemaConfig}: ${JSON.stringify(conta)} com geral ${JSON.stringify(geral)}`);
      }
    }
  }
});

test('modo simples (ghUser + owners): as nove combinações das chaves gerais', () => {
  for (const geral of GERAIS) {
    assert.deepEqual(depois({ ...geral, ghUser: 'x', owners: ['o'] }), antes(geral, {}), JSON.stringify(geral));
  }
});

// A tabela literal: o que a carga grava, caso a caso (os desfechos ausentes valem o padrão
// autônomo na leitura, contas-config.js).
const TABELA = [
  ['receita de instância de teste, ainda sem login', { port: 47180, autoReview: false },
    { user: '', owners: [], autoReview: false }],
  ['modo simples de antes da primeira migração', { ghUser: 'antiga', owners: ['o'] },
    { user: 'antiga', owners: ['o'], autoReview: true }],
  ['lista de antes da primeira migração, conta sem os quatro campos', { accounts: [{ user: 'antiga', owners: [] }] },
    { user: 'antiga', owners: [], autoReview: true }],
  ['modo simples com a revisão desligada pela chave geral', { ghUser: ' eu ', owners: ['org', ' '], autoReview: false },
    { user: 'eu', owners: ['org'], autoReview: false }],
  ['as duas chaves gerais, conta que herda', { autoReview: false, autoApproveAll: true, accounts: [{ user: 'a', owners: ['o'] }] },
    { user: 'a', owners: ['o'], autoReview: false }],
  ['as duas chaves gerais, conta com o limpo esperando: o wait não atravessa', { autoReview: false, autoApproveAll: true, accounts: [{ user: 'b', owners: [], onClean: 'wait' }] },
    { user: 'b', owners: [], autoReview: false }],
  ['chave geral escrita à mão como true depois da migração', { esquemaConfig: 1, autoReview: true, ghUser: 'x', owners: [] },
    { user: 'x', owners: [], autoReview: true }],
  ['chave geral torta: só false desligava', { autoApproveAll: null, autoReview: null, ghUser: 'x', owners: [] },
    { user: 'x', owners: [], autoReview: true }],
  ['todas as contas silenciadas: a conta que nascer da detecção não revisa sozinha', { accounts: [{ user: 'a', owners: ['o'], muted: true }, { user: 'b', muted: true, onReject: 'request_changes' }] },
    { user: '', owners: [], autoReview: false }],
  ['todas silenciadas com o modo simples junto: continua sem revisar sozinha', { ghUser: 'eu', owners: ['o'], accounts: [{ user: 'a', muted: true }] },
    { user: '', owners: [], autoReview: false }],
];

test('a tabela literal do que a carga grava', () => {
  for (const [nome, entrada, conta] of TABELA) {
    const saida = normalizarConfig(entrada);
    assert.deepEqual(saida.conta, conta, nome);
    for (const antiga of ['autoReview', 'autoApproveAll', 'accounts', 'ghUser', 'owners', 'esquemaConfig']) assert.equal(antiga in saida, false, `${nome}: ${antiga}`);
  }
});

test('instalação já migrada e sem chave geral: a conta sem os quatro campos vale o padrão de hoje', () => {
  // era o "conta nova nasce aprovando e reprovando sozinha" da origin/main (padrão de 01/10/2026)
  const migrada = normalizarConfig({ esquemaConfig: 1, accounts: [{ user: 'nova', owners: [] }] }).conta;
  assert.deepEqual(migrada, { user: 'nova', owners: [] });
  assert.deepEqual(efetiva(migrada), { revisa: true, limpo: 'approve', ressalva: 'approve', reprova: 'request_changes' });
  // e a conta do formato novo, sem chave geral antiga no arquivo, também
  assert.deepEqual(normalizarConfig({ conta: { user: 'nova', owners: [] } }).conta, { user: 'nova', owners: [] });
});

test('idempotente: o que a carga devolveu, lido de novo, sai igual', () => {
  for (const [nome, entrada] of TABELA) {
    const um = normalizarConfig(entrada);
    assert.deepEqual(normalizarConfig(JSON.parse(JSON.stringify(um))), um, nome);
  }
});

test('a carga não toca na config recebida', () => {
  const config = { autoReview: false, accounts: [{ user: 'a', owners: [] }] };
  const copia = JSON.parse(JSON.stringify(config));
  normalizarConfig(config);
  assert.deepEqual(config, copia);
});

test('a senioridade antiga atravessa a carga: o boot ainda a migra para o perfil por pessoa', () => {
  assert.deepEqual(normalizarConfig({ seniority: { ana: 'senior' } }).seniority, { ana: 'senior' });
});
