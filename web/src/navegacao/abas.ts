// As cinco abas do Farol, na ordem da navegação. Cada uma é uma pasta em src/app.
export interface Aba {
  rota: string;
  rotulo: string;
}

export const ABAS: readonly Aba[] = [
  { rota: '/radar', rotulo: 'Radar' },
  { rota: '/historico', rotulo: 'Histórico' },
  { rota: '/time', rotulo: 'Time' },
  { rota: '/consumo', rotulo: 'Consumo' },
  { rota: '/sistema', rotulo: 'Sistema' },
];

export const ABA_INICIAL = '/radar';
