import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContaRevisora } from '@/contratos/sistema';
import {
  DOMINIO_DA_POLITICA, OPCOES_DA_TELA, PUBLICA, ampliacoesDaConta, camposAlterados, corpoDaConta, efeitoDaRevisaoAutomatica, efeitoDoDesfecho,
  marcaDaConta, nomeDoCampoDaConta, notaDasRessalvasTravadas, organizacaoValida, organizacoesMescladas, rascunhoDaConta, refazerConta, resumoDaPolitica, rotuloDoValor,
  temOrganizacao, textoDoToken, textoDosCampos, textosDosConflitos, type RascunhoDaConta,
} from './politica';

// O motor é lido por texto, como em src/time/taxonomia.test.ts.
const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');

const CONTA: ContaRevisora = { user: 'farol-bot', owners: ['biudtech'], tokenOk: true, autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait', regrasDeReview: 0 };
const ABERTA: ContaRevisora = { ...CONTA, autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' };

describe('a política é a do motor', () => {
  it('o domínio de cada campo é o de DOMINIO_DA_POLITICA, em lib/settings.js', () => {
    const fonte = raiz('lib/settings.js');
    const bloco = /const DOMINIO_DA_POLITICA = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(fonte);
    expect(bloco).not.toBeNull();
    const doMotor = Object.fromEntries([...(bloco?.[1] ?? '').matchAll(/(\w+): \[([^\]]*)\]/g)].map((m) => [
      m[1] as string,
      (m[2] as string).split(',').map((v) => v.trim()).map((v) => (v === 'true' ? true : v === 'false' ? false : v.replace(/'/g, ''))),
    ]));
    expect(doMotor).toEqual(DOMINIO_DA_POLITICA);
  });

  it('os campos que a tela manda são campos que a rota edita (CAMPOS_EDITAVEIS)', () => {
    const fonte = raiz('lib/engine/contas-config.js');
    const lista = /const CAMPOS_EDITAVEIS = Object\.freeze\(\[([^\]]*)\]\)/.exec(fonte);
    const editaveis = [...(lista?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    for (const campo of ['owners', 'autoReview', 'onClean', 'onCaveats', 'onReject']) expect(editaveis).toContain(campo);
    // a regra que a tela repete no formulário: o com ressalvas nunca é mais permissivo
    expect(fonte).toContain("if (nova.onClean === 'wait') nova.onCaveats = 'wait';");
  });

  it('o valor que publica sozinho, por desfecho', () => {
    expect(PUBLICA).toEqual({ onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
  });

  it('a tela só oferece publicar: nenhuma opção é esperar, e toda opção está no domínio do motor', () => {
    expect(OPCOES_DA_TELA).toEqual({ onClean: ['approve'], onCaveats: ['approve'], onReject: ['request_changes'] });
    for (const campo of ['onClean', 'onCaveats', 'onReject'] as const) {
      expect(OPCOES_DA_TELA[campo]).not.toContain('wait');
      for (const opcao of OPCOES_DA_TELA[campo]) expect(DOMINIO_DA_POLITICA[campo] as readonly string[]).toContain(opcao);
    }
  });
});

// `visto` é o que a pessoa tinha na tela ao começar a editar; `conta` é o motor de agora.
const editar = (conta: ContaRevisora, mudanca: Partial<RascunhoDaConta>) => camposAlterados(rascunhoDaConta(conta), { ...rascunhoDaConta(conta), ...mudanca }, conta);

describe('camposAlterados: só o que a pessoa alterou nesta edição', () => {
  it('sem edição não há campo', () => {
    expect(editar(CONTA, {})).toEqual({});
  });

  it('um campo editado vai sozinho', () => {
    expect(editar(CONTA, { onReject: 'request_changes' })).toEqual({ onReject: 'request_changes' });
    expect(editar(CONTA, { autoReview: true })).toEqual({ autoReview: true });
  });

  it('esperar nunca vai, nem quando o formulário o tem (a tela não oferece; o revisor nunca espera)', () => {
    expect(editar(ABERTA, { onClean: 'wait' })).toEqual({});
    expect(editar(ABERTA, { onReject: 'wait', onCaveats: 'wait' })).toEqual({});
    expect(editar(ABERTA, { onReject: 'wait', autoReview: false })).toEqual({ autoReview: false });
  });

  it('as organizações vão como lista inteira', () => {
    expect(editar(CONTA, { owners: ['biudtech', 'acme'] })).toEqual({ owners: ['biudtech', 'acme'] });
    expect(editar(CONTA, { owners: [] })).toEqual({ owners: [] });
  });

  it('com o limpo em espera (vindo do motor), o com ressalvas não vai: o motor o põe em espera sozinho', () => {
    expect(editar(CONTA, { onCaveats: 'approve' })).toEqual({});
    // trocar o limpo para publicar libera o com ressalvas
    expect(editar(CONTA, { onClean: 'approve', onCaveats: 'approve' })).toEqual({ onClean: 'approve', onCaveats: 'approve' });
  });

  it('valor fora do domínio, ou vazio, nunca vai (vazio faria o motor regravar o padrão, que publica)', () => {
    expect(editar(ABERTA, { onClean: '', onReject: 'merge' })).toEqual({});
    const semPolitica: ContaRevisora = { user: 'farol-bot', owners: [], regrasDeReview: 0 };
    expect(editar(semPolitica, {})).toEqual({});
  });

  it('campo que OUTRA pessoa mudou no motor não vai no corpo, e por isso não é revertido', () => {
    const visto = rascunhoDaConta(CONTA);
    // ela só mexeu na reprovada; nesse meio alguém pôs a limpa para publicar e ligou a revisão automática
    const agora: ContaRevisora = { ...CONTA, onClean: 'approve', autoReview: true };
    expect(camposAlterados(visto, { ...visto, onReject: 'request_changes' }, agora)).toEqual({ onReject: 'request_changes' });
  });

  it('o que ela alterou e o motor já tem igual não vai de novo', () => {
    const visto = rascunhoDaConta(CONTA);
    expect(camposAlterados(visto, { ...visto, onReject: 'request_changes' }, { ...CONTA, onReject: 'request_changes' })).toEqual({});
  });

  it('organização que outra pessoa pôs ou tirou nesse meio fica como o motor a tem', () => {
    const visto = rascunhoDaConta({ ...CONTA, owners: ['biudtech', 'velha'] });
    const rascunho = { ...visto, owners: ['biudtech', 'acme'] };
    // ela tirou "velha" e pôs "acme"; alguém pôs "outra" e tirou "biudtech"
    expect(camposAlterados(visto, rascunho, { ...CONTA, owners: ['velha', 'outra'] })).toEqual({ owners: ['outra', 'acme'] });
    expect(organizacoesMescladas(['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'd'])).toEqual(['a', 'b', 'd', 'c']);
    expect(organizacoesMescladas(['a', 'b'], ['a'], ['A', 'B', 'd'])).toEqual(['A', 'd']);
    // o que ela pôs e o motor já tem não é repetido
    expect(organizacoesMescladas(['a'], ['a', 'c'], ['a', 'C'])).toEqual(['a', 'C']);
  });

  it('o corpo é a operação de editar, com a conta e os campos', () => {
    expect(corpoDaConta('farol-bot', { onClean: 'approve' })).toEqual({ tipo: 'editar', user: 'farol-bot', campos: { onClean: 'approve' } });
  });
});

describe('refazerConta: o rascunho sobre o valor novo do motor', () => {
  const visto = rascunhoDaConta(ABERTA);

  it('o campo que ela não tocou passa a ser o do motor; o que ela tocou fica', () => {
    const novo = rascunhoDaConta({ ...ABERTA, autoReview: false, owners: ['biudtech', 'outra'] });
    expect(refazerConta(visto, { ...visto, onReject: 'wait' }, novo)).toEqual({
      valor: { owners: ['biudtech', 'outra'], autoReview: false, onClean: 'approve', onCaveats: 'approve', onReject: 'wait' },
      conflitos: [],
    });
  });

  it('o mesmo campo mexido pelos dois, cada um para um valor, é conflito; para o mesmo valor, não', () => {
    const base = rascunhoDaConta({ ...ABERTA, onClean: 'merge' });
    const refeito = refazerConta(base, { ...base, onClean: 'approve', autoReview: false }, { ...base, onClean: 'wait', autoReview: false });
    expect(refeito.valor.onClean).toBe('approve');
    expect(refeito.conflitos).toEqual(['onClean']);
  });

  it('o conflito é dito com os dois valores, e some quando os dois ficam iguais', () => {
    const conta: ContaRevisora = { ...ABERTA, onClean: 'wait', autoReview: false };
    const rascunho = { ...visto, onClean: 'approve', autoReview: true };
    expect(textosDosConflitos(['onClean', 'autoReview'], conta, rascunho)).toEqual([
      'Revisão automática: no motor agora está "desligada", e no seu formulário, "ligada". Salvar grava o seu.',
      'Revisão limpa: no motor agora está "esperar (definido no motor)", e no seu formulário, "publicar a aprovação sozinho". Salvar grava o seu.',
    ]);
    expect(textosDosConflitos(['onClean'], conta, { ...rascunho, onClean: 'wait' })).toEqual([]);
    expect(textosDosConflitos([], conta, rascunho)).toEqual([]);
  });
});

describe('o com ressalvas quando o limpo espera', () => {
  it('a nota diz a regra do motor e como liberar, e o valor do formulário quando ele difere', () => {
    expect(notaDasRessalvasTravadas(rascunhoDaConta(CONTA))).toBe('Esperar (definido no motor): com a revisão limpa em espera, o motor põe esta em espera também (o com ressalvas nunca é mais permissivo que o limpo). Troque a limpa para publicar para liberar este campo.');
    expect(notaDasRessalvasTravadas({ ...rascunhoDaConta(CONTA), onCaveats: 'approve' })).toContain('Este campo está em "publicar a aprovação sozinho" no formulário');
  });
});

describe('ampliacoesDaConta: o que amplia a publicação automática', () => {
  it('ligar a revisão automática e trocar esperar por publicar ampliam, cada um com o efeito dito', () => {
    const ampliacoes = ampliacoesDaConta(CONTA, { autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' });
    expect(ampliacoes).toHaveLength(4);
    expect(ampliacoes[0]).toContain('Revisão automática ligada');
    expect(ampliacoes[1]).toContain('APPROVE');
    expect(ampliacoes[1]).toContain('@farol-bot');
    expect(ampliacoes[2]).toContain('com ressalvas');
    expect(ampliacoes[3]).toContain('REQUEST_CHANGES');
  });

  it('o que reduz não entra', () => {
    expect(ampliacoesDaConta(ABERTA, { autoReview: false, onClean: 'wait', onReject: 'wait', owners: [] })).toEqual([]);
  });

  it('organização nova amplia; a que já estava (em outra caixa) não', () => {
    const ampliacoes = ampliacoesDaConta(CONTA, { owners: ['BiudTech', 'acme'] });
    expect(ampliacoes).toHaveLength(1);
    expect(ampliacoes[0]).toContain('Organização acme');
  });

  it('campo que já publicava não conta de novo', () => {
    expect(ampliacoesDaConta(ABERTA, { onClean: 'approve', autoReview: true })).toEqual([]);
  });
});

describe('textos', () => {
  it('cada valor de desfecho tem o efeito dito, e o desconhecido não é inventado', () => {
    expect(efeitoDoDesfecho('onClean', 'approve')).toContain('APPROVE');
    expect(efeitoDoDesfecho('onCaveats', 'approve')).toContain('mesmo com ressalvas');
    expect(efeitoDoDesfecho('onReject', 'request_changes')).toContain('REQUEST_CHANGES');
    // o esperar só existe quando vem do motor: o texto diz isso e não promete mesa nem clique
    expect(efeitoDoDesfecho('onReject', 'wait')).toContain('definido no motor');
    expect(efeitoDoDesfecho('onReject', 'wait')).not.toMatch(/Precisa de você|seu clique/);
    expect(efeitoDoDesfecho('onClean', 'merge')).toContain('não conhece');
    expect(efeitoDoDesfecho('onClean', undefined)).toContain('não conhece');
    expect(rotuloDoValor('onClean', 'approve')).toBe('Publicar a aprovação sozinho');
    expect(rotuloDoValor('onReject', 'request_changes')).toBe('Publicar o pedido de mudanças sozinho');
    expect(rotuloDoValor('onReject', 'wait')).toBe('Esperar (definido no motor)');
    expect(rotuloDoValor('onClean', 'merge')).toBe('merge (valor que esta tela não conhece)');
  });

  it('a revisão automática, o token e os campos numa frase', () => {
    expect(efeitoDaRevisaoAutomatica(true)).toContain('abre sozinho');
    expect(efeitoDaRevisaoAutomatica(false)).toContain('só entra na fila');
    expect(efeitoDaRevisaoAutomatica(undefined)).toBe('O motor não mandou este campo.');
    expect(textoDoToken(true)).toContain('Presente');
    expect(textoDoToken(false)).toContain('Ausente');
    expect(textoDoToken(undefined)).toBe('O motor não informou.');
    expect(textoDosCampos({ onClean: 'approve', owners: ['biudtech', 'acme'], autoReview: true })).toBe('organizações monitoradas: biudtech, acme; revisão automática: ligada; revisão limpa: publicar sozinho');
    expect(textoDosCampos({ owners: [] })).toBe('organizações monitoradas: nenhuma');
    expect(nomeDoCampoDaConta('onCaveats')).toBe('revisão com ressalvas');
    expect(nomeDoCampoDaConta('constructor')).toBe('constructor');
  });

  it('o resumo da política na linha fechada', () => {
    expect(resumoDaPolitica(ABERTA)).toBe('publica sozinho');
    expect(resumoDaPolitica({ ...ABERTA, autoReview: false })).toBe('revisão automática desligada');
    expect(resumoDaPolitica({ ...ABERTA, onClean: 'wait', onCaveats: 'wait' })).toBe('2 desfechos esperam, definido no motor');
    expect(resumoDaPolitica({ ...ABERTA, onReject: 'wait' })).toBe('1 desfecho espera, definido no motor');
    expect(resumoDaPolitica({ autoReview: true })).toBe('política incompleta');
  });

  it('nome de organização: letras, dígitos e hífen, sem hífen nas pontas, até 39', () => {
    for (const boa of ['biudtech', 'Outra-Org', 'a', 'a1', 'x'.repeat(39)]) expect(organizacaoValida(boa)).toBe(true);
    for (const ruim of ['', ' ', '-a', 'a-', 'a b', 'a/b', 'x'.repeat(40), 'ação']) expect(organizacaoValida(ruim)).toBe(false);
    expect(temOrganizacao(['BiudTech'], ' biudtech ')).toBe(true);
    expect(temOrganizacao(['biudtech'], 'acme')).toBe(false);
  });

  it('a marca muda com qualquer campo e com a ordem das organizações', () => {
    const base = rascunhoDaConta(ABERTA);
    expect(marcaDaConta(base)).toBe(marcaDaConta(rascunhoDaConta({ ...ABERTA })));
    expect(marcaDaConta({ ...base, owners: ['a', 'b'] })).not.toBe(marcaDaConta({ ...base, owners: ['b', 'a'] }));
    expect(marcaDaConta({ ...base, onReject: 'wait' })).not.toBe(marcaDaConta(base));
  });
});
