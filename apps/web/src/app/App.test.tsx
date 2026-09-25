import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../test/test-utils";
import { ThemeModeProvider } from "../theme/ThemeModeProvider";
import { routes } from "./router";

function renderApp(initialEntries: string[]) {
  const router = createMemoryRouter(routes, { initialEntries });

  return render(
    <ThemeModeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeModeProvider>,
  );
}

describe("routing", () => {
  it("renders the dashboard page on the index route", async () => {
    renderApp(["/"]);

    expect(await screen.findByRole("heading", { name: "Painel", level: 2 })).toBeInTheDocument();
    // AppBar/Drawer do layout também estão presentes na rota inicial.
    expect(screen.getByRole("heading", { name: "Neulander Parking", level: 1 })).toBeInTheDocument();
  });

  it("renders the not-found page for an unknown route, without crashing the app", async () => {
    renderApp(["/isso-nao-existe"]);

    expect(await screen.findByRole("heading", { name: "Página não encontrada" })).toBeInTheDocument();
    // Fora do layout: sem AppBar do painel na tela de 404.
    expect(screen.queryByRole("heading", { name: "Neulander Parking", level: 1 })).not.toBeInTheDocument();
  });

  it("navigates back to the dashboard from the not-found page", async () => {
    const user = userEvent.setup();
    renderApp(["/isso-nao-existe"]);

    await user.click(await screen.findByRole("link", { name: "Voltar para o início" }));

    expect(await screen.findByRole("heading", { name: "Painel", level: 2 })).toBeInTheDocument();
  });
});
