# Redesenho do farol-biuder: plano

> Para quem executa: um lote por branch saída do `main`, teste primeiro, gate completo em Linux,
> revisão independente, PR e merge por merge commit. Desenho em
> `docs/superpowers/specs/2026-11-19-redesenho-cartao-unico-design.md`.

## Regras de todo lote

- Nunca rebase; base entra por merge commit. Sem atribuição de IA. LF. Português sem travessão.
- Nunca apagar nem afrouxar teste de gate (invariante 4 do `CLAUDE.md`).
- Lista fechada do snapshot: chave nova entra em `server.js` `snapshot()`, em
  `test/snapshot-chaves.test.js` e em `web/src/contratos/snapshot.ts` (`CHAVES_DO_SNAPSHOT`), com
  leitor no contrato da tela.
- Rota nova ou parâmetro novo: `lib/local-auth/inventario.js` e o teste do inventário; o
  `CLAUDE.md` ("A API do motor") e o guia da tela (`web/README.md`) acompanham.
- Gate: `wsl -e bash -lc 'bash /mnt/c/Users/wanderson/Documents/gate-farol-biuder-wsl.sh <branch>'`
  (clona a branch commitada; motor e web; uma rodada por vez).

## Lote 1 (motor): "De fora" e os dados do Radar

Branch `feat/redesenho-1-de-fora`.

1. `lib/engine/de-fora.js`, `deForaParaTela(engine)`: lista
   `[{ key, url, title, author, repo, number, motivo, detalhe, desde, head, quem? }]` dos PRs pedidos
   à conta que o motor não vai revisar sozinho, com os motivos e a precedência do desenho (decisão
   1): `estacionado` (`parked`/`parkedMotivos`: detalhe = tipo e motivo), `outra_conta`
   (`skipComentado` e `outrosRevisando` do item), `decisao_de_gente` e `pedido_retirado` (estado
   novo abaixo), `regra_manual` e `auto_desligado` (`politicaDeInicio`, com `source`,
   `organization`, `author`), `ignorado` (`engine.ignorados` cruzado com `engine.panorama`, sem
   data). Fonte dos metadados: o item da `queue` ou do `panorama`. Pura sobre o engine, sem IO.
2. Estado `engine.seguradoPorGente` (Map em memória, key → `{ head, motivo, decisivos: [{ quem,
   estado, em }], desde }`), gravado onde o motor já decide segurar: `bloqueiaAutomatico`
   (`skip-review.js`) e `recusaNaBoca` (`review.js`), e o pedido retirado
   (`pedido-de-revisao.js`). `reviewsDeOutros` passa a ler `submitted_at`. Some quando o head
   muda ou quando o motor deixa de segurar (podar junto com `podarHistoricoAvisado`). Reinício
   zera: o próximo ciclo grava de novo.
3. Snapshot: `deFora` (lista), `card` em cada `activeSessions[]` (chave do card lido, gravada logo
   depois de `cardForPr` em `review.js`), e `emRetentativa` (`{ [key]: { tentativas, aPartirDe } }`
   de `retryAfterNet`).
4. Testes primeiro, em `test/de-fora.test.js`: um caso por motivo (com o detalhe e o quem/quando
   da decisão de gente), a precedência quando há dois motivos, o PR que o motor VAI revisar
   sozinho nunca aparece (fila comum, conflito, limite do plano, retentativa), e o clique manual
   (`POST /api/review`) atravessa cada motivo listado (os testes que já existem para isso ficam;
   acrescente o que faltar). E: `card` na sessão ativa, `emRetentativa`.

## Lote 2 (motor): dados do Histórico e do Consumo

Branch `feat/redesenho-2-dados`.

1. `GET /api/decision` → `execucao`: `perfis` (os `profileId` distintos das tentativas) e
   `sessoes: [{ id, em, modelo, perfil, duracaoMs, custoUsd, retomada }]`.
2. `GET /api/usage`: filtros `profile` e `author` (o autor vem do histórico por `ref`), tokens de
   pensamento (`thinkingTokens`) nos totais, nas linhas e nos modelos; custo por modelo; `gatilho`
   por sessão (`primeira`, `commit_novo`, `rodada_extra`, `contestacao`), gravado no registro de
   consumo daqui em diante a partir do que `runHeadlessReview` sabe (rodada automática, desfecho
   sem mesa, busca da prova, pushback), antigo sem marca = `primeira`, e agregado `porGatilho`;
   `pageSize` (padrão 8, teto 50); `formato=csv` com o mesmo escape de `historico-csv.js`; e, por
   linha, `etapas` (da decisão do mesmo PR e janela, como em `detalhe-da-decisao.js`), `card` e
   `arquivosLidos` quando a decisão tiver.
3. Testes primeiro para cada item, nos arquivos vizinhos (`test/usage-*.test.js`,
   `test/detalhe-da-decisao*.test.js`).

## Lote 3 (front): base, Radar e "De fora"

Branch `feat/redesenho-3-radar`.

1. Cabeçalho: logo, divisor, "Farol" e a versão (`app.version`), com o respiro do desenho.
2. Componente de cartão único (`componentes/cartao/`): casca com borda por estado, foto,
   chave/autor/ramo, título, pílulas, rodapé; usado em todas as telas.
3. Radar: em análise com a porcentagem grande e a barra (`progresso.percentual`), as etapas, o
   arquivo atual, o tempo e o típico, o card e o perfil; fila sem os PRs de `deFora` e com a
   posição e o motivo de espera (vaga, conflito, limite do plano, retentativa); postadas hoje.
4. "De fora": botão flutuante com rótulo e contagem, pílula ao lado do título da Fila, painel
   lateral com filtros por motivo, cada cartão com o motivo em destaque, quando volta, e "Revisar
   mesmo assim" (`POST /api/review {urls}`). O painel fecha no X e no Esc, prende o foco e devolve
   o foco ao botão.
5. Testes de componente (vitest) para cada estado do cartão e para o painel.

## Lote 4 (front): Histórico e Time

Branch `feat/redesenho-4-historico-time`. Histórico no cartão, agrupado por dia, busca, filtro por
desfecho, detalhe aberto no próprio cartão (critérios, achados com arquivo e linha, rodadas,
tempo, custo, sessões e perfis), Ver o review postado, Revisar de novo. Time em grade de cartões
(papel, domínios, números de 30 dias, aprendizados do dossiê, Ver dossiê, Editar papel, Adicionar
pessoa).

## Lote 5 (front): Consumo

Branch `feat/redesenho-5-consumo`. Período, filtros (busca, repositório, autor, modelo, perfil),
pílulas de filtro ativo, números, uso do plano por perfil, custo por dia e por repositório
clicáveis (viram filtro), por modelo, por gatilho, tabela de sessões paginada, que abre com tokens
por tipo, etapas, tentativas, arquivos e card, e Baixar CSV.

## Lote 6 (front): Sistema

Branch `feat/redesenho-6-sistema`. Menu de assuntos com resumo e rota `/sistema/<assunto>`; Conta
revisora (revisar sozinho, organizações vigiadas, política explicada), Regras por organização e
autor, Padrões do time, Claude (perfis na ordem com o detalhe ao clique, Testar, Refazer login
pelo fluxo `login-web`, Subir na ordem, modelo, esforço, paralelo, modo rápido), Jira (site,
organizações, projetos, últimos cards lidos das decisões, Testar, Trocar credencial com campo
mascarado), Ritmo (intervalo, retomada, contestação) e Quem está conectado (sessões, Sair,
Revogar).

## Lote 7: publicação

`empacotar-next.sh` e `publicar.sh` de `Documents/biud/farol-biuder-hospedagem`, conferência no
servidor (motor e front vivos, link 200), e as telas conferidas no Chrome do dono.
