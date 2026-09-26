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
- **Staleness de até 15 min é aceita, não corrigida:** sem denylist de access token, nenhuma mudança de
  `role`/`parking_lot_ids`/logout invalida um access token já emitido antes do seu `exp` (ULTRAPLAN 1.4,
  revisão de segurança). `POST /v1/auth/logout` revoga a família de refresh (a sessão não sobrevive a um
  próximo `refresh`), mas o bearer atual continua servindo requisições até expirar sozinho — aceitável para
  este protótipo; se um terminal físico compartilhado (guarita) precisar de logout imediato de verdade, isso
  exige um `JWT_ACCESS_TTL` bem mais curto ou um denylist, revisitar então.

## Alternativas consideradas
- **Auth0/Clerk/Cognito:** rápido, mas custo/lock-in e menos valor demonstrativo. **Keycloak:** operação pesada para o escopo.
