# Redesenho do farol-biuder: um cartão só, fila limpa

Data: 19/11/2026. Base: `main` em `a6644da6`. Desenho aprovado pelo dono no canvas do Claude
Design (privado; as telas usam dados de exemplo com pessoas reais do time, por isso não são
copiadas para este repositório, que é público).

## 1. Intenção

O dono gostou do cartão da revisão em andamento no Radar (o do molde da autoanálise, #51) e quer
o front inteiro redesenhado a partir dele: a mesma linguagem visual em todas as telas, uma fila
que mostre só o que o Farol vai de fato revisar, e telas que deixem aprofundar a informação por
interação (clique abre o detalhe), em vez de listas planas.

## 2. Metas, não-metas e antimetas

**Metas**

1. **Cartão único.** Todo PR, em qualquer tela, usa o mesmo cartão: foto do autor, chave, título,
   contexto, pílulas de estado e rodapé. Muda só a borda e o que o cartão mostra pelo estado.
2. **Porcentagem da revisão inteira** no cartão em análise, grande, com uma barra única, e as cinco
   etapas abaixo como detalhe.
3. **Fila limpa.** O PR que o motor deixou de revisar sozinho por um motivo que não se resolve
   sozinho sai da fila e da contagem dela e vai para **"De fora da fila"**: um botão flutuante no
   Radar, discreto e com rótulo ("De fora da fila · Ver os PRs e o motivo de cada um"), e uma
   pílula ao lado do título da Fila, os dois abrindo um painel lateral que se fecha. Cada cartão do
   painel abre com o motivo em destaque e quando o PR volta, e tem "Revisar mesmo assim".
4. **Cabeçalho** com o logo da BIUD e "Farol" com mais respiro e a versão do motor ao lado.
5. **Histórico** no mesmo cartão, agrupado por dia, com busca, filtro por desfecho e o detalhe
   aberto no próprio cartão.
6. **Time**: um cartão por pessoa com papel, domínios, números de 30 dias e "o que o Farol já
   aprendeu", ver dossiê, editar papel e adicionar pessoa.
7. **Consumo** com aprofundamento: período, filtros (busca, repositório, autor do PR, modelo,
   perfil do Claude), números, uso do plano de cada perfil, custo por dia e por repositório
   (clicáveis, viram filtro), por modelo, por gatilho da sessão, e a tabela de cada sessão que
   abre com tokens por tipo, tempo por etapa, tentativas, arquivos e card, com CSV.
8. **Sistema** com menu de assuntos à esquerda (cada um com um resumo do estado) e o assunto aberto
   à direita: Conta revisora (revisar sozinho, organizações vigiadas, política explicada), Regras
   por organização e autor, Padrões do time, Claude (perfis na ordem de uso, cada um abre com uso
   do plano, validade do login, Testar, Refazer login, Subir na ordem; modelo, esforço, paralelo,
   modo rápido), Jira (site, organizações, projetos, últimos cards lidos, Testar, Trocar credencial),
   Ritmo da revisão (intervalo, retomada, contestação) e Quem está conectado.

**Não-metas**

- Mudar regra de gate, de fila ou de postagem. "De fora" é projeção do que o motor já decide.
- Listar PR da própria conta revisora: o motor o corta já na busca e o clique manual o recusa.
- Rascunho em "De fora": rascunho não segura a primeira revisão hoje.
- Regra por repositório: o motor tem regra por organização e por autor; a tela usa isso.
- Custo por tipo de token: o motor não tem tabela de preço; mostra os tokens de cada tipo e o custo
  total da sessão.
- Checks ao vivo durante a revisão: só existem no fim; a pílula de checks aparece quando há dado.
- Faixa de saúde no topo do Sistema (o dono pediu para tirar).

**Antimetas**

- Um "De fora" que esconda PR que o motor ainda vai revisar sozinho.
- "Revisar mesmo assim" que não funcione para algum motivo listado.
- Tela que recalcula regra do motor (a definição do dado é do motor).
- Segredo que volta em resposta da API ou aparece na tela depois de gravado.

## 3. Decisões

1. **"De fora" vem do motor**: chave nova `deFora` no snapshot, montada por `lib/engine/de-fora.js`
   a partir do que o motor já guarda, e o front tira essas chaves da Fila e da contagem
   (`fatiarFila`). A `queue` do motor não muda (ela serve de consulta ao clique). Motivos e fonte:
   `decisao_de_gente` (estado novo `seguradoPorGente`, gravado em `bloqueiaAutomatico` e
   `recusaNaBoca`, com quem, o estado e quando, lendo `submitted_at` nos reviews),
   `pedido_retirado` (mesmo registro), `outra_conta` (`skipComentado`/`outrosRevisando`),
   `regra_manual` e `auto_desligado` (`politicaDeInicio`, com a origem), `estacionado` (`parked`),
   `ignorado` (`ignorados` cruzado com o `panorama`). Ordem de precedência quando há mais de um:
   estacionado, outra conta, decisão de gente, pedido retirado, regra, ignorado.
2. **Dados novos do motor para as telas**: `card` na sessão ativa; a retentativa por PR
   (`{tries, notBefore}`); em `GET /api/decision` → `execucao`, os perfis usados e a lista de
   tentativas; em `GET /api/usage`, filtros `profile` e `author`, tokens de pensamento, custo por
   modelo, o gatilho da sessão (`primeira`, `commit_novo`, `rodada_extra`, `contestacao`, gravado
   no registro de consumo daqui em diante; antigo sem marca conta como `primeira`) e `formato=csv`.
3. **Login da assinatura e credencial do Jira pela tela.** O desenho aprovado tem "Refazer login"
   e "Trocar credencial". O motor já tem as rotas (`/api/claude/login-web/*`, `/api/jira/credential`)
   e o front passa a usá-las; o token do Jira é digitado num campo mascarado, vai só no corpo do
   POST e nunca volta. Isso substitui a decisão de 12/11 ("segredo nunca pela tela"), por escolha
   do dono no desenho. Perfil por chave de API continua só pela API.
4. **Interação no Sistema e no Consumo**: assunto e perfil abrem por estado da tela; a rota da tela
   guarda o assunto aberto (`/sistema/<assunto>`), para o link funcionar.
5. **Identidade**: a de hoje (Mulish, tokens de `globals.css`, logo, tema claro padrão e escuro).
   Cartão branco, raio 16, borda pela cor do estado, sombra leve só no em análise.

## 4. Lotes

1. Motor: "De fora" e os dados do Radar (decisão 1 e o `card` e a retentativa da decisão 2).
2. Motor: os dados do Histórico e do Consumo (resto da decisão 2).
3. Front: base (cabeçalho, cartão, pílulas), Radar e o painel "De fora".
4. Front: Histórico e Time.
5. Front: Consumo.
6. Front: Sistema (inclui a decisão 3).
7. Publicação na Hostinger.

Cada lote: branch do `main`, teste primeiro, gate completo em Linux (motor e web), revisão
independente, PR, merge por merge commit.
