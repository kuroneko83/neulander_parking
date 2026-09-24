---
name: new-adr
description: Create a new Architecture Decision Record in docs/adr following the project format. Use when a structural decision is made or changed (new dependency category, datastore, protocol, pattern, infra component), or when the user says "novo ADR" / "registrar decisão".
---

# /new-adr

Argument: short title of the decision.

1. List `docs/adr/` and take the next number (4 digits, e.g. `0011`).
2. Create `docs/adr/NNNN-kebab-case-title.md` with exactly these sections (pt-BR):
   ```
   # ADR-NNNN — <Título>

   - **Status:** Proposto | Aceito | Substituído por ADR-XXXX
   - **Data:** YYYY-MM-DD

   ## Contexto
   ## Decisão
   ## Consequências
   ## Alternativas consideradas
   ```
3. Be concrete: name the libraries/services, the trade-off accepted, and what would make us revisit it.
4. If it supersedes an earlier ADR, change only the old one's **Status** line to `Substituído por ADR-NNNN`.
5. Add a row to the table in `docs/adr/README.md`.
6. Update `docs/architecture/*` and `CLAUDE.md` (Stack section) if the decision changes them.
