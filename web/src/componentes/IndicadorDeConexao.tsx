import type { Conexao } from '@/transporte/cliente';
import estilos from './IndicadorDeConexao.module.css';

// O estado do fluxo de eventos, em texto e cor. O texto diz tudo sozinho: a cor só reforça.
const ROTULOS: Record<Conexao, string> = {
  conectando: 'Conectando',
  conectado: 'Conectado',
  reconectando: 'Reconectando',
  'sem-motor': 'Sem motor',
};

export function IndicadorDeConexao({ conexao }: { conexao: Conexao }) {
  return (
    <span className={estilos.indicador} data-conexao={conexao} role="status">
      <span className={estilos.ponto} aria-hidden="true" />
      {ROTULOS[conexao]}
    </span>
  );
}
