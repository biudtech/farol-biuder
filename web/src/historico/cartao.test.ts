// O que o cartão de uma revisão do Histórico diz, sem React.
import { describe, expect, it } from 'vitest';
import type { Revisao } from '@/contratos/historico';
import { contextoDoCartao, rodapeDoCartao, temTextoDoReview, textoDaSessao, tomDoCartao } from './cartao';

const SP = 'America/Sao_Paulo';
// 14:32 em Brasília
const RESOLVIDA = Date.UTC(2026, 10, 16, 17, 32);

function revisao(extra: Partial<Revisao> = {}): Revisao {
  return { id: 'd1', key: 'dono/repo#1', resolvedAt: RESOLVIDA, status: 'posted', action: 'approve', reportMarkdown: '## ok', reasons: [], attention: [], ...extra };
}

describe('cartão de revisão do Histórico', () => {
  it('a borda segue o que foi publicado: aprovado, comentado, pediu mudanças e nada postado', () => {
    expect(tomDoCartao(revisao())).toBe('ok');
    expect(tomDoCartao(revisao({ action: 'comment' }))).toBe('aviso');
    expect(tomDoCartao(revisao({ action: 'request_changes' }))).toBe('falha');
    expect(tomDoCartao(revisao({ action: 'skip' }))).toBe('fila');
    expect(tomDoCartao(revisao({ status: 'pending', action: 'approve' }))).toBe('fila');
  });

  it('o contexto: a hora em Brasília, a rodada (de quantas, quando o detalhe diz) e o card', () => {
    expect(contextoDoCartao(revisao(), SP)).toBe('14:32');
    expect(contextoDoCartao(revisao({ card: 'BT-9', rounds: { ordinal: 2 } }), SP)).toBe('14:32 · 2ª rodada · card BT-9');
    const doPr = { itens: [{ id: 'd0', rodada: 1, publicado: 'comment' }, { id: 'd1', rodada: 2, publicado: 'approve' }] };
    expect(contextoDoCartao(revisao({ rounds: { ordinal: 2 }, rodadasDoPr: doPr }), SP)).toBe('14:32 · rodada 2 de 2');
    expect(contextoDoCartao(revisao({ resolvedAt: undefined }), SP)).toBe('');
  });

  it('o rodapé junta só o que o motor mandou: hora, tempo, sessões, custo e perfis', () => {
    const r = revisao({
      execucao: {
        tentativas: 2, modelos: ['opus'], duracaoMs: 720000, custoUsd: 0.84, perfis: ['perfil-b'],
        sessoes: [{ id: 't1', status: 'ok' }, { id: 't2', status: 'ok' }],
      },
    });
    const perfis = [{ id: 'perfil-b', label: 'Assinatura B' }];
    expect(rodapeDoCartao(r, perfis, SP)).toBe('14:32 · 12 min · 2 sessões · US$ 0,84 · perfil Assinatura B');
    // custo estimado diz isso; dois perfis
    const estimado = revisao({ execucao: { tentativas: 1, modelos: [], custoUsd: 1, custoEstimado: true, perfis: ['a', 'b'] } });
    expect(rodapeDoCartao(estimado, undefined, SP)).toBe('14:32 · 1 sessão · US$ 1,00 (estimado) · perfis a, b');
    // sem execução (motor antigo, ou detalhe ainda não chegou): a hora e o tempo das etapas
    expect(rodapeDoCartao(revisao({ stages: { totalMs: 90000, stages: [] } }), undefined, SP)).toBe('14:32 · 1 min 30 s');
    expect(rodapeDoCartao(revisao({ resolvedAt: undefined }), undefined, SP)).toBe('');
  });

  it('uma sessão: hora, por que rodou, modelo, perfil, tempo, custo, retomada e desfecho', () => {
    expect(textoDaSessao({
      id: 't1', em: RESOLVIDA, status: 'ok', gatilho: 'commit_novo', modelo: 'opus', perfil: 'perfil-b', duracaoMs: 240000, custoUsd: 0.4, retomada: 'retomada',
    }, [{ id: 'perfil-b', label: 'Assinatura B' }], SP)).toBe('14:32 · commit novo · opus · Assinatura B · 4 min · US$ 0,40 · retomou a conversa anterior');
    expect(textoDaSessao({ id: 't2', status: 'erro' }, undefined, SP)).toBe('hora não registrada · terminou com erro');
    expect(textoDaSessao({ id: 't4', status: 'outro-valor' }, undefined, SP)).toBe('hora não registrada · desfecho outro-valor');
    expect(textoDaSessao({ id: 't3', status: 'ok', gatilho: 'rodada_extra', retomada: 'nenhuma' }, undefined, SP)).toBe('hora não registrada · rodada extra no mesmo commit');
  });

  it('o texto do review existe quando o motor o gravou; o botão diz se foi postado', () => {
    expect(temTextoDoReview(revisao())).toBe('postado');
    expect(temTextoDoReview(revisao({ action: 'skip' }))).toBe('naoPostado');
    expect(temTextoDoReview(revisao({ status: 'pending' }))).toBe('naoPostado');
    expect(temTextoDoReview(revisao({ reportMarkdown: '' }))).toBe('sem');
  });
});
