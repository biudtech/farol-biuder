import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerContas } from '@/contratos/sistema';
import { TETO_GRAVADO, TETO_NO_PROMPT, contagemDosPadroes, marcaDosPadroes, padroesComoGravados, quantosPadroes, resumoDosPadroes, textoDosPadroes } from './padroes';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');
const TOKEN = `ghp_${'a1B2c3D4'.repeat(4)}`;

describe('os padrões do time', () => {
  it('os tetos são os do motor', () => {
    expect(raiz('lib/parse.js')).toContain(`const TETO_PADROES_GRAVADO = ${TETO_GRAVADO};`);
    expect(raiz('lib/engine/padroes-do-time.js')).toContain(`const TETO_NO_PROMPT = ${TETO_NO_PROMPT};`);
  });

  it('o leitor tolera entrada torta e troca o trecho com cara de segredo', () => {
    const ler = (padroesRevisao: unknown) => lerContas([{ user: 'conta', owners: [], padroesRevisao }], () => {})?.[0];
    expect(ler(undefined)?.padroes).toBeUndefined();
    expect(ler(42)?.padroes).toBeUndefined();
    expect(ler('Teste em todo endpoint.')).toMatchObject({ padroes: 'Teste em todo endpoint.' });
    expect(ler('Teste em todo endpoint.')?.padroesComSegredo).toBeUndefined();
    const comSegredo = ler(`Use o token ${TOKEN} no teste.`);
    expect(comSegredo?.padroes).toBe('Use o token [segredo omitido] no teste.');
    expect(comSegredo?.padroesComSegredo).toBe(true);
  });

  it('o texto como o motor grava, a marca e a contagem', () => {
    expect(padroesComoGravados('  a\n')).toBe('a');
    expect(marcaDosPadroes('a\n\n')).toBe(marcaDosPadroes('a'));
    expect(padroesComoGravados('x'.repeat(TETO_GRAVADO + 5))).toHaveLength(TETO_GRAVADO);
    expect(contagemDosPadroes('abc')).toBe('3 de 6.000 caracteres que entram na revisão.');
    expect(contagemDosPadroes('x'.repeat(6001))).toBe('6.001 caracteres: só os primeiros 6.000 entram na revisão, e o resto fica gravado sem uso.');
  });

  it('cada linha não vazia é um padrão', () => {
    expect(quantosPadroes('a\n\n b \n')).toBe(2);
    expect(quantosPadroes(undefined)).toBe(0);
    expect([undefined, 'a', 'a\nb'].map(resumoDosPadroes)).toEqual(['Nenhum padrão', '1 padrão', '2 padrões']);
    expect(textoDosPadroes('  ')).toBe('os padrões do time foram tirados: a revisão segue sem eles');
    expect(textoDosPadroes('a\nb')).toBe('os padrões do time agora têm 2 padrões (3 caracteres)');
  });
});
