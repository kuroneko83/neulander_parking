/**
 * Roboto carregado via Google Fonts em `index.html` (recomendação do MUI v5).
 *
 * Sem anotação de tipo `ThemeOptions["typography"]` de propósito: essa é uma
 * indexed-access type opcional (inclui `| undefined`), o que conflita com
 * `exactOptionalPropertyTypes` ao passar este valor pro `createTheme()` em
 * `build-theme.ts` — o objeto concreto abaixo já satisfaz o tipo esperado por
 * inferência, sem precisar alargar pra incluir `undefined`.
 */
export const typography = {
  fontFamily: ['"Roboto"', '"Helvetica"', '"Arial"', "sans-serif"].join(", "),
};
