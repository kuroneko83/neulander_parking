import { loadRootEnvFile } from "../src/config/load-root-env-file";

// Populate process.env from the monorepo-root `.env` before any test creates a Nest
// testing module (AppConfigModule validates process.env at module-init time).
loadRootEnvFile();
