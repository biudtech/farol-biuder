import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { confirmacaoDa, executar, idDa, lerRespostaDeAcao, nomeDa, pedidoDa, rotuloDa, type Acao } from '@/radar/acoes';
import type { Resultado } from '@/transporte/cliente';
import { QUANDO_A_POLITICA_VALE, TIPOS_DO_SISTEMA, impedimentoDeSalvar } from './acoes';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

const conta = (extra: Partial<Extract<Acao, { tipo: 'conta' }>> = {}): Acao => ({ tipo: 'conta', alvo: 'sistema:conta', nome: '@farol-bot', user: 'farol-bot', campos: { onReject: 'request_changes' }, ampliacoes: [], ...extra });
const automacao = (extra: Partial<Extract<Acao, { tipo: 'automacao' }>> = {}): Acao => ({ tipo: 'automacao', alvo: 'sistema:automacao', nome: 'a automação', corpo: { parallelReviews: 3 }, ...extra });
const padroes = (texto: string): Acao => ({ tipo: 'padroes', alvo: 'sistema:padroes', nome: '@farol-bot', user: 'farol-bot', texto });
const regra = (modo: 'auto' | 'manual' | 'inherit', autor = 'robo[bot]'): Acao => ({ tipo: 'regra', alvo: 'sistema:regra', nome: autor ? `@${autor} em orga` : 'a organização orga', user: 'farol-bot', organizacao: 'orga', autor: autor || undefined, modo });
const ritmo = (): Acao => ({ tipo: 'ritmo', alvo: 'sistema:ritmo', nome: 'o ritmo', corpo: { intervalSeconds: 600 } });
const ordem = (): Acao => ({ tipo: 'ordemDosPerfis', alvo: 'sistema:ordem', nome: 'B', corpo: { claudeProfileId: 'b', claudeProfiles: [{ id: 'b', label: 'B', kind: 'dir' }, { id: 'a', label: 'A', kind: 'apikey', baseUrl: '' }] } });
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

  it('os padrões vão a accounts/edit só com o texto; vazio tira o campo', () => {
    expect(pedidoDa(padroes('Teste em todo endpoint.'))).toEqual({ rota: '/api/accounts/edit', corpo: { tipo: 'editar', user: 'farol-bot', campos: { padroesRevisao: 'Teste em todo endpoint.' } } });
    expect(pedidoDa(padroes(''))).toEqual({ rota: '/api/accounts/edit', corpo: { tipo: 'editar', user: 'farol-bot', campos: { padroesRevisao: '' } } });
  });

  it('a regra vai a accounts/edit como a operação pontual do motor', () => {
    expect(pedidoDa(regra('manual'))).toEqual({ rota: '/api/accounts/edit', corpo: { tipo: 'regra-review', user: 'farol-bot', organization: 'orga', author: 'robo[bot]', mode: 'manual' } });
    expect(pedidoDa(regra('inherit', ''))).toEqual({ rota: '/api/accounts/edit', corpo: { tipo: 'regra-review', user: 'farol-bot', organization: 'orga', mode: 'inherit' } });
    // os nomes e os modos que a rota lê, conferidos no motor
    const escopo = raiz('lib/engine/review-scope.js');
    for (const trecho of ['nome(op.organization)', 'nome(op.author)', "[...MODOS, 'inherit'].includes(op.mode)", "const MODOS = ['auto', 'manual'];"]) expect(escopo).toContain(trecho);
    expect(raiz('lib/engine/contas-config.js')).toContain("if (o.tipo === 'regra-review')");
  });

  it('o ritmo e a ordem dos perfis vão a settings', () => {
    expect(pedidoDa(ritmo())).toEqual({ rota: '/api/settings', corpo: { intervalSeconds: 600 } });
    expect(pedidoDa(ordem())).toEqual({ rota: '/api/settings', corpo: { claudeProfileId: 'b', claudeProfiles: [{ id: 'b', label: 'B', kind: 'dir' }, { id: 'a', label: 'A', kind: 'apikey', baseUrl: '' }] } });
    // as chaves que a tela manda existem na tabela do motor e ele as aceita pela tela
    const tabela = raiz('lib/settings.js');
    for (const chave of ['intervalSeconds', 'reReviewResume', 'autoPushback', 'reviewFast', 'claudeProfiles', 'claudeProfileId']) expect(tabela).toMatch(new RegExp(`key: '${chave}', def: [^,]+, ui: true`));
  });

  it('a revogação vai a auth/revoke com o id', () => {
    expect(pedidoDa(revogar(false))).toEqual({ rota: '/api/auth/revoke', corpo: { id: '0123456789abcdef' } });
    expect(pedidoDa(revogar(true))).toEqual({ rota: '/api/auth/revoke', corpo: { id: '0123456789abcdef' } });
  });

  it('não existe ação de teto, e só Subir na ordem manda claudeProfiles, sem segredo', () => {
    expect([...TIPOS_DO_SISTEMA]).toEqual(['conta', 'padroes', 'regra', 'automacao', 'ritmo', 'ordemDosPerfis', 'revogarSessao']);
    for (const acao of [conta(), padroes('x'), regra('auto'), automacao(), ritmo(), revogar(false)]) expect(JSON.stringify(pedidoDa(acao))).not.toContain('claudeProfiles');
    const corpoDaOrdem = JSON.stringify(pedidoDa(ordem()));
    for (const proibido of ['apiKey', '"dir":', 'temChave', 'budget']) expect(corpoDaOrdem).not.toContain(proibido);
    // nenhum fonte da tela (fora dos testes) monta perfil para o motor, menos o da ordem
    const pasta = path.resolve(import.meta.dirname, '..');
    const fontes = (fs.readdirSync(pasta, { recursive: true }) as string[])
      .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome))
      .map((nome) => [nome.replace(/\\/g, '/'), fs.readFileSync(path.join(pasta, nome), 'utf8')] as const);
    expect(fontes.length).toBeGreaterThan(60);
    // `claudeProfiles:` como chave de um objeto seria um corpo sendo montado (o tipo lido usa `?:`)
    expect(fontes.filter(([, fonte]) => /claudeProfiles\s*:/.test(fonte)).map(([nome]) => nome)).toEqual(['sistema/perfis.ts']);
    expect(fontes.filter(([, fonte]) => /claudeProfilesCru|PerfisCrus/.test(fonte)).map(([nome]) => nome)).toEqual([]);
    // o teto de gasto saiu do motor em 16/11/2026: nenhum fonte lê campo de teto nem bloqueio
    const comTeto = fontes.filter(([, fonte]) => /budget(Daily|Total|Since|ByWeekday|Dates|s\b)|temTeto|capHoje|tipicoReview/.test(fonte));
    expect(comTeto.map(([nome]) => nome)).toEqual([]);
  });

  it('rótulo, nome acessível e id', () => {
    const acoes = [conta(), padroes('x'), regra('auto'), regra('inherit'), automacao(), ritmo(), ordem(), revogar(true), revogar(false)];
    expect(acoes.map(rotuloDa)).toEqual(['Salvar conta e política', 'Salvar padrões', 'Salvar: revisa sozinho', 'Remover', 'Salvar automação', 'Salvar ritmo', 'Subir na ordem', 'Sair', 'Revogar']);
    expect(acoes.map(nomeDa)).toEqual([
      'Salvar conta e política de @farol-bot', 'Salvar os padrões do time de @farol-bot', 'Salvar a regra de @robo[bot] em orga: revisa sozinho', 'Remover a regra de @robo[bot] em orga',
      'Salvar automação', 'Salvar o ritmo da revisão', 'Subir B na ordem de uso', 'Sair deste navegador', 'Revogar a sessão "Outro"',
    ]);
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
  // 17/11/2026: os desfechos não esperam ninguém (sem `wait`), e só o liga e desliga da revisão
  // (autoReview) é lido ao começar; não há mesa para reavaliar.
  it('o motor lê o liga e desliga da revisão ao começar, e a política não segura a decisão', () => {
    expect(raiz('lib/engine/approval-policy.js')).not.toContain("motivo: 'politica'");
    expect(raiz('lib/engine/review-scope.js')).toContain('if (!retry && !engine.autoReviewFor(engine.accountForPr(pr))) return { automatic: false');
    // a mudança de configuração é emitida, e nenhum arquivo do motor a ouve
    const motor = ['server.js', ...(fs.readdirSync(path.resolve(import.meta.dirname, '../../../lib'), { recursive: true }) as string[]).filter((n) => n.endsWith('.js')).map((n) => `lib/${n}`)];
    const ouvintes = motor.filter((arquivo) => /\.on\(\s*['"]settings-changed['"]/.test(raiz(arquivo)));
    expect(ouvintes).toEqual([]);
  });

  it('a automação nunca pergunta: nenhuma das três chaves amplia o que o motor publica', () => {
    expect(confirmacaoDa(automacao())).toBeNull();
    expect(confirmacaoDa(automacao({ corpo: { reviewModel: 'auto', reviewEffort: 'xhigh', parallelReviews: 4 } }))).toBeNull();
  });

  it('sair e revogar perguntam sempre, e o sair avisa do pareamento', () => {
    expect(confirmacaoDa(revogar(false))?.confirmar).toBe('Revogar a sessão');
    expect(confirmacaoDa(revogar(true))?.texto).toContain('volta ao pareamento');
  });

  it('a regra que revisa sozinho e a remoção perguntam; a que põe no clique vai direto', () => {
    expect(confirmacaoDa(regra('manual'))).toBeNull();
    expect(confirmacaoDa(regra('auto'))?.texto).toContain('revisa e publica sozinho');
    expect(confirmacaoDa(regra('inherit'))?.texto).toContain('volta a seguir a regra da organização');
    expect(confirmacaoDa(regra('inherit', ''))?.texto).not.toContain('regra da organização');
  });

  it('padrões, ritmo e ordem dos perfis não perguntam: nada disso muda o que é publicado', () => {
    for (const acao of [padroes('x'), ritmo(), ordem()]) expect(confirmacaoDa(acao)).toBeNull();
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

  it('padrões: aceito, e ignorado pelo motor', async () => {
    expect(await executar(cliente({ ok: true, ignoradas: [], ignorados: [] }), padroes('a\nb'))).toEqual({ tipo: 'ok', texto: expect.stringContaining('os padrões do time agora têm 2 padrões') });
    expect(await executar(cliente({ ok: true, ignorados: ['padroesRevisao'] }), padroes('a'))).toEqual({ tipo: 'erro', texto: expect.stringContaining('ignorou os padrões do time') });
  });

  it('regra: gravada, tirada e recusada', async () => {
    expect(await executar(cliente({ ok: true, ignoradas: [], ignorados: [] }), regra('manual'))).toEqual({ tipo: 'ok', texto: expect.stringContaining('gravou a regra de @robo[bot] em orga: só no clique') });
    expect(await executar(cliente({ ok: true }), regra('inherit'))).toEqual({ tipo: 'ok', texto: expect.stringContaining('tirou a regra de @robo[bot] em orga') });
    expect(await executar(cliente({ ok: false, erro: 'Modo de review inválido.' }), regra('auto'))).toEqual({ tipo: 'erro', texto: 'O motor recusou: Modo de review inválido.' });
  });

  it('ritmo: gravou, e gravou diferente', async () => {
    expect(await executar(cliente({ ok: true, config: { intervalSeconds: 600 } }), ritmo())).toEqual({ tipo: 'ok', texto: 'O motor gravou: checagem do GitHub: a cada 10 minutos.' });
    expect(await executar(cliente({ ok: true, config: { intervalSeconds: 300 } }), ritmo())).toEqual({ tipo: 'erro', texto: expect.stringContaining('checagem do GitHub ficou a cada 5 minutos') });
  });

  it('ordem dos perfis: gravou, gravou diferente, e a recusa do endereço da chave', async () => {
    const gravada = { claudeProfileId: 'b', claudeProfiles: [{ id: 'a', label: 'A', kind: 'apikey', temChave: true }, { id: 'b', label: 'B', kind: 'dir' }] };
    expect(await executar(cliente({ ok: true, config: gravada }), ordem())).toEqual({ tipo: 'ok', texto: expect.stringContaining('O motor gravou a ordem de uso: B, A.') });
    expect(await executar(cliente({ ok: true, config: { ...gravada, claudeProfileId: 'a' } }), ordem())).toEqual({ tipo: 'erro', texto: 'O motor gravou diferente do pedido: a ordem ficou a, b, e o pedido era b, a.' });
    // recusaDoEndereco (lib/engine/chave-do-perfil.js) responde `code` e `erro`
    expect(await executar(cliente({ ok: false, code: 'chave_exigida', erro: 'Para mudar o endereço deste perfil, digite a chave de novo.' }), ordem())).toEqual({ tipo: 'erro', texto: 'O motor recusou: Para mudar o endereço deste perfil, digite a chave de novo.' });
  });

  it('revogação: a de outra sessão, a deste navegador e a que o motor não tinha mais', async () => {
    expect(await executar(cliente({ ok: true, eraAtual: false }), revogar(false))).toEqual({ tipo: 'ok', texto: 'O motor revogou a sessão "Outro": o token dela não vale mais.' });
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
