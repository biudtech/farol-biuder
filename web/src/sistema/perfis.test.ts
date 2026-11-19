import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerConfigDoSistema } from '@/contratos/sistema';
import { corpoDeSubir, diferencaDaOrdem, idDoPadrao, impedimentoDaOrdem, ordemDeUso } from './perfis';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');
const CHAVE = ['sk', 'ant', 'api03', 'DDDDDDDDDDDDDDDDDDDD'].join('-');

// Como configParaFora (lib/engine/chave-do-perfil.js) manda: o de chave sem `apiKey`.
const A = { id: 'a', label: 'Primeiro', kind: 'dir', dir: '/home/farol/.farol/claude/a' };
const B = { id: 'b', label: 'Segundo', kind: 'apikey', baseUrl: '', temChave: true };
const C = { id: 'c', label: '', kind: 'dir', dir: '' };
const ler = (bruto: unknown) => lerConfigDoSistema(bruto, () => {});

describe('a ordem de uso dos perfis', () => {
  it('é a do motor: o padrão primeiro, depois a lista', () => {
    expect(raiz('lib/engine/perfil-claude.js')).toContain('o padrão (`claudeProfileId`)\n * primeiro, depois os demais na ordem da lista');
    expect(ordemDeUso(ler({ claudeProfileId: 'c', claudeProfiles: [A, B, C] })).map((p) => p.id)).toEqual(['c', 'a', 'b']);
    // padrão que não está na lista não vale: o motor usa a lista como veio
    expect(ordemDeUso(ler({ claudeProfileId: 'x', claudeProfiles: [A, B] })).map((p) => p.id)).toEqual(['a', 'b']);
    expect(idDoPadrao(ler({ claudeProfileId: 'x', claudeProfiles: [A, B] }))).toBeNull();
    expect(ordemDeUso(undefined)).toEqual([]);
  });

  it('subir troca com o de cima; o primeiro vira o padrão', () => {
    const config = ler({ claudeProfileId: 'a', claudeProfiles: [A, B, C] });
    expect(corpoDeSubir(config, 'b')).toEqual({
      claudeProfileId: 'b',
      claudeProfiles: [{ id: 'b', label: 'Segundo', kind: 'apikey', baseUrl: '' }, { id: 'a', label: 'Primeiro', kind: 'dir' }, { id: 'c', label: '', kind: 'dir' }],
    });
    expect(corpoDeSubir(config, 'c')?.claudeProfiles.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(corpoDeSubir(config, 'c')?.claudeProfileId).toBe('a');
    expect(corpoDeSubir(config, 'a')).toBeNull();
    expect(corpoDeSubir(config, 'nada')).toBeNull();
  });

  it('o corpo nunca leva chave, pasta, presença da chave nem campo de teto', () => {
    const config = ler({ claudeProfileId: 'a', claudeProfiles: [A, { ...B, budgetDaily: 5 }, C] });
    const corpo = JSON.stringify(corpoDeSubir(config, 'b'));
    for (const proibido of ['apiKey', '"dir":', 'temChave', 'budget', '/home/farol']) expect(corpo).not.toContain(proibido);
  });

  it('com parte da lista descartada na borda, a tela não monta o corpo', () => {
    const comSegredo = ler({ claudeProfileId: 'a', claudeProfiles: [A, { ...B, apiKey: CHAVE }] });
    expect(impedimentoDaOrdem(comSegredo)).toMatch(/fora da forma/);
    expect(corpoDeSubir(comSegredo, 'b')).toBeNull();
    const torta = ler({ claudeProfileId: 'a', claudeProfiles: [A, B, { label: 'sem id' }] });
    expect(torta.perfisIlegiveis).toBe(1);
    expect(corpoDeSubir(torta, 'b')).toBeNull();
    const tipoNovo = ler({ claudeProfileId: 'a', claudeProfiles: [A, { id: 'n', kind: 'outro' }] });
    expect(corpoDeSubir(tipoNovo, 'n')).toBeNull();
    expect(impedimentoDaOrdem(ler({}))).toMatch(/não mandou/);
  });

  it('a conferência compara a ordem de uso gravada com a pedida', () => {
    const corpo = corpoDeSubir(ler({ claudeProfileId: 'a', claudeProfiles: [A, B] }), 'b');
    if (!corpo) throw new Error('sem corpo');
    expect(diferencaDaOrdem(corpo, ler({ claudeProfileId: 'b', claudeProfiles: [B, A] }))).toBeNull();
    expect(diferencaDaOrdem(corpo, ler({ claudeProfileId: 'a', claudeProfiles: [A, B] }))).toBe('a ordem ficou a, b, e o pedido era b, a');
    expect(diferencaDaOrdem(corpo, ler({}))).toBeNull();
  });
});
