# ULTRAPLAN — Neulander Parking

> Roadmap executável. Cada tarefa tem ID, agente dono e critério de aceite.
> O Claude Code usa `/next-task` para pegar a **primeira tarefa `[ ]` da fase atual** cujas dependências estão `[x]`.
> Ao concluir: marcar `[x]`, anotar o hash do commit ao lado e atualizar a seção **Estado atual**.

## Estado atual

- **Fase atual:** 0 — Fundação
- **Última tarefa concluída:** —
- **Bloqueios / notas:** —

## Visão geral das fases

| Fase | Nome | Entregável demonstrável | Marco |
|---|---|---|---|
| 0 | Fundação | Monorepo rodando, CI verde, docker compose | — |
| 1 | Identidade & organizações | Login, RBAC, convite de operador | — |
| 2 | Estacionamentos & vagas | Gestor cadastra lot, zonas, vagas no painel com mapa | — |
| 3 | Motor de tarifação | Gestor cria tabela de preço e simula | — |
| 4 | Sessões (entrada/saída) | Operador registra entrada/saída e cobra em dinheiro | **M1 — Operação básica** |
| 5 | Pagamentos | Pix e cartão com webhook, recibo | — |
| 6 | Tempo real & dashboard | Ocupação ao vivo e KPIs do dia | **M2 — Painel completo** |
| 7 | App do motorista | Busca no mapa, ticket via QR, pagar pelo app | **M3 — MVP público** |
| 8 | Reservas | Reservar vaga com janela de tempo | — |
| 9 | Mensalistas & relatórios | Planos mensais, faturas, relatórios/exports | — |
| 10 | Produção | AWS via Terraform, observabilidade, carga, modo degradado | **M4 — Produção** |
| 11 | Stretch | LPR, IoT, IA | — |

---

## Fase 0 — Fundação

Objetivo: qualquer pessoa clona, roda `pnpm i && pnpm dev` e tem API + web no ar com banco local.

- [ ] **0.1** Monorepo pnpm + Turborepo, `packages/config` (tsconfig base strict, eslint flat config, prettier), `.nvmrc` (Node 22), `.editorconfig`, `.env.example` — `devops-engineer`
  - Aceite: `pnpm lint`, `pnpm typecheck`, `pnpm test` rodam na raiz (mesmo sem código).
- [ ] **0.2** `infra/docker/compose.yml`: `postgis/postgis:16`, `redis:7`, `axllent/mailpit`; healthchecks; volume nomeado — `devops-engineer`
- [ ] **0.3** `apps/api` NestJS: `main.ts` + `main.worker.ts`, config validada com Zod, `nestjs-pino`, filtro de erros RFC 9457, `/health/live|ready`, Swagger em `/docs` — `backend-engineer`
- [ ] **0.4** Drizzle configurado (migrations em `apps/api/drizzle/`), extensões `postgis`, `btree_gist`, `pg_trgm`, `citext` na migration inicial; scripts `db:generate`/`db:migrate`/`db:seed` — `database-engineer`
- [ ] **0.5** Kernel `shared`: `DomainError`, `Clock` injetável, `Cents`, UUID v7, `normalizePlate()`/`maskPlate()`, interceptor de `Idempotency-Key`, `OutboxService` + relay worker — `backend-engineer`
  - Aceite: testes unitários de placa (Mercosul/antiga/inválida) e integração do outbox (evento gravado na tx e publicado).
- [ ] **0.6** `packages/contracts` (Zod) e `packages/pricing` (vazio com teste de fumaça) com build `tsup` — `backend-engineer`
- [ ] **0.7** `apps/web`: Vite + React 18 + MUI v5 (tema claro/escuro, pt-BR), React Router, TanStack Query, layout com AppBar/Drawer, página 404 — `web-engineer`
- [ ] **0.8** `eslint-plugin-boundaries` (ou dependency-cruiser) impedindo import entre internals de módulos — `architect`
- [ ] **0.9** GitHub Actions: `ci.yml` (install com cache, lint, typecheck, unit, integration com services postgres/redis, build); PR template; Dependabot/Renovate — `devops-engineer`
- [ ] **0.10** Testcontainers helper (`apps/api/test/setup-int.ts`) subindo PostGIS + Redis e rodando migrations — `qa-engineer`
- [ ] **0.11** Hook SessionStart do Claude Code (`.claude/hooks`) que roda `pnpm install` em sessões web — `devops-engineer`

## Fase 1 — Identidade & organizações

- [ ] **1.1** Contracts: `RegisterInput`, `LoginInput`, `TokenPair`, `Me`, `Role` — `backend-engineer`
- [ ] **1.2** Schema `users`, `organizations`, `memberships`, `refresh_tokens` + seed (platform_admin, org demo, gestor, operador, motorista) — `database-engineer`
- [ ] **1.3** Registro/login com argon2id, JWT RS256 (15 min), refresh rotativo com detecção de reuso (revoga família) — `backend-engineer`
- [ ] **1.4** Guards: `JwtAuthGuard`, `@Roles()`, `OrgScopeGuard` (valida `:orgId` ∈ memberships; operador limitado a `parking_lot_ids`) — `backend-engineer`
- [ ] **1.5** Convite de membros (e-mail via Mailpit com token de aceite) — `backend-engineer`
- [ ] **1.6** Rate limit em login/registro (Redis) — `backend-engineer`
- [ ] **1.7** Web: telas login, aceite de convite, seletor de organização, rotas protegidas por papel, refresh silencioso — `web-engineer`
- [ ] **1.8** Revisão de segurança da fase — `security-reviewer`
  - Aceite da fase: e2e Playwright "gestor faz login → convida operador → operador aceita e só vê seu lot".

## Fase 2 — Estacionamentos & vagas

- [ ] **2.1** Contracts + schema `parking_lots` (geography), `zones`, `spots` — `database-engineer`
- [ ] **2.2** CRUD de lots/zonas, criação de vagas em lote (`A-001..A-120`), publicar/fechar, bloquear vaga — `backend-engineer`
- [ ] **2.3** Busca pública `GET /v1/lots/search` com `ST_DWithin`, ordenação por distância, cursor — `database-engineer`
  - Aceite: `EXPLAIN` usa índice GiST; teste com 5 mil lots seed < 50 ms.
- [ ] **2.4** Web: lista de lots, formulário com endereço + mapa (Leaflet/Mapbox) para posicionar o pin, editor de zonas e grade de vagas (MUI DataGrid) — `web-engineer`
- [ ] **2.5** Auditoria (`audit_logs`) para alterações de lot/vaga — `backend-engineer`

## Fase 3 — Motor de tarifação

- [ ] **3.1** `packages/pricing`: schema Zod `RatePlanRules` + `quote()` puro (tolerância, primeira fração, adicionais, teto diário, pernoite, overrides por dia/horário, ticket perdido) com breakdown legível — `backend-engineer`
  - Aceite: ≥ 40 casos tabulares + testes de propriedade (fast-check): valor nunca negativo, monotônico no tempo, respeita teto; fuso `America/Sao_Paulo` incluindo virada de dia.
- [ ] **3.2** Schema `rate_plans`, `rate_plan_versions` (imutáveis) + endpoints e `simulate` — `backend-engineer`
- [ ] **3.3** Web: editor de tabela de preço com preview ao vivo (simulador de entrada/saída e gráfico valor × tempo) — `web-engineer`

## Fase 4 — Sessões (entrada/saída) · Marco M1

- [ ] **4.1** Domínio `ParkingSession` com máquina de estado (flows.md §1) — 100% unit — `backend-engineer`
- [ ] **4.2** Schema `parking_sessions` com unique parcial de placa ativa e trigram — `database-engineer`
- [ ] **4.3** Casos de uso: `StartSession` (idempotente), `QuoteSession`, `CheckoutSession` (método `cash` nesta fase), `ExitSession`, `CancelSession` (auditado) + eventos outbox — `backend-engineer`
- [ ] **4.4** Ticket: `ticket_code` curto (base32, 8 chars) + QR; página pública `/t/:ticketCode` mostrando valor atual — `backend-engineer`
- [ ] **4.5** Web "Modo operador" (otimizado para tablet): campo de placa com máscara e autocomplete, botões grandes Entrada/Saída, busca por placa/QR (câmera via `@zxing/browser`), impressão de ticket (CSS print 80 mm) — `web-engineer`
- [ ] **4.6** E2E: entrada → cotação após 2h (Clock fake) → pagamento em dinheiro → saída; dupla entrada retorna `409 SESSION_ALREADY_OPEN` — `qa-engineer`
- [ ] **4.7** Revisão de código da fase + demo gravada (GIF no README) — `code-reviewer`

## Fase 5 — Pagamentos

- [ ] **5.1** Porta `PaymentProvider` + `FakeProvider` (simula webhook com atraso configurável) + `CashProvider` — `payments-engineer`
- [ ] **5.2** Schema `payments`, `payment_attempts`, `webhook_events` — `database-engineer`
- [ ] **5.3** `MercadoPagoPixProvider` (sandbox): criação de cobrança, webhook assinado, consulta de status — `payments-engineer`
- [ ] **5.4** `StripeCardProvider` (test mode, Payment Intents) — `payments-engineer`
- [ ] **5.5** Integração `payments` ↔ `sessions` via eventos; janela de saída; cobrança de diferença se expirar — `backend-engineer`
- [ ] **5.6** Jobs `payments-reconcile` e estorno (parcial/total, auditado) — `payments-engineer`
- [ ] **5.7** Recibo em PDF (worker → S3/minio local) e e-mail — `backend-engineer`
- [ ] **5.8** Web: modal de cobrança com Pix (QR + copia e cola + polling/WS), cartão, dinheiro com troco — `web-engineer`
- [ ] **5.9** Testes: webhook duplicado, fora de ordem, perdido, valor divergente — `qa-engineer`
- [ ] **5.10** Revisão de segurança (assinaturas, idempotência, dados de cartão nunca tocam o servidor) — `security-reviewer`

## Fase 6 — Tempo real & dashboard · Marco M2

- [ ] **6.1** Módulo `occupancy`: read model Redis, handlers de eventos, job de reconciliação — `backend-engineer`
- [ ] **6.2** Gateway Socket.IO `/rt` com auth no handshake, salas e Redis adapter — `backend-engineer`
- [ ] **6.3** Web: dashboard do gestor (ocupação por zona ao vivo, receita do dia, sessões abertas, tempo médio) com MUI + Recharts; mapa de vagas colorido por status — `web-engineer`
- [ ] **6.4** Teste de integração WS (2 clientes, evento chega em < 2 s) — `qa-engineer`

## Fase 7 — App do motorista · Marco M3

- [ ] **7.1** `apps/mobile` Expo + expo-router + React Native Paper (tema alinhado ao MUI), `packages/api-client` compartilhado — `mobile-engineer`
- [ ] **7.2** Auth (SecureStore), cadastro, veículos (placas) — `mobile-engineer`
- [ ] **7.3** Mapa com lots próximos (disponibilidade + preço estimado via `packages/pricing`), filtros (coberto, EV, PCD), detalhe do lot — `mobile-engineer`
- [ ] **7.4** Ler QR do ticket → vincular sessão → acompanhar valor em tempo real → pagar com Pix/cartão (Stripe SDK) — `mobile-engineer`
- [ ] **7.5** Push notifications (pagamento confirmado, janela de saída acabando) — `mobile-engineer`
- [ ] **7.6** Histórico e recibos; exclusão de conta (LGPD) — `mobile-engineer`
- [ ] **7.7** Fluxo Maestro: busca → abrir lot → pagar sessão (FakeProvider) — `qa-engineer`
- [ ] **7.8** Build EAS (preview) + deploy de demo da API/web (Render/Fly) para portfólio — `devops-engineer`

## Fase 8 — Reservas

- [ ] **8.1** Schema `reservations` com exclusion constraint (ADR-0010) — `database-engineer`
- [ ] **8.2** Domínio + casos de uso (criar com hold, confirmar via pagamento, cancelar com política, check-in automático na entrada pela placa, no-show) — `backend-engineer`
- [ ] **8.3** Teste de concorrência: 50 requisições simultâneas na mesma vaga/janela → exatamente 1 sucesso — `qa-engineer`
- [ ] **8.4** Mobile: fluxo de reserva (escolher janela, pagar, ver QR) — `mobile-engineer`
- [ ] **8.5** Web: agenda de reservas por lot (timeline) — `web-engineer`

## Fase 9 — Mensalistas & relatórios

- [ ] **9.1** Schema e casos de uso de planos, assinaturas, placas autorizadas, faturas — `backend-engineer`
- [ ] **9.2** Entrada de mensalista (flows.md §6) e bloqueio por inadimplência — `backend-engineer`
- [ ] **9.3** Cobrança recorrente (Pix com vencimento / cartão salvo) — `payments-engineer`
- [ ] **9.4** Read models de faturamento/ocupação (tabelas de projeção ou materialized views) + endpoints — `database-engineer`
- [ ] **9.5** Web: gestão de mensalistas, relatórios com filtros, export CSV/PDF assíncrono — `web-engineer`

## Fase 10 — Produção · Marco M4

- [ ] **10.1** Terraform: VPC, ECS Fargate (api, worker), RDS Postgres (PostGIS), ElastiCache, S3+CloudFront, ALB+WAF, Secrets Manager, ECR — `devops-engineer`
- [ ] **10.2** CD com GitHub Actions via OIDC: build imagem, migrate one-off, deploy rolling, smoke test — `devops-engineer`
- [ ] **10.3** OpenTelemetry + Sentry + dashboards e alertas (erro 5xx, fila atrasada, webhook falhando) — `devops-engineer`
- [ ] **10.4** k6: pico de 40 sessões/s e 300 buscas/s; relatório no repo — `qa-engineer`
- [ ] **10.5** Modo degradado do operador (fila IndexedDB + sync idempotente) — `web-engineer`
- [ ] **10.6** Revisão final de segurança + checklist LGPD (política de privacidade, export/exclusão, retenção) — `security-reviewer`
- [ ] **10.7** README de portfólio: arquitetura, decisões, GIFs, link da demo, como rodar — `architect`

## Fase 11 — Stretch (escolher)

- [ ] **11.1** Módulo `devices`: API de cancela (API key + HMAC), abertura remota auditada
- [ ] **11.2** LPR: serviço Python (YOLO + OCR) consumindo imagem → evento `PlateRead` → entrada automática
- [ ] **11.3** Sensores IoT de vaga (MQTT → AWS IoT Core → evento `SpotStatusChanged`)
- [ ] **11.4** Precificação dinâmica sugerida por ocupação histórica
- [ ] **11.5** Assistente com Claude para o gestor ("qual foi o horário de pico da semana?") usando tools sobre os read models
