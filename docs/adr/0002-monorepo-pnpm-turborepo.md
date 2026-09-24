# ADR-0002 — Monorepo com pnpm + Turborepo

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
API, web e mobile compartilham contratos (Zod), motor de preço e cliente HTTP.

## Decisão
Monorepo com pnpm workspaces e Turborepo (cache de tarefas). Pacotes internos: `contracts`, `pricing`, `api-client`, `config`.

## Consequências
- Uma mudança de contrato quebra o typecheck de todos os consumidores no mesmo PR.
- Metro (Expo) precisa de configuração para workspaces pnpm (`node-linker=hoisted` ou config do metro).

## Alternativas consideradas
- **Nx:** mais poderoso, mas mais pesado. **Polyrepo:** duplicação de tipos e versionamento de pacotes.
