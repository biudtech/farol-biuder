import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Relatorio } from '@/contratos/consumo';
import {
  ANO_MINIMO, CONSULTA_VAZIA, PERIODOS, TETO_DA_BUSCA, caminhoDoRelatorio, comPeriodo, dataAceita, dicaDoPeriodo, ehRecusaDeCampo, enderecoDa, lerEndereco, marcaDoConsumo, mensagemDaFalha, periodoPronto, temFiltro,
  temPeriodo,
  textoDoDiarioVazio, textoDoPeriodo, textoDoResultado, textoDoVazio, type Consulta,
} from './consulta';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const fonte = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const de = (query: string): Consulta => lerEndereco(new URLSearchParams(query));
const cheia: Consulta = { inicio: '2026-11-01', fim: '2026-11-16', tipo: 'review', modelo: 'Sonnet 5', repo: 'dono/repo', q: 'repo#12', pagina: 3 };

describe('a consulta no endereço', () => {
  it('endereço vazio é a consulta padrão', () => {
    expect(de('')).toEqual(CONSULTA_VAZIA);
    expect(enderecoDa(CONSULTA_VAZIA)).toBe('');
  });

  it('vai e volta sem perder nada', () => {
    const query = enderecoDa(cheia);
    expect(query).toBe('inicio=2026-11-01&fim=2026-11-16&tipo=review&modelo=Sonnet+5&repo=dono%2Frepo&q=repo%2312&pagina=3');
    expect(de(query)).toEqual(cheia);
  });

  it('só a página é saneada aqui; o resto segue como veio para o motor responder', () => {
    for (const torta of ['0', '-1', '1.5', 'x', '', '01', '1e3', '12345678901']) expect(de(`pagina=${torta}`).pagina, torta).toBe(1);
    expect(de('pagina=12').pagina).toBe(12);
    expect(de('inicio=ontem&tipo=tipo_novo&fim=31/12')).toMatchObject({ inicio: 'ontem', tipo: 'tipo_novo', fim: '31/12' });
  });

  it('filtro e período são coisas diferentes', () => {
    expect(temFiltro(CONSULTA_VAZIA)).toBe(false);
    expect(temFiltro({ ...CONSULTA_VAZIA, inicio: '2026-11-01', pagina: 2 })).toBe(false);
    for (const campo of ['tipo', 'modelo', 'repo', 'q'] as const) expect(temFiltro({ ...CONSULTA_VAZIA, [campo]: 'x' }), campo).toBe(true);
    expect(temPeriodo(CONSULTA_VAZIA)).toBe(false);
    expect(temPeriodo({ ...CONSULTA_VAZIA, fim: '2026-11-01' })).toBe(true);
  });
});

describe('o pedido ao motor', () => {
  it('sem nada escolhido, a rota sem parâmetro: o período padrão é do motor', () => {
    expect(caminhoDoRelatorio(CONSULTA_VAZIA)).toBe('/api/usage');
  });

  it('usa os nomes da rota, e a página do motor começa em zero', () => {
    expect(caminhoDoRelatorio(cheia)).toBe('/api/usage?start=2026-11-01&end=2026-11-16&kind=review&model=Sonnet+5&repo=dono%2Frepo&search=repo%2312&page=2');
    expect(caminhoDoRelatorio({ ...CONSULTA_VAZIA, pagina: 2 })).toBe('/api/usage?page=1');
  });

  it('os parâmetros são os que o motor lê', () => {
    const diario = fonte('lib/usage/activity.js');
    const relatorio = fonte('lib/usage/report.js');
    expect(diario).toContain('const end = query.end ?? activityDay(now);');
    expect(diario).toContain('const start = query.start ?? activityDay(now - 29 * TEMPOS.DIA_MS);');
    expect(diario).toContain("const fields = ['account', 'provider', 'model', 'kind', 'device'];");
    expect(diario).toContain("return !query.repo || query.repo === 'all' || row.ref.split('#')[0] === query.repo;");
    expect(relatorio).toContain(`const search = String(query.search || '').toLocaleLowerCase().slice(0, ${TETO_DA_BUSCA});`);
    // 8 por página, a partir de zero, e página além do fim volta como a última
    expect(relatorio).toContain('const page = Math.min(Math.max(0, Math.floor(Number(query.page) || 0)), pages - 1);');
    expect(relatorio).toContain('rows: rows.slice(page * 8, page * 8 + 8)');
  });

  it('o dia do diário vira à meia-noite de Brasília', () => {
    expect(fonte('lib/constants.js')).toContain("const FUSO_DO_DIA = 'America/Sao_Paulo';");
    expect(fonte('lib/usage/activity.js')).toContain("new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_DIA,");
  });
});

describe('os períodos prontos', () => {
  it('saem do fim que o motor disse, não do relógio, e gravam as duas datas', () => {
    expect(comPeriodo({ ...CONSULTA_VAZIA, tipo: 'review', pagina: 4 }, '2026-11-16', 7)).toEqual({ ...CONSULTA_VAZIA, tipo: 'review', inicio: '2026-11-10', fim: '2026-11-16', pagina: 1 });
    expect(comPeriodo(CONSULTA_VAZIA, '2026-11-16', 90)).toMatchObject({ inicio: '2026-08-19', fim: '2026-11-16' });
    // o fim é o do relatório na tela, não o que estava no endereço
    expect(comPeriodo({ ...CONSULTA_VAZIA, fim: '2026-11-20' }, '2026-10-31', 30)).toMatchObject({ inicio: '2026-10-02', fim: '2026-10-31' });
    // e o pedido leva as duas: o período não cresce no dia seguinte
    expect(caminhoDoRelatorio(comPeriodo(CONSULTA_VAZIA, '2026-11-16', 7))).toBe('/api/usage?start=2026-11-10&end=2026-11-16');
  });

  it('fim que não é dia não muda a consulta', () => {
    expect(comPeriodo(cheia, 'x', 7)).toBe(cheia);
  });

  it('o período pronto só fica marcado quando as duas datas do endereço são as do relatório', () => {
    expect(PERIODOS).toEqual([7, 30, 90]);
    const sete = { start: '2026-11-10', end: '2026-11-16' };
    expect(periodoPronto({ inicio: '2026-11-10', fim: '2026-11-16' }, sete)).toBe(7);
    expect(periodoPronto({ inicio: '2026-10-18', fim: '2026-11-16' }, { start: '2026-10-18', end: '2026-11-16' })).toBe(30);
    // as duas batem, mas não é um período pronto
    expect(periodoPronto({ inicio: '2026-11-11', fim: '2026-11-16' }, { start: '2026-11-11', end: '2026-11-16' })).toBeNull();
  });

  it('só o início no endereço: no dia seguinte são 8 dias, e nenhum atalho fica marcado', () => {
    const hoje = { start: '2026-11-10', end: '2026-11-16' };
    const amanha = { start: '2026-11-10', end: '2026-11-17' };
    expect(periodoPronto({ inicio: '2026-11-10', fim: '' }, hoje)).toBeNull();
    expect(periodoPronto({ inicio: '2026-11-10', fim: '' }, amanha)).toBeNull();
    expect(textoDoPeriodo(amanha)).toBe('10/11/2026 a 17/11/2026 (8 dias)');
  });

  it('fim do endereço diferente do fim do relatório não marca atalho', () => {
    expect(periodoPronto({ inicio: '2026-11-10', fim: '2026-11-17' }, { start: '2026-11-10', end: '2026-11-16' })).toBeNull();
    expect(periodoPronto({ inicio: '', fim: '2026-11-16' }, { start: '2026-10-18', end: '2026-11-16' })).toBeNull();
  });

  it('sem data nenhuma o período é o padrão do motor, que são sempre 30 dias', () => {
    expect(periodoPronto({ inicio: '', fim: '' }, { start: '2026-10-18', end: '2026-11-16' })).toBe(30);
    expect(periodoPronto({ inicio: '', fim: '' }, { start: '2026-10-19', end: '2026-11-17' })).toBe(30);
  });
});

describe('as datas do campo', () => {
  it('só dia que existe, de 1970 em diante, vira pedido', () => {
    expect(ANO_MINIMO).toBe(1970);
    for (const boa of ['1970-01-01', '2026-11-16', '2028-02-29', '9999-12-31']) expect(dataAceita(boa), boa).toBe(true);
    // o que o campo entrega enquanto se digita o ano, e o que não é dia
    for (const ruim of ['', '0002-11-16', '0020-11-16', '0202-11-16', '0000-01-01', '0099-12-31', '1969-12-31', '2026-02-30', '2026-13-01', '16/11/2026', 'hoje', '2026-11-16T00:00']) {
      expect(dataAceita(ruim), ruim).toBe(false);
    }
  });

  it('a dica diz o que o período quer dizer com nenhuma, uma ou as duas datas', () => {
    const range = { start: '2026-11-10', end: '2026-11-17' };
    expect(dicaDoPeriodo({ inicio: '', fim: '' }, null)).toBe('Sem datas, o motor mostra os 30 dias que terminam no hoje dele.');
    expect(dicaDoPeriodo({ inicio: '2026-11-10', fim: '' }, range)).toBe('Só com "De", o período vai dessa data até o hoje do motor e cresce a cada dia. Agora ele termina em 17/11/2026.');
    expect(dicaDoPeriodo({ inicio: '2026-11-10', fim: '' }, null)).toBe('Só com "De", o período vai dessa data até o hoje do motor e cresce a cada dia.');
    expect(dicaDoPeriodo({ inicio: '', fim: '2026-01-31' }, null)).toBe('Só com "Até", o motor começa 30 dias antes do hoje dele, não desta data. Se a data for mais antiga que isso, ele não entrega o relatório: preencha também "De".');
    expect(dicaDoPeriodo({ inicio: '2026-11-10', fim: '2026-11-16' }, range)).toBe('Período fixo nas duas datas: não acompanha o dia de hoje.');
  });
});

describe('as frases', () => {
  const base: Relatorio = {
    range: { start: '2026-10-18', end: '2026-11-16' }, totals: { attempts: 4, costUsd: 3.75 }, series: [], byKind: [], models: [],
    history: { total: 9, page: 1, pages: 2, rows: [], descartados: 0 }, options: { kind: [], model: [], repo: [] }, descartados: 0,
  };

  it('o período com as duas pontas e a contagem de dias', () => {
    expect(textoDoPeriodo(base.range)).toBe('18/10/2026 a 16/11/2026 (30 dias)');
    expect(textoDoPeriodo({ start: '2026-11-16', end: '2026-11-16' })).toBe('16/11/2026 (1 dia)');
  });

  it('o anúncio diz o período, as execuções, o custo estimado e a página do diário', () => {
    expect(textoDoResultado(base)).toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): 4 execuções de IA, custo estimado de US$ 3,75. Diário: 9 operações, página 2 de 2.');
    expect(textoDoResultado({ ...base, totals: { attempts: 1, costUsd: 0 }, history: { ...base.history, total: 1, page: 0, pages: 1 } }))
      .toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): 1 execução de IA, custo estimado de US$ 0,00. Diário: 1 operação, página 1 de 1.');
    expect(textoDoResultado({ ...base, history: { ...base.history, total: 0, page: 0, pages: 1 } })).toMatch(/Diário: nenhuma operação\.$/);
  });

  it('sem execução, o anúncio diz isso', () => {
    expect(textoDoResultado({ ...base, totals: { attempts: 0 } })).toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): nenhuma execução de IA.');
    // contagem que não veio não vira "nenhuma"
    expect(textoDoResultado({ ...base, totals: {} })).toBe('Período de 18/10/2026 a 16/11/2026 (30 dias): o motor não disse quantas execuções de IA, custo não informado. Diário: 9 operações, página 2 de 2.');
  });

  it('vazio com e sem filtro dizem coisas diferentes', () => {
    expect(textoDoVazio(CONSULTA_VAZIA)).toBe('Nenhuma execução de IA neste período.');
    expect(textoDoVazio({ ...CONSULTA_VAZIA, repo: 'dono/repo' })).toBe('Nenhuma execução de IA neste período com os filtros escolhidos.');
    // a busca não recorta as somas
    expect(textoDoVazio({ ...CONSULTA_VAZIA, q: 'x' })).toBe('Nenhuma execução de IA neste período.');
    expect(textoDoDiarioVazio(CONSULTA_VAZIA)).toBe('Nenhuma operação neste período.');
    expect(textoDoDiarioVazio({ ...CONSULTA_VAZIA, q: 'x' })).toBe('Nenhuma operação passa pela busca e pelos filtros escolhidos neste período.');
  });

  it('a marca do consumo é a contagem do agregado', () => {
    expect(marcaDoConsumo(undefined)).toBeNull();
    expect(marcaDoConsumo(0)).toBe('0');
    expect(marcaDoConsumo(42)).toBe('42');
  });
});

describe('a leitura que falhou', () => {
  it('cada falha tem a sua frase, e o cancelamento não tem nenhuma', () => {
    expect(mensagemDaFalha({ ok: false, falha: 'cancelado', status: 0 })).toBe('');
    expect(mensagemDaFalha({ ok: false, falha: 'rede', status: 0 })).toBe('Não deu para falar com o motor (falha de rede).');
    expect(mensagemDaFalha({ ok: false, falha: 'nao_autenticado', status: 401 })).toBe('A sessão deste navegador não vale mais no motor. Pareie de novo.');
    expect(mensagemDaFalha({ ok: false, falha: 'resposta_invalida', status: 200 })).toBe('O motor respondeu fora do formato esperado.');
    expect(mensagemDaFalha({ ok: false, falha: 'recusado', status: 500 })).toBe('O motor recusou o pedido (HTTP 500).');
    expect(mensagemDaFalha({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido' } })).toBe('O motor recusou o pedido (HTTP 400, parametro_invalido).');
  });

  it('a recusa com campo diz qual, com o nome que a tela usa', () => {
    const recusa = (campo: string) => ({ ok: false, falha: 'recusado', status: 400, detalhe: { codigo: 'parametro_invalido', campo } }) as const;
    expect(mensagemDaFalha(recusa('start'))).toBe('O motor recusou o início do período (campo "start").');
    expect(mensagemDaFalha(recusa('search'))).toBe('O motor recusou a busca do diário (campo "search").');
    expect(mensagemDaFalha(recusa('novo'))).toBe('O motor recusou o campo "novo".');
    expect(mensagemDaFalha(recusa('constructor'))).toBe('O motor recusou o campo "constructor".');
    expect(ehRecusaDeCampo(recusa('end'))).toBe(true);
    expect(ehRecusaDeCampo({ ok: false, falha: 'recusado', status: 500 })).toBe(false);
    expect(ehRecusaDeCampo({ ok: false, falha: 'rede', status: 0 })).toBe(false);
  });
});
