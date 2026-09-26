# ADR-0017 — Consumo de eventos de domínio: um despachante por fila + registry de handlers

- **Status:** Aceito
- **Data:** 2026-09-26

## Contexto
O ADR-0007 definiu o outbox transacional e o relay que publica cada evento numa fila BullMQ única
(`domain-events`, `job.name = event.type`, `job.id = event.id`). Até a Fase 1 **nenhum consumidor existia** — a
tarefa 1.5 (convite de membro por e-mail) é o primeiro handler real e, portanto, é ela que fixa o padrão que
`occupancy`, `notifications`, `reporting`, `sessions` e `lpr` vão reusar nas Fases 2–7.

O caminho ingênuo (cada módulo declara sua própria classe `@Processor(DOMAIN_EVENTS_QUEUE)`) **quebra em
silêncio**: no `@nestjs/bullmq` cada `@Processor` instancia um `Worker` BullMQ próprio na fila; workers na mesma
fila *competem* pelos jobs, e cada job é entregue a exatamente um deles. Dois módulos interessados no mesmo
evento — já previsto em `api-and-events.md` (ex.: `sessions.session_closed.v1` → `occupancy` + `facilities` +
`reporting`) — receberiam o evento em apenas um dos dois, de forma não determinística.

## Decisão
1. **Um único consumidor da fila:** `DomainEventsProcessor` (`modules/shared/infra/domain-events.processor.ts`),
   `@Processor(DOMAIN_EVENTS_QUEUE, { autorun: false, concurrency: 1 })`. É o único `@Processor` permitido nessa fila.
2. **Registry in-process:** `DomainEventBus` (`modules/shared`, exportado pelo `index.ts`) com
   `register(eventType, handler)`. Cada módulo registra seus handlers no `onModuleInit` do próprio handler ou do
   seu `*.module.ts`. Handlers ficam na camada `events/` do módulo consumidor (`system-design.md` §6).
3. **Roteamento por tipo:** o despachante resolve os handlers por `job.name` (= `event.type`) e chama todos em
   sequência. Evento sem handler registrado é **ack + log `debug`**, nunca erro — o relay publica tudo, e a
   maioria dos tipos não tem consumidor nesta fase.
4. **Só roda no worker:** `autorun: false` e `run()` chamado exclusivamente em `main.worker.ts`, pelo mesmo motivo
   do `OutboxRelayProcessor` (o `AppModule` é compartilhado com o processo HTTP; um `Worker` iniciado por
   lifecycle hook subiria nos dois).
5. **Envelope validado na entrada:** `job.data` é parseado com `DomainEventSchema` (`@neulander/contracts`) e o
   payload específico com o schema do próprio evento antes de chegar ao handler.
6. **Idempotência é do handler** (ADR-0007). O dedupe nativo por `jobId` é *best-effort*: jobs concluídos são
   removidos por retenção, então um evento republicado depois disso roda de novo.
7. **Retry/DLQ:** o relay passa `attempts: 5`, backoff exponencial (base 5 s), `removeOnComplete: { age: 24h,
   count: 1000 }`, `removeOnFail: { age: 7d }` no `queue.add`. Falha definitiva fica no conjunto `failed` do
   BullMQ (DLQ nativa), sem alerta automático nesta fase.
8. **Ordenação:** nada muda — o ADR-0016 continua valendo (sem ordenação por agregado). Handlers devem tolerar
   reordenação.

## Consequências
- Fan-out real para múltiplos consumidores do mesmo evento, com uma peça de infraestrutura (~60 linhas) e zero
  fila nova.
- `concurrency: 1` mantém o processamento determinístico em teste de integração (dispara `pollOnce()` do relay e
  aguarda a fila drenar) ao custo de throughput — irrelevante no volume deste projeto.
- Um handler lento ou em retry atrasa todos os outros tipos de evento. Quando isso incomodar (candidato natural:
  `lpr-match`, que já quer fila por lot), o módulo cria a **própria fila** atrás do mesmo registry — o que
  substitui esta ADR.
- Payload de evento pode conter segredo (o token de aceite do convite, `identity.member_invited.v1`): ele vive em
  `outbox_events.payload` e em Redis até a retenção expirar. Consequência direta: **nunca logar `job.data`**;
  logs de handler usam id do evento + campos mascarados (`maskEmail()`), e o job `housekeeping` (Fase 10) purga o
  outbox.

## Alternativas consideradas
- **Um `@Processor` por módulo na mesma fila:** o problema descrito no contexto (jobs "roubados" entre workers).
- **Uma fila BullMQ por módulo consumidor,** com o relay roteando por prefixo do `type`: entrega o isolamento de
  falha desde já, mas multiplica filas/workers/observabilidade antes de existir um segundo consumidor. É a
  evolução natural, não o ponto de partida.
- **`DiscoveryService` + decorator `@DomainEventHandler("type")`:** mesma semântica com metadata/reflexão no lugar
  de uma chamada explícita de registro. Menos código nos módulos, mais mágica para depurar — rejeitado por
  proporção (um dev).
- **`EventEmitter2` do Nest:** perde durabilidade, retry e o cruzamento de processos que o outbox existe para dar.
