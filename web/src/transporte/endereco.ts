// O endereço do motor vem de NEXT_PUBLIC_FAROL_API, lido no build. Vale só uma origem http
// ou https, sem caminho, busca, fragmento nem usuário: é o que entra no connect-src da CSP e
// na frente de todo caminho /api.
//
// O texto é conferido contra uma forma fechada ANTES de virar URL, porque o `new URL` aceita
// host que não pode ir para uma diretiva de CSP: `https://*` abriria o connect-src para
// qualquer origem, e `https://a.com;x` fecharia a diretiva e abriria outra. O host é um nome
// (rótulos de letra, dígito e hífen, sem hífen nas pontas), um IPv4 ou um IPv6 entre
// colchetes. O que foge disso é recusado, a tela mostra "falta o endereço do motor" e o
// connect-src fica só na própria origem.
const ROTULO = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const NOME_OU_IPV4 = `${ROTULO}(?:\\.${ROTULO})*`;
const IPV6 = '\\[[0-9a-f:.]{2,45}\\]';
const ORIGEM = new RegExp(`^https?://(?:${NOME_OU_IPV4}|${IPV6})(?::[0-9]{1,5})?/?$`, 'i');

export function enderecoDoMotor(valor: string | undefined = process.env.NEXT_PUBLIC_FAROL_API): string {
  const texto = String(valor ?? '').trim();
  if (!ORIGEM.test(texto)) return '';
  // O `new URL` confere o que a forma não confere: a faixa da porta e do IPv4 e a gramática
  // do IPv6.
  let url: URL;
  try { url = new URL(texto); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.username || url.password || url.search || url.hash) return '';
  if (url.pathname !== '/' && url.pathname !== '') return '';
  return url.origin;
}
