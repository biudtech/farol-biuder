// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PrecisaDeVoce } from './PrecisaDeVoce';
import { URL_DO_PR, controleFalso, nomes, pendencia } from './apoio-de-teste';

afterEach(cleanup);

const NOME = 'PR #12 de dono/repo';
// a pendência de apoio tem parecer "approve", e a decisão leva o parecer junto
const decidir = (decisao: string) => ({ tipo: 'decidir', id: 'd1', decisao, alvo: 'dono/repo#12', nome: NOME, parecer: 'approve' });
const pergunta = () => screen.queryByRole('group', { name: /[?]$/ });

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
    render(<PrecisaDeVoce pendencias={[pendencia({ card: 'BT-9', reasons: [{ text: 'a política manda esperar', kind: 'gate' }], attention: [{ text: 'olhar o teste', kind: 'content' }] })]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Precisa de você (1)' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('dono/repo#12');
    expect(screen.getByText('Corrige o cálculo')).toBeTruthy();
    expect(screen.getByText(/PR de ana · Parecer da revisão: aprovar · Card BT-9/)).toBeTruthy();
    expect(nomes(screen.getAllByRole('button'))).toEqual([`Aprovar ${NOME}`, `Pedir mudanças ${NOME}`, `Comentar ${NOME}`, `Pular ${NOME}`]);
    const motivos = within(screen.getByRole('list', { name: `Motivos de ${NOME}` })).getAllByRole('listitem');
    expect(motivos.map((m) => m.textContent)).toEqual(['Regra do motor: a política manda esperar', 'Ponto da revisão: olhar o teste']);
  });

  it('pendência só com id e chave (o resto ausente) aparece com o que há, e os botões', () => {
    const { controle } = controleFalso();
    render(<PrecisaDeVoce pendencias={[{ id: 'd1', key: 'dono/repo#12', reportMarkdown: '', reasons: [], attention: [] }]} controle={controle} />);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('dono/repo#12');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('pendência que a tela não leu entra no título e vira aviso: o bloco não diz que está vazio', () => {
    const { controle } = controleFalso();
    const { rerender } = render(<PrecisaDeVoce pendencias={[]} ilegiveis={2} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Precisa de você (0, e mais 2 que esta tela não lê)');
    expect(screen.getByText('Atenção: 2 pendência(s) chegaram em formato que esta tela não lê; veja o log do navegador.')).toBeTruthy();
    expect(screen.queryByText('Nenhuma revisão esperando a sua decisão.')).toBeNull();
    rerender(<PrecisaDeVoce pendencias={[pendencia()]} ilegiveis={1} controle={controle} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Precisa de você (1, e mais 1 que esta tela não lê)');
    expect(screen.getAllByRole('button')).toHaveLength(4);
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
    // o review é desenhado de markdown: o título vira título, e a marcação crua fica como texto
    const review = container.querySelector('details');
    expect(review?.querySelector('h4')?.textContent).toBe('Título');
    expect(review?.querySelector('p')?.textContent).toBe(marcado);
    expect(review?.querySelector('pre')).toBeNull();
  });

  it('o review em markdown aparece desenhado, com link só https', () => {
    const { controle } = controleFalso();
    const { container } = render(
      <PrecisaDeVoce pendencias={[pendencia({ reportMarkdown: '## Review\n\n- **um** [doc](https://exemplo.com/a)\n- [x](javascript:alert(1))' })]} controle={controle} />,
    );
    const review = container.querySelector('details');
    expect(review?.querySelector('h5')?.textContent).toBe('Review');
    expect(review?.querySelector('strong')?.textContent).toBe('um');
    expect([...(review?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual(['https://exemplo.com/a']);
    expect(review?.textContent).toContain('[x](javascript:alert(1))');
  });

  it('o texto mostrado é anunciado como o do parecer, não como o que cada botão publica', () => {
    const { controle } = controleFalso();
    const { container } = render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    expect(container.querySelector('summary')?.textContent).toBe(`Ver o texto do parecer da revisão de ${NOME}`);
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

  it('Pular vai direto ao motor: não publica nada', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Pular ${NOME}` }));
    expect(disparar.mock.calls.map(([acao]) => acao)).toEqual([decidir('skip')]);
    expect(pergunta()).toBeNull();
  });

  it('Comentar publica no GitHub, então pergunta antes e só envia na confirmação', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Comentar ${NOME}` }));
    expect(disparar).not.toHaveBeenCalled();
    const grupo = screen.getByRole('group', { name: `Comentar em ${NOME}?` });
    expect(grupo.textContent).toMatch(/review de comentário \(COMMENT\) no GitHub, em PR #12 de dono\/repo/);
    // comentar nunca é o parecer: o texto que sai não é o mostrado
    expect(grupo.textContent).toMatch(/O texto que sai NÃO é o mostrado acima/);
    fireEvent.click(screen.getByRole('button', { name: `Publicar o comentário: ${NOME}` }));
    expect(disparar.mock.calls.map(([acao]) => acao)).toEqual([decidir('comment')]);
  });

  it('Aprovar com parecer de aprovar: a pergunta diz que sai o review mostrado, e só envia na confirmação', () => {
    const { controle, disparar, focarResultado } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    expect(disparar).not.toHaveBeenCalled();
    const grupo = screen.getByRole('group', { name: `Aprovar ${NOME}?` });
    expect(grupo.textContent).toMatch(/publica uma aprovação \(APPROVE\) no GitHub, em PR #12 de dono\/repo/);
    expect(grupo.textContent).toMatch(/O texto é o do review mostrado acima/);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Voltar sem enviar' }));
    fireEvent.click(screen.getByRole('button', { name: `Publicar a aprovação: ${NOME}` }));
    expect(disparar).toHaveBeenCalledTimes(1);
    expect(disparar).toHaveBeenCalledWith(decidir('approve'));
    expect(pergunta()).toBeNull();
    // o foco vai à região do resultado, não fica solto na página
    expect(focarResultado).toHaveBeenCalledTimes(1);
  });

  it('Pedir mudanças com parecer de aprovar: a pergunta avisa que sai um texto que a tela não mostra', () => {
    const { controle } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia({ verdict: 'approve' })]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` }));
    const texto = screen.getByRole('group', { name: `Pedir mudanças em ${NOME}?` }).textContent;
    expect(texto).toMatch(/REQUEST CHANGES/);
    expect(texto).toMatch(/O texto que sai NÃO é o mostrado acima: o motor publica o que ele preparou para esta ação/);
    expect(texto).not.toMatch(/O texto é o do review mostrado acima/);
  });

  it('confirmação cancelada não envia nada, e o foco volta ao botão que perguntou', () => {
    const { controle, disparar, focarResultado } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar sem enviar' }));
    expect(disparar).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Pedir mudanças ${NOME}` }));
    expect(focarResultado).not.toHaveBeenCalled();
  });

  it('Escape fecha a pergunta sem enviar e devolve o foco ao botão', () => {
    const { controle, disparar } = controleFalso();
    render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Voltar sem enviar' }), { key: 'Escape' });
    expect(pergunta()).toBeNull();
    expect(disparar).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
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

describe('o item muda com a pergunta aberta', () => {
  it.each([
    ['chegou commit novo', { blockedKind: 'stale_head', blockedReason: 'o PR recebeu commit novo' }],
    ['o PR passou a ser da própria conta', { prProprio: true as const }],
  ])('a ação deixou de ser permitida (%s): a pergunta fecha sozinha, diz por quê e nada é enviado', (_caso, mudanca) => {
    const { controle, disparar } = controleFalso();
    const { rerender } = render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    expect(pergunta()).toBeTruthy();
    rerender(<PrecisaDeVoce pendencias={[pendencia(mudanca)]} controle={controle} />);
    expect(pergunta()).toBeNull();
    expect(screen.queryByRole('button', { name: `Publicar a aprovação: ${NOME}` })).toBeNull();
    const aviso = screen.getByText(/A pergunta foi fechada: o motor mudou este item e a ação não está mais disponível\. Nada foi enviado\./);
    // o foco, que estava na pergunta, vai ao aviso e não fica solto
    expect(document.activeElement).toBe(aviso);
    expect(disparar).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: `Aprovar ${NOME}` })).toBeNull();
    // o aviso sai no próximo clique
    fireEvent.click(screen.getByRole('button', { name: `Pular ${NOME}` }));
    expect(screen.queryByText(/A pergunta foi fechada/)).toBeNull();
  });

  it('o item muda sem tirar a ação: a pergunta continua, com o texto do item de agora', () => {
    const { controle, disparar } = controleFalso();
    const { rerender } = render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    expect(pergunta()?.textContent).toMatch(/O texto é o do review mostrado acima/);
    rerender(<PrecisaDeVoce pendencias={[pendencia({ verdict: 'request_changes' })]} controle={controle} />);
    expect(pergunta()?.textContent).toMatch(/O texto que sai NÃO é o mostrado acima/);
    fireEvent.click(screen.getByRole('button', { name: `Publicar a aprovação: ${NOME}` }));
    expect(disparar).toHaveBeenCalledWith({ ...decidir('approve'), parecer: 'request_changes' });
  });

  it('o item some com a pergunta aberta: a pergunta some junto e nada é enviado', () => {
    const { controle, disparar } = controleFalso();
    const { rerender } = render(<PrecisaDeVoce pendencias={[pendencia()]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    rerender(<PrecisaDeVoce pendencias={[]} controle={controle} />);
    expect(pergunta()).toBeNull();
    expect(screen.getByText('Nenhuma revisão esperando a sua decisão.')).toBeTruthy();
    expect(disparar).not.toHaveBeenCalled();
  });

  it('a lista reordena com a pergunta aberta: a pergunta segue no mesmo PR, e a confirmação manda o id dele', () => {
    const { controle, disparar } = controleFalso();
    const a = pendencia();
    const b = pendencia({ id: 'd2', key: 'dono/outro#3' });
    const { rerender } = render(<PrecisaDeVoce pendencias={[a, b]} controle={controle} />);
    fireEvent.click(screen.getByRole('button', { name: `Aprovar ${NOME}` }));
    rerender(<PrecisaDeVoce pendencias={[pendencia({ id: 'd0', key: 'novo/repo#1' }), b, a]} controle={controle} />);
    const cartoes = screen.getAllByRole('listitem').filter((li) => li.querySelector('h3'));
    expect(cartoes.map((c) => c.querySelector('h3')?.textContent)).toEqual(['novo/repo#1 (abre em nova aba)', 'dono/outro#3 (abre em nova aba)', 'dono/repo#12 (abre em nova aba)']);
    // a pergunta está no cartão do PR #12, que agora é o terceiro, e só nele
    expect(within(cartoes[2] as HTMLElement).getByRole('group', { name: `Aprovar ${NOME}?` })).toBeTruthy();
    expect(screen.getAllByRole('group', { name: /[?]$/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: `Publicar a aprovação: ${NOME}` }));
    expect(disparar).toHaveBeenCalledTimes(1);
    expect(disparar).toHaveBeenCalledWith(decidir('approve'));
  });
});
