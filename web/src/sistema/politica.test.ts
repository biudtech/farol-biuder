import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContaRevisora } from '@/contratos/sistema';
import {
  DOMINIO_DA_POLITICA, PUBLICA, ampliacoesDaConta, camposAlterados, corpoDaConta, efeitoDaRevisaoAutomatica, efeitoDoDesfecho,
  marcaDaConta, nomeDoCampoDaConta, organizacaoValida, rascunhoDaConta, rotuloDoValor, temOrganizacao, textoDoToken, textoDosCampos,
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
});

describe('camposAlterados: só o que mudou', () => {
  it('sem edição não há campo', () => {
    expect(camposAlterados(CONTA, rascunhoDaConta(CONTA))).toEqual({});
  });

  it('um campo editado vai sozinho', () => {
    expect(camposAlterados(ABERTA, { ...rascunhoDaConta(ABERTA), onReject: 'wait' })).toEqual({ onReject: 'wait' });
    expect(camposAlterados(CONTA, { ...rascunhoDaConta(CONTA), autoReview: true })).toEqual({ autoReview: true });
  });

  it('as organizações vão como lista inteira, na ordem do formulário', () => {
    expect(camposAlterados(CONTA, { ...rascunhoDaConta(CONTA), owners: ['biudtech', 'acme'] })).toEqual({ owners: ['biudtech', 'acme'] });
    expect(camposAlterados(CONTA, { ...rascunhoDaConta(CONTA), owners: [] })).toEqual({ owners: [] });
  });

  it('com o limpo em espera, o com ressalvas não vai: o motor o põe em espera sozinho', () => {
    expect(camposAlterados(ABERTA, { ...rascunhoDaConta(ABERTA), onClean: 'wait' })).toEqual({ onClean: 'wait' });
    expect(camposAlterados(CONTA, { ...rascunhoDaConta(CONTA), onCaveats: 'approve' })).toEqual({});
  });

  it('valor fora do domínio, ou vazio, nunca vai (vazio faria o motor regravar o padrão, que publica)', () => {
    expect(camposAlterados(ABERTA, { ...rascunhoDaConta(ABERTA), onClean: '', onReject: 'merge' })).toEqual({});
    const semPolitica: ContaRevisora = { user: 'farol-bot', owners: [], regrasDeReview: 0 };
    expect(camposAlterados(semPolitica, rascunhoDaConta(semPolitica))).toEqual({});
  });

  it('o corpo é a operação de editar, com a conta e os campos', () => {
    expect(corpoDaConta('farol-bot', { onClean: 'wait' })).toEqual({ tipo: 'editar', user: 'farol-bot', campos: { onClean: 'wait' } });
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
    expect(efeitoDoDesfecho('onReject', 'wait')).toContain('Precisa de você');
    expect(efeitoDoDesfecho('onClean', 'merge')).toContain('não conhece');
    expect(efeitoDoDesfecho('onClean', undefined)).toContain('não conhece');
    expect(rotuloDoValor('onClean', 'approve')).toBe('Publicar a aprovação sozinho');
    expect(rotuloDoValor('onReject', 'request_changes')).toBe('Publicar o pedido de mudanças sozinho');
    expect(rotuloDoValor('onReject', 'wait')).toBe('Esperar você');
    expect(rotuloDoValor('onClean', 'merge')).toBe('merge (valor que esta tela não conhece)');
  });

  it('a revisão automática, o token e os campos numa frase', () => {
    expect(efeitoDaRevisaoAutomatica(true)).toContain('abre sozinho');
    expect(efeitoDaRevisaoAutomatica(false)).toContain('só entra na fila');
    expect(efeitoDaRevisaoAutomatica(undefined)).toBe('O motor não mandou este campo.');
    expect(textoDoToken(true)).toContain('Presente');
    expect(textoDoToken(false)).toContain('Ausente');
    expect(textoDoToken(undefined)).toBe('O motor não informou.');
    expect(textoDosCampos({ onClean: 'wait', owners: ['biudtech', 'acme'], autoReview: true })).toBe('organizações monitoradas: biudtech, acme; revisão automática: ligada; revisão limpa: esperar você');
    expect(textoDosCampos({ owners: [] })).toBe('organizações monitoradas: nenhuma');
    expect(nomeDoCampoDaConta('onCaveats')).toBe('revisão com ressalvas');
    expect(nomeDoCampoDaConta('constructor')).toBe('constructor');
  });

  it('nome de organização: letras, dígitos e hífen, sem hífen nas pontas, até 39', () => {
    for (const boa of ['biudtech', 'Edicoes-CNBB', 'a', 'a1', 'x'.repeat(39)]) expect(organizacaoValida(boa)).toBe(true);
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
