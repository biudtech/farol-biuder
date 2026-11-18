import { describe, expect, it } from 'vitest';
import {
  dataComAno, dataHora, dia, hora, horaCurta, linkDoPr, nomeDoPr, prDaUrl, textoDaEspera,
  textoDoEstacionado,
} from './formato';

// 16/11/2026 14:32:05 em UTC
const INSTANTE = Date.UTC(2026, 10, 16, 14, 32, 5);

describe('nome e link do PR', () => {
  it('a chave do motor vira o nome que o botão diz', () => {
    expect(nomeDoPr('dono/repo#123')).toBe('PR #123 de dono/repo');
    expect(nomeDoPr('Outra-Org/biblioteca.web#7')).toBe('PR #7 de Outra-Org/biblioteca.web');
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
    expect(prDaUrl('https://github.com/dono/repo/pull/123')).toEqual({ chave: 'dono/repo#123', url: 'https://github.com/dono/repo/pull/123' });
    for (const torta of ['', 'dono/repo#9', 'https://github.com/dono/repo', 'https://github.com/dono/repo/issues/9', 'http://github.com/dono/repo/pull/9', 'https://gitlab.com/dono/repo/pull/9', 'https://github.com/dono/repo/pull/9x', 'https://github.com/dono/repo/pull/9 e mais']) {
      expect(prDaUrl(torta), torta).toBeNull();
    }
  });

  it('o que vai ao motor é a URL canônica do PR: sufixo, query e fragmento saem', () => {
    const canonica = 'https://github.com/dono/repo.js/pull/9';
    for (const digitada of [`  ${canonica}  `, `${canonica}/files`, `${canonica}/`, `${canonica}?w=1&x=<y>`, `${canonica}#issuecomment-1`, `${canonica}/commits/abc?diff=split#L3`]) {
      expect(prDaUrl(digitada), digitada).toEqual({ chave: 'dono/repo.js#9', url: canonica });
    }
  });
});

describe('datas', () => {
  it('escreve dia, mês, hora e minuto, de epoch ou de data ISO', () => {
    expect(dataHora(INSTANTE, 'UTC')).toBe('16/11, 14:32');
    expect(dataComAno(INSTANTE, 'UTC')).toBe('16/11/2026, 14:32');
    expect(dataComAno(0, 'UTC')).toBe('');
    expect(dataHora('2026-11-16T14:32:05.000Z', 'UTC')).toBe('16/11, 14:32');
    expect(dataHora(INSTANTE, 'America/Sao_Paulo')).toBe('16/11, 11:32');
    expect(hora(INSTANTE, 'UTC')).toBe('14:32:05');
    expect(horaCurta(INSTANTE, 'UTC')).toBe('14:32');
    expect(dia(INSTANTE, 'UTC')).toBe('16/11/2026');
    // o dia é o do fuso: 23h em São Paulo já é o dia seguinte em UTC
    expect(dia(Date.UTC(2026, 10, 17, 2), 'America/Sao_Paulo')).toBe('16/11/2026');
    expect(dia(0, 'UTC')).toBe('');
  });

  it('sem hora conhecida devolve vazio, e não uma data inventada', () => {
    for (const vazio of [null, undefined, 0, '', 'ontem', Number.NaN]) expect(dataHora(vazio, 'UTC')).toBe('');
  });
});

describe('frases', () => {
  it('espera diz a posição, o motivo e as vagas quando o agendador mediu', () => {
    expect(textoDaEspera({ posicao: 2, total: 3, motivo: 'limite-conta', ocupadas: 1, limite: 1 }))
      .toBe('Na fila de execução, posição 2 de 3. Limite de revisões simultâneas da conta atingido (1/1).');
    expect(textoDaEspera({ posicao: 1, total: 1, motivo: 'aguardando-agendador' })).toMatch(/próxima passagem do agendador\.$/);
    expect(textoDaEspera({ posicao: 1, total: 1, motivo: 'novo-motivo' })).toMatch(/ainda não confirmado/);
    expect(textoDaEspera(undefined)).toBe('Na fila de execução.');
    expect(textoDaEspera({})).toBe('Na fila de execução. Motivo da espera ainda não confirmado pelo agendador.');
    expect(textoDaEspera({ motivo: 'limite-global', posicao: 2 })).toBe('Na fila de execução. Limite total de revisões simultâneas atingido.');
  });

  it('parada diz quando e por quê, com o motivo do motor só onde ele acrescenta', () => {
    expect(textoDoEstacionado({ at: '2026-11-16T14:32:05.000Z', motivo: 'timeout', tipo: 'falha' }, 'UTC'))
      .toBe('Revisão automática parada em 16/11, 14:32: falhou (timeout). Ela não relança sozinha.');
    expect(textoDoEstacionado({ at: '', motivo: 'x', tipo: 'cancelado' })).toBe('Revisão automática parada: a última sessão foi cancelada. Ela não relança sozinha.');
    expect(textoDoEstacionado({ at: '', motivo: '', tipo: 'legado' })).toMatch(/sem motivo registrado/);
    expect(textoDoEstacionado({ at: '', motivo: 'rede', tipo: 'esgotado' })).toMatch(/último erro: rede/);
    // o teto de gasto saiu do motor em 16/11/2026: não há frase de orçamento estourado
    expect(textoDoEstacionado({ at: '', motivo: 'perfil antigo', tipo: 'orcamento' })).not.toMatch(/orçamento/);
    expect(textoDoEstacionado({ at: '', motivo: '', tipo: 'tipo-novo' })).toMatch(/: falhou\./);
    expect(textoDoEstacionado({ at: '', motivo: '', tipo: 'constructor' })).toMatch(/: falhou\./);
  });
});
