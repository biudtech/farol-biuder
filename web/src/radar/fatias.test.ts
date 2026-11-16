import { describe, expect, it } from 'vitest';
import type { Pendencia } from '@/contratos/radar';
import { acoesDaPendencia, avisosDoMotor, chavesAusentes, fatiarFila, fatiarPendencias, textoDaChecagem, textoDaFilaVazia } from './fatias';

function pendencia(extra: Partial<Pendencia> = {}): Pendencia {
  return { id: 'd1', key: 'dono/repo#1', reportMarkdown: '', reasons: [], attention: [], ...extra };
}

const PROVA = { desde: 1, tentativas: 0, aguardandoCi: false, proximaEm: 0, impedimento: '' };
const INSTANTE = Date.UTC(2026, 10, 16, 14, 32, 5);

describe('pendências em dois blocos', () => {
  it('a que espera o CI, ou a prova que o motor retoma sozinho, sai de Precisa de você', () => {
    const comum = pendencia({ id: 'a' });
    const ci = pendencia({ id: 'b', esperaCi: { desde: 1, checks: [] } });
    const prova = pendencia({ id: 'c', esperaProva: { ...PROVA, pedeVoce: false } });
    const pausada = pendencia({ id: 'd', esperaProva: { ...PROVA, pedeVoce: true } });
    const { precisam, esperando } = fatiarPendencias([comum, ci, prova, pausada]);
    expect(precisam.map((p) => p.id)).toEqual(['a', 'd']);
    expect(esperando.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('mantém a ordem do motor e não altera a lista', () => {
    const lista = [pendencia({ id: 'z' }), pendencia({ id: 'a' })];
    expect(fatiarPendencias(lista).precisam.map((p) => p.id)).toEqual(['z', 'a']);
    expect(lista).toHaveLength(2);
    expect(fatiarPendencias([])).toEqual({ precisam: [], esperando: [] });
  });
});

describe('os botões de uma pendência', () => {
  it('pendência comum oferece os quatro', () => {
    expect(acoesDaPendencia(pendencia())).toEqual({ aprovar: true, pedirMudancas: true, comentar: true, pular: true, revisar: false });
  });

  it('PR da própria conta não oferece Aprovar nem Pedir mudanças', () => {
    expect(acoesDaPendencia(pendencia({ prProprio: true }))).toEqual({ aprovar: false, pedirMudancas: false, comentar: true, pular: true, revisar: false });
  });

  it('commit novo depois da revisão só deixa revisar de novo ou pular', () => {
    const p = pendencia({ blockedKind: 'stale_head', pr: { url: 'https://github.com/dono/repo/pull/1' } });
    expect(acoesDaPendencia(p)).toEqual({ aprovar: false, pedirMudancas: false, comentar: false, pular: true, revisar: true });
  });

  it('sem URL confiável não há como pedir a revisão de novo', () => {
    expect(acoesDaPendencia(pendencia({ blockedKind: 'stale_head' })).revisar).toBe(false);
    expect(acoesDaPendencia(pendencia({ blockedKind: 'stale_head', pr: { url: 'http://outro/pull/1' } })).revisar).toBe(false);
  });

  it('outro tipo de bloqueio não esconde botão: o motivo aparece e quem recusa é o motor', () => {
    expect(acoesDaPendencia(pendencia({ blockedKind: 'technical_recheck', blockedReason: 'x' })).aprovar).toBe(true);
  });
});

describe('avisos do motor', () => {
  it('motor em ordem não avisa nada', () => {
    expect(avisosDoMotor({ status: 'idle', account: { user: 'rev', tokenOk: true }, error: null, buscasPausadas: [] })).toEqual([]);
    expect(avisosDoMotor({})).toEqual([]);
  });

  it('sem conta avisa uma vez só (não repete como sem token)', () => {
    const avisos = avisosDoMotor({ status: 'idle', account: { user: '', tokenOk: false } });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tom: 'erro' });
    expect(avisos[0]?.texto).toMatch(/sem conta do GitHub/);
  });

  it('conta sem token no gh avisa com o login', () => {
    const avisos = avisosDoMotor({ status: 'idle', account: { user: 'rev', tokenOk: false } });
    expect(avisos.map((a) => a.texto)).toEqual([expect.stringMatching(/A conta rev está sem token no gh/)]);
  });

  it('enquanto o motor inicia, conta e token ainda não viram aviso', () => {
    expect(avisosDoMotor({ status: 'starting', account: { user: '', tokenOk: false } })).toEqual([]);
  });

  it('checagem que falhou mostra a mensagem do motor; erro antigo com o ciclo em ordem não', () => {
    expect(avisosDoMotor({ status: 'error', error: 'gh: timeout' })[0]?.texto).toMatch(/A última checagem falhou: gh: timeout\./);
    expect(avisosDoMotor({ status: 'idle', error: 'gh: timeout' })).toEqual([]);
    expect(avisosDoMotor({ status: 'error', error: null })).toEqual([]);
  });

  it('buscas pausadas dizem a conta e até quando', () => {
    const avisos = avisosDoMotor({ status: 'idle', buscasPausadas: [{ conta: 'rev', ate: INSTANTE }] }, 'UTC');
    expect(avisos).toEqual([{ tom: 'info', texto: expect.stringContaining('rev até 16/11, 14:32') }]);
  });
});

describe('estado da checagem e fila vazia', () => {
  it('diz o que o motor está fazendo, ou quando checou e quando checa de novo', () => {
    expect(textoDaChecagem({ status: 'starting' })).toBe('O motor está iniciando.');
    expect(textoDaChecagem({ status: 'checking', lastCheckAt: INSTANTE })).toBe('Checando agora.');
    expect(textoDaChecagem({ status: 'idle', lastCheckAt: INSTANTE, nextCheckAt: INSTANTE + 180000 }, 'UTC')).toBe('Última checagem: 16/11, 14:32. Próxima: 16/11, 14:35.');
    expect(textoDaChecagem({ status: 'idle', lastCheckAt: null, nextCheckAt: null })).toBe('Nenhuma checagem terminou ainda.');
    expect(textoDaChecagem({})).toBe('Nenhuma checagem terminou ainda.');
  });

  it('fila vazia só é "nenhum PR" depois de uma checagem terminar', () => {
    expect(textoDaFilaVazia({ lastCheckAt: INSTANTE, status: 'idle' })).toBe('Nenhum PR na fila.');
    expect(textoDaFilaVazia({ lastCheckAt: null, status: 'checking' })).toMatch(/ainda não terminou/);
    expect(textoDaFilaVazia({ lastCheckAt: null, status: 'error' })).toMatch(/primeira checagem falhou/);
  });
});

describe('chaves de que os blocos dependem', () => {
  it('diz quais o estado não trouxe', () => {
    expect(chavesAusentes({ decisions: { pending: [], resolved: [], ilegiveis: 0 }, activeSessions: [], queue: [] })).toEqual([]);
    expect(chavesAusentes({ activeSessions: [] })).toEqual(['as pendências', 'a fila']);
  });
});

describe('fila sem PR repetido na tela', () => {
  const pr = (key: string) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

  it('PR com sessão em curso sai da fila e da espera', () => {
    const r = fatiarFila([pr('a/b#1'), pr('a/b#2')], [pr('a/b#1'), pr('a/b#3')], [{ id: 's1', keys: ['a/b#1'] }, { id: 's2', pr: { key: 'A/B#3' } }], []);
    expect(r.fila.map((p) => p.key)).toEqual(['a/b#2']);
    expect(r.emEspera).toEqual([]);
  });

  it('PR em espera que está na fila, ou que tem pendência, aparece uma vez só', () => {
    const r = fatiarFila([pr('a/b#1')], [pr('a/b#1'), pr('a/b#2'), pr('a/b#3'), pr('a/b#3')], [], [pendencia({ key: 'a/b#2' })]);
    expect(r.fila.map((p) => p.key)).toEqual(['a/b#1']);
    expect(r.emEspera.map((p) => p.key)).toEqual(['a/b#3']);
  });

  it('PR da fila com pendência continua na fila: quem manda na fila é o motor', () => {
    expect(fatiarFila([pr('a/b#1')], [], [], [pendencia({ key: 'a/b#1' })]).fila).toHaveLength(1);
  });

  it('sem nada repetido, devolve tudo na ordem do motor', () => {
    const r = fatiarFila([pr('z/z#9'), pr('a/b#1')], [pr('c/d#4'), pr('a/a#2')], [], []);
    expect(r.fila.map((p) => p.key)).toEqual(['z/z#9', 'a/b#1']);
    expect(r.emEspera.map((p) => p.key)).toEqual(['c/d#4', 'a/a#2']);
  });
});
