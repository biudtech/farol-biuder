import estilos from './EmConstrucao.module.css';

// O que cada aba mostra enquanto a tela dela não chega.
export function EmConstrucao({ titulo }: { titulo: string }) {
  return (
    <>
      <h1 className={estilos.titulo}>{titulo}</h1>
      <p className={estilos.texto}>Em construção.</p>
    </>
  );
}
