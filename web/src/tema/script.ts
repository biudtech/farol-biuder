// O que o servidor precisa do tema, sem React: a chave do localStorage e o script que roda no
// <head> antes do primeiro desenho, para a página não piscar no tema errado. O script vai em
// linha, com o nonce do pedido (src/app/layout.tsx).
export const CHAVE_DO_TEMA = 'farol-tema';

export const SCRIPT_DO_TEMA = `try{var t=localStorage.getItem('${CHAVE_DO_TEMA}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
