import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import { ThemeModeProvider } from "../theme/ThemeModeProvider";
import { queryClient } from "./query-client";
import { router } from "./router";

/**
 * Composição raiz de providers (ULTRAPLAN 0.7): tema (claro/escuro + locale
 * pt-BR) → TanStack Query → React Router. Ordem importa só para o tema, que
 * precisa envolver tudo (inclusive páginas de erro/404 renderizadas pelo router).
 */
export function App() {
  return (
    <ThemeModeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeModeProvider>
  );
}
