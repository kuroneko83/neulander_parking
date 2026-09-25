import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw/server";

// MSW: intercepta `fetch` real feito por useApiHealth (e qualquer chamada futura)
// nos testes de componente — system-design.md §10 (RTL + MSW).
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  // `vitest.config.ts` não liga `test.globals`, então o auto-cleanup do RTL
  // (que depende de detectar um `afterEach` global) não dispara sozinho — sem
  // isto, cada `render()` de um teste ficava acumulado no DOM do próximo.
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
});

afterAll(() => {
  server.close();
});

// jsdom não implementa `matchMedia` — ThemeModeProvider usa
// `prefers-color-scheme` para decidir o modo inicial quando não há preferência
// salva. Stub determinístico (sempre "no preference") para os testes.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

// jsdom não implementa `ResizeObserver` — usado internamente por alguns
// componentes MUI (ex.: posicionamento de Popper/transitions).
if (typeof window.ResizeObserver !== "function") {
  class ResizeObserverStub {
    observe(): void {
      // no-op
    }
    unobserve(): void {
      // no-op
    }
    disconnect(): void {
      // no-op
    }
  }
  window.ResizeObserver = ResizeObserverStub;
}
