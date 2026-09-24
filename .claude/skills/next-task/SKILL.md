---
name: next-task
description: Pick up and complete the next task from docs/ULTRAPLAN.md end to end - select it, delegate to the owning subagent, verify, review, check it off and commit. Use when the user says "next task", "continue the plan", "próxima tarefa", or passes a task ID (e.g. /next-task 2.3).
---

# /next-task

Argument (optional): a task ID like `2.3`. Without it, pick automatically.

## 1. Select
1. Read `docs/ULTRAPLAN.md`. Find **Estado atual → Fase atual**.
2. If an ID was given, use it. Otherwise take the first `[ ]` task in the current phase whose prerequisites
   (earlier tasks it depends on, e.g. contracts/schema before endpoints before UI) are `[x]`.
3. If the phase has no open tasks, run the phase-closing checks in step 5 and advance **Fase atual**.
4. Tell the user in one line which task you're taking and which agent owns it.

## 2. Prepare
- Read the architecture docs sections relevant to the task and any ADR it touches.
- If the task spans more than one module or introduces a new dependency/pattern, consult the `architect` agent first
  for a short design note.

## 3. Implement
- Delegate to the owning agent named in the task (`backend-engineer`, `database-engineer`, `web-engineer`,
  `mobile-engineer`, `payments-engineer`, `qa-engineer`, `devops-engineer`). Give it: the task text, acceptance
  criteria, relevant doc paths, and the Definition of Done from `CLAUDE.md`.
- Order for cross-layer work: `packages/contracts` → database → API → web/mobile.

## 4. Verify
- Run `pnpm lint && pnpm typecheck && pnpm test` (plus `test:int` / `test:e2e` if the task touches those layers).
  Fix failures at the root; never skip tests.
- Run `code-reviewer` on the diff. If the task touches auth, RBAC, tenant scoping, payments, personal data or infra,
  also run `security-reviewer`. Address blocking findings.

## 5. Close
- Mark the task `[x]` in `docs/ULTRAPLAN.md`, append the short commit hash after committing, and update **Estado atual**
  (last task, any notes/blockers).
- Update architecture docs/ADRs if contracts, tables, events or decisions changed.
- Commit with Conventional Commits, scope = module (e.g. `feat(sessions): start session use case (ULTRAPLAN 4.3)`).
- Phase closing (last task of a phase): run `code-reviewer` on the whole phase diff, verify every acceptance criterion
  of the phase, and summarize what's demonstrable now.

## 6. Report
Short summary: task done, files touched, tests added, anything deferred, and the next task in line.
