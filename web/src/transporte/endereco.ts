// O endereço do motor vem de NEXT_PUBLIC_FAROL_API, lido no build. Vale só uma origem http
// ou https, sem caminho, busca, fragmento nem usuário: é o que entra no connect-src da CSP e
// na frente de todo caminho /api.
export function enderecoDoMotor(valor: string | undefined = process.env.NEXT_PUBLIC_FAROL_API): string {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  let url: URL;
  try { url = new URL(texto); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (url.username || url.password || url.search || url.hash) return '';
  if (url.pathname !== '/' && url.pathname !== '') return '';
  return url.origin;
}
