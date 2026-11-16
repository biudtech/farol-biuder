# Armazenamento das fontes de revisão

O cache das fontes do PR fica em `~/.farol/source-cache` (`lib/review-source/store.js`), com um
diretório por escopo: o SHA-256 de host, conta, identidade do repositório e nome do
repositório. Este guia diz os limites, o que entra na conta e como o que sobra é removido. O
detalhe de cada mecanismo, com o caso que o originou, está no cabeçalho dos arquivos de
`lib/review-source/` e de `lib/technical-review/material-maintenance.js`.

## Limites

A chave `sourceCacheLimits` do `config.json` (só por arquivo) aceita os campos abaixo. Cada
valor tem de ser inteiro positivo; o que não for fica no padrão (`limitsFor`,
`lib/review-source/contract.js`).

| Campo | Padrão | Finalidade |
|---|---:|---|
| `maxBytes` | 2 GiB | Orçamento lógico por escopo |
| `reserveBytes` | 512 MiB | Piso de espaço livre por operação |
| `globalMaxBytes` | 4 GiB | Orçamento lógico agregado gerenciado |
| `globalReserveBytes` | 1 GiB | Piso global de espaço livre |
| `acquisitionReserveBytes` | 16 MiB | Reserva inicial da aquisição de tamanho desconhecido, e margem do checkout |
| `monitorIntervalMs` | 250 ms | Intervalo do monitor de uma operação em andamento |
| `timeoutMs` | 120 s | Teto dos comandos Git |
| `fetchTimeoutMs` | 10 min | Teto do fetch e do repack |

A tabela traz os oito campos de quota e de tempo. `DEFAULTS` tem quinze, e os outros sete
aceitam valor do mesmo jeito: `maxFileBytes` (1 MiB), `maxFiles` (20.000), `concurrency` (1; o
valor informado vai no máximo a 2), `maxQueued` (8), `lockWaitMs` (5.000), `maxTreeDepth` (64)
e `maxReleasedLeases` (64). O que cada um limita está em `lib/review-source/contract.js` e em
quem o lê.

## O que entra na conta

O inventário (`lib/review-source/storage-inventory.js`) soma tamanho lógico de arquivo, com
precisão declarada `logical-file-size-deduplicated-within-scope`:

- cada escopo do cache (as pastas de 64 dígitos hexadecimais);
- os arquivos de controle da quota (`storage-budget.json` e a trava);
- o que estiver na raiz do cache sem classificação;
- os materiais da avaliação técnica em `~/.farol/workspace/state/technical-review` que têm
  registro de posse (`<pasta>-material.json`) ou referência de fontes, e os arquivos irmãos
  deles.

Pastas sem registro nessa raiz são legados: aparecem à parte, com
`includedInManagedBytes: false` e `removable: false`, e a quota nunca as remove. O tamanho
delas é observado com janela de 200 ms e até 10 mil entradas, reaproveitado por 60 segundos, e
sai como `bounded-lower-bound` quando a observação não termina.

Ficam fora, declarados em `exclusions`: alocação de diretórios, compressão e arquivos esparsos
do sistema de arquivos, materiais externos sem registro e o índice sintático em memória. Não é
uma quota física do sistema operacional.

## Travas e interrupção

- Duas travas de arquivo, as duas com dono escrito (`lib/review-source/lock-file.js`):
  `storage-budget.lock`, global, e `writer.lock`, por escopo. Trava existente só é retomada
  com prova de que ninguém a segura: este processo sem a trava em mãos, dono encerrado pelo
  sistema operacional, ou boot posterior a ela. Trava sem dono legível continua valendo: idade
  sozinha nunca retoma.
- O `unlink` do fim da transação repete `EPERM`, `EACCES` e `EBUSY` por até 775 ms.
- Com `operation-pending.json` no escopo (término de processo Git não confirmado), a admissão
  daquele escopo é adiada e o material existente fica preservado (`assertConfirmed`,
  `lib/review-source/store.js`).
- Admissão ocupada, sem espaço ou com estado corrompido adia a aquisição; não remove material
  de outro consumidor.

## Refs que o cache guarda

Além dos objetos, o cache Git do escopo guarda `refs/farol/known/head` e
`refs/farol/known/base` (o último alvo preparado) e um anel de alvos recentes por lado, em
`refs/farol/known/recent/head/` e `refs/farol/known/recent/base/`, com até 8 refs em cada um
(`lib/review-source/git.js`). Servem para o fetch anunciar o que o cache já tem. Acima do
`maxBytes` o cache é compactado (`repack -a -d`) e, se não bastar, despejado inteiro, anel
junto; o despejo é recusado enquanto houver consumidor Git ativo.

## Manutenção dos materiais técnicos

A manutenção de `~/.farol/workspace/state/technical-review`
(`lib/technical-review/material-maintenance.js`) roda a cada 30 segundos, lê até 16 registros
por ciclo, em rodízio, e remove no máximo dois materiais por ciclo. Registro já `removed` fica
fora do rodízio.

- **Material liberado** (`released` ou `removal-pending`, sem consumidores) sai pela fila.
  Com `sourceProcessPending` ou `sourceTerminationUnconfirmed` no registro, não sai.
- **Registro preso de dono morto**: liberado com a prova `owner-ended-without-git`, gravada no
  registro, e um WARN no log.
- **Pasta legada** (sem registro): vira candidata quando não tem `-material.json` nem pasta de
  consumidores, não é link simbólico e foi modificada há mais de 7 dias. A varredura roda no
  máximo a cada 10 minutos e só segue se as leases do cache puderam ser lidas; pasta citada por
  lease fica. Tudo é conferido de novo antes de apagar. A evidência (`id`, instante, data de
  modificação e a prova `legacy-unreferenced`) vai a `legacy-removals.json`, que guarda as
  últimas 500, e o fato vai ao log.
- `diagnosticoLegados` classifica cada legado como `eligible`, `recent`, `referenced` ou
  `unverified`.
