import { QueryClient } from "@tanstack/react-query";

/**
 * Instância única do TanStack Query (ULTRAPLAN 0.7). Defaults conservadores:
 * uma tentativa de retry (painel operacional — falha rápido e visível em vez de
 * martelar a API), `staleTime` curto (ainda não há dado de domínio caro de buscar)
 * e sem refetch automático ao focar a janela (evita ruído em telas sempre abertas
 * na guarita).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
