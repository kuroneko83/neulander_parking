import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenvFile } from "dotenv";

/**
 * Loads the monorepo-root `.env` file into `process.env`, regardless of the process'
 * current working directory. Turbo runs each package's scripts with `cwd` set to that
 * package's directory (e.g. `apps/api`), not the repo root, so a plain `dotenv.config()`
 * (which only looks at `cwd`) would silently miss the root `.env`.
 *
 * Must run before `NestFactory.create`/`createApplicationContext` — that's when
 * `AppConfigModule`'s `validate` (Zod) reads `process.env`.
 *
 * No-op when no `.env` file is found: CI/production inject real env vars directly and
 * never ship a `.env` file, so this must not be required for the app to boot there.
 */
export function loadRootEnvFile(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const envFilePath = candidates.find((candidate) => existsSync(candidate));

  if (envFilePath) {
    loadDotenvFile({ path: envFilePath });
  }
}
