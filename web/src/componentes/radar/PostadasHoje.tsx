'use client';

// A seção "Postadas hoje": das revisões resolvidas que o snapshot traz, as publicadas hoje, no
// fuso do navegador (postadasDeHoje, src/radar/postadas.ts). Uma linha por revisão, com a
// bolinha do que saiu, o título e a hora; num clique, a chave, o desfecho em texto e o link que
// abre a revisão no Histórico. O snapshot traz só as 30 mais recentes: num dia cheio, as mais
// antigas do dia ficam só no Histórico, e o link do cabeçalho leva para lá.
import Link from 'next/link';
import { memo, useMemo } from 'react';
import { Bolinha, Linha, Secao, ui } from '@/componentes/ui';
import { postadasDeHoje } from '@/radar/postadas';
import { AbrirNoGitHub } from './Bloco';

interface Props {
  // `decisions.resolved` do snapshot, como veio
  resolvidas: readonly unknown[];
  // o instante que conta como agora; existe para o teste
  agora?: number;
}

export const PostadasHoje = memo(function PostadasHoje({ resolvidas, agora }: Props) {
  // "Hoje" é lido quando a lista muda: a tela não tem relógio próprio. Uma aba aberta da
  // véspera troca de dia quando chega a próxima revisão resolvida.
  const { postadas, ilegiveis } = useMemo(() => postadasDeHoje(resolvidas, agora), [resolvidas, agora]);
  return (
    <Secao titulo="Postadas hoje" extra={<Link className={ui.link} href="/historico">Ver histórico</Link>}>
      {ilegiveis ? (
        <p className={ui.nota}>
          {ilegiveis === 1
            ? '1 revisão recente chegou do motor numa forma que esta tela não lê e ficou de fora da lista.'
            : `${ilegiveis} revisões recentes chegaram do motor numa forma que esta tela não lê e ficaram de fora da lista.`}
        </p>
      ) : null}
      {postadas.length ? (
        <div className={ui.lista}>
          {postadas.map((p) => (
            <Linha
              key={p.id}
              resumo={
                <>
                  <Bolinha tom={p.tom} rotulo={`${p.rotulo}:`} />
                  <span className={ui.t}>{p.titulo}</span>
                  <span className={`${ui.r} ${ui.empurra}`}>{p.hora}</span>
                </>
              }
            >
              <p className={ui.mini}>{`${p.chave} · ${p.desfecho}`}</p>
              <div className={ui.fila}>
                <Link className={ui.link} href={p.endereco}>
                  Ver a revisão{' '}<span className={ui.soLeitor}>de {p.chave}</span>
                </Link>
                <AbrirNoGitHub chave={p.chave} url={p.url} className={ui.empurra} />
              </div>
            </Linha>
          ))}
        </div>
      ) : (
        <p className={ui.vazio}>Nenhuma revisão postada hoje.</p>
      )}
    </Secao>
  );
});
