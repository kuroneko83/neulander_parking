# ADR-0001 — Monólito modular com NestJS

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Volume estimado (pico ~160 writes/s) cabe num único serviço. Equipe de 1 pessoa + agentes. Precisamos de fronteiras claras para evoluir sem virar big ball of mud.

## Decisão
API em NestJS organizada em módulos por bounded context (identity, facilities, pricing, sessions, reservations, payments, subscriptions, occupancy, notifications, reporting). Cada módulo expõe só o `index.ts`; fronteiras verificadas por lint. Comunicação síncrona via serviço público e assíncrona via eventos (outbox). API e worker são o mesmo código com entrypoints diferentes.

## Consequências
- Deploy e debug simples; transações ACID entre agregados quando necessário.
- Extração futura de um módulo para serviço é possível (eventos já existem).
- Exige disciplina: violações de fronteira quebram o CI.

## Alternativas consideradas
- **Microsserviços:** overhead operacional (rede, deploy, consistência distribuída) sem ganho no volume atual.
- **Express/Fastify puro:** menos estrutura para DI, guards e módulos; NestJS também é valorizado no mercado.
