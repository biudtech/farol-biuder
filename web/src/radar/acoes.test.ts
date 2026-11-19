import { describe, expect, it, vi } from 'vitest';
import type { Cliente, Resultado } from '@/transporte/cliente';
import {
  CHECAR, confirmacaoDa, executar, idDa, lerRespostaDeAcao, mensagemDaRecusa, nomeDa, pedidoDa, rotuloDa, textoDoEnvio,
  type Acao, type RespostaDeAcao,
} from './acoes';

const NOME = 'PR #12 de dono/repo';
const base = { alvo: 'dono/repo#12', nome: NOME };
const URL = 'https://github.com/dono/repo/pull/12';
const revisar: Acao = { ...base, tipo: 'revisar', url: URL };

function clienteQueResponde(resultado: Resultado<RespostaDeAcao>) {
  const post = vi.fn(async () => resultado);
  return { cliente: { post } as unknown as Pick<Cliente, 'post'>, post };
}

describe('rota e corpo de cada ação, como lib/http-server.js espera', () => {
  it.each<[Acao, string, object]>([
    [CHECAR, '/api/check', {}],
    [{ ...base, tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12' }, '/api/review', { urls: ['https://github.com/dono/repo/pull/12'] }],
    [{ ...base, tipo: 'cancelar', id: 'a7' }, '/api/cancel', { id: 'a7' }],
    [{ ...base, tipo: 'ignorar', chave: 'dono/repo#12' }, '/api/ignore', { key: 'dono/repo#12' }],
    [{ ...base, tipo: 'restaurar', chave: 'dono/repo#12' }, '/api/restore', { key: 'dono/repo#12' }],
    [{ ...base, tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12', deNovo: true }, '/api/review', { urls: ['https://github.com/dono/repo/pull/12'] }],
    [{ ...base, tipo: 'contestacao', chave: 'dono/repo#12', autor: 'ana', desfecho: 'author_right', nota: 'era intencional' }, '/api/pushback', { key: 'dono/repo#12', author: 'ana', outcome: 'author_right', note: 'era intencional' }],
    // apagar o registro: desfecho vazio, e a nota não vai
    [{ ...base, tipo: 'contestacao', chave: 'dono/repo#12', autor: 'ana', desfecho: '', nota: 'sobra' }, '/api/pushback', { key: 'dono/repo#12', author: 'ana', outcome: '', note: '' }],
  ])('%o', (acao, rota, corpo) => {
    expect(pedidoDa(acao)).toEqual({ rota, corpo });
  });
});

describe('ações do Histórico: revisar de novo e contestação', () => {
  const gravar: Acao = { ...base, tipo: 'contestacao', chave: 'dono/repo#12', autor: 'ana', desfecho: 'mixed', nota: '' };
  const apagar: Acao = { ...gravar, desfecho: '' };

  it('revisar de novo muda o rótulo, e não pede confirmação', () => {
    const deNovo: Acao = { ...base, tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12', deNovo: true };
    expect(rotuloDa(deNovo)).toBe('Revisar de novo');
    expect(nomeDa(deNovo)).toBe('Revisar de novo PR #12 de dono/repo');
    expect(confirmacaoDa(deNovo)).toBeNull();
    expect(idDa(deNovo)).toBe('revisar');
    const falhou: Acao = { ...base, tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12', falhou: true };
    expect(rotuloDa(falhou)).toBe('Tentar de novo');
    expect(nomeDa(falhou)).toBe('Tentar de novo PR #12 de dono/repo');
    expect(pedidoDa(falhou)).toEqual({ rota: '/api/review', corpo: { urls: ['https://github.com/dono/repo/pull/12'] } });
  });

  it('revisar mesmo assim (De fora da fila): o mesmo POST /api/review, com o rótulo do painel', () => {
    const mesmoAssim: Acao = { ...base, tipo: 'revisar', url: 'https://github.com/dono/repo/pull/12', mesmoAssim: true };
    expect(rotuloDa(mesmoAssim)).toBe('Revisar mesmo assim');
    expect(nomeDa(mesmoAssim)).toBe('Revisar mesmo assim PR #12 de dono/repo');
    expect(confirmacaoDa(mesmoAssim)).toBeNull();
    expect(pedidoDa(mesmoAssim)).toEqual({ rota: '/api/review', corpo: { urls: ['https://github.com/dono/repo/pull/12'] } });
  });

  // lib/engine/pushback.js: recordPushback grava confirmado e manual; pushbacksFor leva o
  // registro ao prompt das revisões do autor; licoesDoRepo leva author_right e mixed ao das
  // revisões de outros autores do repositório; pushbackTargets pula o PR com registro manual.
  it('gravar o desfecho pede confirmação, dizendo onde o registro entra e que nada é publicado', () => {
    expect(rotuloDa(gravar)).toBe('Gravar o desfecho');
    expect(nomeDa(gravar)).toBe('Gravar o desfecho da contestação de PR #12 de dono/repo');
    expect(idDa(gravar)).toBe('contestacao:gravar');
    const c = confirmacaoDa(gravar);
    expect(c?.titulo).toBe('Gravar o desfecho da contestação de PR #12 de dono/repo?');
    expect(c?.confirmar).toBe('Gravar o desfecho');
    expect(c?.texto).toMatch(/confirmado e registrado à mão/);
    expect(c?.texto).toMatch(/entra no prompt das próximas revisões dos PRs do autor/);
    expect(c?.texto).toMatch(/o motor deixa de procurar contestação neste PR sozinho/);
    expect(c?.texto).toMatch(/Nada é publicado no GitHub[.]$/);
  });

  it('só o desfecho em que a revisão errou vai ao prompt das revisões de outros autores do repositório', () => {
    const outros = /também no das revisões de PRs de outros autores neste repositório/;
    expect(confirmacaoDa({ ...gravar, desfecho: 'mixed' })?.texto).toMatch(outros);
    expect(confirmacaoDa({ ...gravar, desfecho: 'author_right' })?.texto).toMatch(outros);
    expect(confirmacaoDa({ ...gravar, desfecho: 'we_right' })?.texto).not.toMatch(outros);
    expect(confirmacaoDa({ ...gravar, desfecho: 'we_right' })?.texto).toMatch(/entra no prompt das próximas revisões dos PRs do autor/);
  });

  it('apagar o registro pede confirmação, dizendo o que se perde e que nada é publicado', () => {
    expect(rotuloDa(apagar)).toBe('Apagar a contestação');
    expect(nomeDa(apagar)).toBe('Apagar a contestação de PR #12 de dono/repo');
    expect(idDa(apagar)).toBe('contestacao:apagar');
    const c = confirmacaoDa(apagar);
    expect(c?.titulo).toBe('Apagar a contestação de PR #12 de dono/repo?');
    expect(c?.texto).toMatch(/sai da memória do motor, com a nota/);
    expect(c?.texto).toMatch(/o motor volta a poder detectar contestação neste PR sozinho/);
    expect(c?.texto).toMatch(/Nada é publicado no GitHub\./);
    expect(c?.confirmar).toBe('Apagar o registro');
  });

  it('o aceite e a recusa do motor viram frase', async () => {
    const aceito = clienteQueResponde({ ok: true, dados: { ok: true } });
    expect(await executar(aceito.cliente, gravar)).toEqual({ tipo: 'ok', texto: 'O motor aceitou o pedido: gravar o desfecho da contestação de PR #12 de dono/repo.' });
    expect(aceito.post).toHaveBeenCalledWith('/api/pushback', { key: 'dono/repo#12', author: 'ana', outcome: 'mixed', note: '' }, lerRespostaDeAcao);
    const recusado = clienteQueResponde({ ok: true, dados: { ok: false, error: 'desfecho inválido' } });
    expect(await executar(recusado.cliente, gravar)).toEqual({ tipo: 'erro', texto: 'O motor recusou: desfecho inválido' });
  });
});

describe('rótulo, nome e confirmação', () => {
  it('o nome do botão diz a ação e o alvo', () => {
    expect(rotuloDa(revisar)).toBe('Revisar agora');
    expect(nomeDa(revisar)).toBe('Revisar agora PR #12 de dono/repo');
    expect(nomeDa({ ...base, tipo: 'ignorar', chave: 'x' })).toBe('Ignorar PR #12 de dono/repo');
    expect(nomeDa(CHECAR)).toBe('Checar agora');
    expect(idDa(revisar)).toBe('revisar');
    expect(idDa({ ...base, tipo: 'ignorar', chave: 'x' })).toBe('ignorar');
  });

  // O redesenho de 17/11/2026 tirou a mesa do front: nenhuma ação do Radar decide uma pendência.
  it('nenhuma ação do Radar vai a POST /api/decide', () => {
    const doRadar: Acao[] = [CHECAR, revisar, { ...base, tipo: 'cancelar', id: 'a1' }, { ...base, tipo: 'ignorar', chave: 'x' }, { ...base, tipo: 'restaurar', chave: 'x' }];
    for (const acao of doRadar) expect(pedidoDa(acao).rota).not.toBe('/api/decide');
  });

  it('Cancelar a sessão também pergunta; o resto vai direto', () => {
    expect(confirmacaoDa({ ...base, tipo: 'cancelar', id: 'a1' })?.texto).toMatch(/interrompida/);
    expect(confirmacaoDa({ ...base, tipo: 'ignorar', chave: 'x' })).toBeNull();
    expect(confirmacaoDa({ ...base, tipo: 'restaurar', chave: 'x' })).toBeNull();
    expect(confirmacaoDa({ ...base, tipo: 'revisar', url: 'u' })).toBeNull();
    expect(confirmacaoDa(CHECAR)).toBeNull();
  });
});

describe('leitura da resposta', () => {
  it('aceita o aceite e a recusa, com os campos extras do motor ignorados', () => {
    expect(lerRespostaDeAcao({ ok: true, mode: 'auto', duplicados: [] })).toEqual({ ok: true });
    expect(lerRespostaDeAcao({ ok: false, blocked: 'pr_fechado', error: 'x', attempted: false })).toEqual({ ok: false, blocked: 'pr_fechado', error: 'x' });
    expect(lerRespostaDeAcao({ ok: false })).toEqual({ ok: false, blocked: undefined, error: undefined });
  });

  it('recusa o que não tem a forma', () => {
    for (const torto of [null, 'ok', [], {}, { ok: 'true' }]) expect(lerRespostaDeAcao(torto)).toBeNull();
  });

  it('recusa com código ou frase de forma errada continua sendo recusa, sem o campo', () => {
    expect(lerRespostaDeAcao({ ok: false, error: 7, blocked: null })).toEqual({ ok: false });
    expect(lerRespostaDeAcao({ ok: false, blocked: {}, error: 'frase' })).toEqual({ ok: false, error: 'frase' });
  });
});

describe('mensagem da recusa, pelo código do motor', () => {
  it.each([
    ['stale_head', /commit novo depois da revisão/],
    ['pr_proprio', /própria conta revisora/],
    ['pr_fechado', /mergeado ou fechado/],
    ['instancia_isolada', /instância isolada/],
    ['internal_language', /filtro de linguagem/],
    ['credencial_no_texto', /credencial/],
    ['criterios_inconsistentes', /inconsistentes/],
    ['round_memory', /memória de rodadas/],
    ['invalid_payload', /não pode ser publicado/],
    ['technical_review', /avaliação técnica/],
  ])('%s', (blocked, texto) => {
    expect(mensagemDaRecusa({ blocked, error: 'frase do motor' })).toMatch(texto);
  });

  it('só os códigos que pedem o caso concreto levam a frase do motor junto', () => {
    expect(mensagemDaRecusa({ blocked: 'technical_review', error: 'falta o lint' })).toBe('A avaliação técnica não permite publicar agora. O motor disse: falta o lint');
    expect(mensagemDaRecusa({ blocked: 'pr_fechado', error: 'PR mergeado, então o review não foi postado' })).toBe('O PR já foi mergeado ou fechado: o review não foi publicado.');
    expect(mensagemDaRecusa({ blocked: 'technical_review' })).toBe('A avaliação técnica não permite publicar agora.');
  });

  it('código desconhecido, ou recusa sem código, mostra a frase do motor', () => {
    expect(mensagemDaRecusa({ blocked: 'codigo_novo', error: 'decisão não encontrada (já resolvida?)' })).toBe('O motor recusou: decisão não encontrada (já resolvida?)');
    expect(mensagemDaRecusa({ error: '  sessão não\n encontrada  ' })).toBe('O motor recusou: sessão não encontrada');
    expect(mensagemDaRecusa({ blocked: 'constructor' })).toBe('O motor recusou a ação e não disse o motivo.');
    expect(mensagemDaRecusa({})).toBe('O motor recusou a ação e não disse o motivo.');
  });

  it('frase comprida do motor é cortada', () => {
    const texto = mensagemDaRecusa({ error: 'x'.repeat(2000) });
    expect(texto.length).toBeLessThan(430);
    expect(texto.endsWith('…')).toBe(true);
  });
});

describe('executar', () => {
  it('manda o POST da ação pelo cliente e diz o aceite, sem afirmar o desfecho', async () => {
    const { cliente, post } = clienteQueResponde({ ok: true, dados: { ok: true } });
    const r = await executar(cliente, revisar);
    expect(r).toEqual({ tipo: 'ok', texto: 'O motor aceitou o pedido: revisar agora PR #12 de dono/repo.' });
    expect(r.tipo === 'ok' ? r.texto : '').not.toMatch(/publicad|postad/i);
    expect(post).toHaveBeenCalledWith('/api/review', { urls: [URL] }, lerRespostaDeAcao);
  });

  it('as outras ações dizem só que o motor aceitou o pedido', async () => {
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: true } });
    expect(await executar(cliente, CHECAR)).toEqual({ tipo: 'ok', texto: 'O motor aceitou o pedido: checar agora.' });
    expect(await executar(cliente, { ...base, tipo: 'ignorar', chave: 'dono/repo#12' })).toEqual({ tipo: 'ok', texto: 'O motor aceitou o pedido: ignorar PR #12 de dono/repo.' });
  });

  it('enquanto o pedido está no ar, o texto diz o que está sendo enviado', () => {
    expect(textoDoEnvio(revisar)).toBe('Enviando: Revisar agora PR #12 de dono/repo.');
    expect(textoDoEnvio(CHECAR)).toBe('Enviando: Checar agora.');
  });

  it('recusa do motor vira a mensagem do código', async () => {
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: false, blocked: 'instancia_isolada', error: 'x' } });
    expect(await executar(cliente, revisar)).toEqual({ tipo: 'erro', texto: expect.stringMatching(/instância isolada/) });
  });

  it.each<[Resultado<RespostaDeAcao>, RegExp]>([
    [{ ok: false, falha: 'rede', status: 0 }, /falha de rede/],
    [{ ok: false, falha: 'recusado', status: 403 }, /HTTP 403/],
    [{ ok: false, falha: 'resposta_invalida', status: 200 }, /fora do formato/],
    [{ ok: false, falha: 'nao_autenticado', status: 401 }, /Pareie de novo/],
  ])('falha do transporte %o', async (resultado, texto) => {
    const { cliente } = clienteQueResponde(resultado);
    expect(await executar(cliente, revisar)).toEqual({ tipo: 'erro', texto: expect.stringMatching(texto) });
  });

  it('chamada abortada não vira mensagem', async () => {
    const { cliente } = clienteQueResponde({ ok: false, falha: 'cancelado', status: 0 });
    expect(await executar(cliente, revisar)).toEqual({ tipo: 'cancelado' });
  });
});

describe('ações do Time: papel e competência, e remover do Time', () => {
  const pessoa = { alvo: 'time:ana', nome: '@ana' };
  const pessoas = { bruno: { papel: 'junior' }, ana: { papel: 'senior', dominios: { backend: 'avancado' } } };
  const salvar: Acao = { ...pessoa, tipo: 'perfil', login: 'Ana', pessoas };
  const remover: Acao = { ...pessoa, tipo: 'removerAutor', login: 'Ana', entradas: 3, temPerfil: true, contestacoes: 2 };

  it('salvar manda a lista inteira de perfis em people, como POST /api/settings a lê', () => {
    expect(pedidoDa(salvar)).toEqual({ rota: '/api/settings', corpo: { people: pessoas } });
    expect(rotuloDa(salvar)).toBe('Salvar papel e competência');
    expect(nomeDa(salvar)).toBe('Salvar papel e competência de @ana');
    expect(idDa(salvar)).toBe('perfil');
    expect(confirmacaoDa(salvar)).toBeNull();
  });

  it('o corpo é o mapa que a ação recebeu, sem filtro: forma errada e campo desconhecido vão como vieram', () => {
    const cru = { ana: { papel: 4 }, bruno: 'x', dora: { papel: 'senior', squad: 'plataforma' } };
    expect(pedidoDa({ ...salvar, pessoas: cru }).corpo).toEqual({ people: { ana: { papel: 4 }, bruno: 'x', dora: { papel: 'senior', squad: 'plataforma' } } });
    expect((pedidoDa({ ...salvar, pessoas: cru }).corpo as { people: unknown }).people).toBe(cru);
  });

  it('remover manda só o login, como o motor o listou', () => {
    expect(pedidoDa(remover)).toEqual({ rota: '/api/team/remove', corpo: { login: 'Ana' } });
    expect(rotuloDa(remover)).toBe('Remover do Time');
    expect(nomeDa(remover)).toBe('Remover @ana do Time');
    expect(textoDoEnvio(remover)).toBe('Enviando: Remover @ana do Time.');
  });

  it('remover pergunta antes, dizendo as três coisas apagadas, o que continua, que não desfaz e o efeito nas revisões', () => {
    const c = confirmacaoDa(remover);
    expect(c?.titulo).toBe('Remover @ana do Time?');
    expect(c?.confirmar).toBe('Apagar o dossiê, o perfil e as contestações');
    expect(c?.texto).toContain('O motor apaga três coisas de @ana: o dossiê (3 entradas de memória nesta tela), o papel e a competência configurados e todos os registros de contestação dos PRs dela (2 nesta tela).');
    expect(c?.texto).toContain('o motor não apaga uma entrada só');
    expect(c?.texto).toContain('Não dá para desfazer');
    expect(c?.texto).toContain('as revisões dos PRs dela continuam no Histórico, com ela como autora, e no log do motor');
    expect(c?.texto).toContain('Nada muda no GitHub');
    expect(c?.texto).toContain('outros autores do mesmo repositório');
    // a pergunta não promete apagar tudo
    expect(`${c?.texto} ${c?.confirmar}`).not.toMatch(/apaga tudo|apagar tudo/i);
  });

  it('a pergunta não afirma que existe o que a tela não viu', () => {
    const c = confirmacaoDa({ ...remover, entradas: 0, temPerfil: false, contestacoes: 0 });
    expect(c?.texto).toContain('o dossiê, se houver, o papel e a competência, se houver e os registros de contestação dos PRs dela, se houver');
    expect(confirmacaoDa({ ...remover, entradas: 1 })?.texto).toContain('(1 entrada de memória nesta tela)');
  });

  it('a resposta do salvar traz o mapa de perfis que ficou gravado, como veio', () => {
    expect(lerRespostaDeAcao({ ok: true, ignoradas: [], config: { intervalSeconds: 300, people: pessoas } })).toEqual({ ok: true, pessoas });
    expect(lerRespostaDeAcao({ ok: true, ignoradas: ['people', 7], config: {} })).toEqual({ ok: true, ignoradas: ['people'] });
    // pessoa de forma errada na resposta não some: a conferência é que diz
    expect(lerRespostaDeAcao({ ok: true, config: { people: { ana: 3, dora: { squad: 'x' } } } })).toEqual({ ok: true, pessoas: { ana: 3, dora: { squad: 'x' } } });
    expect(lerRespostaDeAcao({ ok: true, config: { people: [] } })).toEqual({ ok: true });
    expect(lerRespostaDeAcao({ ok: true, removed: false })).toEqual({ ok: true, removed: false });
  });

  it('a recusa de POST /api/settings vem em code e erro', () => {
    expect(lerRespostaDeAcao({ ok: false, code: 'chave_exigida', perfis: ['p1'], erro: 'Para mudar o endereço deste perfil, digite a chave de novo.' }))
      .toEqual({ ok: false, blocked: 'chave_exigida', error: 'Para mudar o endereço deste perfil, digite a chave de novo.' });
  });

  it('o salvar aceito diz o que o motor gravou, lido da resposta', async () => {
    const { cliente, post } = clienteQueResponde({ ok: true, dados: { ok: true, pessoas } });
    expect(await executar(cliente, salvar)).toEqual({ tipo: 'ok', texto: 'O motor gravou o perfil de @ana: papel Sênior; Backend: Avançado.' });
    expect(post).toHaveBeenCalledWith('/api/settings', { people: pessoas }, lerRespostaDeAcao);
  });

  it('se o motor gravou a pessoa diferente do pedido, a tela diz o que ficou', async () => {
    const descartou = clienteQueResponde({ ok: true, dados: { ok: true, pessoas: { bruno: { papel: 'junior' }, ana: { papel: 'senior' } } } });
    expect(await executar(descartou.cliente, salvar)).toEqual({
      tipo: 'erro',
      texto: 'O motor gravou o perfil de @ana diferente do pedido: ficou papel Sênior. O que ele não reconhece, ele descarta.',
    });
  });

  it('confere o mapa inteiro: outra pessoa que mudou ou saiu aparece no resultado', async () => {
    const sumiu = clienteQueResponde({ ok: true, dados: { ok: true, pessoas: { ana: pessoas.ana } } });
    expect(await executar(sumiu.cliente, salvar)).toEqual({
      tipo: 'erro',
      texto: 'O motor gravou o perfil de @ana: papel Sênior; Backend: Avançado. Atenção: o perfil de outra pessoa ficou diferente do que esta tela enviou, mudou ou saiu da lista (@bruno). Confira na tela.',
    });
    // o motor descartou o que não reconhece nas outras: a tela diz quem
    const enviado = { ana: pessoas.ana, bruno: { papel: 4 }, caio: 'x', dora: { papel: 'pleno', squad: 'plataforma' }, eva: { papel: 'pleno' } };
    const saneou = clienteQueResponde({ ok: true, dados: { ok: true, pessoas: { ana: pessoas.ana, dora: { papel: 'pleno' }, eva: { papel: 'pleno' } } } });
    const r = await executar(saneou.cliente, { ...salvar, pessoas: enviado });
    expect(r).toEqual({
      tipo: 'erro',
      texto: 'O motor gravou o perfil de @ana: papel Sênior; Backend: Avançado. Atenção: o perfil de outras 3 pessoas ficou diferente do que esta tela enviou, mudou ou saiu da lista (@bruno, @caio, @dora). Confira na tela.',
    });
  });

  it('a lista de nomes do aviso tem teto', async () => {
    const muitos = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((l) => [l, { papel: 'pleno' }]));
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: true, pessoas: { ana: pessoas.ana } } });
    const r = await executar(cliente, { ...salvar, pessoas: { ...muitos, ana: pessoas.ana } });
    expect(r.tipo === 'erro' ? r.texto : '').toContain('outras 7 pessoas ficou diferente do que esta tela enviou, mudou ou saiu da lista (@a, @b, @c, @d, @e e mais 2)');
  });

  it('perfil apagado e confirmado pela resposta diz que ficou sem perfil', async () => {
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: true, pessoas: { bruno: { papel: 'junior' } } } });
    expect(await executar(cliente, { ...salvar, pessoas: { bruno: { papel: 'junior' } } })).toEqual({ tipo: 'ok', texto: 'O motor gravou o perfil de @ana: sem papel nem competência.' });
  });

  it('sem os perfis na resposta, ou com o campo ignorado, a tela não afirma que gravou', async () => {
    const semPerfis = clienteQueResponde({ ok: true, dados: { ok: true } });
    expect(await executar(semPerfis.cliente, salvar)).toEqual({
      tipo: 'ok',
      texto: 'O motor aceitou o pedido de salvar o perfil de @ana, mas a resposta não trouxe os perfis gravados: confira o perfil na tela.',
    });
    const ignorado = clienteQueResponde({ ok: true, dados: { ok: true, pessoas, ignoradas: ['people'] } });
    expect(await executar(ignorado.cliente, salvar)).toEqual({ tipo: 'erro', texto: 'O motor ignorou o campo de perfis: o perfil de @ana não foi gravado.' });
  });

  it('a remoção diz o que o motor respondeu, sem afirmar que as três coisas existiam, e o que continua', async () => {
    const apagou = clienteQueResponde({ ok: true, dados: { ok: true, removed: true } });
    expect(await executar(apagou.cliente, remover)).toEqual({
      tipo: 'ok',
      texto: 'O motor respondeu que apagou o que tinha de @ana entre o dossiê, o perfil e as contestações (ele não diz quais existiam). Não há como desfazer. As revisões dos PRs dela continuam no Histórico e no log do motor.',
    });
    const nada = clienteQueResponde({ ok: true, dados: { ok: true, removed: false } });
    expect(await executar(nada.cliente, remover)).toEqual({
      tipo: 'ok',
      texto: 'O motor respondeu que não tinha dossiê, perfil nem contestação de @ana: nada foi apagado. As revisões dos PRs dela continuam no Histórico e no log do motor.',
    });
    const mudo = clienteQueResponde({ ok: true, dados: { ok: true } });
    expect(await executar(mudo.cliente, remover)).toEqual({
      tipo: 'ok',
      texto: 'O motor aceitou o pedido de remover @ana do Time e não disse se havia algo para apagar. As revisões dos PRs dela continuam no Histórico e no log do motor.',
    });
  });

  it('login que o motor recusa aparece com a frase dele', async () => {
    const { cliente } = clienteQueResponde({ ok: true, dados: { ok: false, error: 'login inválido' } });
    expect(await executar(cliente, remover)).toEqual({ tipo: 'erro', texto: 'O motor recusou: login inválido' });
  });

  it('recusa fora de 2xx leva o código do corpo, quando há', async () => {
    const comCodigo = clienteQueResponde({ ok: false, falha: 'recusado', status: 403, detalhe: { codigo: 'origem_recusada' } });
    expect(await executar(comCodigo.cliente, salvar)).toEqual({ tipo: 'erro', texto: 'O motor recusou o pedido (HTTP 403, origem_recusada).' });
    const semCodigo = clienteQueResponde({ ok: false, falha: 'recusado', status: 500 });
    expect(await executar(semCodigo.cliente, salvar)).toEqual({ tipo: 'erro', texto: 'O motor recusou o pedido (HTTP 500).' });
  });
});
