// A URL reflete a tela (18/10/2026): a tradução endereço <-> rota de ui/pure/rota.js. Desde
// 20/10/2026 a rota mora no caminho (`/radar/pra-mim`), e o link antigo com `#/` é convertido.
//
// Pedido do dono: "As URLs não refletem exatamente o que vejo em tela". O que se prova aqui
// é a parte pura: ler um endereço qualquer nunca lança e cai no padrão no que não reconhece,
// escrever e ler de volta dá a mesma rota, nada fora de formato fechado entra no endereço, e
// a decisão de empilhar ou substituir no histórico. A fiação com a tela mora em
// ui/telas/rota.js e foi verificada no navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lerRota, escreverRota, mudancaDeRota } from '../ui/pure.js';

const PADRAO = {
  aba: 'radar', sub: 'mim', aparelho: '', secao: '', conta: '', pr: '',
  janela: null,
};

test('endereço vazio não é rota: a tela fica como está', () => {
  for (const h of ['', '#', '#/', '/', '//', '   ', null, undefined]) assert.equal(lerRota(h), null, String(h));
});

test('endereço desconhecido ou quebrado cai no padrão sem lançar', () => {
  for (const h of ['/nada', '/%E0%A4%A', '/radar/zzz', '?pr=lixo', '/../../etc', '/radar/%', '/sistema/%ZZ']) {
    const r = lerRota(h);
    assert.ok(r, h);
    assert.equal(r.aba, h.startsWith('/sistema') ? 'sistema' : 'radar', h);
  }
  assert.deepEqual(lerRota('/nada'), PADRAO);
  assert.deepEqual(lerRota('/sistema/inexistente'), { ...PADRAO, aba: 'sistema', sub: '', secao: 'overview' });
});

test('as quatro abas e as sub-abas do Radar', () => {
  for (const aba of ['radar', 'time', 'consumo', 'sistema']) {
    assert.equal(lerRota(`/${aba}`).aba, aba);
  }
  assert.equal(lerRota('/radar/pra-mim').sub, 'mim');
  assert.equal(lerRota('/radar/aparelhos').sub, 'apar');
  assert.equal(lerRota('/radar/meus-prs').sub, 'meus');
  // o Panorama saiu no corte da fase 1: o endereço antigo cai em Pra mim, sem lançar
  assert.equal(lerRota('/radar/panorama').sub, 'mim');
  // sem barra inicial e na grafia antiga, com o hash, também
  assert.equal(lerRota('#/radar/meus-prs').sub, 'meus');
  assert.equal(lerRota('radar/meus-prs').sub, 'meus');
});

test('aparelho selecionado só existe em Radar > Aparelhos, e só como id opaco', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(lerRota(`/radar/aparelhos/${id}`).aparelho, id);
  assert.equal(escreverRota({ aba: 'radar', sub: 'apar', aparelho: id }), `/radar/aparelhos/${id}`);
  assert.equal(lerRota(`/radar/pra-mim/${id}`).aparelho, '');
  assert.equal(lerRota('/radar/aparelhos/<script>').aparelho, '');
  assert.equal(lerRota('/radar/aparelhos/a%2Fb').aparelho, '');
  assert.equal(escreverRota({ aba: 'radar', sub: 'meus', aparelho: id }), '/radar/meus-prs');
});

test('as doze seções do Sistema, com nome em português no endereço', () => {
  const mapa = {
    'visao-geral': 'overview', contas: 'accounts', automacao: 'automation', jira: 'jira',
    sincronizacao: 'sync', aparelhos: 'devices', grupos: 'groups', plano: 'plans',
    preferencias: 'prefs', diagnostico: 'diag', sobre: 'about',
  };
  for (const [slug, interno] of Object.entries(mapa)) {
    assert.equal(lerRota(`/sistema/${slug}`).secao, interno, slug);
    assert.equal(escreverRota({ aba: 'sistema', secao: interno }), `/sistema/${slug}`);
  }
  assert.equal(escreverRota({ aba: 'sistema' }), '/sistema/visao-geral');
});

test('as abas que saíram (Entregas e Destaques) caem no Radar, sem filtro nenhum', () => {
  for (const h of ['/entregas?org=acme&dias=15&agrupar=pessoas&busca=gate', '/destaques']) {
    const r = lerRota(h);
    assert.equal(r.aba, 'radar', h);
    assert.equal(r.sub, 'mim', h);
  }
  assert.equal(escreverRota({ aba: 'entregas', dias: 7, busca: 'x' }), '/radar/pra-mim');
});

test('conta só nas abas que mostram a barra de contas', () => {
  assert.equal(lerRota('/radar/pra-mim?conta=alice').conta, 'alice');
  assert.equal(lerRota('/time?conta=alice').conta, 'alice');
  assert.equal(lerRota('/sistema/contas?conta=alice').conta, '');
  assert.equal(lerRota('/radar?conta=all').conta, 'all', 'formato válido; quem aplica trata all como Todas');
  assert.equal(lerRota('/radar?conta=a%20b').conta, '');
  assert.equal(escreverRota({ aba: 'time', conta: 'alice' }), '/time?conta=alice');
  assert.equal(escreverRota({ aba: 'consumo', conta: 'alice' }), '/consumo');
});

test('período do Consumo: só 1, 7, 30 e 90, só na aba consumo; o padrão (30) não é escrito', () => {
  assert.equal(lerRota('/consumo?janela=7').janela, 7);
  assert.equal(lerRota('/consumo?janela=7').aba, 'consumo');
  assert.equal(lerRota('/consumo?janela=90').janela, 90);
  assert.equal(lerRota('/consumo?janela=30').janela, 30);
  for (const ruim of ['15', '0', '-7', 'abc', '7x', '07', '']) assert.equal(lerRota(`/consumo?janela=${ruim}`).janela, null, ruim);
  assert.equal(lerRota('/consumo').janela, null);
  assert.equal(lerRota('/radar?janela=7').janela, null, 'nas outras abas é ignorada');
  assert.equal(escreverRota({ aba: 'consumo', janela: 7 }), '/consumo?janela=7');
  assert.equal(escreverRota({ aba: 'consumo', janela: 30 }), '/consumo');
  assert.equal(escreverRota({ aba: 'consumo', janela: 15 }), '/consumo');
  assert.equal(escreverRota({ aba: 'radar', janela: 7 }), '/radar/pra-mim');
  assert.equal(escreverRota(lerRota('/consumo?janela=90&pr=acme%2Fapi%239')), '/consumo?janela=90&pr=acme%2Fapi%239');
  assert.equal(mudancaDeRota({ aba: 'consumo' }, { aba: 'consumo', janela: 7 }), 'replace', 'filtro substitui');
  assert.equal(mudancaDeRota({ aba: 'consumo', janela: 7 }, { aba: 'consumo', janela: 90 }), 'replace');
});

test('caixa de revisão aberta: só chave de PR no formato owner/repo#N', () => {
  const r = lerRota('/consumo?pr=acme%2Fapi%2342');
  assert.equal(r.pr, 'acme/api#42');
  assert.equal(escreverRota(r), '/consumo?pr=acme%2Fapi%2342');
  assert.equal(lerRota('/consumo?pr=acme/api').pr, '');
  assert.equal(lerRota('/consumo?pr=https%3A%2F%2Fevil').pr, '');
  assert.equal(lerRota('/consumo?pr=Kudos').pr, '');
  // o # cru corta a consulta no navegador (vira o hash da página); escrito por nós ele sai
  // sempre codificado
  assert.equal(lerRota('/radar/pra-mim?pr=acme/api#42').pr, 'acme/api#42');
  assert.match(escreverRota({ aba: 'radar', pr: 'acme/api#42' }), /pr=acme%2Fapi%2342$/);
});

test('escrever e ler de volta dá a mesma rota (ida e volta)', () => {
  const casos = [
    { aba: 'radar', sub: 'apar', aparelho: 'dev-1', conta: 'alice', pr: 'a/b#1' },
    { aba: 'radar', sub: 'meus' },
    { aba: 'sistema', secao: 'diag', pr: 'x/y#9' },
    { aba: 'consumo' }, { aba: 'time', conta: 'bob' },
  ];
  for (const c of casos) {
    const hash = escreverRota(c);
    assert.equal(escreverRota(lerRota(hash)), hash, hash);
  }
});

test('a tela manda tudo o que lembra; vale só o da aba à mostra', () => {
  // cada tela lembra a sua sub-aba, seção e aparelho mesmo quando não está à mostra
  const tela = { aba: 'sistema', sub: 'meus', secao: 'accounts', aparelho: 'dev-1', conta: 'bob', janela: 7 };
  assert.equal(escreverRota(tela), '/sistema/contas');
  assert.equal(escreverRota({ ...tela, aba: 'radar' }), '/radar/meus-prs?conta=bob');
  assert.equal(escreverRota({ ...tela, aba: 'radar', sub: 'apar' }), '/radar/aparelhos/dev-1?conta=bob');
  assert.equal(escreverRota({ ...tela, aba: 'consumo' }), '/consumo?janela=7');
});

test('escrever é tolerante: lixo vira o padrão', () => {
  assert.equal(escreverRota(null), '/radar/pra-mim');
  assert.equal(escreverRota({}), '/radar/pra-mim');
  assert.equal(escreverRota({ aba: 'hack', sub: 'x', secao: 'y' }), '/radar/pra-mim');
  assert.equal(escreverRota({ aba: 'sistema', secao: 'zzz' }), '/sistema/visao-geral');
});

test('empilhar x substituir no histórico', () => {
  const r = (h) => lerRota(h);
  assert.equal(mudancaDeRota(null, r('/radar')), 'replace', 'primeira escrita substitui');
  assert.equal(mudancaDeRota(r('/radar'), r('/radar/pra-mim')), '', 'mesma tela, nada a fazer');
  assert.equal(mudancaDeRota(r('/radar'), r('/sistema')), 'push', 'troca de aba empilha');
  assert.equal(mudancaDeRota(r('/radar/pra-mim'), r('/radar/meus-prs')), 'push', 'troca de sub-aba empilha');
  assert.equal(mudancaDeRota(r('/radar/aparelhos/a'), r('/radar/aparelhos/b')), 'push', 'troca de aparelho empilha');
  assert.equal(mudancaDeRota(r('/sistema/contas'), r('/sistema/jira')), 'push', 'troca de seção empilha');
  assert.equal(mudancaDeRota(r('/radar'), r('/radar?conta=alice')), 'replace', 'conta substitui');
  assert.equal(mudancaDeRota(r('/consumo'), r('/consumo?pr=a%2Fb%231')), 'push', 'abrir a caixa empilha');
  assert.equal(mudancaDeRota(r('/consumo?pr=a%2Fb%231'), r('/consumo?pr=a%2Fb%232')), 'push', 'outra caixa empilha');
  assert.equal(mudancaDeRota(r('/consumo?pr=a%2Fb%231'), r('/consumo')), 'fechou-caixa', 'fechar volta a entrada');
  assert.equal(mudancaDeRota(r('/consumo?pr=a%2Fb%231'), r('/sistema')), 'push', 'fechar e trocar de aba empilha');
  assert.equal(mudancaDeRota(r('/radar?conta=x&pr=a%2Fb%231'), r('/radar')), 'replace', 'fechar e mudar filtro substitui');
});

test('nome de consulta fora da lista não chega ao objeto, nem __proto__', async () => {
  const { lerRota } = await import('../ui/pure/rota.js');
  const r = lerRota('/consumo?__proto__=x&constructor=y&janela=7');
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.equal(({}).x, undefined);
  assert.equal(r.janela, 7);
});

// ---------------------------------------------------------------- caminho x hash antigo (20/10/2026)

test('enderecoDaPagina: a rota vem do caminho e da consulta', async () => {
  const { enderecoDaPagina } = await import('../ui/pure/rota.js');
  assert.deepEqual(enderecoDaPagina({ pathname: '/radar/pra-mim', search: '', hash: '' }), { endereco: '/radar/pra-mim', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/consumo', search: '?janela=7', hash: '' }), { endereco: '/consumo?janela=7', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '', hash: '' }), { endereco: '', antigo: false }, 'a raiz não pede rota');
  assert.deepEqual(enderecoDaPagina({ pathname: '/index.html', search: '', hash: '' }), { endereco: '', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '?pr=a%2Fb%231', hash: '' }), { endereco: '?pr=a%2Fb%231', antigo: false });
  assert.deepEqual(enderecoDaPagina(null), { endereco: '', antigo: false }, 'tolerante');
  assert.equal(lerRota(enderecoDaPagina({ pathname: '/', search: '', hash: '' }).endereco), null);
});

test('enderecoDaPagina: link antigo com a rota no hash é reconhecido, e só na raiz', async () => {
  const { enderecoDaPagina } = await import('../ui/pure/rota.js');
  const antigo = enderecoDaPagina({ pathname: '/', search: '', hash: '#/radar/pra-mim' });
  assert.deepEqual(antigo, { endereco: '/radar/pra-mim', antigo: true });
  // o pedido do dono: https://farol.usealways.com/#/radar/pra-mim vira /radar/pra-mim
  assert.equal(escreverRota(lerRota(antigo.endereco)), '/radar/pra-mim');
  const comConsulta = enderecoDaPagina({ pathname: '/', search: '', hash: '#/consumo?pr=acme%2Fapi%2342' });
  assert.equal(escreverRota(lerRota(comConsulta.endereco)), '/consumo?pr=acme%2Fapi%2342');
  // a grafia mais antiga ainda (sem barra, nome interno da seção)
  assert.equal(escreverRota(lerRota(enderecoDaPagina({ pathname: '/', hash: '#sistema/accounts' }).endereco)), '/sistema/contas');
  // fora da raiz, ou com consulta, o hash é pedaço do endereço, nunca a rota
  assert.deepEqual(enderecoDaPagina({ pathname: '/consumo', search: '?pr=acme/api', hash: '#42' }), { endereco: '/consumo?pr=acme/api', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '?pr=acme/api', hash: '#42' }), { endereco: '?pr=acme/api', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '', hash: '#' }), { endereco: '', antigo: false });
  assert.deepEqual(enderecoDaPagina({ pathname: '/', search: '', hash: '#/' }), { endereco: '', antigo: false });
});

test('o caminho que escreverRota gera nunca leva hash', () => {
  for (const c of [{ aba: 'radar', pr: 'acme/api#42' }, { aba: 'sistema', secao: 'diag' }, { aba: 'time', conta: 'bob' }]) {
    const e = escreverRota(c);
    assert.ok(e.startsWith('/'), e);
    assert.ok(!e.includes('#'), e);
  }
});
