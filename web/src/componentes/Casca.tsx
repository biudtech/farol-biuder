'use client';

// A casca das cinco abas: a marca da BIUD com "Farol" ao lado, a navegação, estado da conexão, tema e Sair,
// e a faixa de queda da conexão (FaixaDeQueda.tsx) no alto do conteúdo. Só existe com
// este navegador pareado (src/componentes/Aplicacao.tsx). O Sair pede ao motor que revogue a
// sessão deste navegador antes de apagar o token daqui (app.sair, src/estado/app.ts): enquanto
// o motor não responde o botão diz "Saindo", e o desfecho aparece na tela de pareamento.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import type { App } from '@/estado/app';
import { app as appDoNavegador, useApp } from '@/estado/instancia';
import { ABA_INICIAL, ABAS } from '@/navegacao/abas';
import { FaixaDeQueda } from './FaixaDeQueda';
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
  const viaPortao = useApp((e) => e.viaPortao, app);
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
        <div className={estilos.topoDentro}>
        <Link href={ABA_INICIAL} className={estilos.marca} aria-label="Farol, ir para o Radar">
          <Logo />
          <i className={estilos.divisor} aria-hidden="true" />
          <span className={estilos.nomeEVersao}>
            <span className={estilos.nome}>Farol</span>
            {versao ? <span className={estilos.versao} title="Versão do motor">v{versao}</span> : null}
          </span>
        </Link>

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
          {viaPortao ? <span className={estilos.origemDaSessao} title="Este navegador não foi pareado: a credencial vem do login na frente do Farol.">Sessão do login da frente</span> : null}
          <TrocaDeTema />
          <button type="button" className={estilos.botao} disabled={saindo} onClick={() => { void app.sair(); }}>
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
          <span className={estilos.soLeitor} role="status">{saindo ? (viaPortao ? 'Saindo: encerrando o login da frente.' : 'Saindo: pedindo ao motor que revogue a sessão deste navegador.') : ''}</span>
        </div>
        </div>
      </header>

      <main id="conteudo" ref={conteudo} className={estilos.conteudo} tabIndex={-1}>
        <FaixaDeQueda app={app} />
        {children}
      </main>
    </>
  );
}
