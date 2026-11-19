import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerConfigDoSistema } from '@/contratos/sistema';
import {
  INTERVALO_MAXIMO, INTERVALO_MINIMO, conflitosDoRitmo, corpoDoRitmo, diferencasDoRitmo, intervaloValido, resumoDoRitmo, ritmoDe, textoDoIntervalo, textoDoRitmo,
} from './ritmo';

const raiz = (arquivo: string): string => fs.readFileSync(path.resolve(import.meta.dirname, '../../..', arquivo), 'utf8');
const RITMO = { intervalSeconds: 300, reReviewResume: true, autoPushback: true };

describe('o ritmo da revisão', () => {
  it('a faixa do intervalo é a do motor', () => {
    expect(raiz('lib/settings.js')).toContain(`clamp(parseInt(v, 10) || 300, ${INTERVALO_MINIMO}, ${INTERVALO_MAXIMO})`);
  });

  it('o leitor tolera entrada torta: o que não tem forma conta como ausente', () => {
    expect(ritmoDe(lerConfigDoSistema(RITMO, () => {}))).toEqual(RITMO);
    expect(ritmoDe(lerConfigDoSistema({ ...RITMO, intervalSeconds: '300' }, () => {}))).toBeNull();
    expect(ritmoDe(lerConfigDoSistema({ ...RITMO, autoPushback: 'sim' }, () => {}))).toBeNull();
    expect(ritmoDe(lerConfigDoSistema(null, () => {}))).toBeNull();
    expect(ritmoDe(undefined)).toBeNull();
  });

  it('o corpo leva só o que mudou', () => {
    expect(corpoDoRitmo(RITMO, RITMO)).toEqual({});
    expect(corpoDoRitmo(RITMO, { ...RITMO, intervalSeconds: 600, autoPushback: false })).toEqual({ intervalSeconds: 600, autoPushback: false });
  });

  it('textos: intervalo, pedido, conflito, diferença e resumo', () => {
    expect([180, 300, 3600, 200].map(textoDoIntervalo)).toEqual(['3 minutos', '5 minutos', '1 hora', '200 segundos']);
    expect(intervaloValido(179)).toBe(false);
    expect(intervaloValido(600)).toBe(true);
    expect(textoDoRitmo({ intervalSeconds: 600, reReviewResume: false })).toBe('checagem do GitHub: a cada 10 minutos; retomada na rodada nova: desligada');
    expect(conflitosDoRitmo(['autoPushback'], { ...RITMO, autoPushback: false }, RITMO)[0]).toContain('no motor agora está "desligada"');
    expect(diferencasDoRitmo({ intervalSeconds: 60 }, { intervalSeconds: 180 })).toEqual(['checagem do GitHub ficou a cada 3 minutos, e o pedido era a cada 1 minuto']);
    expect(resumoDoRitmo(RITMO)).toBe('Checagem a cada 5 minutos');
    expect(resumoDoRitmo(null)).toBe('O motor não mandou');
  });
});
