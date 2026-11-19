import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PrDeFora } from '@/contratos/de-fora';
import { VALIDADE_DA_LABEL_HORAS, contarPorMotivo, filtrarDeFora, fraseDoMotivo } from './de-fora';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const HORA_MS = 3600 * 1000;

const FUSO = 'UTC';
// 19/11/2026 18:30 em UTC
const AS_18_30 = Date.UTC(2026, 10, 19, 18, 30);

function item(extra: Partial<PrDeFora> & Pick<PrDeFora, 'motivo'>): PrDeFora {
  return { key: 'dono/repo#12', detalhe: {}, ...extra };
}

describe('a frase de cada motivo de De fora', () => {
  it('decisão de gente: quem aprovou o commit, com o head e a hora, e volta no próximo commit', () => {
    const f = fraseDoMotivo(item({
      motivo: 'decisao_de_gente', head: '30438ba4c0ffee', quem: ['bia'],
      detalhe: { decisivos: [{ quem: 'bia', estado: 'APPROVED', em: '2026-11-19T18:30:00Z' }] },
    }), FUSO);
    expect(f).toEqual({
      tom: 'ok',
      titulo: 'bia aprovou este commit',
      detalhe: 'bia aprovou o head 30438ba em 19/11, 18:30. O Farol não revisa por cima.',
      volta: 'Volta à fila no próximo commit.',
    });
  });

  it('decisão de gente: pediu mudanças, e mais de uma pessoa', () => {
    const f = fraseDoMotivo(item({
      motivo: 'decisao_de_gente',
      detalhe: { decisivos: [{ quem: 'caio', estado: 'CHANGES_REQUESTED' }, { quem: 'bia', estado: 'APPROVED', em: 'quebrado' }] },
    }), FUSO);
    expect(f.titulo).toBe('caio pediu mudanças neste commit');
    expect(f.detalhe).toBe('caio pediu mudanças e bia aprovou neste commit. O Farol não revisa por cima.');
  });

  it('decisão de gente sem o detalhe: a frase genérica, sem inventar quem', () => {
    expect(fraseDoMotivo(item({ motivo: 'decisao_de_gente' }), FUSO).titulo).toBe('Uma pessoa já revisou este commit');
  });

  it('outra conta: pela label, com quem e desde quando; pela saída de cena, no head', () => {
    const label = fraseDoMotivo(item({ motivo: 'outra_conta', quem: ['carla'], desde: AS_18_30, detalhe: { fonte: 'label' } }), FUSO);
    expect(label).toEqual({
      tom: 'neutro',
      titulo: 'Outra conta está revisando',
      detalhe: 'O PR está com a label de revisão de carla desde 19/11, 18:30.',
      volta: 'Volta sozinho se a label sair sem review naquele commit, ou 3 horas depois de o Farol ver a label, quando ela vale como esquecida.',
    });
    const saida = fraseDoMotivo(item({ motivo: 'outra_conta', quem: ['carla', 'davi'], detalhe: { fonte: 'saida_de_cena' } }), FUSO);
    expect(saida.titulo).toBe('Outra conta está revisando');
    expect(saida.detalhe).toBe('carla e davi já estavam revisando este commit, e o Farol saiu de cena.');
    expect(saida.volta).toBe('Volta à fila no próximo commit.');
  });

  it('a validade da label escrita na frase é a do motor (SINAL_REVISAO_TTL_MS)', async () => {
    const { TEMPOS } = await import(/* @vite-ignore */ pathToFileURL(path.join(RAIZ, 'lib/constants.js')).href) as { TEMPOS: { SINAL_REVISAO_TTL_MS: number } };
    expect(VALIDADE_DA_LABEL_HORAS * HORA_MS).toBe(TEMPOS.SINAL_REVISAO_TTL_MS);
    const label = fraseDoMotivo(item({ motivo: 'outra_conta', quem: ['carla'], detalhe: { fonte: 'label' } }), FUSO);
    expect(label.volta).toContain(`${TEMPOS.SINAL_REVISAO_TTL_MS / HORA_MS} horas depois`);
  });

  it('parado por falha: o motivo do motor, e volta sozinho com commit ou pedido novo', () => {
    const f = fraseDoMotivo(item({ motivo: 'estacionado', desde: AS_18_30, detalhe: { tipo: 'esgotado', motivo: 'card BT-848 ilegível.' } }), FUSO);
    expect(f).toEqual({
      tom: 'falha',
      titulo: 'Parado por falha',
      detalhe: 'A revisão automática falhou várias vezes seguidas (último erro: card BT-848 ilegível) em 19/11, 18:30.',
      volta: 'Volta sozinho com commit novo ou pedido novo de revisão.',
    });
    expect(fraseDoMotivo(item({ motivo: 'estacionado', detalhe: { tipo: 'autenticacao' } }), FUSO).volta).toBe('Volta sozinho com commit novo ou pedido novo de revisão.');
    expect(fraseDoMotivo(item({ motivo: 'estacionado', detalhe: {} }), FUSO).detalhe).toBe('A revisão automática parou: falhou.');
  });

  it('parado por cancelamento ou sem motivo gravado (legado) não volta sozinho, como no destrave do motor', () => {
    const NAO_VOLTA = 'Não volta sozinho: Revisar mesmo assim abre a revisão.';
    const cancelado = fraseDoMotivo(item({ motivo: 'estacionado', detalhe: { tipo: 'cancelado' } }), FUSO);
    expect(cancelado.detalhe).toBe('A revisão automática parou: a última sessão foi cancelada.');
    expect(cancelado.volta).toBe(NAO_VOLTA);
    const legado = fraseDoMotivo(item({ motivo: 'estacionado', detalhe: { tipo: 'legado' } }), FUSO);
    expect(legado.detalhe).toBe('A revisão automática parou: parou sem motivo registrado.');
    expect(legado.volta).toBe(NAO_VOLTA);
  });

  it('pedido retirado, regra só no clique, revisar sozinho desligado e ignorado', () => {
    expect(fraseDoMotivo(item({ motivo: 'pedido_retirado', desde: AS_18_30 }), FUSO)).toEqual({
      tom: 'aviso',
      titulo: 'Pedido de revisão retirado',
      detalhe: 'O pedido de revisão à conta foi retirado em 19/11, 18:30.',
      volta: 'Volta quando a revisão for pedida de novo.',
    });
    expect(fraseDoMotivo(item({ motivo: 'regra_manual', detalhe: { source: 'organizacao', organization: 'acme' } }), FUSO)).toEqual({
      tom: 'aviso',
      titulo: 'Regra: só no clique',
      detalhe: 'A regra da organização acme manda revisar só no clique.',
      volta: 'Não volta sozinho: a regra muda no Sistema.',
    });
    expect(fraseDoMotivo(item({ motivo: 'regra_manual', detalhe: { source: 'autor', organization: 'acme', author: 'ana' } }), FUSO).detalhe).toBe('A regra do autor ana manda revisar só no clique.');
    expect(fraseDoMotivo(item({ motivo: 'regra_manual', detalhe: { source: 'escopo_desconhecido' } }), FUSO).detalhe)
      .toBe('Há regra de revisão na conta, mas não deu para saber a organização deste PR. Na dúvida, só no clique.');
    expect(fraseDoMotivo(item({ motivo: 'regra_manual', detalhe: { source: 'autor_desconhecido' } }), FUSO).detalhe)
      .toBe('A organização deste PR tem regra por autor, mas não deu para saber o autor deste PR. Na dúvida, só no clique.');
    expect(fraseDoMotivo(item({ motivo: 'regra_manual', detalhe: {} }), FUSO).detalhe).toBe('Uma regra da conta manda revisar só no clique.');
    expect(fraseDoMotivo(item({ motivo: 'auto_desligado' }), FUSO)).toEqual({
      tom: 'aviso',
      titulo: 'Revisar sozinho está desligado',
      detalhe: 'A conta revisora está com o revisar sozinho desligado.',
      volta: 'Volta quando o revisar sozinho for ligado no Sistema.',
    });
    expect(fraseDoMotivo(item({ motivo: 'ignorado' }), FUSO)).toEqual({
      tom: 'neutro',
      titulo: 'Ignorado',
      detalhe: 'Alguém pediu para o Farol ignorar este PR.',
      volta: 'Não volta sozinho: Revisar mesmo assim abre a revisão.',
    });
  });
});

describe('os filtros por motivo', () => {
  const itens = [
    item({ key: 'a#1', motivo: 'decisao_de_gente' }),
    item({ key: 'a#2', motivo: 'ignorado' }),
    item({ key: 'a#3', motivo: 'decisao_de_gente' }),
    item({ key: 'a#4', motivo: 'estacionado' }),
  ];

  it('conta por motivo, na ordem de precedência do motor, só os que têm PR', () => {
    expect(contarPorMotivo(itens)).toEqual([
      { motivo: 'estacionado', rotulo: 'Parado por falha', n: 1 },
      { motivo: 'decisao_de_gente', rotulo: 'Revisado por gente', n: 2 },
      { motivo: 'ignorado', rotulo: 'Ignorado', n: 1 },
    ]);
    expect(contarPorMotivo([])).toEqual([]);
  });

  it('filtra pelo motivo escolhido; sem filtro, todos', () => {
    expect(filtrarDeFora(itens, 'decisao_de_gente').map((i) => i.key)).toEqual(['a#1', 'a#3']);
    expect(filtrarDeFora(itens, null)).toBe(itens);
  });
});
