import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { DashboardPage } from "../pages/DashboardPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { AppLayout } from "./layout/AppLayout";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

/**
 * Roteamento (ULTRAPLAN 0.7): uma rota inicial ("Painel") dentro do layout e uma
 * rota coringa (`*`) para a página 404, fora do layout. `createRoutesFromElements`
 * não é necessário aqui — o array de objetos é mais direto para uma árvore rasa.
 *
 * `routes` fica exportado separado de `router` para os testes montarem a mesma
 * árvore com `createMemoryRouter` em vez do `createBrowserRouter` real (que
 * manipula `window.history`) — ver `src/app/App.test.tsx`.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [{ index: true, element: <DashboardPage /> }],
  },
  { path: "*", element: <NotFoundPage />, errorElement: <RouteErrorBoundary /> },
];

export const router = createBrowserRouter(routes);
