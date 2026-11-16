// LER UMA CONFIG ANTIGA NUNCA DEIXA A CONTA MAIS PERMISSIVA DO QUE ELA ERA.
//
// É a regra que test/contas-migracao.test.js travava até o corte para uma conta (lote 14), e
// que a primeira versão do normalizarConfig afrouxou em três lugares: a receita de instância
// de teste (`{"port": 47180, "autoReview": false}`), a config de antes da primeira migração
// (sem `esquemaConfig`, conta sem os quatro campos) e a lista só de contas silenciadas.
//
// A referência é a regra ANTIGA escrita à mão aqui (`antes`), como era em
// lib/engine/contas-config.js até 30/09/2026, mais uma tabela literal de casos. Nenhuma das
// duas chama o código de hoje.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizarConfig } = await import('../lib/settings.js');
const C = (await import('../lib/engine/contas-config.js')).default;

// A config em memória era `{ ...padrões, ...arquivo }`, com `autoReview: true` e
// `autoApproveAll: false` nos padrões, e as duas leituras eram `!== false`.
function antes(geral, conta) {
  const cfg = { autoReview: true, autoApproveAll: false, ...geral };
  const escolheuRevisao = conta.autoReview === true || conta.autoReview === false;
  const segueRessalva = !conta.onCaveats && conta.onClean !== 'wait';
  let ressalva = conta.onCaveats || 'wait';
  if (segueRessalva) ressalva = cfg.autoApproveAll !== false ? 'approve' : 'wait';
  return {
    revisa: escolheuRevisao ? conta.autoReview : cfg.autoReview !== false,
    limpo: conta.onClean || 'approve',
    ressalva,
    reprova: conta.onReject === 'request_changes' ? 'request_changes' : 'wait',
  };
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
  assert.ok(a.limpo === 'approve' || d.limpo === 'wait', `${rotulo}: não passa a aprovar o limpo`);
  assert.ok(a.ressalva === 'approve' || d.ressalva === 'wait', `${rotulo}: não passa a aprovar com ressalvas`);
  assert.ok(a.reprova === 'request_changes' || d.reprova === 'wait', `${rotulo}: não passa a reprovar sozinha`);
};

test('a tabela inteira: config de antes da primeira migração faz depois o que fazia antes', () => {
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
        // a ÚNICA diferença, e ela só restringe: limpo esperando com o com ressalvas aprovando
        const excecao = conta.onClean === 'wait' && conta.onCaveats === 'approve';
        assert.deepEqual(d, excecao ? { ...a, ressalva: 'wait' } : a, rotulo);
      }
    }
  }
});

test('chave geral antiga presente nunca afrouxa, com o marcador de esquema gravado ou não', () => {
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

// A tabela literal: o que a origin/main gravava, caso a caso.
const TABELA = [
  ['receita de instância de teste, ainda sem login', { port: 47180, autoReview: false },
    { user: '', owners: [], autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }],
  ['modo simples de antes da primeira migração', { ghUser: 'antiga', owners: ['o'] },
    { user: 'antiga', owners: ['o'], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }],
  ['lista de antes da primeira migração, conta sem os quatro campos', { accounts: [{ user: 'antiga', owners: [] }] },
    { user: 'antiga', owners: [], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }],
  ['modo simples com a revisão desligada pela chave geral', { ghUser: ' eu ', owners: ['org', ' '], autoReview: false },
    { user: 'eu', owners: ['org'], autoReview: false, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }],
  ['as duas chaves gerais, conta que herda', { autoReview: false, autoApproveAll: true, accounts: [{ user: 'a', owners: ['o'] }] },
    { user: 'a', owners: ['o'], autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' }],
  ['as duas chaves gerais, conta com o limpo esperando', { autoReview: false, autoApproveAll: true, accounts: [{ user: 'b', owners: [], onClean: 'wait' }] },
    { user: 'b', owners: [], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }],
  ['chave geral escrita à mão como true depois da migração', { esquemaConfig: 1, autoReview: true, ghUser: 'x', owners: [] },
    { user: 'x', owners: [], autoReview: true, onClean: 'approve', onCaveats: 'wait', onReject: 'wait' }],
  ['chave geral torta: só false desligava', { autoApproveAll: null, autoReview: null, ghUser: 'x', owners: [] },
    { user: 'x', owners: [], autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' }],
  ['todas as contas silenciadas: a conta que nascer da detecção não age', { accounts: [{ user: 'a', owners: ['o'], muted: true }, { user: 'b', muted: true, onReject: 'request_changes' }] },
    { user: '', owners: [], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }],
  ['todas silenciadas com o modo simples junto: continua sem agir', { ghUser: 'eu', owners: ['o'], accounts: [{ user: 'a', muted: true }] },
    { user: '', owners: [], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' }],
];

test('a tabela literal do que a origin/main gravava', () => {
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
