## O que muda

<!-- Uma frase direta. Se precisar de parágrafo, o PR provavelmente tem mais de um assunto. -->

## Por quê

<!-- O problema que isso resolve, ou o comportamento que passa a existir. Link da issue, se houver: Closes #123 -->

## Como validar

<!-- O caminho pelo motor, ou o teste que cobre. Quem revisa precisa conseguir repetir. -->

## Checklist

- [ ] `npm run check && npm run lint && npm test` verdes localmente
- [ ] Teste novo cobrindo o comportamento novo (ou justificativa de por que não cabe)
- [ ] Nenhum teste de gate apagado ou afrouxado
- [ ] Nenhuma dependência npm nova
- [ ] Nenhum gate de postagem afrouxado
- [ ] Texto e comentários em português, sem travessão
- [ ] Base trazida por merge commit, sem rebase
- [ ] Documentação atualizada no mesmo PR (`CLAUDE.md`, `README.md` ou `docs/QUALITY.md`), se o comportamento documentado mudou

## Risco

<!-- O que pode quebrar se isso estiver errado, e o que fazer para reverter. "Nenhum" é resposta válida, desde que seja verdade. -->
