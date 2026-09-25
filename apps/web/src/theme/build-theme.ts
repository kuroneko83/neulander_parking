import { ptBR } from "@mui/material/locale";
import { createTheme, type Theme } from "@mui/material/styles";

import { darkPalette, lightPalette } from "./palette";
import { typography } from "./typography";

export type ThemeMode = "light" | "dark";

/**
 * Fábrica do tema MUI (ULTRAPLAN 0.7): paleta claro/escuro centralizada +
 * locale pt-BR (`ptBR` de `@mui/material/locale`, traduz textos internos dos
 * componentes MUI — paginação, DataGrid etc.).
 */
export function buildTheme(mode: ThemeMode): Theme {
  return createTheme(
    {
      palette: mode === "light" ? lightPalette : darkPalette,
      typography,
      shape: { borderRadius: 8 },
    },
    ptBR,
  );
}
