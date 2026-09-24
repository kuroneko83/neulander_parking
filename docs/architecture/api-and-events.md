# API, WebSocket e Eventos — Neulander Parking

> REST versionado em `/v1` · JSON · erros RFC 9457 · OpenAPI gerado dos schemas Zod (`nestjs-zod`) em `/docs`

## Convenções

- Autenticação: `Authorization: Bearer <access>`; web usa cookie para refresh em `/v1/auth/refresh`.
- Escopo de organização via path: `/v1/orgs/:orgId/...` para endpoints do painel; motorista usa `/v1/me/...` e endpoints públicos.
- Paginação por cursor: `?cursor=&limit=` → `{ data: [], nextCursor }`.
- Escritas sensíveis exigem `Idempotency-Key` (UUID) — resposta reproduzida se a chave repetir com o mesmo corpo; `409` se corpo diferente.
- Datas ISO 8601 UTC. Dinheiro `{ amountCents, currency }`.
- Erro: `{ type, title, status, detail, code, errors? }` — `code` estável (ex.: `SESSION_ALREADY_OPEN`, `SPOT_UNAVAILABLE`).

## Endpoints (MVP)

### Auth & identidade
| Método | Rota | Quem | Descrição |
|---|---|---|---|
| POST | `/v1/auth/register` | público | Cadastro de motorista |
| POST | `/v1/auth/login` | público | Retorna access + refresh |
| POST | `/v1/auth/refresh` | público | Rotação de refresh token |
| POST | `/v1/auth/logout` | autenticado | Revoga família de refresh |
| GET | `/v1/me` | autenticado | Perfil + memberships |
| POST | `/v1/orgs` | platform_admin | Cria organização + owner |
| POST | `/v1/orgs/:orgId/members` | owner, manager | Convida operador/gestor |

### Facilities
| Método | Rota | Quem |
|---|---|---|
| GET/POST | `/v1/orgs/:orgId/lots` | manager+ |
| GET/PATCH | `/v1/orgs/:orgId/lots/:lotId` | manager+ (GET operador) |
| POST | `/v1/orgs/:orgId/lots/:lotId/publish` | manager+ |
| GET/POST | `/v1/orgs/:orgId/lots/:lotId/zones` | manager+ |
| POST | `/v1/orgs/:orgId/lots/:lotId/spots:bulk` | manager+ — cria vagas em lote (ex.: A-001..A-120) |
| PATCH | `/v1/orgs/:orgId/lots/:lotId/spots/:spotId` | operator+ (bloquear/desbloquear) |
| GET | `/v1/lots/search?lat=&lng=&radiusM=&from=&to=` | público — busca no mapa com disponibilidade e preço estimado |
| GET | `/v1/lots/:slug` | público — detalhe |

### Pricing
| Método | Rota | Quem |
|---|---|---|
| GET/POST | `/v1/orgs/:orgId/lots/:lotId/rate-plans` | manager+ |
| POST | `/v1/orgs/:orgId/rate-plans/:planId/versions` | manager+ — cria nova versão (imutável) |
| POST | `/v1/orgs/:orgId/rate-plans/:planId/simulate` | manager+ — simula entrada/saída |

### Sessions
| Método | Rota | Quem | Descrição |
|---|---|---|---|
| POST | `/v1/orgs/:orgId/lots/:lotId/sessions` | operator+ | Entrada (placa, spot opcional) — idempotente |
| GET | `/v1/orgs/:orgId/lots/:lotId/sessions?status=&plate=` | operator+ | Lista / busca fuzzy por placa |
| GET | `/v1/sessions/:ticketCode/quote` | público c/ ticket, operador | Valor atual a pagar |
| POST | `/v1/sessions/:sessionId/checkout` | operator+ / driver dono | Cria pagamento para o valor cotado |
| POST | `/v1/orgs/:orgId/sessions/:sessionId/exit` | operator+ | Saída (valida pago ou isento) |
| POST | `/v1/orgs/:orgId/sessions/:sessionId/cancel` | manager+ | Cancelamento com motivo (auditado) |
| POST | `/v1/me/sessions/claim` | driver | Vincula ticket (QR) à conta do motorista |
| GET | `/v1/me/sessions` | driver | Sessões ativas e histórico |

### Payments
| Método | Rota | Quem |
|---|---|---|
| GET | `/v1/payments/:paymentId` | dono / operador |
| POST | `/v1/orgs/:orgId/payments/:paymentId/refund` | manager+ (auditado) |
| POST | `/v1/webhooks/mercadopago` | PSP (assinatura HMAC) |
| POST | `/v1/webhooks/stripe` | PSP (assinatura) |

### Câmeras LPR — API de dispositivo (agente de borda)
Autenticação: `Authorization: Device <apiKey>` + `X-Signature: t=<unix>,v1=<hmac-sha256(t + "." + body)>`. Escopo: um estacionamento.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/v1/devices/heartbeat` | Status do agente (versão, fila local, desvio de relógio, fps, temperatura) → responde com `DeviceConfig` atual |
| POST | `/v1/devices/uploads:presign` | Pede URLs pré-assinadas (PUT) para até 1000 imagens de recorte |
| POST | `/v1/devices/reads` | Lote de até 500 `PlateReadInput` `{ id, capturedAt, plateRaw, confidence, candidates[], direction, plateImageKey?, vehicleImageKey? }` → `207` com status por item (`accepted` \| `duplicate` \| `rejected`) |
| POST | `/v1/devices/sync-complete` | `{ syncedUntil }` — agente informa que enviou tudo até esse instante (libera o relatório diário) |

### Câmeras LPR — painel
| Método | Rota | Quem |
|---|---|---|
| GET/POST | `/v1/orgs/:orgId/lots/:lotId/devices` | manager+ — POST retorna a API key **uma única vez** |
| PATCH | `/v1/orgs/:orgId/devices/:deviceId` | manager+ (modo de envio, faixa, limiar, desativar) |
| POST | `/v1/orgs/:orgId/devices/:deviceId/rotate-key` | owner, manager (auditado) |
| GET | `/v1/orgs/:orgId/lots/:lotId/plate-reads?status=&plate=&from=&to=` | operator+ |
| GET | `/v1/orgs/:orgId/plate-reads/:readId/images` | operator+ — URLs assinadas curtas (acesso auditado) |
| POST | `/v1/orgs/:orgId/plate-reads/:readId/review` | operator+ — `{ action: 'correct' \| 'confirm' \| 'ignore', plate? }` |

### Relatório diário
| Método | Rota | Quem |
|---|---|---|
| GET | `/v1/orgs/:orgId/lots/:lotId/daily-reports?from=&to=` | owner, manager |
| GET | `/v1/orgs/:orgId/lots/:lotId/daily-reports/:date` | owner, manager — resumo + lista de veículos |
| GET | `/v1/orgs/:orgId/lots/:lotId/daily-reports/:date/download?format=pdf\|csv` | owner, manager — redirect para URL assinada |
| POST | `/v1/orgs/:orgId/lots/:lotId/daily-reports/:date/regenerate` | owner, manager |
| PATCH | `/v1/orgs/:orgId/lots/:lotId/report-settings` | owner — horário de corte, retenção de imagens |
| GET/POST | `/v1/orgs/:orgId/lots/:lotId/report-recipients` | owner — destinatários (e-mail/WhatsApp), preferências de relatório/alertas |
| POST | `/v1/orgs/:orgId/report-recipients/:id/verify` | owner — envia código de verificação (e-mail) ou mensagem de opt-in (WhatsApp) |
| DELETE | `/v1/orgs/:orgId/report-recipients/:id` | owner |
| POST | `/v1/orgs/:orgId/lots/:lotId/daily-reports/:date/resend` | owner, manager — reenviar para todos ou um destinatário |
| GET/POST | `/v1/webhooks/whatsapp` | Meta — verificação (GET) e status de entrega/respostas (POST, `X-Hub-Signature-256`) |

### Reservations (Fase 9)
`POST /v1/lots/:lotId/reservations` · `GET /v1/me/reservations` · `POST /v1/me/reservations/:id/cancel` · `GET /v1/orgs/:orgId/lots/:lotId/reservations`

### Subscriptions (Fase 10)
`/v1/orgs/:orgId/lots/:lotId/subscription-plans` · `/v1/orgs/:orgId/subscriptions` (CRUD, placas autorizadas, faturas)

### Reports de período (Fase 10)
`GET /v1/orgs/:orgId/reports/revenue?from=&to=&lotId=&groupBy=day` · `GET .../reports/occupancy` · `POST .../reports/exports` (assíncrono → S3 URL assinada)

## WebSocket (Socket.IO, namespace `/rt`)

Autenticação no handshake com access token. Salas:

| Sala | Quem entra | Eventos emitidos pelo servidor |
|---|---|---|
| `lot:{lotId}` | operador/gestor do lot; motorista vendo o detalhe | `occupancy.updated { lotId, free, occupied, reserved, byZone[] }` |
| `lot:{lotId}:ops` | operador/gestor | `session.started`, `session.paid`, `session.closed`, `payment.failed`, `lpr.read { readId, plate, direction, confidence, capturedAt, thumbUrl, status }`, `lpr.review_required`, `device.status_changed` |
| `user:{userId}` | motorista | `session.updated`, `payment.updated`, `reservation.updated` |

Mensagens cliente → servidor: `subscribe { room }`, `unsubscribe { room }` (servidor valida permissão).
Payloads definidos em `packages/contracts/src/realtime`.

## Eventos de domínio (outbox → BullMQ)

Envelope: `{ id, type, version, occurredAt, aggregateId, organizationId, payload }`. Handlers **idempotentes** (dedupe por `id`).

| Evento | Produtor | Consumidores |
|---|---|---|
| `identity.user_registered.v1` | identity | notifications (boas-vindas) |
| `facilities.spot_status_changed.v1` | facilities | occupancy |
| `sessions.session_started.v1` | sessions | occupancy, facilities (marca vaga ocupada), notifications |
| `sessions.session_paid.v1` | sessions | occupancy (realtime), notifications (recibo) |
| `sessions.session_closed.v1` | sessions | occupancy, facilities (libera vaga), reporting |
| `payments.payment_succeeded.v1` | payments | sessions / reservations / subscriptions (conforme `payableType`) |
| `payments.payment_failed.v1` | payments | notifications, sessions |
| `payments.payment_refunded.v1` | payments | reporting, notifications |
| `lpr.plate_read_received.v1` | lpr (ingestão) | lpr (pareamento, processado em ordem por lot) |
| `lpr.plate_read_matched.v1` | lpr | sessions (abre/fecha sessão com horário da leitura), occupancy |
| `lpr.review_required.v1` | lpr | occupancy (WS para o painel), notifications (resumo ao gestor se a fila crescer) |
| `lpr.device_offline.v1` | lpr (job) | notifications (alerta ao gestor/dono), reporting (aviso no relatório) |
| `reporting.daily_report_ready.v1` | reporting | notifications (e-mail + WhatsApp para `report_recipients` ativos) |
| `reservations.reservation_confirmed.v1` | reservations | facilities (vaga `reserved` na janela), notifications |
| `reservations.reservation_expired.v1` | reservations (job) | facilities, notifications |
| `subscriptions.subscription_past_due.v1` | subscriptions | notifications, sessions (bloqueia entrada como mensalista) |

## Jobs agendados (BullMQ repeatable)

| Job | Frequência | Função |
|---|---|---|
| `outbox-relay` | contínuo (poll 500 ms / LISTEN-NOTIFY) | Publica eventos pendentes |
| `payments-reconcile` | 1 min | Consulta PSP para `pending` > 2 min |
| `reservations-expire` | 1 min | Expira holds não pagos e marca no-show |
| `lpr-match` | contínuo (fila por lot, concorrência 1 por lot) | Pareia leituras em ordem de `captured_at` |
| `device-offline-check` | 2 min | Marca câmera offline sem heartbeat há > 5 min |
| `daily-report` | por lot, no `business_day_cutoff` local | Espera sync (máx. 2 h) → agrega → PDF/CSV → e-mail + WhatsApp |
| `lpr-image-purge` | diário | Expurga imagens além de `image_retention_days` |
| `occupancy-reconcile` | 5 min | Recalcula contadores Redis a partir do Postgres |
| `subscriptions-billing` | diário 03:00 local | Gera faturas e marca inadimplência |
| `housekeeping` | diário | Purge de outbox/idempotency, anonimização LGPD |
