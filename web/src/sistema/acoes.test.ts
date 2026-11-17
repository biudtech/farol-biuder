import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { confirmacaoDa, executar, idDa, lerRespostaDeAcao, nomeDa, pedidoDa, rotuloDa, type Acao } from '@/radar/acoes';
import type { Resultado } from '@/transporte/cliente';
import { QUANDO_A_POLITICA_VALE, TIPOS_DO_SISTEMA, impedimentoDeSalvar } from './acoes';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

const conta = (extra: Partial<Extract<Acao, { tipo: 'conta' }>> = {}): Acao => ({ tipo: 'conta', alvo: 'sistema:conta', nome: '@farol-bot', user: 'farol-bot', campos: { onReject: 'request_changes' }, ampliacoes: [], ...extra });
const automacao = (extra: Partial<Extract<Acao, { tipo: 'automacao' }>> = {}): Acao => ({ tipo: 'automacao', alvo: 'sistema:automacao', nome: 'a automação', corpo: { parallelReviews: 3 }, ...extra });
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
  it('a conta vai a accounts/edit, só com os campos alterados', () => {
    expect(pedidoDa(conta())).toEqual({ rota: '/api/accounts/edit', corpo: { tipo: 'editar', user: 'farol-bot', campos: { onReject: 'request_changes' } } });
  });

  it('a automação vai a settings só com as chaves dela', () => {
    expect(pedidoDa(automacao())).toEqual({ rota: '/api/settings', corpo: { parallelReviews: 3 } });
  });

  it('a revogação vai a auth/revoke com o id', () => {
    expect(pedidoDa(revogar(false))).toEqual({ rota: '/api/auth/revoke', corpo: { id: '0123456789abcdef' } });
  });

  it('não existe ação de teto nem ação que mande claudeProfiles', () => {
    expect([...TIPOS_DO_SISTEMA]).toEqual(['conta', 'automacao', 'revogarSessao']);
    for (const acao of [conta(), automacao(), revogar(false)]) expect(JSON.stringify(pedidoDa(acao))).not.toContain('claudeProfiles');
    // nenhum fonte da tela (fora dos testes) manda perfil de volta ao motor
    const pasta = path.resolve(import.meta.dirname, '..');
    const fontes = (fs.readdirSync(pasta, { recursive: true }) as string[])
      .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome))
      .map((nome) => [nome, fs.readFileSync(path.join(pasta, nome), 'utf8')] as const);
    expect(fontes.length).toBeGreaterThan(60);
    // `claudeProfiles:` como chave de um objeto seria um corpo sendo montado (o tipo lido usa `?:`)
    expect(fontes.filter(([, fonte]) => /claudeProfiles\s*:/.test(fonte)).map(([nome]) => nome)).toEqual([]);
    expect(fontes.filter(([, fonte]) => /claudeProfilesCru|PerfisCrus/.test(fonte)).map(([nome]) => nome)).toEqual([]);
    // o teto de gasto saiu do motor em 16/11/2026: nenhum fonte lê campo de teto nem bloqueio
    const comTeto = fontes.filter(([, fonte]) => /budget(Daily|Total|Since|ByWeekday|Dates|s\b)|temTeto|capHoje|tipicoReview/.test(fonte));
    expect(comTeto.map(([nome]) => nome)).toEqual([]);
  });

  it('rótulo, nome acessível e id', () => {
    expect([conta(), automacao(), revogar(false)].map(rotuloDa)).toEqual(['Salvar conta e política', 'Salvar automação', 'Encerrar']);
    expect([conta(), automacao(), revogar(false)].map(nomeDa)).toEqual(['Salvar conta e política de @farol-bot', 'Salvar automação', 'Encerrar a sessão "Outro"']);
    expect([conta(), automacao(), revogar(false)].map(idDa)).toEqual(['conta', 'automacao', 'revogarSessao']);
  });
});

describe('a pergunta antes do envio', () => {
  it('a conta só pergunta quando a mudança amplia a publicação, e diz cada efeito e quando passa a valer', () => {
    expect(confirmacaoDa(conta())).toBeNull();
    const pergunta = confirmacaoDa(conta({ campos: { onClean: 'approve' }, ampliacoes: ['Revisão limpa: o motor passa a publicar sozinho a aprovação.'] }));
    expect(pergunta?.titulo).toBe('Ampliar o que o motor publica sozinho por @farol-bot?');
    expect(pergunta?.texto).toContain('Revisão limpa: o motor passa a publicar sozinho a aprovação.');
    expect(pergunta?.texto).toContain('sem clique');
    expect(pergunta?.texto).toContain(QUANDO_A_POLITICA_VALE);
    // o front não tem mesa: a pergunta não manda ninguém a "Precisa de você" nem promete clique
    expect(pergunta?.texto).toContain('O PR que a política anterior deixou esperando não é reavaliado');
    expect(pergunta?.texto).not.toMatch(/Precisa de você|seu clique|próximas decisões/);
    expect(pergunta?.confirmar).toBe('Salvar e ampliar a publicação automática');
  });

  // O que a pergunta afirma sobre o motor, conferido no fonte dele.
  it('o motor lê a política ao decidir, ao começar e na espera do CI, e ninguém reavalia a mesa', () => {
    expect(raiz('lib/engine/approval-policy.js')).toContain("if (engine.approvePolicyFor(engine.accountForPr(pr), clean) !== 'approve') {");
    expect(raiz('lib/engine/approval-policy.js')).toContain("return engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes';");
    expect(raiz('lib/engine/review-scope.js')).toContain('if (!retry && !engine.autoReviewFor(engine.accountForPr(pr))) return { automatic: false');
    expect(raiz('lib/engine/espera-ci.js')).toContain("if (engine.approvePolicyFor(conta, limpo) === 'approve') return true;");
    // a mudança de configuração é emitida, e nenhum arquivo do motor a ouve
    const motor = ['server.js', ...(fs.readdirSync(path.resolve(import.meta.dirname, '../../../lib'), { recursive: true }) as string[]).filter((n) => n.endsWith('.js')).map((n) => `lib/${n}`)];
    const ouvintes = motor.filter((arquivo) => /\.on\(\s*['"]settings-changed['"]/.test(raiz(arquivo)));
    expect(ouvintes).toEqual([]);
  });

  it('a automação nunca pergunta: nenhuma das três chaves amplia o que o motor publica', () => {
    expect(confirmacaoDa(automacao())).toBeNull();
    expect(confirmacaoDa(automacao({ corpo: { reviewModel: 'auto', reviewEffort: 'xhigh', parallelReviews: 4 } }))).toBeNull();
  });

  it('encerrar pergunta sempre, e a da sessão atual avisa do pareamento', () => {
    expect(confirmacaoDa(revogar(false))?.confirmar).toBe('Encerrar a sessão');
    expect(confirmacaoDa(revogar(true))?.texto).toContain('volta ao pareamento');
  });
});

describe('a leitura da resposta', () => {
  it('o config da resposta de settings entra sem o que tem cara de segredo, e sem lista crua de perfis', () => {
    const chave = ['sk', 'ant', 'api03', 'BBBBBBBBBBBBBBBBBBBB'].join('-');
    const lido = lerRespostaDeAcao({ ok: true, ignoradas: [], config: { parallelReviews: 3, claudeProfiles: [{ id: 'api', kind: 'apikey', apiKey: chave, temChave: true, dir: '/home/farol/x' }] } });
    expect(JSON.stringify(lido)).not.toContain(chave);
    expect(JSON.stringify(lido)).not.toContain('/home/farol');
    expect(lido).toEqual({ ok: true, sistema: { parallelReviews: 3, claudeProfiles: [{ id: 'api', kind: 'apikey', temChave: true }], segredosDescartados: 1 } });
  });

  it('os campos ignorados da conta e o eraAtual da revogação', () => {
    expect(lerRespostaDeAcao({ ok: true, ignoradas: [], ignorados: ['onClean', 3] })).toEqual({ ok: true, ignorados: ['onClean'] });
    expect(lerRespostaDeAcao({ ok: true, eraAtual: true })).toEqual({ ok: true, eraAtual: true });
    expect(lerRespostaDeAcao({ ok: false, erro: 'a conta @x não é a conta deste Farol' })).toEqual({ ok: false, error: 'a conta @x não é a conta deste Farol' });
    expect(lerRespostaDeAcao({ ok: false, code: 'sessao_inexistente' })).toEqual({ ok: false, blocked: 'sessao_inexistente' });
  });

  it('a frase de uma recusa fica, sem o trecho em formato de credencial', () => {
    const token = `ghp_${'q1W2e3R4'.repeat(4)}`;
    expect(lerRespostaDeAcao({ ok: false, blocked: 'x', error: `falha ao postar: o gh usou ${token}` })).toEqual({ ok: false, blocked: 'x', error: 'falha ao postar: o gh usou [segredo omitido]' });
  });
});

describe('o que a tela diz depois', () => {
  it('conta: o aceite diz o pedido e que a resposta não traz a conta gravada', async () => {
    const c = cliente({ ok: true, ignoradas: [], ignorados: [] });
    expect(await executar(c, conta())).toEqual({ tipo: 'ok', texto: 'O motor aceitou a mudança em @farol-bot: revisão reprovada: publicar sozinho. A resposta dele não traz a conta gravada. O que ficou gravado aparece nesta tela quando o estado do motor chegar.' });
    expect(c.post).toHaveBeenCalledWith('/api/accounts/edit', { tipo: 'editar', user: 'farol-bot', campos: { onReject: 'request_changes' } }, lerRespostaDeAcao);
  });

  it('conta: campo que o motor ignorou é erro, e a recusa mostra a frase do motor', async () => {
    const ignorado = await executar(cliente({ ok: true, ignoradas: [], ignorados: ['onReject'] }), conta());
    expect(ignorado).toEqual({ tipo: 'erro', texto: expect.stringContaining('ignorou revisão reprovada') });
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

  it('encerramento: a de outra sessão, a deste navegador e a que o motor não tinha mais', async () => {
    expect(await executar(cliente({ ok: true, eraAtual: false }), revogar(false))).toEqual({ tipo: 'ok', texto: 'O motor encerrou a sessão "Outro": o token dela não vale mais.' });
    expect(await executar(cliente({ ok: true, eraAtual: true }), revogar(true))).toEqual({ tipo: 'ok', texto: 'O motor encerrou a sessão deste navegador. Voltando ao pareamento.' });
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
