import { describe, expect, it } from 'vitest';
import {
  chaveDaUrlDePr, dataHora, hora, linkDoPr, nomeDoPr, textoDaEspera, textoDaRetentativa, textoDoEstacionado,
  textoDoParecer,
} from './formato';

// 16/11/2026 14:32:05 em UTC
const INSTANTE = Date.UTC(2026, 10, 16, 14, 32, 5);

describe('nome e link do PR', () => {
  it('a chave do motor vira o nome que o botão diz', () => {
    expect(nomeDoPr('dono/repo#123')).toBe('PR #123 de dono/repo');
    expect(nomeDoPr('Edicoes-CNBB/biblioteca.web#7')).toBe('PR #7 de Edicoes-CNBB/biblioteca.web');
  });

  it('chave fora do formato aparece como veio', () => {
    expect(nomeDoPr('solta')).toBe('PR solta');
    expect(nomeDoPr('')).toBe('PR ');
  });

  it('só URL do GitHub por HTTPS vira link', () => {
    expect(linkDoPr('https://github.com/dono/repo/pull/1')).toBe('https://github.com/dono/repo/pull/1');
    for (const torta of [undefined, '', 'http://github.com/dono/repo/pull/1', 'javascript:alert(1)', 'https://github.com.evil.example/x', 'https://evil.example/https://github.com/', ' https://github.com/x']) {
      expect(linkDoPr(torta), String(torta)).toBeNull();
    }
  });

  it('a URL da revisão sob demanda tem de ser a de um PR do GitHub', () => {
    expect(chaveDaUrlDePr('https://github.com/dono/repo/pull/123')).toBe('dono/repo#123');
    expect(chaveDaUrlDePr('  https://github.com/dono/repo.js/pull/9/files  ')).toBe('dono/repo.js#9');
    expect(chaveDaUrlDePr('https://github.com/dono/repo/pull/9#issuecomment-1')).toBe('dono/repo#9');
    for (const torta of ['', 'dono/repo#9', 'https://github.com/dono/repo', 'https://github.com/dono/repo/issues/9', 'http://github.com/dono/repo/pull/9', 'https://gitlab.com/dono/repo/pull/9', 'https://github.com/dono/repo/pull/9x', 'https://github.com/dono/repo/pull/9 e mais']) {
      expect(chaveDaUrlDePr(torta), torta).toBeNull();
    }
  });
});

describe('datas', () => {
  it('escreve dia, mês, hora e minuto, de epoch ou de data ISO', () => {
    expect(dataHora(INSTANTE, 'UTC')).toBe('16/11, 14:32');
    expect(dataHora('2026-11-16T14:32:05.000Z', 'UTC')).toBe('16/11, 14:32');
    expect(dataHora(INSTANTE, 'America/Sao_Paulo')).toBe('16/11, 11:32');
    expect(hora(INSTANTE, 'UTC')).toBe('14:32:05');
  });

  it('sem hora conhecida devolve vazio, e não uma data inventada', () => {
    for (const vazio of [null, undefined, 0, '', 'ontem', Number.NaN]) expect(dataHora(vazio, 'UTC')).toBe('');
  });
});

describe('frases', () => {
  it('parecer conhecido ganha rótulo; desconhecido ou ausente não aparece', () => {
    expect(textoDoParecer('approve')).toBe('Parecer da revisão: aprovar');
    expect(textoDoParecer('request_changes')).toBe('Parecer da revisão: pedir mudanças');
    expect(textoDoParecer('outro')).toBe('');
    expect(textoDoParecer('toString')).toBe('');
    expect(textoDoParecer(undefined)).toBe('');
  });

  it('retentativa diz se o motor ainda tenta ou desistiu', () => {
    expect(textoDaRetentativa({ attempts: 1, exhausted: false })).toMatch(/tentando de novo sozinho/);
    expect(textoDaRetentativa({ attempts: 4, exhausted: true })).toMatch(/desistiu.*4 tentativa/);
  });

  it('espera diz a posição, o motivo e as vagas quando o agendador mediu', () => {
    expect(textoDaEspera({ posicao: 2, total: 3, motivo: 'limite-conta', ocupadas: 1, limite: 1 }))
      .toBe('Na fila de execução, posição 2 de 3. Limite de revisões simultâneas da conta atingido (1/1).');
    expect(textoDaEspera({ posicao: 1, total: 1, motivo: 'aguardando-agendador' })).toMatch(/próxima passagem do agendador\.$/);
    expect(textoDaEspera({ posicao: 1, total: 1, motivo: 'novo-motivo' })).toMatch(/ainda não confirmado/);
    expect(textoDaEspera(undefined)).toBe('Na fila de execução.');
  });

  it('parada diz quando e por quê, com o motivo do motor só onde ele acrescenta', () => {
    expect(textoDoEstacionado({ at: '2026-11-16T14:32:05.000Z', motivo: 'timeout', tipo: 'falha' }, 'UTC'))
      .toBe('Revisão automática parada em 16/11, 14:32: falhou (timeout). Ela não relança sozinha.');
    expect(textoDoEstacionado({ at: '', motivo: 'x', tipo: 'cancelado' })).toBe('Revisão automática parada: a última sessão foi cancelada. Ela não relança sozinha.');
    expect(textoDoEstacionado({ at: '', motivo: '', tipo: 'legado' })).toMatch(/sem motivo registrado/);
    expect(textoDoEstacionado({ at: '', motivo: 'rede', tipo: 'esgotado' })).toMatch(/último erro: rede/);
    expect(textoDoEstacionado({ at: '', motivo: '', tipo: 'tipo-novo' })).toMatch(/: falhou\./);
    expect(textoDoEstacionado({ at: '', motivo: '', tipo: 'constructor' })).toMatch(/: falhou\./);
  });
});
