// @ts-check
import boundaries from "eslint-plugin-boundaries";

/**
 * Fronteiras de módulo da API, automatizadas (ULTRAPLAN 0.8).
 *
 * Automatiza as regras de arquitetura 1 e 2 do `CLAUDE.md` — até aqui só documentadas:
 *
 *   1. Cada módulo (`src/modules/<ctx>`) expõe **apenas** seu `index.ts`. Nenhum outro
 *      módulo (nem o bootstrap da aplicação) importa arquivo interno de um módulo.
 *   2. Dentro do módulo as dependências apontam para dentro:
 *      `domain/` ← `application/` ← (`infra/` | `http/` | `events/`).
 *
 * Fica num arquivo separado do `eslint.config.mjs` de propósito: o teste
 * `test/unit/eslint-boundaries.test.ts` importa exatamente este array e roda o ESLint
 * programaticamente sobre arquivos-fixture, então o que o teste prova é a configuração
 * que a aplicação usa de verdade (e não uma cópia parecida).
 *
 * Vale só para `apps/api` (a estrutura `src/modules/<ctx>/<camada>` não existe em
 * `apps/web`/`packages/*`), por isso não entra no `packages/config` compartilhado.
 *
 * A escolha do plugin já estava decidida em ADR-0001 ("fronteiras verificadas por lint") e
 * em `docs/architecture/system-design.md` §6 (`eslint-plugin-boundaries`), então isto só
 * automatiza o que já estava escrito — sem ADR novo.
 *
 * Referência da API do plugin (v7): https://www.jsboundaries.dev/docs/overview/
 */

/** Camadas internas de um módulo, na ordem de fora para dentro. */
const LAYERS = ["domain", "application", "infra", "http", "events"];

/** Pastas de `src/` que não são módulos de domínio: bootstrap/cross-cutting da aplicação. */
const APP_AREAS = ["config", "common", "health", "database"];

/**
 * Selector do elemento "raiz do próprio módulo do arquivo que importa": o `index.ts`, o
 * `<ctx>.module.ts` e qualquer pasta do módulo que não seja uma das camadas. `domain/` e
 * `application/` não podem importar nada disso (seria dependência para fora, e no caso do
 * `index.ts` um ciclo com o próprio barril).
 */
const OWN_MODULE_ROOT = {
  element: { type: "module", captured: { module: "{{from.element.captured.module}}" } },
};

/**
 * Selector de "uma camada do próprio módulo do arquivo que importa, que não esteja em
 * `allowedLayers`".
 *
 * @param {string[]} allowedLayers
 */
function ownModuleLayersOtherThan(allowedLayers) {
  return {
    element: {
      type: "module-layer",
      captured: {
        module: "{{from.element.captured.module}}",
        layer: `!(${allowedLayers.join("|")})`,
      },
    },
  };
}

export default [
  {
    // Só código de produção da API. Testes (`*.test.ts` em `src/`, e tudo em `test/`) ficam
    // de fora de propósito: um teste de integração precisa das tabelas Drizzle do módulo
    // (`modules/shared/infra/schema`) para montar/conferir estado no banco, e um teste de
    // unidade importa o arquivo puro que ele testa. Fronteira é regra de arquitetura do
    // código que roda em produção, não do arnês de teste.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    plugins: { boundaries },
    settings: {
      // O resolver padrão (eslint-import-resolver-node, já embutido no plugin) não conhece
      // `.ts`; sem isso todo import relativo fica "unknown" e nenhuma regra pega nada.
      "import/resolver": { node: { extensions: [".ts", ".tsx", ".js", ".json"] } },
      // Ordem importa: o primeiro descriptor que casa define o tipo do elemento.
      "boundaries/elements": [
        {
          // Camada interna de um módulo: `src/modules/<ctx>/<camada>/**`.
          type: "module-layer",
          pattern: `src/modules/*/(${LAYERS.join("|")})`,
          capture: ["module", "layer"],
          partialMatch: false,
        },
        {
          // Raiz do módulo: `index.ts` (API pública), `<ctx>.module.ts` e afins.
          type: "module",
          pattern: "src/modules/*",
          capture: ["module"],
          partialMatch: false,
        },
        {
          // Bootstrap/cross-cutting: `config/`, `common/`, `health/`, `database/`.
          type: "app",
          pattern: `src/(${APP_AREAS.join("|")})`,
          capture: ["area"],
          partialMatch: false,
        },
        {
          // Resto de `src/`: `main.ts`, `main.worker.ts`, `app.module.ts`.
          // Vem por último justamente para ser o "catch-all" — assim nenhum arquivo de
          // `src/` fica como elemento desconhecido.
          type: "app",
          pattern: "src",
          partialMatch: false,
        },
      ],
    },
    rules: {
      // `default: "allow"` (e não "disallow" + allowlist): as regras 1 e 2 do CLAUDE.md são
      // proibições. Um allowlist fechado teria de enumerar também todo import externo
      // (@nestjs/*, drizzle-orm, @neulander/contracts, ...) sem ganho nenhum hoje.
      //
      // Ordem de `policies` importa de um jeito não óbvio: ao contrário de `boundaries/elements`
      // acima ("primeiro que casa define o tipo"), `boundaries/dependencies` segue
      // last-write-wins — é a ÚLTIMA política do array que casar (allow ou disallow) que decide
      // o resultado, não a primeira. Por isso as políticas mais específicas (2, 3, 4 e as duas
      // exceções nomeadas) vêm depois da proibição genérica (1) que elas precisam sobrescrever.
      // Uma política nova no meio do array pode mudar o resultado de políticas depois dela.
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              // Regra 1: o interior de um módulo é privado. De fora dele só o `index.ts`.
              disallow: {
                to: [
                  { element: { type: "module-layer" } },
                  { element: { type: "module", fileInternalPath: "!index.ts" } },
                ],
              },
              message:
                'Fronteira de módulo (CLAUDE.md regra 1): "{{dependency.source}}" é arquivo interno do módulo "{{to.captured.module}}". Importe o módulo pelo seu `index.ts` (ex.: `modules/{{to.captured.module}}`) ou, se for efeito colateral, publique um evento de domínio via outbox.',
            },
            {
              // ...exceto dentro do próprio módulo: as camadas de um módulo e sua raiz
              // (`index.ts`, `<ctx>.module.ts`) podem se importar. A direção permitida
              // dentro do módulo é restringida pelas políticas seguintes.
              from: { element: { captured: { module: "{{to.element.captured.module}}" } } },
              allow: {
                to: { element: { types: { anyOf: ["module", "module-layer"] } } },
              },
            },
            {
              // Regra 2: `domain/` é puro — não depende de nenhuma outra camada do módulo
              // (nem do barril/módulo Nest do próprio módulo, o que seria ciclo).
              from: { element: { type: "module-layer", captured: { layer: "domain" } } },
              disallow: { to: [ownModuleLayersOtherThan(["domain"]), OWN_MODULE_ROOT] },
              message:
                'Camadas (CLAUDE.md regra 2): `domain/` é puro e as dependências apontam para dentro — não pode importar "{{dependency.source}}". Mova o que `domain/` precisa para dentro de `domain/` (ex.: a interface/porta) e deixe `infra/`/`http/` implementarem.',
            },
            {
              // Regra 2: `application/` (casos de uso) só olha para dentro, para `domain/`.
              from: { element: { type: "module-layer", captured: { layer: "application" } } },
              disallow: {
                to: [ownModuleLayersOtherThan(["domain", "application"]), OWN_MODULE_ROOT],
              },
              message:
                'Camadas (CLAUDE.md regra 2): `application/` só depende de `domain/` — não pode importar "{{dependency.source}}". Declare a porta (interface + token de DI) em `domain/`/`application/` e injete o adapter de `infra/` pelo módulo Nest.',
            },

            // --- Exceções nomeadas (as duas que já existem no código, ambas documentadas
            // --- no próprio arquivo que as usa). Ficam aqui, e não como `eslint-disable`
            // --- espalhado, para a lista de exceções ser curta, visível e revisável.
            {
              // `src/database/schema.ts` é o ponto único de schema que o `drizzle-kit`
              // lê (`drizzle.config.ts`): ele re-exporta o `infra/schema.ts` de cada
              // módulo. É encanamento de tooling, não código de aplicação.
              from: {
                element: { type: "app", path: "src/database", fileInternalPath: "schema.ts" },
              },
              allow: {
                to: {
                  element: {
                    type: "module-layer",
                    captured: { layer: "infra" },
                    fileInternalPath: "schema.ts",
                  },
                },
              },
            },
            {
              // `modules/identity/domain/auth-errors.ts` (ULTRAPLAN 1.3) estende
              // `DomainError` — mesmo motivo da exceção de
              // `problem-details.exception-filter.ts` logo abaixo: importar o barril
              // `modules/shared` avaliaria `SharedModule` -> `AppConfigModule` (valida
              // `process.env` no momento do import), quebrando o teste de unidade puro
              // deste arquivo (`auth-errors.test.ts`, sem `.env` carregado — roda em
              // `pnpm test`, não em `pnpm test:int`). `domain/domain-error.ts` é TS puro
              // exatamente para permitir isso.
              from: {
                element: {
                  type: "module-layer",
                  captured: { module: "identity", layer: "domain" },
                  fileInternalPath: "auth-errors.ts",
                },
              },
              allow: {
                to: {
                  element: {
                    type: "module-layer",
                    captured: { module: "shared", layer: "domain" },
                    fileInternalPath: "domain-error.ts",
                  },
                },
              },
            },
            {
              // `problem-details.exception-filter.ts` importa `DomainError` do arquivo puro
              // em vez do barril de propósito: o barril também exporta `SharedModule`, que
              // avaliaria `AppConfigModule`/`DatabaseModule` (leem `process.env`/abrem pool
              // no import) dentro de um filtro instanciado pelo `AppModule` e exercitado por
              // teste unitário sem `.env`. Ver o comentário no próprio arquivo.
              from: {
                element: {
                  type: "app",
                  path: "src/common",
                  fileInternalPath: "problem-details.exception-filter.ts",
                },
              },
              allow: {
                to: {
                  element: {
                    type: "module-layer",
                    captured: { module: "shared", layer: "domain" },
                    fileInternalPath: "domain-error.ts",
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
];
