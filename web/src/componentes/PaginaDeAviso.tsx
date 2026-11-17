import type { ReactNode } from 'react';
import estilos from './PaginaDeAviso.module.css';

interface Props {
  // a marca grande acima do título (o "404" da página não encontrada); decorativa
  codigo?: string;
  titulo: string;
  texto: string;
  // a saída da página: um link ou um botão
  children: ReactNode;
}

// O corpo das páginas de aviso do front (não encontrada, erro). Estilo só por classe: as
// páginas embutidas do Next usam o atributo style, que a CSP de produção bloqueia.
export function PaginaDeAviso({ codigo, titulo, texto, children }: Props) {
  return (
    <div className={estilos.aviso}>
      {codigo ? <p className={estilos.codigo} aria-hidden="true">{codigo}</p> : null}
      <h1 className={estilos.titulo}>{titulo}</h1>
      <p className={estilos.texto}>{texto}</p>
      <div className={estilos.saida}>{children}</div>
    </div>
  );
}

// a classe do link ou botão de saída, para quem monta a página
export const classeDaSaida = estilos.botao;
// a moldura de quando a página não tem a casca em volta (global-error)
export const classeDaPaginaInteira = estilos.pagina;
