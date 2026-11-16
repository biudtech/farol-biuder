import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOMINIOS, NIVEIS, PAPEIS, ehConhecido, rotuloDoDominio, rotuloDoNivel, rotuloDoPapel, type Opcao } from './taxonomia';

// O motor é lido por texto, como em src/historico/rotulos.test.ts: importar o arquivo dele
// puxaria o motor para dentro do front.
const FONTE = fs.readFileSync(path.resolve(import.meta.dirname, '../../../lib/taxonomy.js'), 'utf8');

function lista(nome: string): string[] {
  const achado = new RegExp(`const ${nome} = \\[([^\\]]*)\\]`).exec(FONTE);
  if (!achado) throw new Error(`não achei ${nome} em lib/taxonomy.js`);
  return [...(achado[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

function mapa(nome: string): Record<string, string> {
  const achado = new RegExp(`const ${nome} = \\{([^}]*)\\}`).exec(FONTE);
  if (!achado) throw new Error(`não achei ${nome} em lib/taxonomy.js`);
  return Object.fromEntries([...(achado[1] as string).matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1] as string, m[2] as string]));
}

// a tabela da tela, como o motor a escreveria: as chaves na ordem dele, cada uma com o rótulo
const doMotor = (chaves: string, rotulos: string): Opcao[] => lista(chaves).map((chave) => [chave, mapa(rotulos)[chave] ?? '']);

describe('a taxonomia do perfil é a do motor', () => {
  it('papéis, na ordem e com os rótulos de lib/taxonomy.js', () => {
    expect(lista('PAPEL_LEVELS').length).toBeGreaterThan(0);
    expect(PAPEIS).toEqual(doMotor('PAPEL_LEVELS', 'PAPEL_LABEL'));
  });

  it('domínios', () => {
    expect(lista('DOMAINS').length).toBeGreaterThan(0);
    expect(DOMINIOS).toEqual(doMotor('DOMAINS', 'DOMAIN_LABEL'));
  });

  it('níveis de competência', () => {
    expect(lista('DOMAIN_LEVELS').length).toBeGreaterThan(0);
    expect(NIVEIS).toEqual(doMotor('DOMAIN_LEVELS', 'DOMAIN_LEVEL_LABEL'));
  });
});

describe('rótulos', () => {
  it('valor conhecido vira rótulo, e o desconhecido aparece cru', () => {
    expect(rotuloDoPapel('techlead')).toBe('Tech Lead');
    expect(rotuloDoPapel('papel_novo')).toBe('papel_novo');
    expect(rotuloDoDominio('infra')).toBe('Infra/DevOps');
    expect(rotuloDoDominio('mobile')).toBe('mobile');
    expect(rotuloDoNivel('intermediario')).toBe('Intermediário');
    expect(rotuloDoNivel('constructor')).toBe('constructor');
  });

  it('ehConhecido só olha a tabela', () => {
    expect(ehConhecido(PAPEIS, 'senior')).toBe(true);
    expect(ehConhecido(PAPEIS, 'toString')).toBe(false);
  });
});
