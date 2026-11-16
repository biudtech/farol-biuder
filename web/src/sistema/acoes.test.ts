import { describe, expect, it, vi } from 'vitest';
import { confirmacaoDa, executar, idDa, lerRespostaDeAcao, nomeDa, pedidoDa, rotuloDa, type Acao } from '@/radar/acoes';
import type { Resultado } from '@/transporte/cliente';
import { impedimentoDeSalvar } from './acoes';
import { comTeto, type Teto } from './teto';

const PLANO = { id: 'plano', label: 'Assinatura', kind: 'dir', dir: '', budgetDaily: 20 };
const API = { id: 'api', label: 'Chave', kind: 'apikey', baseUrl: '', temChave: true };
const CRU = [PLANO, API];
const ANTES: Teto = { budgetDaily: 20, budgetTotal: null, budgetSince: '' };
const NOVO: Teto = { budgetDaily: 5, budgetTotal: null, budgetSince: '' };

const conta = (extra: Partial<Extract<Acao, { tipo: 'conta' }>> = {}): Acao => ({ tipo: 'conta', alvo: 'sistema:conta', nome: '@farol-bot', user: 'farol-bot', campos: { onClean: 'wait' }, ampliacoes: [], ...extra });
const automacao = (extra: Partial<Extract<Acao, { tipo: 'automacao' }>> = {}): Acao => ({ tipo: 'automacao', alvo: 'sistema:automacao', nome: 'a automação', corpo: { parallelReviews: 3 }, ampliacoes: [], ...extra });
const teto: Acao = { tipo: 'teto', alvo: 'sistema:teto:plano', nome: 'Assinatura', perfil: 'plano', perfis: comTeto(CRU, 'plano', NOVO) ?? [], antes: ANTES, teto: NOVO };
const revogar = (atual: boolean): Acao => ({ tipo: 'revogarSessao', alvo: 'sistema:sessao:0123456789abcdef', nome: atual ? '"Este" (este navegador)' : '"Outro"', id: '0123456789abcdef', rotulo: atual ? 'Este' : 'Outro', atual });

// Um cliente de mentira: o corpo cru passa pelo leitor da borda, como no de verdade.
function cliente(corpo: unknown) {
  const post = vi.fn(async (_rota: string, _enviado: unknown, leitor: (bruto: unknown) => unknown): Promise<Resultado<never>> => {
    const dados = leitor(corpo);
    return (dados === null ? { ok: false, falha: 'resposta_invalida', status: 200 } : { ok: true, dados }) as Resultado<never>;
  });
  return { post } as unknown as Parameters<typeof executar>[0] & { post: typeof post };
}

describe('o pedido de cada ação do Sistema', () => {
  it('a conta vai a accounts/edit, só com os campos que mudaram', () => {
    expect(pedidoDa(conta())).toEqual({ rota: '/api/accounts/edit', corpo: { tipo: 'editar', user: 'farol-bot', campos: { onClean: 'wait' } } });
  });

  it('a automação vai a settings só com as chaves dela', () => {
    expect(pedidoDa(automacao())).toEqual({ rota: '/api/settings', corpo: { parallelReviews: 3 } });
  });

  it('o teto vai a settings só com claudeProfiles, a lista inteira montada da crua', () => {
    expect(pedidoDa(teto)).toEqual({ rota: '/api/settings', corpo: { claudeProfiles: [{ ...PLANO, budgetDaily: 5 }, API] } });
  });

  it('a revogação vai a auth/revoke com o id', () => {
    expect(pedidoDa(revogar(false))).toEqual({ rota: '/api/auth/revoke', corpo: { id: '0123456789abcdef' } });
  });

  it('rótulo, nome acessível e id', () => {
    expect([conta(), automacao(), teto, revogar(false)].map(rotuloDa)).toEqual(['Salvar conta e política', 'Salvar automação', 'Salvar teto', 'Revogar']);
    expect([conta(), automacao(), teto, revogar(false)].map(nomeDa)).toEqual(['Salvar conta e política de @farol-bot', 'Salvar automação', 'Salvar teto de Assinatura', 'Revogar a sessão "Outro"']);
    expect([conta(), automacao(), teto, revogar(false)].map(idDa)).toEqual(['conta', 'automacao', 'teto', 'revogarSessao']);
  });
});

describe('a pergunta antes do envio', () => {
  it('a conta só pergunta quando a mudança amplia a publicação, e diz cada efeito', () => {
    expect(confirmacaoDa(conta())).toBeNull();
    const pergunta = confirmacaoDa(conta({ campos: { onClean: 'approve' }, ampliacoes: ['Revisão limpa: o motor passa a publicar sozinho a aprovação.'] }));
    expect(pergunta?.titulo).toBe('Ampliar o que o motor publica sozinho por @farol-bot?');
    expect(pergunta?.texto).toContain('Revisão limpa: o motor passa a publicar sozinho a aprovação.');
    expect(pergunta?.texto).toContain('sem clique');
    expect(pergunta?.confirmar).toBe('Salvar e ampliar a publicação automática');
  });

  it('a automação só pergunta ao desligar o CI antes de aprovar', () => {
    expect(confirmacaoDa(automacao())).toBeNull();
    const pergunta = confirmacaoDa(automacao({ corpo: { aguardarCiParaAprovar: false }, ampliacoes: ['CI antes de aprovar desligado: pode publicar APPROVE com o CI vermelho.'] }));
    expect(pergunta?.titulo).toBe('Desligar o CI antes de aprovar?');
    expect(pergunta?.texto).toContain('CI vermelho');
  });

  it('o teto pergunta sempre, com o antes, o depois e o efeito', () => {
    const pergunta = confirmacaoDa(teto);
    expect(pergunta?.titulo).toBe('Mudar o teto de gasto de Assinatura?');
    expect(pergunta?.texto).toContain('passa de US$ 20,00 por dia para US$ 5,00 por dia');
    expect(pergunta?.texto).toContain('pausam');
    expect(pergunta?.confirmar).toBe('Salvar o teto');
  });

  it('revogar pergunta sempre, e a da sessão atual avisa do pareamento', () => {
    expect(confirmacaoDa(revogar(false))?.confirmar).toBe('Revogar a sessão');
    expect(confirmacaoDa(revogar(true))?.texto).toContain('volta ao pareamento');
  });
});

describe('a leitura da resposta', () => {
  it('o config da resposta de settings entra sem o que tem cara de segredo', () => {
    const chave = ['sk', 'ant', 'api03', 'BBBBBBBBBBBBBBBBBBBB'].join('-');
    const lido = lerRespostaDeAcao({ ok: true, ignoradas: [], config: { parallelReviews: 3, claudeProfiles: [{ id: 'api', kind: 'apikey', apiKey: chave, temChave: true }] } });
    expect(JSON.stringify(lido)).not.toContain(chave);
    expect(lido).toEqual({ ok: true, sistema: { parallelReviews: 3, claudeProfiles: [{ id: 'api', kind: 'apikey', temChave: true }], claudeProfilesCru: [{ id: 'api', kind: 'apikey', temChave: true }], segredosDescartados: 1 } });
  });

  it('os campos ignorados da conta e o eraAtual da revogação', () => {
    expect(lerRespostaDeAcao({ ok: true, ignoradas: [], ignorados: ['onClean', 3] })).toEqual({ ok: true, ignorados: ['onClean'] });
    expect(lerRespostaDeAcao({ ok: true, eraAtual: true })).toEqual({ ok: true, eraAtual: true });
    expect(lerRespostaDeAcao({ ok: false, erro: 'a conta @x não é a conta deste Farol' })).toEqual({ ok: false, error: 'a conta @x não é a conta deste Farol' });
    expect(lerRespostaDeAcao({ ok: false, code: 'sessao_inexistente' })).toEqual({ ok: false, blocked: 'sessao_inexistente' });
  });
});

describe('o que a tela diz depois', () => {
  it('conta: o aceite diz o pedido e que a resposta não traz a conta gravada', async () => {
    const c = cliente({ ok: true, ignoradas: [], ignorados: [] });
    expect(await executar(c, conta())).toEqual({ tipo: 'ok', texto: 'O motor aceitou a mudança em @farol-bot: revisão limpa: esperar você. A resposta dele não traz a conta gravada. O que ficou gravado aparece nesta tela quando o estado do motor chegar.' });
    expect(c.post).toHaveBeenCalledWith('/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onClean: 'wait' } }, lerRespostaDeAcao);
  });

  it('conta: campo que o motor ignorou é erro, e a recusa mostra a frase do motor', async () => {
    const ignorado = await executar(cliente({ ok: true, ignoradas: [], ignorados: ['onClean'] }), conta());
    expect(ignorado).toEqual({ tipo: 'erro', texto: expect.stringContaining('ignorou revisão limpa') });
    const recusa = await executar(cliente({ ok: false, erro: 'o "sem ressalvas" de @farol-bot espera você, então o "com ressalvas" também espera' }), conta());
    expect(recusa).toEqual({ tipo: 'erro', texto: 'O motor recusou: o "sem ressalvas" de @farol-bot espera você, então o "com ressalvas" também espera' });
  });

  it('automação: gravou, gravou diferente, ignorou, e resposta sem a configuração', async () => {
    expect(await executar(cliente({ ok: true, ignoradas: [], config: { parallelReviews: 3 } }), automacao())).toEqual({ tipo: 'ok', texto: 'O motor gravou: revisões ao mesmo tempo: 3.' });
    expect(await executar(cliente({ ok: true, ignoradas: [], config: { parallelReviews: 4 } }), automacao({ corpo: { parallelReviews: 9 } }))).toEqual({
      tipo: 'erro',
      texto: 'O motor gravou diferente do pedido: revisões ao mesmo tempo ficou 4, e o pedido era 9. O que ele não aceita, ele mantém como estava ou ajusta para a faixa.',
    });
    expect(await executar(cliente({ ok: true, ignoradas: ['parallelReviews'], config: {} }), automacao())).toEqual({ tipo: 'erro', texto: 'O motor ignorou parallelReviews: não foi gravado.' });
    expect(await executar(cliente({ ok: true }), automacao())).toEqual({ tipo: 'ok', texto: expect.stringContaining('a resposta não trouxe a configuração gravada') });
  });

  it('teto: gravou o pedido', async () => {
    const c = cliente({ ok: true, ignoradas: [], config: { claudeProfiles: [{ ...PLANO, budgetDaily: 5 }, API] } });
    expect(await executar(c, teto)).toEqual({ tipo: 'ok', texto: 'O motor gravou o teto de Assinatura: US$ 5,00 por dia.' });
    expect(c.post).toHaveBeenCalledWith('/api/settings', { claudeProfiles: [{ ...PLANO, budgetDaily: 5 }, API] }, lerRespostaDeAcao);
  });

  it('teto: gravou diferente, outro perfil mudou, o perfil saiu, e a lista foi ignorada', async () => {
    expect(await executar(cliente({ ok: true, config: { claudeProfiles: [{ ...PLANO }, API] } }), teto)).toEqual({ tipo: 'erro', texto: expect.stringContaining('diferente do pedido: ficou US$ 20,00 por dia') });
    const outro = await executar(cliente({ ok: true, config: { claudeProfiles: [{ ...PLANO, budgetDaily: 5 }] } }), teto);
    expect(outro).toEqual({ tipo: 'erro', texto: expect.stringContaining('outro perfil ficou diferente do que esta tela enviou, mudou ou saiu da lista (api)') });
    expect(await executar(cliente({ ok: true, config: { claudeProfiles: [API] } }), teto)).toEqual({ tipo: 'erro', texto: expect.stringContaining('não está na lista que o motor gravou') });
    expect(await executar(cliente({ ok: true, ignoradas: ['claudeProfiles'], config: {} }), teto)).toEqual({ tipo: 'erro', texto: 'O motor ignorou a lista de perfis: o teto de Assinatura não foi gravado.' });
    expect(await executar(cliente({ ok: true, config: {} }), teto)).toEqual({ tipo: 'ok', texto: expect.stringContaining('não trouxe os perfis gravados') });
  });

  it('teto: a recusa do endereço diz que nada foi gravado e que a tela não digita chave', async () => {
    const recusa = await executar(cliente({ ok: false, code: 'chave_exigida', perfis: ['api'], erro: 'Para mudar o endereço deste perfil, digite a chave de novo.' }), teto);
    expect(recusa).toEqual({ tipo: 'erro', texto: expect.stringContaining('Esta tela não digita chave: nada foi gravado.') });
  });

  it('revogação: a de outra sessão, a deste navegador e a que o motor não tinha mais', async () => {
    expect(await executar(cliente({ ok: true, eraAtual: false }), revogar(false))).toEqual({ tipo: 'ok', texto: 'O motor revogou a sessão "Outro": o token dela não vale mais.' });
    expect(await executar(cliente({ ok: true, eraAtual: true }), revogar(true))).toEqual({ tipo: 'ok', texto: 'O motor revogou a sessão deste navegador. Voltando ao pareamento.' });
    expect(await executar(cliente({ ok: false, code: 'sessao_inexistente' }), revogar(false))).toEqual({ tipo: 'erro', texto: expect.stringContaining('já foi revogada ou expirou') });
  });
});

describe('impedimentoDeSalvar', () => {
  it('só salva conectado e com o estado desta conexão já chegado', () => {
    expect(impedimentoDeSalvar({ conectado: true, emDia: true })).toBeNull();
    expect(impedimentoDeSalvar({ conectado: false, emDia: true })).toContain('sem conexão com o motor');
    expect(impedimentoDeSalvar({ conectado: true, emDia: false })).toContain('ainda não chegou');
  });
});
