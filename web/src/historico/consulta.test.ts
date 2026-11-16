import { describe, expect, it } from 'vitest';
import {
  CONSULTA_VAZIA, caminhoDaPagina, caminhoDoDetalhe, enderecoDa, lerEndereco, marcaDasResolvidas, mensagemDaFalha, temFiltro,
  textoDaDuracao, textoDoResultado, textoDoVazio,
} from './consulta';

const ler = (query: string) => lerEndereco(new URLSearchParams(query));

describe('consulta do Histórico no endereço', () => {
  it('endereço sem nada é a primeira página, sem filtro e sem detalhe', () => {
    expect(ler('')).toEqual({ consulta: CONSULTA_VAZIA, detalhe: null });
    expect(CONSULTA_VAZIA).toEqual({ pagina: 1, q: '', veredito: '', repo: '' });
  });

  it('lê busca, desfecho, repositório, página e a revisão aberta', () => {
    expect(ler('q=proj-9+ana&veredito=skip&repo=dono%2Frepo&pagina=3&id=d77&pr=dono%2Frepo%2312')).toEqual({
      consulta: { pagina: 3, q: 'proj-9 ana', veredito: 'skip', repo: 'dono/repo' },
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
    const consulta = { pagina: 2, q: 'ana & cia', veredito: 'approve', repo: 'dono/repo' };
    const detalhe = { id: 'd1', chave: 'dono/repo#12' };
    const escrito = enderecoDa(consulta, detalhe);
    expect(escrito).toBe('q=ana+%26+cia&veredito=approve&repo=dono%2Frepo&pagina=2&id=d1&pr=dono%2Frepo%2312');
    expect(ler(escrito)).toEqual({ consulta, detalhe });
    expect(enderecoDa({ ...CONSULTA_VAZIA, pagina: 4 }, null)).toBe('pagina=4');
  });

  it('temFiltro diz se há busca ou filtro, sem contar a página', () => {
    expect(temFiltro(CONSULTA_VAZIA)).toBe(false);
    expect(temFiltro({ ...CONSULTA_VAZIA, pagina: 3 })).toBe(false);
    expect(temFiltro({ ...CONSULTA_VAZIA, q: 'a' })).toBe(true);
    expect(temFiltro({ ...CONSULTA_VAZIA, veredito: 'skip' })).toBe(true);
    expect(temFiltro({ ...CONSULTA_VAZIA, repo: 'a/b' })).toBe(true);
  });
});

describe('pedido ao motor', () => {
  it('a página pede só o que foi preenchido, com os nomes da rota', () => {
    expect(caminhoDaPagina(CONSULTA_VAZIA)).toBe('/api/decisions?page=1');
    expect(caminhoDaPagina({ pagina: 3, q: 'proj-9 ana', veredito: 'skip', repo: 'dono/repo' }))
      .toBe('/api/decisions?page=3&q=proj-9+ana&veredito=skip&repo=dono%2Frepo');
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
