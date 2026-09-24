# ADR-0012 — Ingestão de leituras em tempo real e em lote com o mesmo caminho idempotente

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
O dono pode querer acompanhar em tempo real ou só receber os dados no fim do dia (internet ruim, custo de dados). Leituras
podem chegar duplicadas (reenvios), atrasadas ou fora de ordem. O relatório precisa dar o mesmo resultado nos dois modos.

## Decisão
- Um único endpoint de ingestão em lote (`POST /v1/devices/reads`, até 500 itens). O modo `realtime` envia lotes pequenos a cada ~2 s;
  o modo `end_of_day` envia tudo no horário de corte. Não existe um "caminho batch" separado.
- Cada leitura tem **ID UUID v7 gerado na borda**; `INSERT ... ON CONFLICT (id) DO NOTHING` garante idempotência. O agente só apaga/marca
  como enviado após o `207` confirmar o item.
- O horário que vale é o `captured_at` da borda. O pareamento processa leituras **em ordem de `captured_at` por estacionamento** numa fila
  com concorrência 1 por lot; leituras atrasadas disparam reprocessamento da placa a partir daquele instante.
- O agente informa `sync-complete { syncedUntil }`; o relatório diário só é gerado quando todas as câmeras do lot sincronizaram até o
  corte, ou após 2 h de espera (com aviso).

## Consequências
- Tempo real e fim do dia produzem exatamente os mesmos dados (verificado por teste E2E na Fase 5.13).
- Depende de relógio correto na borda: NTP obrigatório, desvio reportado no heartbeat e alertado acima de 30 s.
- Reprocessamento de leitura atrasada pode alterar um relatório já enviado → relatório versionado e reenviado como "revisado".

## Alternativas consideradas
- **Upload de arquivo CSV no fim do dia:** simples, mas cria um segundo caminho de código e perde a idempotência por item.
- **MQTT (AWS IoT Core):** ótimo para muitos dispositivos e comando remoto; excesso para o volume atual. Reavaliar se a abertura de cancela (Fase 12) exigir comandos em tempo real.
- **Usar o horário de recebimento do servidor:** errado no modo lote e com internet instável.
