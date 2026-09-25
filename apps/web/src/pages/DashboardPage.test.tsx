import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { apiBaseUrl } from "../shared/api/config";
import { server } from "../test/msw/server";
import { renderWithProviders } from "../test/test-utils";
import { DashboardPage } from "./DashboardPage";

describe("DashboardPage", () => {
  it("shows the API status as online once the health check succeeds (default MSW handler)", async () => {
    renderWithProviders(<DashboardPage />);

    expect(screen.getByText("Verificando conexão com a API…")).toBeInTheDocument();
    expect(await screen.findByText("API online")).toBeInTheDocument();
  });

  it("shows the API status as offline when the health check fails", async () => {
    server.use(http.get(`${apiBaseUrl}/health/live`, () => HttpResponse.error()));

    renderWithProviders(<DashboardPage />);

    // timeout maior que o padrão: useApiHealth usa `retry: 1` de propósito, e o
    // backoff padrão do TanStack Query consome ~1s antes dessa nova tentativa.
    expect(
      await screen.findByText(
        "API offline — verifique se apps/api está rodando",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });
});
