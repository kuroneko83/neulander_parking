import type { PaletteOptions } from "@mui/material/styles";

/**
 * Tokens de paleta claro/escuro (ULTRAPLAN 0.7). Central e único lugar onde cor
 * é definida — o resto do app consome via tema (`sx`/`styled`), nunca cor
 * hardcoded (persona web-engineer, CLAUDE.md).
 */
export const lightPalette: PaletteOptions = {
  mode: "light",
  primary: { main: "#1565c0" },
  secondary: { main: "#00897b" },
  background: { default: "#f4f6f8", paper: "#ffffff" },
};

export const darkPalette: PaletteOptions = {
  mode: "dark",
  primary: { main: "#5c9ce6" },
  secondary: { main: "#4db6ac" },
  background: { default: "#0f1720", paper: "#16202b" },
};
