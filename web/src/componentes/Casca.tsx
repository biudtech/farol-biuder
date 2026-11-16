'use client';

// A casca das cinco abas: marca, navegação, estado da conexão, tema e Sair. Só existe com
// este navegador pareado (src/componentes/Aplicacao.tsx).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { app, useApp } from '@/estado/instancia';
import { ABAS } from '@/navegacao/abas';
import { IndicadorDeConexao } from './IndicadorDeConexao';
import { Logo } from './Logo';
import { TrocaDeTema } from './TrocaDeTema';
import estilos from './Casca.module.css';

export function Casca({ children }: { children: ReactNode }) {
  const caminho = usePathname();
  const conexao = useApp((e) => e.conexao);
  const versao = useApp((e) => e.snapshot?.app?.version ?? '');

  return (
    <>
      <a className={estilos.pular} href="#conteudo">Pular para o conteúdo</a>
      <header className={estilos.topo}>
        <div className={estilos.marca}>
          <Logo />
          <span className={estilos.nome}>Farol</span>
          {versao ? <span className={estilos.versao}>v{versao}</span> : null}
        </div>

        <nav className={estilos.abas} aria-label="Seções do Farol">
          <ul>
            {ABAS.map((aba) => {
              const ativa = caminho === aba.rota || caminho.startsWith(`${aba.rota}/`);
              return (
                <li key={aba.rota}>
                  <Link href={aba.rota} className={estilos.aba} aria-current={ativa ? 'page' : undefined}>
                    {aba.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={estilos.acoes}>
          <IndicadorDeConexao conexao={conexao} />
          <TrocaDeTema />
          <button type="button" className={estilos.botao} onClick={() => app.sair()}>Sair</button>
        </div>
      </header>

      <main id="conteudo" className={estilos.conteudo} tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
