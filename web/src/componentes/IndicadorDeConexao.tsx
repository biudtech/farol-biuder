import type { Conexao } from '@/transporte/cliente';
import estilos from './IndicadorDeConexao.module.css';

// O estado do fluxo de eventos, em texto e cor. O texto diz tudo sozinho: a cor só reforça.
// Conectado é o normal e não ocupa o cabeçalho: o selo só aparece quando a conexão não está de
// pé. A região de status fica montada, com o texto só para o leitor de tela, para a volta da
// conexão continuar sendo anunciada.
const ROTULOS: Record<Conexao, string> = {
  conectando: 'Conectando',
  conectado: 'Conectado',
  reconectando: 'Reconectando',
  'sem-motor': 'Sem motor',
};

export function IndicadorDeConexao({ conexao }: { conexao: Conexao }) {
  if (conexao === 'conectado') {
    return <span className={estilos.oculto} data-conexao={conexao} role="status">{ROTULOS[conexao]}</span>;
  }
  return (
    <span className={estilos.indicador} data-conexao={conexao} role="status">
      <span className={estilos.ponto} aria-hidden="true" />
      {ROTULOS[conexao]}
    </span>
  );
}
