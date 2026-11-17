// Fonte ÚNICA de leitura de process.env fora de lib/paths.js
// (core.duplication.business-rule). LEITURA PREGUIÇOSA de propósito: os testes setam os
// stubs FAROL_*_CMD depois do require, então snapshot no load quebraria a suíte.
const env = {
  headlessCmdStub: () => process.env.FAROL_HEADLESS_CMD, // usado só em teste: substitui o claude headless
  debugSpawns: () => process.env.FAROL_DEBUG_SPAWNS === '1',
  testConcurrency: () => process.env.FAROL_TEST_CONCORRENCIA || '',
  // cópia do eng-behaviour que o gate usa, quando não é a fixada ao lado (tools/eng-behaviour/gate.js)
  engBehaviourHome: () => process.env.FAROL_ENG_BEHAVIOUR_HOME || '',
  setDebugSpawns: (ligado) => { process.env.FAROL_DEBUG_SPAWNS = ligado ? '1' : ''; },
  // o valor cru da trava da instância hospedada; quem o interpreta é lib/instancia-hospedada.js
  instanciaHospedada: () => process.env.FAROL_INSTANCIA_HOSPEDADA,
  // Copia do ambiente sem os nomes pedidos, para quem dispara `git`.
  //
  // Mora AQUI, e nao junto de quem usa, por causa da propria regra que este
  // arquivo existe para cumprir: a leitura de process.env tem uma casa so. Quem
  // chama e que sabe QUAIS nomes remover (a lista autoritativa e do git, nao
  // nossa), entao ela vem por parametro em vez de estar escrita aqui dentro.
  semAsVariaveis: (nomes) => {
    const copia = { ...process.env };
    for (const nome of nomes) delete copia[nome];
    return copia;
  },
};
export default env;
export const { headlessCmdStub, debugSpawns, engBehaviourHome, setDebugSpawns, semAsVariaveis, instanciaHospedada } = env;
export const { testConcurrency } = env;
