import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiBaseUrl } from "../api/config";

export type ApiHealthStatus = "online";

/**
 * Prova de conectividade fim a fim do pipeline TanStack Query → fetch → API
 * (ULTRAPLAN 0.7) — não é feature de negócio, é só o esqueleto do stack. Chama
 * `GET /health/live` (apps/api, ULTRAPLAN 0.3): processo de pé, sem checar
 * Postgres/Redis — suficiente pra provar que o painel alcança a API com CORS ok.
 */
async function fetchApiHealth(signal: AbortSignal): Promise<ApiHealthStatus> {
  const response = await fetch(`${apiBaseUrl}/health/live`, { signal });

  if (!response.ok) {
    throw new Error(`Health check da API respondeu ${String(response.status)}`);
  }

  return "online";
}

export function useApiHealth(): UseQueryResult<ApiHealthStatus> {
  return useQuery({
    queryKey: ["api-health", "live"],
    queryFn: ({ signal }) => fetchApiHealth(signal),
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
