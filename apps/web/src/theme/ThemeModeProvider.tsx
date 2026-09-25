import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { createContext, type ReactNode,useCallback, useContext, useMemo, useState } from "react";

import { buildTheme, type ThemeMode } from "./build-theme";

const STORAGE_KEY = "neulander:theme-mode";

interface ThemeModeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

function readStoredMode(): ThemeMode | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(stored) ? stored : undefined;
  } catch {
    // localStorage indisponível (ex.: navegação privada) — segue sem persistência.
    return undefined;
  }
}

function readPreferredMode(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readInitialMode(): ThemeMode {
  return readStoredMode() ?? readPreferredMode();
}

function persistMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Persistência é um bônus (barato de fazer), não um requisito — falha em silêncio.
  }
}

/**
 * Alternância de tema claro/escuro (ULTRAPLAN 0.7). Preferência não precisa
 * persistir por requisito da tarefa, mas `localStorage` é barato e melhora a
 * experiência entre reloads — cai de volta para `prefers-color-scheme` do SO
 * quando não há nada salvo (ou quando `localStorage` está indisponível).
 */
export function ThemeModeProvider({ children }: { children: ReactNode }): ReactNode {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next: ThemeMode = current === "light" ? "dark" : "light";
      persistMode(next);
      return next;
    });
  }, []);

  const theme = useMemo(() => buildTheme(mode), [mode]);
  const contextValue = useMemo<ThemeModeContextValue>(
    () => ({ mode, toggleMode }),
    [mode, toggleMode],
  );

  return (
    <ThemeModeContext.Provider value={contextValue}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within a ThemeModeProvider");
  }
  return context;
}
