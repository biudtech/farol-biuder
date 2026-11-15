import { telaVisivel, editandoFormulario, textoSelecionado } from './pintura.js';

// Dependências dos campos de topo do SSE. Uma aba suja continua lendo o estado mais novo ao entrar.
function gruposDaPintura(pintar) {
  const radar = () => telaVisivel('radar');
  const mim = () => telaVisivel('radar', 'mim') && !editandoFormulario() && !textoSelecionado('#rpane-mim');
  const sistema = () => telaVisivel('sistema') && !editandoFormulario() && !textoSelecionado('#tab-sistema');
  const grupo = (id, campos, visivel = () => true) => ({ id, campos, visivel, pintar: pintar[id] });
  return [
    grupo('plataforma', ['app']),
    grupo('contas', ['accounts', 'account', 'config', 'queue', 'decisions', 'activeSessions']),
    grupo('status', ['app', 'status', 'error', 'account', 'activeSessions', 'buscasPausadas']),
    grupo('sessoes', ['activeSessions', 'activity', 'headlessWaiting', 'headlessWaitingContas', 'accounts'], mim),
    grupo('decisoes', ['decisions', 'accounts', 'config', 'reRounds', 'pushbacks', 'activeSessions', 'headlessWaiting', 'headlessWaitingContas'], mim),
    grupo('fila', ['queue', 'headlessWaitingPrs', 'activeSessions', 'decisions', 'headlessWaiting', 'headlessDistributing', 'headlessWaitingDetails', 'accounts', 'config', 'parked', 'sync', 'usage', 'status', 'lastCheckAt'], mim),
    grupo('meus', ['myPRs', 'selfAnalyses', 'activeSessions', 'headlessWaiting', 'hiddenPRs', 'mergeStates', 'baseDosMeusPRs', 'config', 'accounts', 'lastCheckAt', 'status', 'sync'], () => telaVisivel('radar', 'meus') && !editandoFormulario() && !textoSelecionado('#rpane-meus')),
    grupo('navegacao', ['queue', 'myPRs', 'hiddenPRs', 'decisions', 'activeSessions', 'headlessWaiting', 'headlessDistributing', 'accounts', 'sync'], radar),
    grupo('configuracoes', ['app', 'paths', 'config', 'accounts', 'account', 'contasGh', 'doctor', 'sync', 'jiraSites', 'modelos', 'capacidades', 'myPRs'], sistema),
    grupo('relogio', ['lastCheckAt', 'nextCheckAt', 'status', 'activeSessions', 'activity']),
    grupo('consumo', ['usage', 'config', 'sync', 'filaJusta', 'accounts', 'activeSessions'], () => telaVisivel('consumo')),
    grupo('compartilhado', ['sync', 'config', 'accounts'], radar),
    grupo('aparelhos', ['sync', 'config', 'accounts'], radar),
  ];
}
export { gruposDaPintura };
