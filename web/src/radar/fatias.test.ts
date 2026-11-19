import { describe, expect, it } from 'vitest';
import { avisosDoMotor, chavesAusentes, fatiarFila, resumoDoTopo, textoDaChecagem, textoDaChecagemEmCurso, textoDaFilaVazia, textoDasPendencias, textoDoTudoEmDia } from './fatias';

const INSTANTE = Date.UTC(2026, 10, 16, 14, 32, 5);

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
    // só a checagem que falhou leva o Checar agora junto
    expect(avisosDoMotor({ status: 'error', error: 'gh: timeout' })[0]?.checar).toBe(true);
    expect(avisosDoMotor({ status: 'idle', account: { user: '', tokenOk: false } })[0]?.checar).toBeUndefined();
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
    expect(textoDaChecagem({ status: 'checking', checagem: { total: 22, feitas: 9, agora: 'biudtech' } })).toBe('Checando as 22 organizações · 9 de 22 · agora: biudtech');
    // a checagem que sobrou de um ciclo já encerrado não vale
    expect(textoDaChecagem({ status: 'idle', checagem: { total: 2, feitas: 1 }, lastCheckAt: null })).toBe('Nenhuma checagem terminou ainda.');
    expect(textoDaChecagem({ status: 'idle', lastCheckAt: INSTANTE, nextCheckAt: INSTANTE + 180000 }, 'UTC')).toBe('Última checagem: 16/11, 14:32. Próxima: 16/11, 14:35.');
    expect(textoDaChecagem({ status: 'idle', lastCheckAt: null, nextCheckAt: null })).toBe('Nenhuma checagem terminou ainda.');
    expect(textoDaChecagem({})).toBe('Nenhuma checagem terminou ainda.');
  });

  it('checagem em curso: a contagem do motor, a organização da vez e o singular', () => {
    expect(textoDaChecagemEmCurso({ total: 1, feitas: 0, agora: 'biudtech' })).toBe('Checando a organização · 0 de 1 · agora: biudtech');
    expect(textoDaChecagemEmCurso({ total: 3, feitas: 3 })).toBe('Checando as 3 organizações · 3 de 3');
    expect(textoDaChecagemEmCurso({ total: 0, feitas: 0 })).toBe('Checando agora.');
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
    expect(chavesAusentes({ activeSessions: [] })).toEqual(['a fila', 'as revisões postadas']);
  });
});

describe('fila sem PR repetido na tela', () => {
  const pr = (key: string) => ({ key, url: `https://github.com/${key.replace('#', '/pull/')}` });

  it('PR com sessão em curso sai da fila e da espera', () => {
    const r = fatiarFila([pr('a/b#1'), pr('a/b#2')], [pr('a/b#1'), pr('a/b#3')], [{ id: 's1', keys: ['a/b#1'] }, { id: 's2', pr: { key: 'A/B#3' } }]);
    expect(r.fila.map((p) => p.key)).toEqual(['a/b#2']);
    expect(r.emEspera).toEqual([]);
  });

  it('PR em espera que está na fila, ou repetido na espera, aparece uma vez só', () => {
    const r = fatiarFila([pr('a/b#1')], [pr('a/b#1'), pr('a/b#2'), pr('a/b#3'), pr('a/b#3')], []);
    expect(r.fila.map((p) => p.key)).toEqual(['a/b#1']);
    expect(r.emEspera.map((p) => p.key)).toEqual(['a/b#2', 'a/b#3']);
  });

  it('sem nada repetido, devolve tudo na ordem do motor', () => {
    const r = fatiarFila([pr('z/z#9'), pr('a/b#1')], [pr('c/d#4'), pr('a/a#2')], []);
    expect(r.fila.map((p) => p.key)).toEqual(['z/z#9', 'a/b#1']);
    expect(r.emEspera.map((p) => p.key)).toEqual(['c/d#4', 'a/a#2']);
  });

  it('o PR de De fora sai da Fila e da espera, e por isso da contagem do topo', () => {
    const deFora = [{ key: 'A/B#2', motivo: 'decisao_de_gente' as const, detalhe: {} }, { key: 'c/d#4', motivo: 'ignorado' as const, detalhe: {} }];
    const r = fatiarFila([pr('a/b#1'), pr('a/b#2'), pr('a/b#3')], [pr('c/d#4'), pr('c/d#5')], [], deFora);
    expect(r.fila.map((p) => p.key)).toEqual(['a/b#1', 'a/b#3']);
    expect(r.emEspera.map((p) => p.key)).toEqual(['c/d#5']);
    expect(resumoDoTopo(0, r.fila.length + r.emEspera.length)).toBe('0 em análise · 3 na fila');
  });
});

describe('o topo e o tudo em dia', () => {
  it('a frase do topo conta o que está na tela', () => {
    expect(resumoDoTopo(1, 3)).toBe('1 em análise · 3 na fila');
    expect(resumoDoTopo(0, 0)).toBe('0 em análise · 0 na fila');
  });

  it('a próxima checagem de hoje diz só a hora; de outro dia, a data junto; sem ela, só a fila vazia', () => {
    expect(textoDoTudoEmDia({ nextCheckAt: INSTANTE + 180000 }, INSTANTE, 'UTC')).toBe('Nenhum PR na fila. A próxima checagem é às 14:35.');
    expect(textoDoTudoEmDia({ nextCheckAt: INSTANTE + 86400000 }, INSTANTE, 'UTC')).toBe('Nenhum PR na fila. A próxima checagem é em 17/11, 14:32.');
    expect(textoDoTudoEmDia({ nextCheckAt: null }, INSTANTE, 'UTC')).toBe('Nenhum PR na fila.');
    expect(textoDoTudoEmDia({}, INSTANTE, 'UTC')).toBe('Nenhum PR na fila.');
  });
});

describe('a linha das pendências', () => {
  it('conta as revisões sem nada postado, no singular e no plural', () => {
    expect(textoDasPendencias(1)).toBe('1 revisão sem nada postado');
    expect(textoDasPendencias(4)).toBe('4 revisões sem nada postado');
  });
});
