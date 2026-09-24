# ADR-0005 — Pagamentos via porta/adapter e confirmação por webhook

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Mercado brasileiro: Pix é essencial; cartão também. Provedores mudam; testes não podem depender de sandbox externo.

## Decisão
Porta `PaymentProvider` (`createCharge`, `getStatus`, `refund`, `verifyWebhook`) com adapters Mercado Pago (Pix), Stripe (cartão), Cash e Fake. Valor sempre calculado no servidor. Status só muda por webhook verificado + consulta server-side, ou job de conciliação. Idempotency-Key em toda criação; `webhook_events` com unique no ID externo. Dados de cartão nunca passam pelo nosso servidor (tokenização no cliente).

## Consequências
- Escopo PCI reduzido (SAQ A). Testes determinísticos com FakeProvider.
- Complexidade extra de conciliação assumida conscientemente.

## Alternativas consideradas
- **Integração direta sem abstração:** acoplamento e testes frágeis. **Confirmar pelo redirect do cliente:** inseguro.
