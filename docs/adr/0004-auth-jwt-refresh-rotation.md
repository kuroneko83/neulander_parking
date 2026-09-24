# ADR-0004 — Autenticação própria com JWT + refresh rotativo

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Três clientes (web, mobile, dispositivos futuros), RBAC por organização. Projeto de portfólio: demonstrar domínio de auth é um objetivo.

## Decisão
Access token JWT RS256 (15 min) com `sub`, `roles` globais e lista curta de orgs; refresh token opaco (30 dias) armazenado como hash, rotacionado a cada uso, com `family_id` para detectar reuso e revogar a família. Senhas com argon2id. Web usa cookie HttpOnly para refresh; mobile usa SecureStore. Chaves em Secrets Manager.

## Consequências
- Controle total e zero custo; responsabilidade de segurança é nossa (revisão obrigatória do `security-reviewer`).
- Login social pode ser adicionado depois (OAuth via passport).

## Alternativas consideradas
- **Auth0/Clerk/Cognito:** rápido, mas custo/lock-in e menos valor demonstrativo. **Keycloak:** operação pesada para o escopo.
