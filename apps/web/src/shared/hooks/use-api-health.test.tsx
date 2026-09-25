import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { server } from "../../test/msw/server";
import { createTestQueryClient } from "../../test/test-utils";
import { apiBaseUrl } from "../api/config";
import { useApiHealth } from "./use-api-health";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useApiHealth", () => {
  it("resolves to online when GET /health/live succeeds (default MSW handler)", async () => {
    const { result } = renderHook(() => useApiHealth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBe("online");
  });

  it("surfaces an error when GET /health/live fails (API offline)", async () => {
    server.use(
      http.get(`${apiBaseUrl}/health/live`, () => HttpResponse.error()),
    );

    const { result } = renderHook(() => useApiHealth(), { wrapper });

    // timeout maior que o padrão (1000ms): o hook usa `retry: 1` de propósito
    // (uma nova tentativa antes de reportar offline), e o backoff padrão do
    // TanStack Query já consome ~1s antes dessa tentativa.
    await waitFor(
      () => {
        expect(result.current.isError).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it("surfaces an error when GET /health/live responds with a non-2xx status", async () => {
    server.use(
      http.get(`${apiBaseUrl}/health/live`, () => new HttpResponse(null, { status: 503 })),
    );

    const { result } = renderHook(() => useApiHealth(), { wrapper });

    await waitFor(
      () => {
        expect(result.current.isError).toBe(true);
      },
      { timeout: 3000 },
    );
  });
});
