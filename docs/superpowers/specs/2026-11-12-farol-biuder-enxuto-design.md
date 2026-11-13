# Farol BIUD enxuto: revisor autônomo hospedado

Data: 12/11/2026. Base: `biudtech/farol-biuder` em `5fa446df` (v2.79.13, fork idêntico ao Farol pessoal).

## 1. Intenção

Transformar o fork num revisor autônomo de pull requests da BIUD, hospedado, que faz só revisão.
O Farol de hoje é um app de desktop pessoal com cerca de 450 mil linhas e muita função fora da
revisão (autoanálise, sync entre aparelhos, cascas nativas, chat, merge). O objetivo é um sistema
enxuto, que cumpre só o essencial e que uma pessoa consegue manter.

## 2. Metas, não-metas e antimetas

**Metas**

- Motor que monitora os PRs, revisa com Claude Code headless, passa pelos gates e posta aprovação,
  pedido de mudanças ou comentário, com leitura do card no Jira.
- Front novo em Next.js, na Vercel, com cinco telas: Radar (fila), Histórico, Time, Consumo e
  Sistema mínima.
- Motor em container Linux na AWS, com uma única conta revisora do GitHub, definida por
  configuração (a conta será escolhida depois).
- Repositório administrado só pela conta `wandersonbiuder`: commits, PRs, merges e releases.

**Não-metas**

- Autoanálise e Meus PRs, Entregas, Destaques e kudos, ferramentas (pr-health), chat por PR, sessão
  de terminal, merge pelo app, reviewers por projeto, especialistas, intervenções, review-audit,
  capacity, transferência de preferências.
- Electron, instaladores, cascas nativas (macOS e Windows), auto-update, sync entre aparelhos,
  celular, Firebase.
- Codex e agy como motores: só Claude.
- Multi-conta: uma instância, uma conta.
- Manter o fork sincronizável com o Farol pessoal. Ele diverge de vez.
- Login do time na tela. Na primeira versão só o administrador acessa.

**Antimetas** (seria fracasso mesmo funcionando)

- Perder ou afrouxar regra de gate já calibrada (postagem, dedup por head, espera do CI, PR da
  própria conta sai como comentário, credencial no texto, linguagem pública).
- Front que reimplementa regra do motor. A definição do dado é do motor; a tela fatia e formata.
- API do motor exposta sem autenticação ou com CORS aberto.
- Código morto mantido "desligado por configuração".

## 3. Restrições

- Rebase proibido; base entra por merge commit. Sem atribuição de IA em commit ou PR.
- Toda escrita no GitHub pelo `gh` com a conta `wandersonbiuder`, trocada no mesmo comando.
- Cada PR deixa `npm run check`, `npm run lint` e `npm test` verdes. Jest e node:test com teto de
  quatro workers nesta máquina.
- Arquivos em LF.
- O check obrigatório da branch chama-se `ci`; o nome fica.
- Deploy no EKS fora de `apps/agente70` pede validação do tech lead. Fica na última fase.
- Nada sobe com vulnerabilidade conhecida (audit e osv verdes) no front e no motor.

### Decisões do Wanderson em 12/11/2026

- **Branch e release:** só `main`, com PR de branch curta. Release é uma tag que publica a imagem
  do motor e o front. A numeração recomeça em 3.0.0.
- **Gate:** o eng-behaviour sai (`tools/eng-behaviour/`, `eng-behaviour.json`,
  `eng-behaviour.rules.md` e a parte dele no pre-push). Fica o padrão BIUD: `check`, `lint` com
  ratchet e testes no CI. Sai no lote 1.
- **Estado inicial:** a instância hospedada nasce vazia. Sem migração; na primeira checagem os PRs
  já abertos ficam fora da fila.

## 4. Caminhos considerados

| Caminho | O que é | Troca |
|---|---|---|
| A. Cortar e depois separar, mantendo a `ui/` atual | Remover módulos, publicar a `ui/` vanilla estática na Vercel | Mais barato e de menor risco, mas mantém 66 telas em JS sem tipo e fora do padrão dos fronts BIUD |
| B. Separar primeiro, cortar depois | Hospedar o sistema inteiro e enxugar em produção | Hospeda cedo, mas adapta para nuvem código que será apagado |
| **C. Front novo em Next, motor cortado** (escolhido) | Reescrever a tela só com as cinco abas; cortar o motor no fork | Mais caro, porém o front nasce pequeno, tipado e no padrão; a `ui/` antiga sai inteira |

Escolha do Wanderson em 12/11/2026: **C**. O corte acontece no próprio fork (não é projeto novo).

## 5. Arquitetura alvo

```
navegador ──HTTPS──> Vercel (web/, Next.js)
     │
     └──HTTPS + Bearer──> proxy TLS (AWS) ──> motor (node server.js, container, 1 réplica)
                                               ├─ volume: ~/.farol (estado, histórico, consumo)
                                               ├─ gh (token da conta revisora, por segredo)
                                               ├─ claude (perfil por chave de API, por segredo)
                                               └─ Jira (credencial por segredo)
```

- **Um repositório, duas partes.** O motor fica na raiz (`server.js`, `lib/`, `test/`,
  `workspace-template/`). O front fica em `web/`, com `package.json` próprio; o projeto da Vercel
  usa `web/` como diretório raiz. Decisão minha: um repo só mantém contrato e tela no mesmo PR.
- **O navegador fala direto com o motor.** O front é estático do ponto de vista dos dados: toda
  leitura e ação é `fetch` do navegador para a API do motor, com `Authorization: Bearer`. Sem
  rotas de API no Next e sem segredo na Vercel. Decisão minha: evita um segundo lugar com
  credencial e mantém o tempo real (SSE lido por `fetch`, como a tela atual já faz com token).
- **Uma réplica.** O estado é arquivo em disco e o escalonador é de processo único. Não escala
  horizontalmente e não precisa.

## 6. Motor: o que muda

### 6.1 Cortes

Em lotes, na ordem abaixo; cada lote é um PR com a suíte verde.

1. CI e release: sai o job `electron` (o `jira-mcp-processo.test.js` vai para o `gate`), o
   agregador `ci` passa a exigir só o `gate`, sai o `release-nativo.yml`. Matriz só Ubuntu.
2. Cortes limpos de rota: review-audit, preferences transfer, chat, reviewers por projeto.
3. Auto-update.
4. Electron, instaladores, macOS: `main.js`, `installer/`, `Instalar*`, `tools/make-*`,
   `tools/release/`, `tools/emuladores/`, dependência `electron`, script `start`.
5. Cascas nativas: `shell/`, `lib/engine/casca-*`, `avisos-nativos`.
6. Intervenções, Entregas, Destaques, ferramentas. Antes, `clearLog` e a leitura do log saem de
   `tools.js` e `workspace.js` para o diagnóstico; `lib/settings.js` deixa de importar da `ui/`.
7. Especialistas (`specialists/contract.js` vira utilitário, pois `review-context` o usa).
8. Capacity (`capacity/processes.js` é usado por `review-source/recovery-owner`: mover).
9. Codex e agy: `runProvedor` e `provedores.js` ficam só com Claude.
10. Autoanálise e Meus PRs. **Ficam** `pr-proprio.js` e `espera-pr-proprio.js`: são a regra de
    gate "PR da conta que revisa sai como comentário".
11. Sessão de terminal, com as rotas `/api/session-exit` e `/api/review/post`.
12. Sync, em dois passos: primeiro `syncCoordenacaoAtiva()` fixo em falso e a fiação retirada do
    caminho de revisão e postagem; depois apagar `lib/sync` (menos o que for hash e id puro),
    `lib/engine/sync-*`, `firebase/` e os testes.
13. Multi-conta: colapsa para uma conta. `contas-config.js` fica, porque carrega a política de
    aprovação (`autoReview`, `onClean`, `onCaveats`, `onReject`).
14. `ui/` antiga e `lib/http-ui.js`: saem quando o front novo cobrir as cinco telas.
15. Fechamento: baselines de qualidade, `CLAUDE.md`, README e guias reescritos para o que sobrou.

Testes de contrato que travam a existência do que sai (inventário de rotas, superfície da `ui/pure`,
guias navegáveis, listas de distribuição, auditoria do pacote) são ajustados no mesmo PR do corte,
com o motivo no commit. Teste que só protegia o que saiu é apagado; teste de gate nunca.

### 6.1.1 Regra para o que a lista não cita (decisão minha)

Sai tudo o que as cinco telas e o ciclo de revisão não usam; a lista acima não é exaustiva. Na
dúvida entre apagar e manter, decide a pergunta "isto é regra de gate ou alimenta uma das cinco
telas?". Aplicações já decididas:

- **Sai:** Panorama e faixa de prontidão (PRs não pedidos à conta; a fila é o que foi pedido à
  conta revisora, e revisar por URL continua), ocultar PR, cadeia de perfis, `login-web`, perfis
  de pasta e `maquina`, co-assinatura, "revisar junto", `review-signal` (leitura de transição),
  modo celular, `tools/web/` e `docs/WEB.md`, `tools/review-quality`, rotas `review-labels`,
  `claude-login` e a sessão de IA do diagnóstico.
- **Fica:** a label `<conta>:revisando` e a saída de cena (outros Faróis pessoais do time seguem
  existindo), `limite-plano` reduzido ao que vale para chave de API, leitura do log e do
  diagnóstico em Markdown (alimentam a saúde em Sistema).
- **Perfil do Claude:** um perfil só, `kind: 'apikey'`.

**Só Linux.** O motor passa a rodar e a ser testado só em Linux. Os ramos `IS_WIN` e `IS_MAC`
saem num lote próprio, depois do lote 5. Nesta máquina a suíte roda pelo WSL.

### 6.2 Acréscimos

- **Origens permitidas e CORS.** `config.origensPermitidas` (só por arquivo, saneada como o
  `bind`): lista exata de origens `https://`. `lib/http-guard.js` passa a aceitá-las; o servidor
  responde `OPTIONS` com 204 antes do porteiro de autenticação e depois da checagem de origem, e
  envia `Access-Control-Allow-Origin` com a origem exata (nunca `*`), `Vary: Origin`,
  `Allow-Headers: Authorization, Content-Type, x-farol` e `Allow-Methods: GET, POST` em toda
  resposta, SSE e erro inclusive. Sem `Allow-Credentials`: não há cookie.
- **Host público.** `config.hostPublico` (só por arquivo, saneado) entra na allowlist de Host
  ao lado do loopback, sem porta. O motor não depende de o proxy reescrever o Host. Decisão minha:
  a defesa muda no código, na fase 2, com teste, e não fica à mercê da configuração do ingress.
- **Autenticação exigida no modo hospedado.** Com `origensPermitidas` ou `hostPublico`
  preenchidos, não existe caminho sem token, sem configuração que desligue. Em loopback puro, sem
  nenhum dos dois, a regra atual continua (é o que os testes de boot e de rota usam). O pareamento
  por código (`POST /api/auth/pair`) e o Bearer continuam; `tools/farol-parear.js` fica para gerar
  o código dentro do container.
- **Histórico paginado.** Rota nova `GET /api/decisions?page=&q=&veredito=&repo=` sobre as
  decisões resolvidas em disco (até 3.000), com a mesma projeção segura que o snapshot usa
  (`decisionForUi`). Entra no inventário de rotas.
- **Snapshot menor.** As chaves do que saiu deixam de existir no snapshot (`myPRs`, `selfAnalyses`,
  `chats`, `toolRuns`, `sync`, `casca`, `update`, `interventions` e afins).
- **Container.** `Dockerfile` com Node 24, `gh` e `claude` CLI, usuário comum (com uid 0 o Claude
  recusa o modo headless), `HOME` gravável e `~/.farol` em volume. O entrypoint grava o token do
  GitHub com `gh auth login --with-token` (o motor apaga `GH_TOKEN` herdado e lê do `gh`) e o
  `config.json` traz um perfil do Claude `kind: 'apikey'` (o motor também apaga
  `ANTHROPIC_API_KEY` do ambiente do filho). `FAROL_HOME` fica no padrão, porque outro valor liga
  a instância isolada e bloqueia toda postagem.
- **Saúde.** Rota pública `GET /api/health` (sem dado sensível) para o probe do orquestrador.

### 6.3 O que não muda

O ciclo de revisão: polling e fila, saída de cena e labels, lançamento headless, prompt e leitura,
envelope, gates, postagem, re-revisão, retry, Jira, memória do time, consumo e teto, log e
diagnóstico. A mesa "Precisa de você" fica: é para onde vai o que a política da conta não decide
sozinha. O botão de revisar sob demanda fica.

## 7. Front: `web/`

Decisões minhas de como fazer: Next.js (App Router) com TypeScript, renderização no cliente para
as telas de dados, sem biblioteca de estado além do necessário para o snapshot, estilos próprios
portando a identidade visual do Farol atual (tema escuro padrão e claro), lint e gate no padrão
`engineering-standards`. Sem MUI.

| Tela | O que mostra | Dados |
|---|---|---|
| Radar | Fila, "Analisando agora" com feed e Cancelar, "Precisa de você" (aprovar, pedir mudanças, comentar, pular), esperando o CI, revisar sob demanda, ignorar, checar agora | snapshot + `review`, `cancel`, `decide`, `ignore`, `restore`, `check` |
| Histórico | Revisões feitas, paginadas e filtráveis; detalhe da revisão; re-revisar; desfecho de contestação | `GET /api/decisions`, `GET /api/decision`, `review`, `pushback` |
| Time | Dossiê por autor, papel e competência; remover memória | `GET /api/team`, `team/remove`, `settings {people}` |
| Consumo | Gasto por dia, por tipo e por modelo, sessões recentes, estado do teto, diário filtrável | snapshot `usage`, `GET /api/usage` |
| Sistema | Conta revisora e política de aprovação, perfil do Claude e teto, Jira, saúde | `accounts/edit`, `settings`, `claude/profile-test`, `jira/*`, snapshot `doctor` |

- **O que a Sistema edita (decisão minha).** Pela tela: organizações monitoradas, política da
  conta, chaves de automação (CI antes de aprovar, paralelismo, modelo e esforço), teto de gasto,
  papéis do time, sites do Jira e revogação de sessões pareadas. Só por segredo, nunca pela tela:
  token do GitHub, chave da Anthropic e credencial do Jira; a tela mostra apenas se cada um está
  presente e válido. No boot o segredo vence o que estiver no volume. Só por arquivo: `bind`,
  `hostPublico`, `origensPermitidas`.
- **Transporte.** Um cliente único: `GET /api/events` lido por `fetch` com Bearer, aplicando
  `state` e `state-patch` por chave de topo, reconexão com recuo de 3 a 30 s e queda por 90 s de
  silêncio. Os contratos do snapshot ganham tipos e validação na borda.
- **Entrada.** Tela de pareamento: endereço do motor vem de `NEXT_PUBLIC_FAROL_API`, o código é
  trocado por token, guardado no `localStorage` da origem. 401 volta para o pareamento.
- **Segurança do front.** CSP restrita ao próprio domínio e ao endereço do motor; nenhuma
  credencial de serviço na Vercel.

## 8. Publicação

- **Front:** projeto na Vercel do time BIUD, raiz `web/`. Preview por PR não fala com o motor de
  produção (a origem do preview não entra em `origensPermitidas`).
- **Motor:** imagem publicada pelo CI; uma réplica com volume persistente e proxy TLS na frente.
  Proponho EKS pelo `infra-k8s`, com os segredos (token do GitHub, chave da Anthropic, credencial
  do Jira) no cofre. O desenho final de infra é decidido com o tech lead na última fase.
- **Conta revisora:** entra só como configuração e segredo. A primeira subida pode ser com
  `autoReview` desligado (o motor monitora e nada posta) até a conta ser definida.
- **Repositório:** restringir admins e escrita aos demais colaboradores é mudança de acesso no
  GitHub e não faz parte deste desenho; fica para decisão separada.

## 9. Fases

1. **Motor enxuto** (seção 6.1, lotes 1 a 13). Entregável: `node server.js` em Linux fazendo só
   revisão, suíte verde, `ui/` antiga ainda servindo para conferência.
2. **Contrato para o front** (seção 6.2: CORS, autenticação sempre, histórico, snapshot menor,
   saúde).
3. **Front novo** (seção 7), tela a tela: transporte e pareamento, Radar, Histórico, Time,
   Consumo, Sistema.
4. **Remoção da `ui/` antiga e fechamento** (lotes 14 e 15).
5. **Container e publicação** (seção 8).

Verificação por fase: suíte do motor verde; para o front, typecheck, lint, testes e as cinco telas
exercitadas contra um motor local com dados reais, sem postar no GitHub (motor com `autoReview`
desligado e conta sem pedido de revisão).

## 10. Deixado para quem constrói

- Estrutura interna de `web/` (pastas, componentes) e a biblioteca de gráficos do Consumo.
- Formato exato da paginação e dos filtros de `GET /api/decisions`.
- O que de `lib/sync` sobrevive como utilitário puro (hash e id) e com que nome.
- Como colapsar a multi-conta sem quebrar a leitura de um `config.json` existente.
- Quais guias (`docs/*.md`) são reescritos e quais saem.

## 11. Riscos conhecidos

- **Sync e multi-conta estão no caminho de postagem.** São os dois cortes que tocam gate; vão por
  último, um de cada vez, com os testes de postagem como rede.
- **Tamanho.** São quinze lotes de corte e um front novo. Se algum lote crescer além do previsto,
  ele é dividido, não acumulado.
- **Tela sem autenticação de time.** Só o administrador entra na primeira versão; abrir para o
  time pede login (o `internal-auth` é o caminho) e é outro desenho.
