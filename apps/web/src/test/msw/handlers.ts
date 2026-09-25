import { http, HttpResponse } from "msw";

import { apiBaseUrl } from "../../shared/api/config";

/**
 * Handlers default (MSW) usados pela maioria dos testes — a API respondendo
 * saudável. Testes que precisam do caso "API offline" sobrescrevem com
 * `server.use(...)` (revertido em `afterEach` por `server.resetHandlers()`,
 * que volta a estes defaults, não a "sem handler nenhum").
 */
export const handlers = [
  http.get(`${apiBaseUrl}/health/live`, () =>
    HttpResponse.json({ status: "ok", info: {}, error: {}, details: {} }),
  ),
];
