'use client';

// A casca das cinco abas: marca, navegação, estado da conexão, tema e Sair. Só existe com
// este navegador pareado (src/componentes/Aplicacao.tsx). O Sair pede ao motor que revogue a
// sessão deste navegador antes de apagar o token daqui (app.sair, src/estado/app.ts): enquanto
// o motor não responde o botão diz "Saindo", e o desfecho aparece na tela de pareamento.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { ABAS } from '@/navegacao/abas';
import { IndicadorDeConexao } from './IndicadorDeConexao';
import { Logo } from './Logo';
import { TrocaDeTema } from './TrocaDeTema';
import estilos from './Casca.module.css';

interface Props {
  children: ReactNode;
  // existe para o teste trocar a instância
  app?: App;
}

export function Casca({ children, app = appDoNavegador }: Props) {
  const caminho = usePathname();
  const conexao = useApp((e) => e.conexao, app);
  const versao = useApp((e) => e.snapshot?.app?.version ?? '', app);
  const saindo = useApp((e) => e.saindo, app);
  const conteudo = useRef<HTMLElement>(null);

  // Quem acabou de parear estava com o foco no formulário, que sumiu: o foco vai ao conteúdo
  // principal, para o leitor de tela e o teclado não ficarem no vazio. Quem abriu a página já
  // pareado não tem o foco mexido.
  useEffect(() => {
    if (app.store.ler().entrouAgora) conteudo.current?.focus();
  }, [app]);

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
          <button type="button" className={estilos.botao} disabled={saindo} onClick={() => { void app.sair(); }}>
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
          <span className={estilos.soLeitor} role="status">{saindo ? 'Saindo: pedindo ao motor que revogue a sessão deste navegador.' : ''}</span>
        </div>
      </header>

      <main id="conteudo" ref={conteudo} className={estilos.conteudo} tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
