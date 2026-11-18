import { describe, expect, it } from 'vitest';
import { lerEndereco } from '@/historico/consulta';
import { enderecoDaRevisao, postadasDeHoje } from './postadas';

// 16/11/2026 14:32 em UTC
const AGORA = Date.UTC(2026, 10, 16, 14, 32);
const HORA = 3600000;

function resolvida(extra: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    key: 'dono/repo#12',
    resolvedAt: AGORA - HORA,
    status: 'auto_approved',
    action: 'approve',
    pr: { repo: 'dono/repo', number: 12, url: 'https://github.com/dono/repo/pull/12', title: 'Corrige o cálculo' },
    reportMarkdown: '',
    reasons: [],
    attention: [],
    ...extra,
  };
}

describe('postadas hoje', () => {
  it('só as de hoje, no fuso dado, e só as publicadas, na ordem do motor', () => {
    const lista = [
      resolvida({ id: 'a' }),
      resolvida({ id: 'ontem', resolvedAt: AGORA - 20 * HORA }),
      resolvida({ id: 'pulada', action: 'skip', status: 'skipped' }),
      resolvida({ id: 'sem-action', action: undefined }),
      resolvida({ id: 'desconhecida', action: 'merge' }),
      resolvida({ id: 'sem-hora', resolvedAt: undefined }),
      resolvida({ id: 'b', action: 'request_changes', status: 'auto_rejected' }),
      resolvida({ id: 'c', action: 'comment', status: 'commented_own_pr' }),
    ];
    const { postadas, ilegiveis } = postadasDeHoje(lista, AGORA, 'UTC');
    expect(postadas.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(ilegiveis).toBe(0);
  });

  it('leva ao cartão o autor, o card e a duração das etapas, só quando o motor mandou', () => {
    const [p] = postadasDeHoje([resolvida({ card: 'BT-1', stages: { totalMs: 420000, stages: [] }, pr: { url: 'https://github.com/dono/repo/pull/12', author: 'ana' } })], AGORA, 'UTC').postadas;
    expect([p?.autor, p?.card, p?.totalMs, p?.acao]).toEqual(['ana', 'BT-1', 420000, 'approve']);
  });

  it('o dia é o do fuso do navegador: 23h de ontem em São Paulo ainda é ontem lá', () => {
    // 02h UTC do dia 16 são 23h do dia 15 em São Paulo
    const madrugada = Date.UTC(2026, 10, 16, 2);
    expect(postadasDeHoje([resolvida({ resolvedAt: madrugada })], AGORA, 'UTC').postadas).toHaveLength(1);
    expect(postadasDeHoje([resolvida({ resolvedAt: madrugada })], AGORA, 'America/Sao_Paulo').postadas).toHaveLength(0);
  });

  it('cada uma traz a cor, o rótulo, a hora, o desfecho em texto e o endereço da revisão', () => {
    const lista = [resolvida(), resolvida({ id: 'b', action: 'request_changes', status: 'posted' }), resolvida({ id: 'c', action: 'comment', status: 'status-novo' })];
    const [a, b, c] = postadasDeHoje(lista, AGORA, 'UTC').postadas;
    expect(a).toEqual({
      id: 'd1',
      chave: 'dono/repo#12',
      titulo: 'Corrige o cálculo',
      hora: '13:32',
      tom: 'ok',
      rotulo: 'Aprovado',
      desfecho: 'Aprovação. Publicado automaticamente.',
      endereco: '/historico?id=d1&pr=dono%2Frepo%2312',
      url: 'https://github.com/dono/repo/pull/12',
      acao: 'approve',
      resolvedAt: AGORA - HORA,
    });
    expect([b?.tom, b?.rotulo, b?.desfecho]).toEqual(['ruim', 'Pediu mudanças', 'Pedido de mudanças. Publicado por você.']);
    // status que a tabela não conhece aparece cru
    expect([c?.tom, c?.rotulo, c?.desfecho]).toEqual(['aviso', 'Comentado', 'Comentário. status-novo.']);
  });

  it('sem título usa a chave; link que não é do GitHub por HTTPS não vira link', () => {
    const [p] = postadasDeHoje([resolvida({ pr: { url: 'http://outro.example/pull/12' } })], AGORA, 'UTC').postadas;
    expect(p?.titulo).toBe('dono/repo#12');
    expect(p?.url).toBeNull();
  });

  it('item sem id ou sem chave é contado como ilegível, e o resto entra', () => {
    const { postadas, ilegiveis } = postadasDeHoje([resolvida(), { key: 'x#1' }, 'torto', null], AGORA, 'UTC');
    expect(postadas).toHaveLength(1);
    expect(ilegiveis).toBe(3);
  });

  it('o endereço é o que o Histórico lê para abrir a revisão', () => {
    const endereco = enderecoDaRevisao('d 9', 'dono/repo#12');
    expect(endereco.startsWith('/historico?')).toBe(true);
    const params = new URLSearchParams(endereco.slice('/historico?'.length));
    expect(lerEndereco(params).detalhe).toEqual({ id: 'd 9', chave: 'dono/repo#12' });
  });
});
