// Quem exige autenticação na API local (A4, spec 7.A4). PURO: os sinais chegam por
// parâmetro, e nada que o cliente escreve entra aqui.

// localAuth 'exigir' liga em qualquer ambiente. O motor que escuta fora do loopback
// (config.bind, implantação web) exige sempre: ali a API chega a outras máquinas, e Host
// permitido não é autenticação. Não existe ramo que leia a config para devolver false com o
// bind fora do loopback, e é isso que impede uma config de desligar a proteção ali.
function exigeAutenticacao({ config = {}, bindForaDoLoopback = false } = {}) {
  if (config && config.localAuth === 'exigir') return true;
  return bindForaDoLoopback === true;
}

export default { exigeAutenticacao };
export { exigeAutenticacao };
