# Política de segurança

O Farol roda com a credencial da conta revisora e é capaz de **escrever no GitHub em nome
dela** (aprovar PR, pedir mudanças, comentar). Falha de segurança aqui tem consequência real
nos repositórios da BIUD, então este arquivo existe.

## Como reportar

**Não abra issue para falha de segurança.**

1. Preferido: abra um advisory privado do próprio repositório em
   <https://github.com/biudtech/farol-biuder/security/advisories/new>. Só quem administra o
   repositório vê.
2. Alternativa: avise diretamente o responsável pelo repositório, por canal privado.

Ajuda no relato: o commit em que o problema acontece, o que um atacante consegue fazer e o
passo a passo mínimo para reproduzir. Nunca inclua token, credencial ou conteúdo de
repositório privado no relato.

## O que está em escopo

- **Escapar de um gate de postagem.** Qualquer caminho que faça o motor aprovar, reprovar ou
  comentar no GitHub sem o gate correspondente (`shouldAutoApprove`, `shouldAutoReject`,
  cobertura da leitura, trava de linguagem pública, dedup por head).
- **Vazamento de credencial.** Token do `gh`, chave do Claude ou conteúdo de repositório
  privado indo parar em log, em arquivo de estado, no corpo de um review postado ou em
  qualquer tráfego que não seja GitHub e Anthropic.
- **Superfície HTTP local.** O motor escuta em `127.0.0.1` por padrão, com allowlist de Host
  e Origin (`lib/http-guard.js`) e autenticação opcional (`lib/local-auth/`), exigida sempre
  que o bind sai do loopback. Qualquer forma de alcançar a API de fora da máquina sem essa
  proteção, ou de fazer uma página web chamar os endpoints dela (CSRF, DNS rebinding, CORS
  frouxo), é falha.
- **Execução de código.** Conteúdo controlado por terceiros (título de PR, nome de branch,
  corpo de comentário, resposta do `gh`) que vire comando de shell ou execução arbitrária no
  motor.
- **Injeção com efeito de escrita pelo caminho do motor.** Conteúdo de PR que faça o motor
  escrever no GitHub o que os gates deveriam segurar: aprovar ou reprovar sem revisão
  pedida, passar texto interno pelo filtro de linguagem ou postar sobre um commit que a
  revisão não leu.

## Limitações conhecidas e assumidas

- **Sessão do Claude Code com credencial.** A sessão de revisão recebe uma credencial do
  GitHub para investigar PRs, inclusive privados. A proibição de escrever por fora do funil
  do motor é regra de protocolo, não uma fronteira contra um processo deliberadamente
  malicioso, inclusive a sessão sequestrada por injeção no conteúdo do PR que chama o `gh`
  por conta própria: o limite ali é o que a credencial da sessão permite. Detalhe em
  [`docs/REVIEW-GATES.md`](../docs/REVIEW-GATES.md).
- **Quem liga a automação responde por ela.** A política da conta (`onClean`, `onCaveats`,
  `onReject`) decide o que sai sozinho, e o que sai é postado na conta revisora.
- **Acesso local à máquina.** Quem já tem sessão de usuário no host lê `~/.farol` e fala com
  a API local. O motor não protege contra o dono da máquina nem contra malware já rodando
  com o mesmo usuário.
- **Prompt injection sem efeito colateral.** Conteúdo de PR que influencia o TEXTO de uma
  revisão, sem escapar de nenhum gate de postagem, é qualidade de review, não segurança.
  Abra issue normal.

Nunca compartilhe a pasta `~/.farol`: ela contém o estado, a configuração e a memória de
reviews.
