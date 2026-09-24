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
  open --> closed: Saída lida pela câmera (lpr_mode = record_only / enforced sem pagamento → settlement_status = unpaid_exit)
  closed --> [*]
  cancelled --> [*]
```

Invariantes:
- Uma placa só pode ter **uma** sessão não finalizada por estacionamento (unique parcial no banco).
- `rate_plan_version_id` é fixado na entrada.
- Saída pelo operador só é permitida em `paid` com `now <= exit_deadline_at`, ou em `open` se o valor cotado for 0.
- **Saída registrada pela câmera nunca é recusada** (o carro já saiu fisicamente): a sessão fecha com `exit_at = captured_at`,
  `amount_due_cents` calculado e `settlement_status` indicando se foi paga. É isso que alimenta o relatório diário.
- Os horários de entrada/saída de sessões LPR vêm do `captured_at` da leitura, não do relógio do servidor.

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

## 4. Máquina de estado — `Reservation` (Fase 9)

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

## 6. Mensalista na entrada (Fase 10)

Na `StartSession`, se a placa pertence a `subscription_vehicles` de assinatura `active` no lot e o horário é permitido
pelas regras do plano → sessão criada com `subscription_id` e passa direto para `paid` (valor 0, janela de saída ilimitada).
Se `past_due` → entrada como rotativo + alerta ao operador.

## 7. Câmera LPR — do carro na cancela até a sessão

```mermaid
sequenceDiagram
  autonumber
  participant CAM as Câmera (RTSP / ANPR)
  participant EA as Agente de borda
  participant LDB as SQLite local
  participant API as API /devices
  participant Q as fila lpr-match (por lot)
  participant S as sessions
  participant P as Painel (WS)

  CAM->>EA: frames / evento ANPR
  EA->>EA: detecta veículo + placa, OCR, rastreia direção, vota melhor leitura
  EA->>LDB: grava leitura {id UUIDv7, capturedAt, placa, confiança, direção} + recortes
  alt upload_mode = realtime
    EA->>API: presign + PUT imagens no S3
    EA->>API: POST /devices/reads [lote pequeno, a cada ~2 s]
  else upload_mode = end_of_day
    Note over EA,LDB: acumula o dia todo
    EA->>API: no horário de corte: lotes de 500 até esvaziar + /sync-complete
  end
  API->>API: valida HMAC, INSERT ... ON CONFLICT (id) DO NOTHING
  API-->>EA: 207 {accepted/duplicate por item}
  EA->>LDB: marca como enviado (só após confirmação)
  API->>Q: plate_read_received
  Q->>Q: processa em ordem de capturedAt (fluxo §8)
  Q->>S: entrada → StartSession(lpr, entryAt = capturedAt)<br/>saída → CloseSessionFromRead(exitAt = capturedAt)
  Q-->>P: lpr.read / lpr.review_required
```

Garantias: **at-least-once** do agente + **idempotência** no servidor = exatamente uma leitura registrada.
Internet caída: o agente continua lendo e grava tudo localmente; ao voltar, envia o atraso em ordem.

## 8. Pareamento de leituras (`PlateMatcher`, domínio puro)

Para cada leitura, em ordem de `captured_at` dentro do estacionamento:

1. **Deduplicação:** mesma placa + mesma direção + mesmo dispositivo em < 60 s → `duplicate`.
2. **Confiança:** abaixo do limiar da câmera (padrão 0,80) → `needs_review` (não mexe em sessão até alguém revisar).
3. **Entrada (`in`):**
   - já existe sessão aberta dessa placa → provável saída não lida; fecha a anterior como exceção `missing_exit` e abre nova.
   - senão → abre sessão (ou vincula a mensalista/reserva, Fases 9–10).
4. **Saída (`out`):**
   - busca sessão aberta pela placa exata; se não houver, tenta variações de caracteres confundíveis
     (O↔0, I↔1, B↔8, S↔5, Z↔2, G↔6, D↔0) e distância de edição ≤ 1 entre as sessões abertas do lot;
   - exatamente um candidato → fecha a sessão; zero ou vários → `needs_review` com os candidatos sugeridos.
5. **Direção `unknown`** (câmera bidirecional sem rastreamento conclusivo): se há sessão aberta da placa → trata como saída; senão → entrada.
6. **Leitura atrasada** (chega depois de leituras posteriores já processadas): reprocessa a partir do `captured_at` dela
   para aquela placa; se o dia já teve relatório, marca o relatório para nova versão.

Revisão humana (`/plate-reads/:id/review`): corrigir a placa re-executa o pareamento para aquela leitura; tudo auditado.

## 9. Fechamento do dia e relatório

```mermaid
sequenceDiagram
  autonumber
  participant J as job daily-report (lot)
  participant L as lpr
  participant R as reporting
  participant S3
  participant N as notifications
  actor D as Dono

  J->>L: todas as câmeras com last_synced_until ≥ corte?
  alt não
    J->>J: reagenda em 10 min (até 2 h após o corte)
  end
  J->>R: gerar(lot, businessDate)
  R->>R: agrega sessões e leituras do dia (fuso do lot) + exceções + avisos
  R->>S3: PDF + CSV
  R->>R: daily_reports (ready, version n) + outbox(daily_report_ready)
  R->>N: daily_report_ready
  N->>D: e-mail "Resumo do dia 24/09 — 312 entradas, 298 saídas, R$ 4.870 calculados, 14 ainda no pátio, 3 exceções" + links
```

Conteúdo do relatório:
- **Resumo:** entradas, saídas, veículos ainda no pátio no corte, pico de ocupação (horário), permanência média e mediana, faturamento calculado vs. recebido (e diferença).
- **Gráfico:** entradas e saídas por hora.
- **Tabela:** placa · entrada · saída · permanência · valor calculado · valor pago · forma de pagamento · origem (câmera/operador).
- **Exceções:** saída sem entrada, entrada sem saída (dias anteriores), leituras corrigidas manualmente, saída sem pagamento (`enforced`), duplicadas suspeitas.
- **Saúde das câmeras:** tempo online, leituras por câmera, % de leituras em revisão, desvio de relógio.
