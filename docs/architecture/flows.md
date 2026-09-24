# Fluxos e Máquinas de Estado — Neulander Parking

## 1. Máquina de estado — `ParkingSession`

```mermaid
stateDiagram-v2
  [*] --> open: StartSession (entrada)
  open --> awaiting_payment: Checkout (cria Payment)
  awaiting_payment --> open: PaymentFailed / expirado
  awaiting_payment --> paid: PaymentSucceeded
  open --> paid: Isento (tolerância, mensalista, reserva paga)
  paid --> closed: Exit dentro da janela
  paid --> open: Janela de saída expirou (cobra diferença)
  open --> cancelled: Cancel (gestor, auditado)
  closed --> [*]
  cancelled --> [*]
```

Invariantes:
- Uma placa só pode ter **uma** sessão não finalizada por estacionamento (unique parcial no banco).
- `rate_plan_version_id` é fixado na entrada.
- Saída só é permitida em `paid` com `now <= exit_deadline_at`, ou em `open` se o valor cotado for 0.

## 2. Entrada e saída pelo operador (caminho principal do MVP)

```mermaid
sequenceDiagram
  autonumber
  actor Op as Operador (painel)
  participant API as API /sessions
  participant PR as pricing
  participant DB as Postgres
  participant OB as outbox → worker
  participant RT as occupancy (WS)

  Op->>API: POST /sessions {plate} + Idempotency-Key
  API->>API: normalizePlate, checa mensalista/reserva ativa
  API->>PR: activeVersion(lotId)
  API->>DB: INSERT session(open) + outbox(session_started) [tx]
  API-->>Op: 201 {sessionId, ticketCode (QR)}
  OB->>RT: session_started → occupancy.updated (sala lot:{id})

  Note over Op,API: ... horas depois ...
  Op->>API: GET /sessions/{ticket}/quote
  API->>PR: quote(version, entryAt, now)
  API-->>Op: {totalCents, breakdown}
  Op->>API: POST /sessions/{id}/checkout {method: cash|pix|card}
  alt dinheiro
    API->>DB: Payment(succeeded) + session(paid) + outbox [tx]
  else pix/cartão
    API->>DB: Payment(pending) + session(awaiting_payment)
    API-->>Op: QR Pix / link
    Note right of API: webhook confirma (fluxo 3)
  end
  Op->>API: POST /sessions/{id}/exit
  API->>DB: session(closed) + outbox(session_closed) [tx]
  OB->>RT: occupancy.updated
```

## 3. Pagamento via app (Pix) com webhook

```mermaid
sequenceDiagram
  autonumber
  actor D as Motorista (app)
  participant API
  participant PAY as payments
  participant PSP as Mercado Pago
  participant W as worker

  D->>API: POST /sessions/{id}/checkout {method: pix} + Idempotency-Key
  API->>API: quote (valor calculado no servidor, nunca no cliente)
  API->>PAY: createPayment(payable=session, amount)
  PAY->>PSP: cria cobrança Pix (idempotency header)
  PSP-->>PAY: qr_code, copia-e-cola, expires_at
  PAY-->>D: 201 {paymentId, pix}
  D->>D: paga no app do banco
  PSP->>API: POST /webhooks/mercadopago (assinado)
  API->>API: valida assinatura, INSERT webhook_events (unique) → 200 rápido
  API->>W: enfileira processamento
  W->>PSP: GET payment (confirma status server-side)
  W->>PAY: Payment → succeeded + outbox(payment_succeeded) [tx]
  W->>API: sessions: session → paid, exit_deadline_at = now+15min
  W-->>D: WS user:{id} session.updated + push "Pagamento confirmado"
```

Falhas tratadas: webhook duplicado (unique em `webhook_events`), webhook fora de ordem (sempre consulta estado no PSP),
webhook perdido (job `payments-reconcile`), valor divergente (rejeita e audita), pagamento após sessão cancelada (estorno automático).

## 4. Máquina de estado — `Reservation` (Fase 8)

```mermaid
stateDiagram-v2
  [*] --> pending_payment: Create (hold 10 min)
  pending_payment --> confirmed: PaymentSucceeded
  pending_payment --> expired: hold expirou
  confirmed --> checked_in: Entrada (placa bate) dentro da janela
  confirmed --> cancelled: Cancel (reembolso conforme política)
  confirmed --> no_show: fim da tolerância sem entrada
  checked_in --> completed: Sessão fechada
```

Alocação: escolhe vaga `reservable` do tipo pedido; `INSERT` protegido pela exclusion constraint; em `23P01` tenta a próxima candidata (máx. N tentativas) → `409 SPOT_UNAVAILABLE`.

## 5. Máquina de estado — `Payment`

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> succeeded
  pending --> failed
  pending --> expired
  succeeded --> partially_refunded
  succeeded --> refunded
  partially_refunded --> refunded
```

## 6. Mensalista na entrada (Fase 9)

Na `StartSession`, se a placa pertence a `subscription_vehicles` de assinatura `active` no lot e o horário é permitido
pelas regras do plano → sessão criada com `subscription_id` e passa direto para `paid` (valor 0, janela de saída ilimitada).
Se `past_due` → entrada como rotativo + alerta ao operador.
