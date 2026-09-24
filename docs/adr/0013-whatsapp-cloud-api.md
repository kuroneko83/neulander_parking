# ADR-0013 — Relatório diário e alertas via WhatsApp Business Cloud API (oficial)

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
O dono do estacionamento quer receber o relatório diário por e-mail **e por WhatsApp**. No Brasil o WhatsApp é o canal
que o dono realmente lê. Mensagens iniciadas pela empresa fora de uma conversa aberta exigem template aprovado pela Meta.

## Decisão
- Usar a **WhatsApp Business Cloud API** da Meta diretamente (sem BSP intermediário no MVP), atrás de uma porta
  `MessagingChannel` no módulo `notifications` (adapters: `SesEmailChannel`, `WhatsAppCloudChannel`, `FakeChannel` para dev/testes).
- Template de categoria **utility** `relatorio_diario_v1` (pt_BR): cabeçalho com o **PDF como documento**, corpo com variáveis
  (nome do estacionamento, data, entradas, saídas, no pátio, faturamento calculado, nº de exceções) e botão de URL para o painel.
  Template `alerta_camera_offline_v1` para alertas.
- **Opt-in obrigatório**: destinatário cadastrado pelo dono, confirmação registrada (`opt_in_at`, evidência). Mensagem de
  verificação antes do primeiro relatório. Resposta "PARAR" desativa o destinatário.
- Upload do PDF pela Media API da Meta (ou link assinado de curta duração) no momento do envio; nunca URL pública permanente.
- Status de entrega pelo webhook da Meta (validação `X-Hub-Signature-256`) → `notification_deliveries`.
- Envio pelo worker (outbox → BullMQ), com retry exponencial; falha no WhatsApp não bloqueia o e-mail.

## Consequências
- Custo baixo: mensagem utility no Brasil ≈ R$ 0,04–0,05 (cobrança em BRL disponível desde jul/2026) → ~R$ 1,50/mês por destinatário.
- Setup inicial: conta Meta Business verificada, número dedicado, aprovação de templates (pode levar dias) — tarefa 5.15.
- Mudanças de texto exigem nova versão de template aprovada (`_v2`).

## Alternativas consideradas
- **Bibliotecas não oficiais (Baileys, whatsapp-web.js):** grátis, mas violam os termos do WhatsApp, quebram com atualizações e o número pode ser banido. Rejeitado.
- **BSP (Twilio, Zenvia, Take Blip):** onboarding mais fácil e suporte, porém custo extra por mensagem. Pode substituir o adapter se a gestão direta der trabalho.
- **Só e-mail:** mais simples, mas não atende o pedido do dono.
