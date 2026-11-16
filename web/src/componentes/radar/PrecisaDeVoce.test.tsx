// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrecisaDeVoce } from './PrecisaDeVoce';
import { URL_DO_PR, controleFalso, nomes, pendencia } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';

describe('bloco Precisa de você', () => {
  it('lista vazia diz que está vazia numa linha', () => {
    const { controle } = controleFalso();
    render(<PrecisaDeVoce pendencias={[]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (0)' })).toBeTruthy();
    expect(screen.getByText('Nenhuma revisão esperando a sua decisão.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('pendência normal mostra o PR, o parecer e os quatro botões, cada um com o alvo no nome', () => {
    const { controle } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia({ reasons: [{ text: 'a política manda esperar', kind: 'gate' }], attention: [{ text: 'olhar o teste', kind: 'content' }] })]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('dono/repo#12');
    expect(screen.getByText('Corrige o cálculo')).toBeTruthy();
    expect(screen.getByText(/PR de ana · Parecer da revisão: aprovar/)).toBeTruthy();
    expect(nomes(screen.getAllByRole('button'))).toEqual([`Aprovar ${NOME}`, `Pedir mudanças ${NOME}`, `Comentar ${NOME}`, `Pular ${NOME}`]);
    const motivos = within(screen.getByRole('list', { name: `Motivos de ${NOME}` })).getAllByRole('listitem');
    expect(motivos.map((m) => m.textContent)).toEqual(['Regra do motor: a política manda esperar', 'Ponto da revisão: olhar o teste']);
  });

  it('o link do PR só existe para URL do GitHub por HTTPS, e abre em outra aba sem referência', () => {
    const { controle } = controleFalso();
    const { unmount } = render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    const link = screen.getByRole('link', { name: /dono\/repo#12/ });
    expect(link.getAttribute('href')).toBe(URL_DO_PR);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    unmount();
    render(<PrecisaDeVoce pendencias={[pendencia({ pr: { url: 'javascript:alert(1)', title: 'x' } })]} controle={controle} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('dono/repo#12');
  });

  it('título, motivo e review de fora entram como texto, nunca como HTML', () => {
    const { controle } = controleFalso();
    const marcado = '<img src=x onerror=alert(1)><b>negrito</b>';
    const { container } = render(
      <PrecisaDeVoce
        pendencias={[pendencia({ pr: { url: URL_DO_PR, title: marcado, author: marcado }, reportMarkdown: `# Título\n${marcado}`, reasons: [{ text: marcado, kind: 'content' }], blockedReason: marcado })]}
        controle={controle}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe(`# Título\n${marcado}`);
    expect(pre?.children).toHaveLength(0);
  });

  it('PR da própria conta não mostra Aprovar nem Pedir mudanças, e diz por quê', () => {
    const { controle } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia({ prProprio: true })]} controle={controle} />);
    expect(nomes(screen.getAllByRole('button'))).toEqual([`Comentar ${NOME}`, `Pular ${NOME}`]);
    expect(screen.getByText(/PR da própria conta revisora/)).toBeTruthy();
  });

  it('item bloqueado mostra o motivo do motor, e o que o motor faz com a publicação que falhou', () => {
    const { controle } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia({ blockedReason: 'a redação gerada foi bloqueada pelo filtro de linguagem', postRetry: { attempts: 3, exhausted: true } })]} controle={controle} />);
    expect(screen.getByText('Bloqueado: a redação gerada foi bloqueada pelo filtro de linguagem')).toBeTruthy();
    expect(screen.getByText(/desistiu de tentar sozinho depois de 3 tentativa/)).toBeTruthy();
    // outro bloqueio não esconde botão: quem recusa é o motor
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('commit novo depois da revisão só deixa Revisar agora e Pular', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia({ blockedKind: 'stale_head', blockedReason: 'o PR recebeu commit novo' })]} controle={controle} />);
    expect(nomes(screen.getAllByRole('button'))).toEqual([`Revisar agora ${NOME}`, `Pular ${NOME}`]);
    fireEvent.click(screen.getByRole('button', { name: `Revisar agora ${NOME}` }));
    expect(disparar).toHaveBeenCalledWith({ tipo: 'revisar', url: URL_DO_PR, alvo: 'dono/repo#12', nome: NOME });
  });

  it('Comentar e Pular vão direto ao motor', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Pular ${NOME}` }));
    fireEvent.click(screen.getByRole('button', { name: `Comentar ${NOME}` }));
    expect(disparar.mock.calls.map(([acao]) => acao)).toEqual([
      { tipo: 'decidir', id: 'd1', decisao: 'skip', alvo: 'dono/repo#12', nome: NOME },
      { tipo: 'decidir', id: 'd1', decisao: 'comment', alvo: 'dono/repo#12', nome: NOME },
    ]);
  });

  it('Aprovar pergunta antes, dizendo o que sai e em qual PR, e só envia na confirmação', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    expect(disparar).not.toHaveBeenCalled();
    const pergunta = screen.getByRole('group', { name: `Aprovar ${NOME}?` });
    expect(pergunta.textContent).toMatch(/publica uma aprovação \(APPROVE\) no GitHub, em PR #12 de dono\/repo/);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Voltar sem enviar' }));
    fireEvent.click(screen.getByRole('button', { name: `Publicar a aprovação: ${NOME}` }));
    expect(disparar).toHaveBeenCalledTimes(1);
    expect(disparar).toHaveBeenCalledWith({ tipo: 'decidir', id: 'd1', decisao: 'approve', alvo: 'dono/repo#12', nome: NOME });
    expect(screen.queryByRole('group', { name: /[?]$/ })).toBeNull();
  });

  it('confirmação cancelada não envia nada, e o foco volta ao botão que perguntou', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` }));
    expect(screen.getByRole('group', { name: `Pedir mudanças em ${NOME}?` }).textContent).toMatch(/REQUEST CHANGES/);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar sem enviar' }));
    expect(disparar).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: /[?]$/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` }));
  });

  it('com uma ação do item no ar, todos os botões dele ficam desabilitados e o clicado diz Enviando', () => {
    const { controle, disparar } = controleFalso({ 'dono/repo#12': 'decidir:skip' });
    render(<PrecisaDeVoce pendencias={[pendencia(), pendencia({ id: 'd2', key: 'dono/outro#3' })]} controle={controle} />);
    const [primeiro, segundo] = screen.getAllByRole('listitem').filter((li) => li.querySelector('h3'));
    const doPrimeiro = within(primeiro as HTMLElement).getAllByRole('button') as HTMLButtonElement[];
    expect(doPrimeiro.every((b) => b.disabled)).toBe(true);
    const pular = within(primeiro as HTMLElement).getByRole('button', { name: `Enviando: Pular ${NOME}` });
    expect(pular.textContent).toBe('Enviando…');
    fireEvent.click(pular);
    expect(disparar).not.toHaveBeenCalled();
    // o outro item segue livre
    expect((within(segundo as HTMLElement).getAllByRole('button') as HTMLButtonElement[]).every((b) => !b.disabled)).toBe(true);
  });
});
