import { describe, expect, it } from 'vitest';
import { ASSUNTOS, assuntoDoCaminho, assuntoDosSegmentos, nomeDoAssunto, rotaDoAssunto } from './assuntos';

describe('os assuntos do Sistema', () => {
  it('a ordem do menu, com a conta primeiro e a saúde por último', () => {
    expect(ASSUNTOS.map((a) => a.id)).toEqual(['conta', 'regras', 'padroes', 'claude', 'jira', 'ritmo', 'acesso', 'saude']);
    expect(nomeDoAssunto('acesso')).toBe('Quem está conectado');
    expect(rotaDoAssunto('claude')).toBe('/sistema/claude');
  });

  it('sem segmento abre o primeiro, sem dizer que o endereço pediu', () => {
    expect(assuntoDosSegmentos(undefined)).toEqual({ id: 'conta', explicito: false });
    expect(assuntoDosSegmentos([])).toEqual({ id: 'conta', explicito: false });
  });

  it('o segmento que nomeia um assunto abre ele', () => {
    for (const { id } of ASSUNTOS) expect(assuntoDosSegmentos([id])).toEqual({ id, explicito: true });
  });

  it('entrada torta não abre assunto nenhum', () => {
    for (const torto of [['nada'], ['Claude'], ['claude', 'x'], [3], 'claude', null, {}, [''], ['../conta']]) {
      expect(assuntoDosSegmentos(torto)).toBeNull();
    }
  });

  it('o caminho da página: com e sem assunto, com barra final, com busca, e fora do Sistema', () => {
    expect(assuntoDoCaminho('/sistema')).toEqual({ id: 'conta', explicito: false });
    expect(assuntoDoCaminho('/sistema/')).toEqual({ id: 'conta', explicito: false });
    expect(assuntoDoCaminho('/sistema/jira')).toEqual({ id: 'jira', explicito: true });
    expect(assuntoDoCaminho('/sistema/jira/')).toEqual({ id: 'jira', explicito: true });
    expect(assuntoDoCaminho('/sistema/jira?x=1#y')).toEqual({ id: 'jira', explicito: true });
    expect(assuntoDoCaminho('/sistema/nada')).toBeNull();
    expect(assuntoDoCaminho('/sistemas')).toBeNull();
    expect(assuntoDoCaminho('/radar')).toBeNull();
    expect(assuntoDoCaminho(undefined)).toBeNull();
    expect(assuntoDoCaminho(42)).toBeNull();
  });
});
