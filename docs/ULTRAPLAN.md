# ULTRAPLAN — Neulander Parking

> Roadmap executável. Cada tarefa tem ID, agente dono e critério de aceite.
> O Claude Code usa `/next-task` para pegar a **primeira tarefa `[ ]` da fase atual** cujas dependências estão `[x]`.
> Ao concluir: marcar `[x]`, anotar o hash do commit ao lado e atualizar a seção **Estado atual**.

## Estado atual

- **Fase atual:** 0 — Fundação
- **Última tarefa concluída:** 0.5 — Kernel `shared`: Clock, Cents, placas, Idempotency-Key, outbox+BullMQ (`a5c176b`)
- **Bloqueios / notas:** LocalStack (ADR-0015) exige conta gratuita + `LOCALSTACK_AUTH_TOKEN` por desenvolvedor
  desde 23/03/2026; Postgres do compose exposto na porta `5433` e a API na porta `3333` (não `5432`/`3000`) por
  já haver outros projetos nesta máquina de dev ocupando essas portas.
- **Escopo do protótipo (2026-09-25):** alvo até **M3 (Fases 0–7)** — automação do controle de entrada/saída e
  operação do dia a dia para o **dono do estacionamento**, sem app para clientes/motoristas por enquanto. Fases 8
  e 9 ficam só como estrutura/contratos (ver notas nos cabeçalhos de cada fase abaixo). Ver `CLAUDE.md`.

## Visão geral das fases

| Fase | Nome | Entregável demonstrável | Marco |
|---|---|---|---|
| 0 | Fundação | Monorepo rodando, CI verde, docker compose | — |
| 1 | Identidade & organizações | Login, RBAC, convite de operador | — |
| 2 | Estacionamentos & vagas | Gestor cadastra lot, zonas, vagas no painel com mapa | — |
| 3 | Motor de tarifação | Gestor cria tabela de preço e simula | — |
| 4 | Sessões (entrada/saída) | Operador registra entrada/saída e cobra em dinheiro | **M1 — Operação básica** |
| 5 | Câmera LPR & relatório diário | Uma câmera lê placas na entrada e saída (tempo real ou lote no fim do dia) e o dono recebe o relatório diário por e-mail e WhatsApp | **M2 — Controle automático** |
| 6 | Pagamentos | Pix e cartão com webhook, recibo | — |
| 7 | Tempo real & dashboard | Ocupação ao vivo e KPIs do dia | **M3 — Painel completo** |
| 8 | App do motorista ⚠️ *fora do escopo por ora* | Busca no mapa, ticket via QR, pagar pelo app | **M4 — MVP público** |
| 9 | Reservas ⚠️ *fora do escopo por ora* | Reservar vaga com janela de tempo | — |
| 10 | Mensalistas & relatórios | Planos mensais, faturas, relatórios de período (semana/mês) e exports | — |
| 11 | Produção | AWS via Terraform, observabilidade, carga, modo degradado | **M5 — Produção** |
| 12 | Stretch | Cancela automática, IoT, IA | — |

---

## Fase 0 — Fundação

Objetivo: qualquer pessoa clona, roda `pnpm i && pnpm dev` e tem API + web no ar com banco local.

- [x] **0.1** Monorepo pnpm + Turborepo, `packages/config` (tsconfig base strict, eslint flat config, prettier), `.nvmrc` (Node 22), `.editorconfig`, `.env.example` — `devops-engineer` (`4af88e9`)
  - Aceite: `pnpm lint`, `pnpm typecheck`, `pnpm test` rodam na raiz (mesmo sem código).
- [x] **0.2** `infra/docker/compose.yml`: `postgis/postgis:16`, `redis:7`, `axllent/mailpit`, LocalStack — S3 (imagens LPR/relatórios; substitui MinIO, descontinuado — ADR-0015); healthchecks; volume nomeado — `devops-engineer` (`b232d94`)
- [x] **0.3** `apps/api` NestJS: `main.ts` + `main.worker.ts`, config validada com Zod, `nestjs-pino`, filtro de erros RFC 9457, `/health/live|ready`, Swagger em `/docs` — `backend-engineer` (`42ef216`)
- [x] **0.4** Drizzle configurado (migrations em `apps/api/drizzle/`), extensões `postgis`, `btree_gist`, `pg_trgm`, `citext` na migration inicial; scripts `db:generate`/`db:migrate`/`db:seed` — `database-engineer` (`c30c399`)
- [x] **0.5** Kernel `shared`: `DomainError`, `Clock` injetável, `Cents`, UUID v7, `normalizePlate()`/`maskPlate()`, interceptor de `Idempotency-Key`, `OutboxService` + relay worker — `backend-engineer` (`a5c176b`)
  - Aceite: testes unitários de placa (Mercosul/antiga/inválida) e integração do outbox (evento gravado na tx e publicado).
- [ ] **0.6** `packages/contracts` (Zod) e `packages/pricing` (vazio com teste de fumaça) com build `tsup` — `backend-engineer`
- [ ] **0.7** `apps/web`: Vite + React 18 + MUI v5 (tema claro/escuro, pt-BR), React Router, TanStack Query, layout com AppBar/Drawer, página 404 — `web-engineer`
- [ ] **0.8** `eslint-plugin-boundaries` (ou dependency-cruiser) impedindo import entre internals de módulos — `architect`
- [ ] **0.9** GitHub Actions: `ci.yml` (install com cache, lint, typecheck, unit, integration com services postgres/redis, build; job Python para `apps/edge-agent` com ruff + mypy + pytest quando existir); PR template; Dependabot/Renovate — `devops-engineer`
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

## Fase 5 — Câmera LPR & relatório diário · Marco M2

Objetivo: a câmera na entrada/saída lê a placa, o sistema marca **hora de entrada e de saída** de cada carro
automaticamente (em **tempo real** ou enviando **em lote no fim do dia**) e o dono recebe um **relatório diário**.
Configuração padrão: **uma única câmera para entrada e saída**; relatório por **e-mail e WhatsApp**.
Desenho completo: `system-design.md` §7.7–7.8, `flows.md` §7–9, ADR-0011, ADR-0012 e ADR-0013.
Equipamentos e custos: `docs/hardware/equipamentos-e-custos.md` — **alvo: plano econômico** (câmera comum ~R$ 330 + PC do guichê; kit de R$ 400 a R$ 950).

- [ ] **5.1** Contracts: `PlateReadInput` (lote), `DeviceHeartbeat`, `DeviceConfig`, `DailyReportSummary`; export JSON Schema dos contratos para o agente Python (`pnpm contracts:jsonschema`) — `architect`
- [ ] **5.2** Schema `devices`, `plate_reads`, `daily_reports`; colunas novas em `parking_sessions` (`entry_read_id`, `exit_read_id`, `settlement_status`) e `parking_lots` (`lpr_mode`, `business_day_cutoff`, `image_retention_days`); `report_recipients`, `notification_deliveries`; `plate_reads.vehicle_type` e `direction_source` — `database-engineer`
- [ ] **5.3** Módulo `lpr`: cadastro de câmera (gera API key exibida uma única vez), autenticação de dispositivo (API key + assinatura HMAC com timestamp), `heartbeat` que devolve config — `backend-engineer`
- [ ] **5.4** Ingestão `POST /v1/devices/reads` em lote (até 500), idempotente pelo `id` gerado na borda, + URLs pré-assinadas para as imagens (S3; LocalStack em dev — ADR-0015) — `backend-engineer`
  - Aceite: reenviar o mesmo lote 3× não duplica nada; leituras chegando fora de ordem geram o mesmo resultado.
- [ ] **5.5** Domínio `PlateMatcher` (puro): normalização, caracteres confundíveis (O/0, I/1, B/8, S/5, Z/2, G/6), deduplicação de leituras repetidas (< 60 s), pareamento entrada↔saída por `captured_at`, limiar de confiança → `needs_review` — `backend-engineer`
  - Aceite: ≥ 30 cenários tabulares (saída sem entrada, entrada sem saída, placa lida errada 1 caractere, mesma placa volta no dia, lote do fim do dia chegando depois de leituras em tempo real, virada da meia-noite).
- [ ] **5.6** Integração `lpr` → `sessions`: leitura de entrada abre sessão (`entry_channel = lpr`), leitura de saída fecha com `amount_due_cents` calculado; modo `record_only` vs `enforced` (flows.md §7) — `backend-engineer`
- [ ] **5.7** `apps/edge-agent` (Python): config, fontes de imagem plugáveis (**simulador** com pasta de imagens/vídeo, RTSP, câmera ANPR via push HTTP), armazenamento local SQLite (store-and-forward), uploader com modos `realtime` e `end_of_day`, heartbeat, retry com backoff; **dois alvos: Docker/Linux e serviço nativo no Windows** (PC do guichê, ADR-0014) com limite de CPU/fps — `vision-engineer`
- [ ] **5.8** Pipeline de reconhecimento: captura RTSP → gatilho de movimento/ROI → detecção de veículo e placa (ONNX) → OCR de placa Mercosul/antiga → rastreamento (direção entrada/saída com **câmera única**: linha virtual + variação do tamanho da placa) → votação entre frames → leitura final com confiança e tipo de veículo — `vision-engineer`
  - Aceite: script de avaliação em dataset de exemplo reporta acurácia por placa (meta ≥ 95% de dia, ≥ 90% à noite), **acerto de direção ≥ 98%** com câmera única, e latência por frame no hardware alvo. **Câmera de referência: TP-Link Tapo C320WS (plano econômico)**, medida num mini PC N100 e num PC de guichê típico (i3/8 GB, Windows) sem passar de 50% de CPU.
- [ ] **5.9** Adapter para câmeras com LPR embarcado (ex.: Intelbras/Hikvision ANPR enviando evento HTTP): normaliza e encaminha; em paralelo o agente lê o RTSP da mesma câmera em baixa taxa só para determinar a direção quando o evento não trouxer sentido — `vision-engineer`
- [ ] **5.10** Web: cadastro/gestão de câmeras (status online/offline, última sincronização, modo), feed ao vivo de leituras com miniatura (WS), **fila de revisão** para leituras de baixa confiança ou sem par (corrigir placa com 1 clique) — `web-engineer`
- [ ] **5.11** Relatório diário: job por estacionamento no horário de corte → espera sincronização das câmeras (máx. 2 h) → gera resumo + **PDF e CSV** → envia por **e-mail e WhatsApp** aos destinatários ativos + página no painel; regenerar sob demanda se chegar leitura atrasada — `backend-engineer`
- [ ] **5.12** Web: página "Relatórios diários" (lista por dia, resumo, gráfico entradas/saídas por hora, tabela placa/entrada/saída/permanência/valor, exceções, download PDF/CSV) — `web-engineer`
- [ ] **5.13** E2E: simulador reproduz um dia de leituras em modo `end_of_day` → relatório gerado confere com o gabarito esperado; o mesmo dia em `realtime` produz relatório idêntico — `qa-engineer`
- [ ] **5.14** Canal WhatsApp: adapter `WhatsAppCloudChannel` (Cloud API da Meta), templates `relatorio_diario_v1` e `alerta_camera_offline_v1`, envio do PDF como documento, webhook de status, opt-in/verificação e "PARAR"; cadastro de destinatários (e-mail/WhatsApp) no painel com status de entrega — `backend-engineer` + `web-engineer` (ADR-0013)
  - Aceite: com `FakeChannel`, relatório gerado é enviado aos dois canais; falha simulada no WhatsApp não impede o e-mail; destinatário sem opt-in não recebe.
- [ ] **5.15** Setup operacional do WhatsApp (conta Meta Business verificada, número dedicado, aprovação dos templates) + guia de instalação física da câmera única (`apps/edge-agent/INSTALL.md`, baseado em `docs/hardware/equipamentos-e-custos.md`) — `devops-engineer`
- [ ] **5.16** Revisão de segurança + LGPD: autenticação de dispositivo, rotação de chave, retenção de imagens (job de expurgo), placa de aviso de monitoramento, acesso às imagens auditado, token e webhook do WhatsApp, opt-in e telefones mascarados em logs — `security-reviewer`

## Fase 6 — Pagamentos

- [ ] **6.1** Porta `PaymentProvider` + `FakeProvider` (simula webhook com atraso configurável) + `CashProvider` — `payments-engineer`
- [ ] **6.2** Schema `payments`, `payment_attempts`, `webhook_events` — `database-engineer`
- [ ] **6.3** `MercadoPagoPixProvider` (sandbox): criação de cobrança, webhook assinado, consulta de status — `payments-engineer`
- [ ] **6.4** `StripeCardProvider` (test mode, Payment Intents) — `payments-engineer`
- [ ] **6.5** Integração `payments` ↔ `sessions` via eventos; janela de saída; cobrança de diferença se expirar — `backend-engineer`
- [ ] **6.6** Jobs `payments-reconcile` e estorno (parcial/total, auditado) — `payments-engineer`
- [ ] **6.7** Recibo em PDF (worker → S3; LocalStack em dev — ADR-0015) e e-mail — `backend-engineer`
- [ ] **6.8** Web: modal de cobrança com Pix (QR + copia e cola + polling/WS), cartão, dinheiro com troco — `web-engineer`
- [ ] **6.9** Testes: webhook duplicado, fora de ordem, perdido, valor divergente — `qa-engineer`
- [ ] **6.10** Revisão de segurança (assinaturas, idempotência, dados de cartão nunca tocam o servidor) — `security-reviewer`

## Fase 7 — Tempo real & dashboard · Marco M3

- [ ] **7.1** Módulo `occupancy`: read model Redis, handlers de eventos, job de reconciliação — `backend-engineer`
- [ ] **7.2** Gateway Socket.IO `/rt` com auth no handshake, salas e Redis adapter — `backend-engineer`
- [ ] **7.3** Web: dashboard do gestor (ocupação por zona ao vivo, receita do dia, sessões abertas, tempo médio) com MUI + Recharts; mapa de vagas colorido por status — `web-engineer`
- [ ] **7.4** Teste de integração WS (2 clientes, evento chega em < 2 s) — `qa-engineer`

## Fase 8 — App do motorista · Marco M4

> ⚠️ **Fora do escopo deste protótipo por enquanto** (decisão de 2026-09-25, ver `CLAUDE.md`): este protótipo é
> para o dono automatizar a operação, não um app para clientes finais. Ao chegar aqui, manter só contratos/estrutura
> mínima para plugar depois (ex.: `packages/contracts` para os payloads, esqueleto do app Expo sem telas
> funcionais) — não implementar as tarefas abaixo de ponta a ponta sem revisitar essa decisão com o usuário.

- [ ] **8.1** `apps/mobile` Expo + expo-router + React Native Paper (tema alinhado ao MUI), `packages/api-client` compartilhado — `mobile-engineer`
- [ ] **8.2** Auth (SecureStore), cadastro, veículos (placas) — `mobile-engineer`
- [ ] **8.3** Mapa com lots próximos (disponibilidade + preço estimado via `packages/pricing`), filtros (coberto, EV, PCD), detalhe do lot — `mobile-engineer`
- [ ] **8.4** Ler QR do ticket → vincular sessão → acompanhar valor em tempo real → pagar com Pix/cartão (Stripe SDK) — `mobile-engineer`
- [ ] **8.5** Push notifications (pagamento confirmado, janela de saída acabando) — `mobile-engineer`
- [ ] **8.6** Histórico e recibos; exclusão de conta (LGPD) — `mobile-engineer`
- [ ] **8.7** Fluxo Maestro: busca → abrir lot → pagar sessão (FakeProvider) — `qa-engineer`
- [ ] **8.8** Build EAS (preview) + deploy de demo da API/web (Render/Fly) para portfólio — `devops-engineer`

## Fase 9 — Reservas

> ⚠️ **Fora do escopo deste protótipo por enquanto** (mesma decisão da Fase 8) — reserva antecipada é um recurso
> voltado ao motorista/cliente final. Manter só o schema/contratos como estrutura, sem implementar o fluxo completo.

- [ ] **9.1** Schema `reservations` com exclusion constraint (ADR-0010) — `database-engineer`
- [ ] **9.2** Domínio + casos de uso (criar com hold, confirmar via pagamento, cancelar com política, check-in automático na entrada pela placa, no-show) — `backend-engineer`
- [ ] **9.3** Teste de concorrência: 50 requisições simultâneas na mesma vaga/janela → exatamente 1 sucesso — `qa-engineer`
- [ ] **9.4** Mobile: fluxo de reserva (escolher janela, pagar, ver QR) — `mobile-engineer`
- [ ] **9.5** Web: agenda de reservas por lot (timeline) — `web-engineer`

## Fase 10 — Mensalistas & relatórios

- [ ] **10.1** Schema e casos de uso de planos, assinaturas, placas autorizadas, faturas — `backend-engineer`
- [ ] **10.2** Entrada de mensalista (flows.md §6) e bloqueio por inadimplência — `backend-engineer`
- [ ] **10.3** Cobrança recorrente (Pix com vencimento / cartão salvo) — `payments-engineer`
- [ ] **10.4** Read models de faturamento/ocupação (tabelas de projeção ou materialized views) + endpoints — `database-engineer`
- [ ] **10.5** Web: gestão de mensalistas, relatórios com filtros, export CSV/PDF assíncrono — `web-engineer`

## Fase 11 — Produção · Marco M5

- [ ] **11.1** Terraform: VPC, ECS Fargate (api, worker), RDS Postgres (PostGIS), ElastiCache, S3+CloudFront, bucket de imagens LPR com lifecycle (expurgo), ALB+WAF, Secrets Manager, ECR — `devops-engineer`
- [ ] **11.2** CD com GitHub Actions via OIDC: build imagem, migrate one-off, deploy rolling, smoke test — `devops-engineer`
- [ ] **11.3** OpenTelemetry + Sentry + dashboards e alertas (erro 5xx, fila atrasada, webhook falhando, câmera offline, relatório diário não gerado) — `devops-engineer`
- [ ] **11.4** k6: pico de 40 sessões/s, 300 buscas/s e ingestão de lotes de fim do dia de 500 estacionamentos em paralelo; relatório no repo — `qa-engineer`
- [ ] **11.5** Modo degradado do operador (fila IndexedDB + sync idempotente) — `web-engineer`
- [ ] **11.6** Revisão final de segurança + checklist LGPD (política de privacidade, export/exclusão, retenção) — `security-reviewer`
- [ ] **11.7** README de portfólio: arquitetura, decisões, GIFs, link da demo, como rodar — `architect`

## Fase 12 — Stretch (escolher)

- [ ] **12.1** Integração com cancela: abrir a cancela automaticamente quando a leitura LPR confirmar entrada/saída permitida (reusa auth de dispositivo da Fase 5), abertura remota auditada
- [ ] **12.2** Reconhecimento de veículo além da placa (cor/modelo) para reforçar o pareamento
- [ ] **12.3** Sensores IoT de vaga (MQTT → AWS IoT Core → evento `SpotStatusChanged`)
- [ ] **12.4** Precificação dinâmica sugerida por ocupação histórica
- [ ] **12.5** Assistente com Claude para o gestor ("qual foi o horário de pico da semana?") usando tools sobre os read models
