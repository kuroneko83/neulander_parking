# ADR-0007 — Transactional outbox + BullMQ para efeitos assíncronos

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Evitar dual-write (gravar no banco e publicar em fila sem atomicidade) e chamadas externas dentro de transações.

## Decisão
Casos de uso gravam eventos em `outbox_events` na mesma transação. Um relay (worker) publica em filas BullMQ (Redis). Handlers são idempotentes (dedupe por event id). Jobs agendados também em BullMQ.

## Consequências
- Entrega at-least-once garantida; ordem por agregado preservada via `aggregate_id` como group/job id.
- Redis vira componente crítico (ElastiCache com réplica em produção).

## Alternativas consideradas
- **SQS/SNS/EventBridge:** ótimos na AWS, mas pioram o ambiente local; podem substituir BullMQ depois atrás da mesma interface. **Kafka:** desproporcional.
