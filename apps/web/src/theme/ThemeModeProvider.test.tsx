import { useTheme } from "@mui/material/styles";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ThemeModeProvider, useThemeMode } from "./ThemeModeProvider";

function ThemeModeProbe() {
  const { mode, toggleMode } = useThemeMode();
  const theme = useTheme();

  return (
    <div>
      <output data-testid="mode-from-context">{mode}</output>
      <output data-testid="mode-from-mui-theme">{theme.palette.mode}</output>
      <button type="button" onClick={toggleMode}>
        toggle
      </button>
    </div>
  );
}

describe("ThemeModeProvider", () => {
  it("starts in light mode when there is no stored/OS preference", () => {
    render(
      <ThemeModeProvider>
        <ThemeModeProbe />
      </ThemeModeProvider>,
    );

    expect(screen.getByTestId("mode-from-context")).toHaveTextContent("light");
    expect(screen.getByTestId("mode-from-mui-theme")).toHaveTextContent("light");
  });

  it("flips both the context value and the actual MUI theme when toggled", async () => {
    const user = userEvent.setup();
    render(
      <ThemeModeProvider>
        <ThemeModeProbe />
      </ThemeModeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("mode-from-context")).toHaveTextContent("dark");
    expect(screen.getByTestId("mode-from-mui-theme")).toHaveTextContent("dark");

    await user.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByTestId("mode-from-context")).toHaveTextContent("light");
    expect(screen.getByTestId("mode-from-mui-theme")).toHaveTextContent("light");
  });

  it("persists the chosen mode to localStorage", async () => {
    const user = userEvent.setup();
    render(
      <ThemeModeProvider>
        <ThemeModeProbe />
      </ThemeModeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "toggle" }));

    expect(window.localStorage.getItem("neulander:theme-mode")).toBe("dark");
  });
});
