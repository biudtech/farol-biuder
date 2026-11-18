import { describe, expect, it } from 'vitest';
import {
  ehHistoricoIndisponivel,
  CONSULTA_VAZIA, caminhoDaPagina, caminhoDoCsv, caminhoDoDetalhe, nomeDoCsv, textoDosRecentes, enderecoDa, lerEndereco, marcaDasResolvidas, mensagemDaFalha, temFiltro,
  desdeDoPeriodo, textoDaDuracao, textoDoResultado, textoDoVazio,
} from './consulta';

const ler = (query: string) => lerEndereco(new URLSearchParams(query));

describe('consulta do Histórico no endereço', () => {
  it('endereço sem nada é a primeira página, sem filtro e sem detalhe', () => {
    expect(ler('')).toEqual({ consulta: CONSULTA_VAZIA, detalhe: null });
    expect(CONSULTA_VAZIA).toEqual({ pagina: 1, q: '', veredito: '', repo: '', periodo: '' });
  });

  it('lê busca, desfecho, repositório, página e a revisão aberta', () => {
    expect(ler('q=proj-9+ana&veredito=skip&repo=dono%2Frepo&pagina=3&id=d77&pr=dono%2Frepo%2312')).toEqual({
      consulta: { pagina: 3, q: 'proj-9 ana', veredito: 'skip', repo: 'dono/repo', periodo: '' },
      detalhe: { id: 'd77', chave: 'dono/repo#12' },
    });
  });

  it('página que não é inteiro a partir de 1 vale como a primeira', () => {
    for (const torta of ['0', '-2', 'abc', '1.5', '1e3', ' 2', '9999999999', '']) expect(ler(`pagina=${encodeURIComponent(torta)}`).consulta.pagina).toBe(1);
    expect(ler('pagina=999999999').consulta.pagina).toBe(999999999);
  });

  it('filtro que a tela não conhece segue como veio: quem recusa é o motor', () => {
    expect(ler('veredito=xyz').consulta.veredito).toBe('xyz');
  });

  it('detalhe precisa do id; a chave do PR é opcional', () => {
    expect(ler('id=d1').detalhe).toEqual({ id: 'd1', chave: '' });
    expect(ler('pr=dono%2Frepo%231').detalhe).toBeNull();
  });

  it('escreve o endereço só com o que não é padrão, e ler o que escreveu devolve o mesmo', () => {
    expect(enderecoDa(CONSULTA_VAZIA, null)).toBe('');
    const consulta = { pagina: 2, q: 'ana & cia', veredito: 'approve', repo: 'dono/repo', periodo: '30' };
    const detalhe = { id: 'd1', chave: 'dono/repo#12' };
    const escrito = enderecoDa(consulta, detalhe);
    expect(escrito).toBe('q=ana+%26+cia&veredito=approve&repo=dono%2Frepo&periodo=30&pagina=2&id=d1&pr=dono%2Frepo%2312');
    expect(ler(escrito)).toEqual({ consulta, detalhe });
    expect(enderecoDa({ ...CONSULTA_VAZIA, pagina: 4 }, null)).toBe('pagina=4');
  });

  it('temFiltro diz se há busca ou filtro, sem contar a página', () => {
    expect(temFiltro(CONSULTA_VAZIA)).toBe(false);
    expect(temFiltro({ ...CONSULTA_VAZIA, pagina: 3 })).toBe(false);
    expect(temFiltro({ ...CONSULTA_VAZIA, q: 'a' })).toBe(true);
    expect(temFiltro({ ...CONSULTA_VAZIA, veredito: 'skip' })).toBe(true);
    expect(temFiltro({ ...CONSULTA_VAZIA, repo: 'a/b' })).toBe(true);
    expect(temFiltro({ ...CONSULTA_VAZIA, periodo: '7' })).toBe(true);
  });

  it('período que a tela não oferece é ignorado no endereço', () => {
    expect(ler('periodo=7').consulta.periodo).toBe('7');
    expect(ler('periodo=30').consulta.periodo).toBe('30');
    for (const torto of ['15', 'abc', '', '07']) expect(ler(`periodo=${torto}`).consulta.periodo).toBe('');
  });
});

describe('pedido ao motor', () => {
  it('a página pede só o que foi preenchido, com os nomes da rota', () => {
    expect(caminhoDaPagina(CONSULTA_VAZIA)).toBe('/api/decisions?page=1');
    expect(caminhoDaPagina({ pagina: 3, q: 'proj-9 ana', veredito: 'skip', repo: 'dono/repo', periodo: '' }))
      .toBe('/api/decisions?page=3&q=proj-9+ana&veredito=skip&repo=dono%2Frepo');
  });

  it('o CSV leva a mesma busca e os mesmos filtros, sem página, com o formato', () => {
    const agora = Date.parse('2026-11-17T15:00:00Z');
    expect(caminhoDoCsv(CONSULTA_VAZIA, agora)).toBe('/api/decisions?formato=csv');
    expect(caminhoDoCsv({ pagina: 3, q: 'proj-9', veredito: 'approve', repo: 'dono/repo', periodo: '7' }, agora))
      .toBe('/api/decisions?formato=csv&q=proj-9&veredito=approve&repo=dono%2Frepo&desde=2026-11-11');
    expect(nomeDoCsv(Date.parse('2026-11-17T01:30:00Z'))).toBe('farol-historico-2026-11-16.csv');
  });

  it('a contagem dos últimos 7 dias, com o singular', () => {
    expect(textoDosRecentes(146)).toBe('146 revisões nos últimos 7 dias');
    expect(textoDosRecentes(1)).toBe('1 revisão nos últimos 7 dias');
    expect(textoDosRecentes(0)).toBe('0 revisões nos últimos 7 dias');
  });

  it('o período vira o primeiro dia (desde), contado com hoje, no fuso do motor', () => {
    // 17/11/2026 01:30 em UTC ainda é 16/11 em São Paulo
    const agora = Date.parse('2026-11-17T01:30:00Z');
    expect(desdeDoPeriodo('7', agora)).toBe('2026-11-10');
    expect(desdeDoPeriodo('30', agora)).toBe('2026-10-18');
    expect(desdeDoPeriodo('7', Date.parse('2026-11-17T03:00:00Z'))).toBe('2026-11-11');
    expect(desdeDoPeriodo('', agora)).toBe('');
    expect(desdeDoPeriodo('15', agora)).toBe('');
    expect(caminhoDaPagina({ ...CONSULTA_VAZIA, periodo: '7' }, agora)).toBe('/api/decisions?page=1&desde=2026-11-10');
  });

  it('o detalhe pede pela chave do PR', () => {
    expect(caminhoDoDetalhe('dono/repo#12')).toBe('/api/decision?key=dono%2Frepo%2312');
  });
});

describe('textos do Histórico', () => {
  it('o resultado diz quantas revisões e em que página', () => {
    expect(textoDoResultado({ total: 61, page: 2, pages: 3 })).toBe('61 revisões, página 2 de 3');
    expect(textoDoResultado({ total: 1, page: 1, pages: 1 })).toBe('1 revisão, página 1 de 1');
    expect(textoDoResultado({ total: 0, page: 1, pages: 0 })).toBe('Nenhuma revisão');
  });

  it('o vazio com filtro e o vazio sem filtro dizem coisas diferentes', () => {
    expect(textoDoVazio(CONSULTA_VAZIA)).toBe('O motor ainda não resolveu nenhuma revisão.');
    expect(textoDoVazio({ ...CONSULTA_VAZIA, q: 'x' })).toBe('Nenhuma revisão passa pela busca e pelos filtros escolhidos.');
  });

  it('o 400 do motor diz qual campo foi recusado', () => {
    const recusa = (campo?: string) => mensagemDaFalha({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo } });
    expect(recusa('veredito')).toBe('O motor recusou o filtro de desfecho (campo "veredito").');
    expect(recusa('q')).toBe('O motor recusou a busca (campo "q").');
    expect(recusa('repo')).toBe('O motor recusou o filtro de repositório (campo "repo").');
    expect(recusa('page')).toBe('O motor recusou a página pedida (campo "page").');
    expect(recusa('pageSize')).toBe('O motor recusou o tamanho da página (campo "pageSize").');
    expect(recusa('outro')).toBe('O motor recusou o campo "outro".');
    expect(recusa(undefined)).toBe('O motor recusou um parâmetro do pedido e não disse qual.');
  });

  it('as outras falhas têm frase própria, e o cancelamento não tem frase', () => {
    expect(mensagemDaFalha({ ok: false, falha: 'rede', status: 0 })).toBe('Não deu para falar com o motor (falha de rede).');
    expect(mensagemDaFalha({ ok: false, falha: 'recusado', status: 500 })).toBe('O motor recusou o pedido (HTTP 500).');
    expect(mensagemDaFalha({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'outro_codigo' } })).toBe('O motor recusou o pedido (HTTP 400, outro_codigo).');
    expect(mensagemDaFalha({ ok: false, falha: 'resposta_invalida', status: 200 })).toBe('O motor respondeu fora do formato esperado.');
    expect(mensagemDaFalha({ ok: false, falha: 'nao_autenticado', status: 401 })).toBe('A sessão deste navegador não vale mais no motor. Pareie de novo.');
    expect(mensagemDaFalha({ ok: false, falha: 'cancelado', status: 0 })).toBe('');
  });

  it('duração de etapa em segundos ou em minutos e segundos', () => {
    expect(textoDaDuracao(900)).toBe('menos de 1 s');
    expect(textoDaDuracao(4000)).toBe('4 s');
    expect(textoDaDuracao(125_000)).toBe('2 min 5 s');
    expect(textoDaDuracao(120_000)).toBe('2 min');
    expect(textoDaDuracao(-1)).toBe('');
  });
});

describe('marca das resolvidas do snapshot', () => {
  it('é o id e a hora da revisão resolvida mais recente', () => {
    expect(marcaDasResolvidas([{ id: 'd2', resolvedAt: 20 }, { id: 'd1', resolvedAt: 10 }])).toBe('d2@20');
  });

  it('muda quando entra revisão nova no topo, e não muda com a mesma lista relida', () => {
    const antes = [{ id: 'd1', resolvedAt: 10 }];
    expect(marcaDasResolvidas([...antes])).toBe(marcaDasResolvidas(antes));
    expect(marcaDasResolvidas([{ id: 'd2', resolvedAt: 20 }, ...antes])).not.toBe(marcaDasResolvidas(antes));
  });

  it('lista vazia tem marca própria, e chave ausente não tem marca', () => {
    expect(marcaDasResolvidas([])).toBe('vazio');
    expect(marcaDasResolvidas(undefined)).toBeNull();
  });

  it('topo torto não quebra: a marca sai do que der para ler', () => {
    expect(marcaDasResolvidas([null])).toBe('@');
    expect(marcaDasResolvidas([{ id: 7, resolvedAt: 'x' }])).toBe('@');
    expect(marcaDasResolvidas([{ id: 'd1' }])).toBe('d1@');
  });
});

describe('histórico indisponível', () => {
  it('o 503 do motor é indisponível; recusa de parâmetro e falha de rede não', () => {
    expect(ehHistoricoIndisponivel({ ok: false, falha: 'recusado', status: 503, detalhe: { codigo: 'historico_indisponivel' } })).toBe(true);
    expect(ehHistoricoIndisponivel({ ok: false, falha: 'recusado', status: 503 })).toBe(true);
    expect(ehHistoricoIndisponivel({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo: 'q' } })).toBe(false);
    expect(ehHistoricoIndisponivel({ ok: false, falha: 'rede', status: 0 })).toBe(false);
  });
});
