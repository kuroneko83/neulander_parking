# ADR-0016 — Outbox relay sem ordenação por agregado (adiada até haver consumidor real)

- **Status:** Aceito
- **Data:** 2026-09-25

## Contexto

O ADR-0007 decidiu outbox transacional + BullMQ e registrou como consequência que "ordem por agregado preservada
via `aggregate_id` como group/job id". Ao implementar o `OutboxRelayProcessor` (ULTRAPLAN 0.5), esse ponto não foi
seguido ao pé da letra: o BullMQ (na versão livre, sem os *groups* do BullMQ Pro) não tem um conceito nativo de
"uma fila lógica por chave, consumida em ordem, mas processada em paralelo entre chaves diferentes" — só filas
inteiras com concorrência configurável. Implementar isso à mão (ex.: uma fila por `aggregate_id`, ou um mutex de
aplicação) seria trabalho real sem nenhum consumidor de evento existindo ainda para se beneficiar — nenhum módulo
de domínio (Fase 1+) registrou um processor até este ponto.

## Decisão

`OutboxRelayProcessor` usa `jobId = event.id` (garante *dedupe* nativo do BullMQ por evento, não por agregado) e
publica os eventos pendentes na fila única `domain-events` **na ordem em que aparecem em `outbox_events`**
(consulta ordenada por `occurred_at`), mas **sem** garantir que o *consumo* da fila mantenha essa ordem por
agregado quando houver múltiplos handlers/consumidores concorrentes. Isso vale só até o primeiro módulo de
domínio precisar de fato de ordenação estrita por agregado.

## Consequências

- Handlers de evento (Fase 1+) **não podem assumir** que dois eventos do mesmo agregado chegam nessa ordem se
  forem consumidos por workers/processos diferentes — precisam ser projetados para tolerar reordenação (ex.:
  usar `occurredAt`/versão no payload pra decidir se um evento é mais recente que o estado já aplicado), ou o
  handler específico precisa de sua própria lógica de sequenciamento.
- Simplicidade agora: nenhuma fila por agregado, nenhum mutex, nenhuma dependência do BullMQ Pro.
- Quando o primeiro caso real de ordenação estrita aparecer (candidato provável: `lpr.plate_read_matched` na
  Fase 5, que já tem sua própria ordenação por `captured_at` implementada no domínio `PlateMatcher` — ver
  ADR-0012 — então pode nem precisar disso na fila), revisar esta decisão: opções incluem BullMQ Pro (*groups*),
  uma fila dedicada por `aggregate_id` com concorrência 1, ou mover esse tipo de evento para processamento
  síncrono dentro do próprio caso de uso em vez de outbox assíncrono.

## Alternativas consideradas

- **Uma fila BullMQ por `aggregate_id`:** garante ordem por agregado, mas explode em número de filas
  (potencialmente uma por sessão/dispositivo) sem necessidade real hoje — descartado por over-engineering.
- **Concorrência 1 na fila inteira (`domain-events`):** garantiria ordem global, mas serializa todo processamento
  de eventos do sistema inteiro por um único worker — descartado, custo alto pra um requisito que ninguém usa
  ainda.
- **BullMQ Pro (`groups`):** resolveria de forma nativa, mas é uma feature paga; reavaliar se/quando o problema
  de ordenação por agregado se tornar real.
