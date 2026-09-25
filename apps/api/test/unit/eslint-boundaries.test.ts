import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Prova que a regra de fronteiras de `eslint.boundaries.mjs` (ULTRAPLAN 0.8) **bloqueia**
 * de verdade, e não só documenta: roda o ESLint pela API do Node sobre arquivos-fixture
 * que violam (e respeitam) as regras 1 e 2 de arquitetura do `CLAUDE.md`.
 *
 * Por que arquivos-fixture em disco e não `lintText` em memória: o plugin resolve o alvo de
 * cada import pelo sistema de arquivos (eslint-import-resolver-node). Se o arquivo importado
 * não existe, o alvo fica "unknown" e nenhuma política casa — o teste passaria por engano.
 * Por isso a árvore-fixture é escrita num diretório temporário (fora do working tree, some
 * no `afterAll`) que imita `apps/api/`: os patterns de `boundaries/elements` são relativos à
 * raiz do projeto lintado (`src/modules/*`), então valem igual ali.
 *
 * A configuração sob teste é **a mesma** que o `eslint.config.mjs` da API usa: este arquivo
 * importa o próprio `eslint.boundaries.mjs`. Só o parser é reconfigurado (parser do
 * typescript-eslint sem type info), porque aqui não há um tsconfig cobrindo as fixtures — e
 * regras de fronteira não dependem de tipos.
 *
 * `eslint`/`typescript-eslint` são devDependencies diretas de `apps/api` (além de já serem da
 * raiz) só por causa deste arquivo: ele importa os dois como código de teste de verdade
 * (`new ESLint(...)`, `tseslint.parser`), não como config — sob a resolução estrita do pnpm,
 * qualquer pacote importado por código precisa estar declarado no `package.json` de quem
 * importa. É a exceção deliberada à convenção "tooling só na raiz" da tarefa 0.1.
 */

// `__dirname` (e não `import.meta.dirname`): `apps/api` compila para CommonJS — ver o
// comentário sobre `module` no `tsconfig.json`. Mesmo padrão de `database-migrate.int.test.ts`.
const API_ROOT = resolve(__dirname, "..", "..");

/** Um item de flat config do ESLint; só o suficiente para repassar ao `baseConfig`. */
type FlatConfigItem = Record<string, unknown>;

/** `src/modules/<módulo>/...` das fixtures: dois módulos fictícios + o bootstrap da app. */
const FIXTURES: Record<string, string> = {
  // --- módulo fake-a ---
  "src/modules/fake-a/index.ts": `export * from "./domain/thing";\n`,
  "src/modules/fake-a/fake-a.module.ts": `export const FakeAModule = 1;\n`,
  "src/modules/fake-a/domain/thing.ts": `export const thing = 1;\n`,
  "src/modules/fake-a/infra/repo.ts": `export const repo = 1;\n`,

  // (4) dentro do módulo, para dentro: infra → domain.
  "src/modules/fake-a/infra/ok-domain.ts": `import { thing } from "../domain/thing";\nexport const ok = thing;\n`,
  // application → domain.
  "src/modules/fake-a/application/ok-domain.ts": `import { thing } from "../domain/thing";\nexport const ok = thing;\n`,
  // (2) entre módulos, pelo barril.
  "src/modules/fake-a/http/ok-cross-module.ts": `import { thing } from "../../fake-b";\nexport const ok = thing;\n`,
  // entre módulos, pelo barril, em import de tipo.
  "src/modules/fake-a/http/ok-cross-module-type.ts": `import type { Thing } from "../../fake-b";\nexport const ok = (t: Thing) => t;\n`,
  // dentro do módulo: o barril e o módulo Nest podem importar as camadas.
  "src/modules/fake-a/http/ok-own-infra.ts": `import { repo } from "../infra/repo";\nexport const ok = repo;\n`,

  // (1) entre módulos, arquivo interno.
  "src/modules/fake-a/http/bad-cross-module.ts": `import { thing } from "../../fake-b/domain/thing";\nexport const bad = thing;\n`,
  // idem, mas em import de tipo (também é dependência).
  "src/modules/fake-a/http/bad-cross-module-type.ts": `import type { Thing } from "../../fake-b/domain/thing";\nexport const bad = (t: Thing) => t;\n`,
  // entre módulos, arquivo da raiz do outro módulo que não é o `index.ts`.
  "src/modules/fake-a/http/bad-cross-module-nest.ts": `import { FakeBModule } from "../../fake-b/fake-b.module";\nexport const bad = FakeBModule;\n`,
  // (3) dentro do módulo, para fora: domain → infra.
  "src/modules/fake-a/domain/bad-infra.ts": `import { repo } from "../infra/repo";\nexport const bad = repo;\n`,
  // domain → barril do próprio módulo (ciclo).
  "src/modules/fake-a/domain/bad-own-barrel.ts": `import { thing } from "..";\nexport const bad = thing;\n`,
  // application → infra do próprio módulo.
  "src/modules/fake-a/application/bad-infra.ts": `import { repo } from "../infra/repo";\nexport const bad = repo;\n`,

  // --- módulo fake-b ---
  "src/modules/fake-b/index.ts": `export * from "./domain/thing";\n`,
  "src/modules/fake-b/fake-b.module.ts": `export const FakeBModule = 1;\n`,
  "src/modules/fake-b/domain/thing.ts": `export type Thing = number;\nexport const thing = 1;\n`,

  // --- bootstrap da aplicação ---
  "src/app.module.ts": `import { thing } from "./modules/fake-a";\nexport const AppModule = thing;\n`,
  "src/main.ts": `import { repo } from "./modules/fake-a/infra/repo";\nexport const main = repo;\n`,
  "src/common/ok-barrel.ts": `import { thing } from "../modules/fake-a";\nexport const ok = thing;\n`,
  "src/common/bad-internal.ts": `import { thing } from "../modules/fake-a/domain/thing";\nexport const bad = thing;\n`,
};

/** Arquivos-fixture que devem ser reportados pela regra de fronteiras. */
const EXPECTED_VIOLATIONS = [
  "src/modules/fake-a/http/bad-cross-module.ts",
  "src/modules/fake-a/http/bad-cross-module-type.ts",
  "src/modules/fake-a/http/bad-cross-module-nest.ts",
  "src/modules/fake-a/domain/bad-infra.ts",
  "src/modules/fake-a/domain/bad-own-barrel.ts",
  "src/modules/fake-a/application/bad-infra.ts",
  "src/main.ts",
  "src/common/bad-internal.ts",
];

/** Arquivos-fixture que a regra de fronteiras não pode reportar. */
const EXPECTED_CLEAN = [
  "src/modules/fake-a/index.ts",
  "src/modules/fake-a/infra/ok-domain.ts",
  "src/modules/fake-a/application/ok-domain.ts",
  "src/modules/fake-a/http/ok-cross-module.ts",
  "src/modules/fake-a/http/ok-cross-module-type.ts",
  "src/modules/fake-a/http/ok-own-infra.ts",
  "src/modules/fake-b/index.ts",
  "src/app.module.ts",
  "src/common/ok-barrel.ts",
];

/** Carrega o array de flat config de `apps/api/eslint.boundaries.mjs`. */
async function loadBoundariesConfig(): Promise<FlatConfigItem[]> {
  const url = pathToFileURL(join(API_ROOT, "eslint.boundaries.mjs")).href;
  const loaded = (await import(url)) as { default: FlatConfigItem[] };
  return loaded.default;
}

/**
 * ESLint com **só** a config de fronteiras (mais um parser de TS sem type info), para que
 * qualquer mensagem reportada venha necessariamente da regra sob teste.
 */
function createEslint(cwd: string, boundariesConfig: FlatConfigItem[]): ESLint {
  return new ESLint({
    cwd,
    // `true` = não procurar `eslint.config.*` no disco; vale só o `baseConfig` abaixo.
    overrideConfigFile: true,
    baseConfig: [
      { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
      ...boundariesConfig,
      // Os patterns de `boundaries/elements` são relativos à raiz do projeto, que o plugin
      // deduz de `process.cwd()` — e não da opção `cwd` do ESLint. Sem isto as fixtures no
      // diretório temporário não casariam com nenhum elemento e o teste passaria vazio.
      { settings: { "boundaries/root-path": cwd } },
    ] as ESLint.Options["baseConfig"],
  });
}

/** Mapeia caminho relativo → mensagens da regra `boundaries/*` naquele arquivo. */
function boundariesMessagesByFile(
  results: ESLint.LintResult[],
  cwd: string,
): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const result of results) {
    const relativePath = result.filePath.startsWith(cwd)
      ? result.filePath.slice(cwd.length + 1)
      : result.filePath;
    const fatal = result.messages.filter((message) => message.fatal);
    if (fatal.length > 0) {
      throw new Error(
        `Erro de parsing em ${relativePath}: ${fatal.map((m) => m.message).join("; ")}`,
      );
    }
    byFile.set(
      relativePath,
      result.messages
        .filter((message) => message.ruleId?.startsWith("boundaries/") === true)
        .map((message) => message.message),
    );
  }
  return byFile;
}

describe("eslint.boundaries.mjs", () => {
  let fixtureRoot: string;
  let fixtureMessages: Map<string, string[]>;

  beforeAll(async () => {
    const boundariesConfig = await loadBoundariesConfig();

    // `realpath`: no macOS `os.tmpdir()` é um symlink (/var → /private/var) e o ESLint
    // reporta caminhos já resolvidos — sem isso o corte do prefixo `cwd` não casaria.
    fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), "neulander-boundaries-")));

    for (const [relativePath, content] of Object.entries(FIXTURES)) {
      const absolutePath = join(fixtureRoot, relativePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
    }

    const eslint = createEslint(fixtureRoot, boundariesConfig);
    fixtureMessages = boundariesMessagesByFile(await eslint.lintFiles(["src"]), fixtureRoot);
  }, 30_000);

  afterAll(async () => {
    if (fixtureRoot) {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("lint todos os arquivos-fixture (guarda contra fixture que o ESLint ignorou)", () => {
    expect([...fixtureMessages.keys()].sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(EXPECTED_VIOLATIONS)("bloqueia %s", (relativePath) => {
    expect(fixtureMessages.get(relativePath)).toHaveLength(1);
  });

  it.each(EXPECTED_CLEAN)("permite %s", (relativePath) => {
    expect(fixtureMessages.get(relativePath)).toEqual([]);
  });

  it("explica a violação entre módulos citando o `index.ts` do módulo alvo", () => {
    const [message] = fixtureMessages.get("src/modules/fake-a/http/bad-cross-module.ts") ?? [];
    expect(message).toContain("CLAUDE.md regra 1");
    expect(message).toContain("modules/fake-b");
  });

  it("explica a violação de camada citando a regra 2", () => {
    const [message] = fixtureMessages.get("src/modules/fake-a/domain/bad-infra.ts") ?? [];
    expect(message).toContain("CLAUDE.md regra 2");
  });

  it("não reporta nada no `src/` real da API (inclui modules/shared)", async () => {
    const boundariesConfig = await loadBoundariesConfig();
    const eslint = createEslint(API_ROOT, boundariesConfig);
    const messages = boundariesMessagesByFile(await eslint.lintFiles(["src"]), API_ROOT);

    expect([...messages].filter(([, violations]) => violations.length > 0)).toEqual([]);
    // Sanidade: o módulo `shared` de verdade foi lintado (senão o teste acima é vazio).
    expect(messages.has("src/modules/shared/infra/outbox.service.ts")).toBe(true);
  }, 30_000);
});
