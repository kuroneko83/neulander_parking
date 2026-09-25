/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL da API (Nest, apps/api). Default em `src/shared/api/config.ts` se ausente. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
