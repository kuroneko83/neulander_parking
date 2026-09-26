# Modelo de Dados — Neulander Parking

> PostgreSQL 16 + PostGIS + `btree_gist` + `pg_trgm` · ORM: Drizzle · Dono: `database-engineer`

## Convenções

- PK `id uuid` (UUID v7, gerado na aplicação → ordenável por tempo).
- `created_at`, `updated_at timestamptz not null default now()` em todas as tabelas mutáveis.
- Dinheiro: `*_cents integer not null` + `currency char(3) default 'BRL'`.
- Enums como `text` + `CHECK` (mais fácil de migrar que `CREATE TYPE`), espelhados em `packages/contracts`.
- Tabelas pertencem a **um** módulo; o schema Drizzle fica em `modules/<ctx>/infra/schema.ts`.
- FK entre módulos é permitida no banco (integridade), mas o código de um módulo não faz JOIN em tabela de outro — usa o serviço público.
- Soft delete apenas onde há exigência (lots, spots): `archived_at timestamptz`.

## ERD

```mermaid
erDiagram
  organizations ||--o{ memberships : has
  users ||--o{ memberships : has
  organizations ||--o{ parking_lots : owns
  parking_lots ||--o{ zones : has
  zones ||--o{ spots : has
  parking_lots ||--o{ rate_plans : has
  rate_plans ||--o{ rate_plan_versions : versions
  users ||--o{ vehicles : owns
  parking_lots ||--o{ parking_sessions : hosts
  spots ||--o{ parking_sessions : "optional"
  rate_plan_versions ||--o{ parking_sessions : priced_by
  parking_sessions ||--o{ payments : paid_by
  reservations ||--o{ payments : paid_by
  spots ||--o{ reservations : reserved
  users ||--o{ reservations : makes
  parking_lots ||--o{ subscription_plans : offers
  subscription_plans ||--o{ subscriptions : instances
  subscriptions ||--o{ subscription_vehicles : authorizes
  payments ||--o{ payment_attempts : tries
  parking_lots ||--o{ devices : has
  devices ||--o{ plate_reads : captures
  plate_reads |o--o| parking_sessions : "entry/exit read"
  parking_lots ||--o{ daily_reports : "one per business day"
```

## Tabelas por módulo

### identity
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `users` | id, email (citext), password_hash, name, phone, cpf_encrypted, role_global (`driver`\|`platform_admin`\|null), email_verified_at, deleted_at | unique(email) |
| `organizations` | id, name, legal_name, cnpj, status (`active`\|`suspended`) | unique(cnpj) |
| `memberships` | id, organization_id, user_id, role (`owner`\|`manager`\|`operator`), parking_lot_ids uuid[] (escopo do operador; vazio = todos) | unique(organization_id, user_id) |
| `refresh_tokens` | id, user_id, token_hash, family_id, expires_at, revoked_at, replaced_by | index(user_id), index(family_id), unique(token_hash) |
| `invitations` | id, organization_id, email (citext), role (`owner`\|`manager`\|`operator`), parking_lot_ids uuid[], token_hash (sha256 do token opaco — nunca o token), invited_by_user_id, expires_at (7 dias), accepted_at, accepted_by_user_id, revoked_at | unique(token_hash), unique parcial(organization_id, email) `where accepted_at is null and revoked_at is null` (um convite pendente por e-mail/org), index(organization_id) |

### facilities
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `parking_lots` | id, organization_id, name, slug, address jsonb, location geography(Point,4326), timezone, opening_hours jsonb, total_capacity, status (`draft`\|`published`\|`closed`), amenities text[], **lpr_mode (`off`\|`record_only`\|`enforced`)**, **business_day_cutoff time (padrão 23:59)**, **image_retention_days (padrão 30)**, archived_at | GiST(location), unique(organization_id, slug) |
| `zones` | id, parking_lot_id, name, level, kind (`general`\|`pcd`\|`elderly`\|`ev`\|`moto`\|`vip`) | |
| `spots` | id, zone_id, parking_lot_id, code, kind, status (`free`\|`occupied`\|`reserved`\|`blocked`), reservable bool, archived_at | unique(parking_lot_id, code), index(parking_lot_id, status) |

### pricing
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `rate_plans` | id, parking_lot_id, name, applies_to (`rotating`\|`reservation`), active_version_id | |
| `rate_plan_versions` | id, rate_plan_id, version int, rules jsonb (validado por Zod `RatePlanRules`), valid_from, created_by | unique(rate_plan_id, version) — **imutável** |

### sessions
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `parking_sessions` | id, organization_id, parking_lot_id, spot_id?, plate_normalized, vehicle_id?, driver_user_id?, reservation_id?, subscription_id?, rate_plan_version_id, status, entry_at, exit_deadline_at?, exit_at?, amount_due_cents?, **settlement_status (`pending`\|`paid`\|`waived`\|`unpaid_exit`)**, **entry_read_id?**, **exit_read_id?**, ticket_code (curto, p/ QR), entry_channel (`operator`\|`app`\|`gate`\|`lpr`), opened_by, closed_by | **partial unique(parking_lot_id, plate_normalized) WHERE status IN ('open','awaiting_payment','paid')** — impede dupla entrada; index(parking_lot_id, status); trigram(plate_normalized); unique(ticket_code) |

### lpr (câmeras e leituras de placa)
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `devices` | id, organization_id, parking_lot_id, name, kind (`lpr_camera`\|`gate` futuro), source (`rtsp`\|`anpr_push`\|`simulator`), lane (`bidirectional` padrão \|`entry`\|`exit`), direction_hint jsonb (linha virtual + qual lado é "dentro"), upload_mode (`realtime`\|`end_of_day`), api_key_prefix, api_key_hash, hmac_secret_encrypted, config jsonb (ROI, linha virtual, limiar de confiança, fps), status (`active`\|`disabled`), agent_version, last_seen_at, last_synced_until, clock_skew_ms | unique(api_key_prefix), index(parking_lot_id) |
| `plate_reads` | **id (UUID v7 gerado no agente)**, organization_id, parking_lot_id, device_id, captured_at, received_at, plate_raw, plate_normalized, confidence numeric(4,3), candidates jsonb (top-N com confiança), direction (`in`\|`out`\|`unknown`), direction_source (`camera`\|`tracker`\|`server_inferred`), vehicle_type (`car`\|`motorcycle`\|`truck`\|`unknown`), plate_image_key?, vehicle_image_key?, status (`pending`\|`matched`\|`duplicate`\|`needs_review`\|`corrected`\|`ignored`), session_id?, corrected_plate?, reviewed_by?, reviewed_at?, review_reason? | PK(id) = idempotência; index(parking_lot_id, captured_at); index(parking_lot_id, plate_normalized, captured_at); index(parking_lot_id, status) WHERE status = 'needs_review'; trigram(plate_normalized) |

### notifications
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `report_recipients` | id, organization_id, parking_lot_id, name, channel (`email`\|`whatsapp`), address (e-mail ou telefone E.164), wants_daily_report bool, wants_alerts bool, opt_in_at, opt_in_evidence jsonb, verified_at, active | unique(parking_lot_id, channel, address) |
| `notification_deliveries` | id, notification_id, recipient_id, channel, provider_message_id, status (`queued`\|`sent`\|`delivered`\|`read`\|`failed`), error_code, updated_at | unique(channel, provider_message_id) |

### reporting
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `daily_reports` | id, organization_id, parking_lot_id, business_date date, cutoff_at, status (`waiting_sync`\|`generating`\|`ready`\|`failed`), version int, summary jsonb (`DailyReportSummary`), warnings jsonb, pdf_key, csv_key, generated_at, sent_at | unique(parking_lot_id, business_date, version) |

### reservations
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `reservations` | id, parking_lot_id, spot_id, driver_user_id, plate_normalized, period tstzrange, status, price_cents, hold_expires_at, checked_in_session_id? | **EXCLUDE USING gist (spot_id WITH =, period WITH &&) WHERE (status IN ('pending_payment','confirmed','checked_in'))** |

### payments
| Tabela | Colunas principais | Índices / restrições |
|---|---|---|
| `payments` | id, organization_id, payable_type (`session`\|`reservation`\|`subscription_invoice`), payable_id, amount_cents, currency, method (`pix`\|`card`\|`cash`), provider, provider_payment_id, status, idempotency_key, paid_at, refunded_cents | unique(idempotency_key), unique(provider, provider_payment_id), index(payable_type, payable_id) |
| `payment_attempts` | id, payment_id, request jsonb (sanitizado), response jsonb, status, created_at | |
| `webhook_events` | id, provider, external_event_id, payload jsonb, received_at, processed_at, error | unique(provider, external_event_id) |

### subscriptions (mensalistas)
| Tabela | Colunas principais |
|---|---|
| `subscription_plans` | id, parking_lot_id, name, price_cents, billing_day, rules jsonb (horários permitidos, vaga fixa?) |
| `subscriptions` | id, plan_id, customer_user_id?, customer_name, customer_document_encrypted, status (`active`\|`past_due`\|`cancelled`), current_period_end, fixed_spot_id? |
| `subscription_vehicles` | id, subscription_id, plate_normalized — unique(subscription_id, plate_normalized) |
| `subscription_invoices` | id, subscription_id, period, amount_cents, status, due_date, payment_id? |

### shared / plataforma
| Tabela | Uso |
|---|---|
| `outbox_events` | id, aggregate_type, aggregate_id, type, payload jsonb, occurred_at, published_at? — index(published_at) WHERE published_at IS NULL |
| `idempotency_keys` | key, scope (user/device), request_hash, response_status, response_body jsonb, expires_at — PK(scope, key) |
| `audit_logs` | id, organization_id, actor_user_id, action, target_type, target_id, diff jsonb, ip, created_at |
| `notifications` | id, user_id, channel, template, payload jsonb, status, sent_at |
| `vehicles` | id, user_id, plate_normalized, nickname, kind — unique(user_id, plate_normalized) |

## Formato de `rate_plan_versions.rules` (exemplo)

```json
{
  "graceMinutes": 10,
  "first": { "minutes": 60, "priceCents": 1200 },
  "additional": { "minutes": 30, "priceCents": 400 },
  "dailyCapCents": 6000,
  "overnight": { "from": "22:00", "to": "06:00", "flatCents": 3000 },
  "overrides": [
    { "days": ["sat", "sun"], "first": { "minutes": 60, "priceCents": 800 } }
  ],
  "lostTicketFeeCents": 5000
}
```

## Particionamento e retenção (Fase 11+)

- `parking_sessions`, `payments`, `audit_logs`: particionamento declarativo por mês (`entry_at`/`created_at`) quando > 10 M linhas.
- `outbox_events` publicados: purge após 7 dias. `idempotency_keys`: TTL 24 h (job diário).
- `plate_reads`: particionar por mês (`captured_at`) desde o início se houver muitos estacionamentos; imagens no S3 com
  lifecycle = `image_retention_days` do lot + job diário que limpa `*_image_key` das leituras expiradas.
- Anonimização LGPD: job que remove vínculo `driver_user_id` e mascara placa em sessões > 5 anos.
