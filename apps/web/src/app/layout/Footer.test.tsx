import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "../../test/test-utils";
import { Footer } from "./Footer";

describe("Footer", () => {
  it("links to Ikebukuro Technologies opening in a new tab", () => {
    renderWithProviders(<Footer />);

    const link = screen.getByRole("link", { name: /Desenvolvido por Ikebukuro Technologies/i });
    expect(link).toHaveAttribute("href", "https://ikebukuro.com.br");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("shows the Ikebukuro wordmark with accessible alt text", () => {
    renderWithProviders(<Footer />);

    const logo = screen.getByRole("img", { name: "Ikebukuro Technologies" });
    expect(logo).toBeInTheDocument();
  });

  it("uses the navy wordmark in light mode and the white one in dark mode", () => {
    const { unmount } = renderWithProviders(<Footer />);
    expect(screen.getByRole("img", { name: "Ikebukuro Technologies" })).toHaveAttribute(
      "src",
      "/brand/ikebukuro-wordmark-navy.png",
    );
    unmount();

    window.localStorage.setItem("neulander:theme-mode", "dark");
    renderWithProviders(<Footer />);
    expect(screen.getByRole("img", { name: "Ikebukuro Technologies" })).toHaveAttribute(
      "src",
      "/brand/ikebukuro-wordmark-white.png",
    );
  });
});
