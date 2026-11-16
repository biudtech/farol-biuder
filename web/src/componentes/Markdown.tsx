// Desenha o markdown de um review com elementos do React, a partir da árvore de
// src/markdown/markdown.ts. Não há HTML montado por texto: todo conteúdo é filho de texto, e
// o único atributo que vem do review é o `href`, que o leitor só entrega quando é https.
import { memo, useMemo, type ReactNode } from 'react';
import { TETO_DE_TEXTO, lerMarkdown, type Bloco, type Trecho } from '@/markdown/markdown';
import estilos from './Markdown.module.css';

interface Props {
  texto: string;
  // O nível do título de primeiro nível do texto (`#`). O padrão é 4: o review aparece
  // dentro de um cartão ou de uma seção que já tem título de nível 3.
  nivelBase?: 2 | 3 | 4 | 5 | 6;
}

const TITULOS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;

function trechos(nos: readonly Trecho[]): ReactNode[] {
  return nos.map((no, i) => {
    switch (no.t) {
      case 'texto': return no.v;
      case 'quebra': return <br key={i} />;
      case 'codigo': return <code key={i} className={estilos.codigo}>{no.v}</code>;
      case 'forte': return <strong key={i}>{trechos(no.f)}</strong>;
      case 'enfase': return <em key={i}>{trechos(no.f)}</em>;
      case 'link': return (
        <a key={i} href={no.href} target="_blank" rel="noreferrer noopener">
          {trechos(no.f)}
          <span className={estilos.soLeitor}> (abre em nova aba)</span>
        </a>
      );
    }
  });
}

// O item que é um parágrafo só aparece sem a margem de parágrafo.
function item(conteudo: readonly Bloco[], nivelBase: number): ReactNode {
  const [unico] = conteudo;
  if (conteudo.length === 1 && unico?.t === 'paragrafo') return trechos(unico.f);
  return blocos(conteudo, nivelBase);
}

function blocos(nos: readonly Bloco[], nivelBase: number): ReactNode[] {
  return nos.map((no, i) => {
    switch (no.t) {
      case 'paragrafo': return <p key={i}>{trechos(no.f)}</p>;
      case 'titulo': {
        const Titulo = TITULOS[Math.min(nivelBase + no.nivel - 1, 6) - 2] ?? 'h6';
        return <Titulo key={i} className={estilos.titulo}>{trechos(no.f)}</Titulo>;
      }
      case 'lista': {
        const itens = no.itens.map((conteudo, n) => <li key={n}>{item(conteudo, nivelBase)}</li>);
        return no.ordenada ? <ol key={i} start={no.inicio}>{itens}</ol> : <ul key={i}>{itens}</ul>;
      }
      case 'citacao': return <blockquote key={i} className={estilos.citacao}>{blocos(no.f, nivelBase)}</blockquote>;
      case 'codigo': return <pre key={i} className={estilos.bloco} data-linguagem={no.linguagem}><code>{no.v}</code></pre>;
      case 'regua': return <hr key={i} className={estilos.regua} />;
    }
  });
}

export const Markdown = memo(function Markdown({ texto, nivelBase = 4 }: Props) {
  const documento = useMemo(() => lerMarkdown(texto), [texto]);
  return (
    <div className={estilos.markdown}>
      {blocos(documento.blocos, nivelBase)}
      {documento.cortado ? (
        <p className={estilos.corte} role="note">
          O texto passa de {TETO_DE_TEXTO.toLocaleString('pt-BR')} caracteres e foi cortado aqui.
        </p>
      ) : null}
    </div>
  );
});
