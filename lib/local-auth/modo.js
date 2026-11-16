// Quem exige autenticação na API local (A4, spec 7.A4). PURO: os sinais chegam por
// parâmetro, e nada que o cliente escreve entra aqui.

// Modo hospedado (fase 2a): a config traz um host público ou alguma origem permitida, ou
// seja, a API foi aberta para fora da máquina. A config chega saneada do boot (vazio e lista
// vazia quando o arquivo não as traz ou traz valor inválido); se um valor de outro tipo chegar
// aqui mesmo assim, qualquer coisa preenchida conta, porque na dúvida a resposta é exigir.
function hospedado(config) {
  if (!config) return false;
  const origens = config.origensPermitidas;
  return !!config.hostPublico || (Array.isArray(origens) ? origens.length > 0 : !!origens);
}

// O único valor de config.localAuth que liga a exigência, com esta grafia. Outro valor preenchido
// no arquivo ("Exigir", true, "sim") não chega aqui: impede o boot (lib/fronteira-hospedada.js).
const EXIGIR = 'exigir';

// No modo hospedado exige sempre, e a pergunta vem ANTES de qualquer leitura do localAuth:
// não existe valor de config que devolva false com hostPublico ou origensPermitidas
// preenchidos. localAuth 'exigir' liga em qualquer ambiente. O motor que escuta fora do
// loopback (config.bind, implantação web) exige sempre: ali a API chega a outras máquinas, e
// Host permitido não é autenticação. Não existe ramo que leia a config para devolver false
// com o bind fora do loopback, e é isso que impede uma config de desligar a proteção ali.
function exigeAutenticacao({ config = {}, bindForaDoLoopback = false } = {}) {
  if (hospedado(config)) return true;
  if (config && config.localAuth === EXIGIR) return true;
  return bindForaDoLoopback === true;
}

export default { exigeAutenticacao };
export { exigeAutenticacao, EXIGIR };
