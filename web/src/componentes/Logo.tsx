import estilos from './Logo.module.css';

// A marca da BIUD, servida pelo próprio front (public/, copiada do biud-frontend). É <img> e
// não next/image de propósito: o next/image escreve o atributo style no elemento, que a CSP de
// produção recusa (src/proxy.ts), e um SVG não ganha nada com o otimizador.

// O logo completo, no cabeçalho e no pareamento, com "Farol" escrito ao lado por quem o usa.
export function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={estilos.logo} src="/biud-logo.svg" alt="BIUD" width={78} height={26} />;
}

// O símbolo, onde a tela usa só a marca (tudo em dia, sessão expirada). Decorativo.
export function Simbolo({ grande }: { grande?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={grande ? estilos.simboloGrande : estilos.simbolo} src="/biud-simbolo.svg" alt="" width={32} height={40} />;
}
