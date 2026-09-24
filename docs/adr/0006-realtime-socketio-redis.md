# ADR-0006 — Tempo real com Socket.IO + Redis adapter

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Painel e app precisam de ocupação e status de pagamento em < 2 s. API roda em múltiplas tasks.

## Decisão
Gateway Socket.IO (namespace `/rt`) no processo da API com `@socket.io/redis-adapter`; salas por lot e por usuário; autorização no handshake e no `subscribe`. Eventos disparados pelos handlers de domínio via worker → Redis pub/sub.

## Consequências
- Reconexão e fallback prontos; clientes web e React Native maduros.
- ALB precisa de sticky sessions ou transporte apenas websocket.

## Alternativas consideradas
- **SSE:** unidirecional e mais simples, mas menos suporte em RN. **AWS API Gateway WebSocket / AppSync:** lock-in e mais peças. **Polling:** latência e custo.
