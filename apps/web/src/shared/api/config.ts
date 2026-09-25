const DEFAULT_API_BASE_URL = "http://localhost:3333";

/**
 * Base URL da API (apps/api). Vem de `VITE_API_URL` (ver `.env.example` na raiz
 * do monorepo e `vite.config.ts`, que aponta `envDir` para a raiz) — nunca
 * hardcoded no código (ULTRAPLAN 0.7). Sem trailing slash, para concatenação
 * simples de path (`${apiBaseUrl}/health/live`).
 */
export const apiBaseUrl: string = (import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE_URL).replace(
  /\/+$/,
  "",
);
