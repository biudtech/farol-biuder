import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Relatorio } from '@/contratos/consumo';
import {
  ANO_MINIMO, CONSULTA_VAZIA, PERIODOS, TETO_DA_BUSCA, caminhoDoCsv, caminhoDoPeriodo, caminhoDoRelatorio, comDia, comPeriodo, dataAceita, dicaDoPeriodo, ehRecusaDeCampo, enderecoDa, filtrosAtivos, lerEndereco, marcaDoConsumo, mensagemDaFalha, nomeDoCsv, periodoPronto, temFiltro,
  temPeriodo,
  textoDoDiarioVazio, textoDoPeriodo, textoDoResultado, textoDoVazio, type Consulta,
} from './consulta';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const fonte = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
const de = (query: string): Consulta => lerEndereco(new URLSearchParams(query));
const cheia: Consulta = { ...CONSULTA_VAZIA, inicio: '2026-11-01', fim: '2026-11-16', tipo: 'review', modelo: 'Sonnet 5', repo: 'dono/repo', q: 'repo#12', pagina: 3 };
// com os filtros do redesenho (lote 5): o dia clicado no gráfico, o autor e o perfil
const nova: Consulta = { ...cheia, dia: '2026-11-14', autor: 'Ana', perfil: 'perfil-a' };

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

  it('o dia, o autor e o perfil também moram no endereço', () => {
    const query = enderecoDa(nova);
    expect(query).toBe('inicio=2026-11-01&fim=2026-11-16&dia=2026-11-14&tipo=review&modelo=Sonnet+5&repo=dono%2Frepo&autor=Ana&perfil=perfil-a&q=repo%2312&pagina=3');
    expect(de(query)).toEqual(nova);
  });

  it('filtro e período são coisas diferentes', () => {
    expect(temFiltro(CONSULTA_VAZIA)).toBe(false);
    expect(temFiltro({ ...CONSULTA_VAZIA, inicio: '2026-11-01', pagina: 2 })).toBe(false);
    for (const campo of ['tipo', 'modelo', 'repo', 'autor', 'perfil', 'dia', 'q'] as const) expect(temFiltro({ ...CONSULTA_VAZIA, [campo]: 'x' }), campo).toBe(true);
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

  it('autor e perfil vão como author e profile; o dia clicado vira o período de um dia só', () => {
    expect(caminhoDoRelatorio(nova)).toBe('/api/usage?start=2026-11-14&end=2026-11-14&kind=review&model=Sonnet+5&repo=dono%2Frepo&author=Ana&profile=perfil-a&search=repo%2312&page=2');
    // o gráfico continua mostrando o período inteiro, com os mesmos filtros, sem a busca nem a página
    expect(caminhoDoPeriodo(nova)).toBe('/api/usage?start=2026-11-01&end=2026-11-16&kind=review&model=Sonnet+5&repo=dono%2Frepo&author=Ana&profile=perfil-a');
    // sem dia não há segundo pedido
    expect(caminhoDoPeriodo(cheia)).toBeNull();
  });

  it('o CSV leva o mesmo recorte em formato=csv, sem a página', () => {
    expect(caminhoDoCsv(CONSULTA_VAZIA)).toBe('/api/usage?formato=csv');
    expect(caminhoDoCsv(nova)).toBe('/api/usage?formato=csv&start=2026-11-14&end=2026-11-14&kind=review&model=Sonnet+5&repo=dono%2Frepo&author=Ana&profile=perfil-a&search=repo%2312');
    // o mesmo nome que o motor dá, com o dia de Brasília
    expect(nomeDoCsv(Date.UTC(2026, 10, 20, 2, 30))).toBe('farol-consumo-2026-11-19.csv');
    expect(fonte('lib/engine/consumo-das-sessoes.js')).toContain('function nomeDoCsv(agora = Date.now()) { return `farol-consumo-${quando(agora).slice(0, 10)}.csv`; }');
  });

  it('autor, perfil e formato são parâmetros que o motor lê', () => {
    const diario = fonte('lib/usage/activity.js');
    expect(diario).toContain("const author = String(query.author || '').trim().toLowerCase();");
    expect(diario).toContain("const FILTER_FIELDS = ['account', 'provider', 'model', 'kind', 'device', 'profile'];");
    expect(fonte('lib/engine/usage-activity.js')).toContain("if (formatos[0] !== 'csv') return { status: 200, body: await usageActivity(engine, params) };");
  });

  it('os parâmetros são os que o motor lê', () => {
    const diario = fonte('lib/usage/activity.js');
    const relatorio = fonte('lib/usage/report.js');
    expect(diario).toContain('const end = query.end ?? activityDay(now);');
    expect(diario).toContain('const start = query.start ?? activityDay(now - 29 * TEMPOS.DIA_MS);');
    // os filtros por igualdade: os nomes que a tela manda (kind, model) estão entre eles
    expect(diario).toContain("const FILTER_FIELDS = ['account', 'provider', 'model', 'kind', 'device', 'profile'];");
    expect(diario).toContain("if (FILTER_FIELDS.some(field => query[field] && query[field] !== 'all' && row[field] !== query[field])) return false;");
    expect(diario).toContain("return !query.repo || query.repo === 'all' || row.ref.split('#')[0] === query.repo;");
    expect(relatorio).toContain(`const search = String(query.search || '').toLocaleLowerCase().slice(0, ${TETO_DA_BUSCA});`);
    // a partir de zero, e página além do fim volta como a última
    expect(relatorio).toContain('const page = Math.min(Math.max(0, Math.floor(Number(query.page) || 0)), pages - 1);');
    expect(relatorio).toContain('rows: rows.slice(page * size, page * size + size)');
    // a tela não manda pageSize: vale o padrão do motor, 8 por página
    expect(relatorio).toContain('const PAGE_SIZE = 8;');
    expect(caminhoDoRelatorio(cheia)).not.toContain('pageSize');
  });

  it('sem pageSize, o motor devolve 8 operações por página', async () => {
    type Relatar = (fontes: unknown[], consulta: Record<string, string>, agora: number) => { history: { rows: unknown[]; pages: number; pageSize: number } };
    const { activityReport } = await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ, 'lib/usage/report.js')).href) as { activityReport: Relatar };
    const agora = Date.UTC(2026, 10, 16, 18, 0);
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `a-00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, at: agora - (i + 1) * 60_000, kind: 'review', status: 'ok', ref: `dono/repo#${i + 1}`, account: 'rev', model: 'Sonnet 5', costUsd: 1, costSource: 'medido' }));
    const historico = activityReport([{ device: 'local', rows }], {}, agora).history;
    expect([historico.rows.length, historico.pages, historico.pageSize]).toEqual([8, 2, 8]);
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
    // 1 é o Hoje: o último dia do relatório
    expect(PERIODOS).toEqual([1, 7, 30, 90]);
    expect(periodoPronto({ inicio: '2026-11-16', fim: '2026-11-16' }, { start: '2026-11-16', end: '2026-11-16' })).toBe(1);
    expect(comPeriodo(CONSULTA_VAZIA, '2026-11-16', 1)).toMatchObject({ inicio: '2026-11-16', fim: '2026-11-16' });
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

describe('o clique que vira filtro e as pílulas', () => {
  it('o dia clicado entra, volta à primeira página, e o mesmo dia de novo sai', () => {
    const com = comDia({ ...CONSULTA_VAZIA, pagina: 3 }, '2026-11-14');
    expect(com).toEqual({ ...CONSULTA_VAZIA, dia: '2026-11-14' });
    expect(comDia(com, '2026-11-14')).toEqual(CONSULTA_VAZIA);
    expect(comDia(com, '2026-11-15').dia).toBe('2026-11-15');
  });

  it('uma pílula por filtro ativo, cada uma com a consulta sem ela', () => {
    const periodo = { start: '2026-11-01', end: '2026-11-16' };
    const perfil = (id: string) => (id === 'perfil-a' ? 'Assinatura A' : id);
    const ativos = filtrosAtivos(nova, periodo, perfil);
    expect(ativos.map((a) => a.texto)).toEqual([
      'Período: de 01/11/2026 até 16/11/2026', 'Dia: 14/11/2026', 'Tipo: Revisão', 'Repositório: dono/repo', 'Autor: Ana', 'Modelo: Sonnet 5', 'Perfil: Assinatura A', 'Busca: repo#12',
    ]);
    for (const ativo of ativos) expect(ativo.sem.pagina, ativo.chave).toBe(1);
    expect(ativos.find((a) => a.chave === 'dia')?.sem).toEqual({ ...nova, dia: '', pagina: 1 });
    expect(ativos.find((a) => a.chave === 'periodo')?.sem).toMatchObject({ inicio: '', fim: '', dia: '2026-11-14' });
    // o período pronto não vira pílula: ele está nos botões do topo
    expect(filtrosAtivos({ ...CONSULTA_VAZIA, inicio: '2026-11-10', fim: '2026-11-16' }, { start: '2026-11-10', end: '2026-11-16' })).toEqual([]);
    expect(filtrosAtivos(CONSULTA_VAZIA, null)).toEqual([]);
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
    history: { total: 9, page: 1, pages: 2, rows: [], descartados: 0 }, options: { kind: [], model: [], repo: [], author: [], profile: [] }, descartados: 0,
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
