# ADR-0010 — Anti double-booking de reservas via exclusion constraint

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Reservas concorrentes na mesma vaga/janela não podem coexistir, mesmo sob alta concorrência e múltiplas instâncias da API.

## Decisão
Tabela `reservations` com `period tstzrange` e `EXCLUDE USING gist (spot_id WITH =, period WITH &&) WHERE (status IN ('pending_payment','confirmed','checked_in'))` (requer btree_gist). A aplicação tenta vagas candidatas em ordem e trata o erro `23P01`.

## Consequências
- Garantia no banco, sem locks distribuídos. Teste de concorrência obrigatório (Fase 8.3).
- Holds não pagos ocupam a vaga por até 10 min (job de expiração).

## Alternativas consideradas
- **SELECT FOR UPDATE + checagem:** sujeito a erro de implementação. **Lock Redis (Redlock):** consistência mais fraca. **Reserva só por capacidade agregada:** mais simples, mas não permite vaga garantida; pode ser modo alternativo por lot.
