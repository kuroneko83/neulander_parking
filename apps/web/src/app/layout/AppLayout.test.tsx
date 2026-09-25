import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/test-utils";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
  it("shows the AppBar with the app title and the menu/theme buttons", () => {
    renderWithProviders(<AppLayout />);

    expect(screen.getByRole("heading", { name: "Neulander Parking", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alternar menu de navegação" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ativar tema escuro" })).toBeInTheDocument();
  });

  it("keeps the navigation items hidden until the menu button opens the drawer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />);

    expect(screen.queryByRole("link", { name: "Painel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Alternar menu de navegação" }));

    expect(await screen.findByRole("link", { name: "Painel" })).toBeInTheDocument();
  });

  it("closes the drawer again when the menu button is toggled a second time", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />);

    const menuButton = screen.getByRole("button", { name: "Alternar menu de navegação" });

    await user.click(menuButton);
    expect(await screen.findByRole("link", { name: "Painel" })).toBeInTheDocument();

    await user.click(menuButton);
    expect(screen.queryByRole("link", { name: "Painel" })).not.toBeInTheDocument();
  });
});
