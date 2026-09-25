import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { ThemeModeProvider } from "../theme/ThemeModeProvider";

/** `retry: false`/`gcTime: 0`: testes não devem esperar retries reais nem cache entre casos. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
  initialEntries?: string[];
}

/**
 * Render helper para componentes que dependem de tema + TanStack Query + React
 * Router (não usa o `router.tsx` real — os testes de roteamento de fato usam
 * `createMemoryRouter` diretamente, ver `src/app/App.test.tsx`).
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    queryClient = createTestQueryClient(),
    initialEntries = ["/"],
    ...options
  }: RenderWithProvidersOptions = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <ThemeModeProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </QueryClientProvider>
      </ThemeModeProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
