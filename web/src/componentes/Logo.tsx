import estilos from './Logo.module.css';

// O farol da marca. Decorativo: o nome vem escrito ao lado.
export function Logo() {
  return (
    <svg className={estilos.logo} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className={estilos.facho} opacity=".5" d="M10.7 5.2 2 2.6v5.4l8.7-1.1z" />
      <path className={estilos.facho} d="M13.3 5.2 22 2.6v5.4l-8.7-1.1z" />
      <path className={estilos.torre} d="M12 1.9l1.6 2h-3.2l1.6-2z" />
      <rect className={estilos.torre} x="10.5" y="3.9" width="3" height="2.6" />
      <rect className={estilos.facho} x="11.1" y="4.4" width="1.8" height="1.7" />
      <rect className={estilos.torre} x="9.8" y="6.5" width="4.4" height="1.1" rx=".55" />
      <path className={estilos.torre} d="M10.7 7.6h2.6L15.2 20H8.8l1.9-12.4z" />
      <rect className={estilos.faixa} x="10.2" y="11" width="3.7" height="1.1" />
      <rect className={estilos.faixa} x="9.7" y="14.6" width="4.7" height="1.1" />
      <rect className={estilos.torre} x="8" y="20" width="8" height="1.7" rx=".85" />
    </svg>
  );
}
