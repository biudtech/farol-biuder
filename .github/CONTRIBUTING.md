# Contribuindo com o Farol

O Farol é o revisor autônomo de pull requests da BIUD: um motor em Node puro (`node server.js`)
que monitora o GitHub com o `gh` e dispara revisões com o Claude Code. Roda só em Linux.

Comece pelo [mapa do código](../README.md#mapa-do-código). Depois leia o
[`CLAUDE.md`](../CLAUDE.md) (guia do mantenedor, manda nos invariantes) e o
[`docs/QUALITY.md`](../docs/QUALITY.md) (manda em como o código é organizado e verificado).

## Invariantes que não se negociam

Estão detalhados no `CLAUDE.md`. Resumo do que reprova um PR na hora:

1. **Sem dependência npm de runtime.** Pacote novo só com autorização.
2. **Dados em `~/.farol`.**
3. **`farol.log` só recebe falha**, e a classificação delas mora só em `lib/log-taxonomy.js`.
4. **Nada é postado no GitHub sem gate.** Não afrouxe `shouldAutoApprove` / `shouldAutoReject` nem os gates de postagem.
5. **Texto e comentário em português, sem travessão.** Use vírgula, parênteses ou dois pontos.

## Ambiente

- Linux com Node.js 24.22.1 (faixa `>=24.22.1 <25`, conferida por `lib/node-runtime.js` antes de cada script)
- GitHub CLI (`gh`) autenticado
- Claude Code (`claude`) no PATH, se for mexer no caminho de revisão

Não é preciso `npm install` para rodar os testes: a suíte usa o runner nativo do Node
(`node --test`).

Para subir sem tocar no seu estado real, aponte para outra pasta:

```bash
FAROL_HOME=/tmp/farol-teste node server.js
```

Instância com `FAROL_HOME` fora de `~/.farol` não escreve no GitHub, a menos que o
`config.json` dela traga `"instanciaIsoladaPosta": true`. `FAROL_HEADLESS_CMD`
substitui o `claude` da revisão por um stub.

## Fluxo

1. Branch curta saída da `main`.
2. Instale os hooks uma vez por clone: `npm run hooks:install`. O pre-push recusa push direto
   na `main` e roda o gate local.
3. Antes de abrir o PR, o gate local verde:

   ```bash
   npm run check && npm run lint && npm test
   ```

4. PR para a `main`. O check obrigatório é o `ci` (`.github/workflows/ci.yml`, em Linux), que
   roda o mesmo gate.
5. Mescle com merge commit (`gh pr merge --merge`).

**Rebase é proibido**, em qualquer forma (`git rebase`, `git pull --rebase`, "Rebase and merge"
ou "Update with rebase" no GitHub). Para trazer a `main` para a branch, use merge commit
(`git merge --no-ff`).

Se o `lint` acusar regressão, corrija o código. `npm run lint:update` só move a catraca quando
o número melhora de verdade, nunca para esconder piora.

## Regras do PR

- Um assunto por PR, com teste junto do código.
- **Nunca apague nem afrouxe teste de gate** (postagem, dedup por head, espera do CI, PR
  próprio como COMMENT, credencial no texto, linguagem pública, instância isolada). Teste que
  só protegia código removido sai junto com ele, com o motivo no commit.
- Commits no formato `tipo: descrição` (`feat`, `fix`, `docs`, `chore`, `ci`, `refactor`,
  `test`), em português, sem rodapé de coautoria.
- Arquivos sempre em LF (o `.gitattributes` cuida disso).
- Mudou comportamento documentado? Atualize o `CLAUDE.md`, o `README.md` ou o
  `docs/QUALITY.md` no mesmo PR.

## Reportando problema

- **Bug ou melhoria**: abra uma issue usando um dos modelos.
- **Falha de segurança**: não abra issue. Siga o [`SECURITY.md`](SECURITY.md).

Ao colar trecho do `farol.log` ou da configuração, confira antes: o log cita nomes de
repositório, de PR e de conta. Nunca cole token.
