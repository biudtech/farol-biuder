# Fontes, contexto e desempenho, entrega local

Base de desenvolvimento: `3f9b8685ab0966a0d4cd339a462bfa5b29367c86` (v2.77.2).
A entrega mantém Node/Electron, sem embeddings, banco vetorial, serviço externo ou
análise paga de PRs. A rodada de fechamento acrescenta o parser oficial autocontido
com licença e hashes; o pin npm é usado apenas para reproduzir o artefato distribuído.

## Decisões

- Fontes têm conta/repositório/H/B/M próprios. Review e autoanálise compartilham aquisição,
  mas mantêm separadas autoria, checkpoints, decisões e publicação.
- Cache de objetos e árvores fica fora dos snapshots descartados. Referências por
  consumidor protegem objetos Git; não há alternates dependentes de origem podável.
- Manifestos de material ficam fora do checkout verificado. Leases de filhos e resultados
  duráveis têm tratamento diferente. Incerteza sobre término conserva o material.
- UI aplica o estado imediatamente e agenda somente a pintura. Abas ocultas ficam dirty;
  foco, seleção, rascunho e FileList precisam sobreviver às atualizações.
- Dados históricos de consumo podem ser reutilizados com invalidação explícita.
  As falhas continuam vivas; gravações mantêm fsync e confirmação síncrona.
- O mapa é navegação candidata. A bateria frontend demonstrou a lacuna do parser nativo;
  o parser distribuído cobre JS/TS/JSX/TSX, com limites declarados.
- O contrato externo vigente é Node 24 LTS, `>=24.22.1 <25`. O suporte a Node 22
  foi encerrado por decisão de produto, sem atribuir causa ao crash histórico.
  A política e o procedimento de atualização estão em [RUNTIME.md](RUNTIME.md).

## Comparação reproduzível

O replay de 100 deltas da tela antiga (`tools/benchmark-ui-pintura.js`) saiu com ela em
16/11/2026. Ele comparava operações DOM, preservação de estado e cauda de atividade; não era
perfil de CPU em produção.

Com `FAROL_HOME` temporário e `GH_CONFIG_DIR` vazio, execute:

```text
node tools/benchmark-contexto.js --baseline <checkout-da-base> --output <resultado.json>
```

O replay usa 83 arquivos sintéticos e H/M congelados, sem comentários ou soluções
posteriores. Mede parser frio/quente, recuperação de consumidor e teste fora do diff,
compactação da memória com os mesmos blockers e cinco gravações com fsync real.
Não chama o máximo de cinco amostras de p95 nem afirma ganho de decisão de modelo.
Há três cenários: regressão conhecida, mudança compatível e fonte insuficiente.
O controle que só contém o diff é sintético; ele não representa o Farol anterior
completo, que já dispunha de buscas adicionais. Execute em processo novo para o
cache frio do parser; a reutilização sintática é limitada à memória do processo.
O fechamento também compara os engines completos, nos dois fluxos, com fontes
congeladas e reinícios: [método e resultados](COMPARACAO-CONTEXTO-ENGINE.md).
Nesses casos, `assist` recupera evidência adicional e aumenta o prompt completo;
redução da memória de rodadas não demonstra economia total de tokens.
O `tools/benchmark-ui-native.js`, que complementava o lote com Electron real, também não
existe mais.

## Limitações e ativação

As opções e os procedimentos estão em [CONFIGURATION.md](CONFIGURATION.md).
O rollout do mapa começa desligado; observe não muda a seleção e assist é controlado.
As correções determinísticas só passam a valer numa instalação futura autorizada.

Os benchmarks locais não comprovam consumo de agentes sob carga, qualidade de decisões,
economia faturada ou redução de CPU da instalação aberta. A bateria controlada com
provedores e julgamento humano permanece uma avaliação posterior, sem contaminar
fontes históricas. Há provas locais de recuperação e de redução de repetição.

Legados sem posse verificável não são removidos automaticamente. As rodadas locais
anteriores não executaram push, PR ou merge. A rodada de Node 24 autoriza publicar
a branch e integrar após os gates; o pedido posterior autoriza também a release
com notas e artefatos conferidos. O estado efetivo consta do relatório de entrega.
Continuam vedados limpeza real de snapshots, instalação ou restart do usuário.
Após reinício, materiais novos interrompidos só são recuperados quando há decisão
final correspondente ao PR/head/conta, sem sessão/fila/retomada referenciando, e o
SO comprova o término do proprietário e dos consumidores. Queda sem esse desfecho,
histórico podado ou identidade insuficiente conserva o material para diagnóstico.
