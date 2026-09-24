# CLAUDE.md — Neulander Parking

Plataforma de estacionamentos: **câmera com leitura de placa (LPR)** que registra a hora de entrada e saída de cada
carro e gera um **relatório diário para o dono** + **painel web** para operadores/gestores (entrada/saída, tarifas,
mensalistas, relatórios) + **app mobile** para motoristas (buscar vagas, reservar, pagar, ticket digital).
Projeto de portfólio fullstack — qualidade de código, testes e documentação importam tanto quanto features.

## Leia antes de trabalhar

| Documento | Quando ler |
|---|---|
| `docs/ULTRAPLAN.md` | **Sempre.** Roadmap em fases, tarefas com checkbox, critérios de aceite |
| `docs/architecture/system-design.md` | Antes de criar/alterar módulos, infra ou integrações |
| `docs/architecture/data-model.md` | Antes de tocar em schema/migrations |
| `docs/architecture/api-and-events.md` | Antes de criar endpoints, eventos ou mensagens WebSocket |
| `docs/architecture/flows.md` | Antes de implementar check-in/out, pagamento, reserva |
| `docs/adr/` | Decisões já tomadas — não reabra sem criar um novo ADR |
| `docs/domain/glossary.md` | Termos de domínio pt-BR ↔ nomes no código (en) |

## Stack

- **Monorepo:** pnpm workspaces + Turborepo · Node 22 LTS · TypeScript `strict`
- **API:** NestJS 10 (monólito modular) · Drizzle ORM · PostgreSQL 16 + PostGIS · Redis 7 · BullMQ · Socket.IO
- **Web:** React 18 + Vite · **MUI v5** · TanStack Query · React Router · React Hook Form + Zod
- **Mobile:** Expo (React Native) + expo-router · React Native Paper · react-native-maps
- **Agente de borda LPR (única parte em Python):** Python 3.12 + uv · OpenCV · ONNX Runtime · SQLite · Pydantic (gerado dos contratos) — ADR-0011
- **Compartilhado:** `packages/contracts` (Zod), `packages/pricing` (motor de tarifa puro)
- **Testes:** Vitest · Supertest + Testcontainers · Playwright (web) · Maestro (mobile, opcional)
- **Infra:** Docker Compose (local) · AWS ECS Fargate + RDS + ElastiCache via Terraform · GitHub Actions

## Estrutura (alvo)

```
apps/api        NestJS — REST /v1, WebSocket, worker (main.worker.ts)
apps/web        Painel operador/gestor/admin (React + MUI)
apps/mobile     App do motorista (Expo)
apps/edge-agent Agente de borda Python: câmera → leitura de placa → envio (tempo real ou fim do dia)
packages/contracts   Schemas Zod, tipos, eventos de domínio — fonte única de verdade
packages/pricing     Motor de tarifação (funções puras, 100% testado)
packages/api-client  Cliente HTTP tipado + hooks TanStack Query
packages/config      eslint, tsconfig, prettier compartilhados
infra/docker    docker-compose local
infra/terraform AWS
```

## Comandos

> Disponíveis após a Fase 0. Se um comando não existir ainda, a Fase 0 não está concluída.

```bash
pnpm install
pnpm dev                 # sobe api + web (turbo)
pnpm dev --filter api    # só a API
docker compose -f infra/docker/compose.yml up -d   # postgres, redis, mailpit
pnpm lint && pnpm typecheck && pnpm test           # rodar ANTES de todo commit
pnpm test:int --filter api   # integração (Testcontainers, precisa de Docker)
pnpm test:e2e --filter web   # Playwright
pnpm db:generate --filter api   # gera migration a partir do schema Drizzle
pnpm db:migrate --filter api
pnpm contracts:jsonschema        # regenera JSON Schema → modelos Pydantic do edge-agent
cd apps/edge-agent && uv run pytest && uv run ruff check && uv run mypy
cd apps/edge-agent && uv run python -m edge_agent --source simulator --dataset eval/samples   # sem câmera
```

## Regras de arquitetura (não negociáveis)

1. **Fronteiras de módulo.** Cada módulo da API (`apps/api/src/modules/<ctx>`) expõe apenas seu `index.ts`.
   Outro módulo **nunca** importa arquivos internos nem acessa tabelas de outro módulo. Comunicação por
   serviço público (síncrono) ou evento de domínio (assíncrono via outbox).
2. **Camadas dentro do módulo:** `domain/` (puro, sem Nest/Drizzle) ← `application/` (casos de uso) ←
   `infra/` (repositórios, adapters) e `http/` (controllers). Dependências apontam para dentro.
3. **Contratos primeiro.** Todo payload HTTP/WS/evento nasce como schema Zod em `packages/contracts`
   e é reutilizado por API, web e mobile. Nada de tipos duplicados à mão.
4. **Dinheiro em centavos (`integer`)**, nunca float. Tipo `Cents` de `packages/contracts`.
5. **Tempo em UTC** no banco (`timestamptz`); conversão para o fuso do estacionamento (`parking_lots.timezone`,
   padrão `America/Sao_Paulo`) só na borda/apresentação e no motor de tarifa.
6. **Idempotência:** endpoints de entrada/saída, pagamento e webhooks exigem/tratam `Idempotency-Key`.
7. **Efeitos colaterais assíncronos** (notificação, e-mail, relatório) saem via tabela `outbox_events`
   na mesma transação do caso de uso → worker BullMQ. Nunca chame serviço externo dentro de transação.
8. **Máquinas de estado explícitas** para `ParkingSession`, `Reservation`, `Payment` (ver `flows.md`).
   Transição inválida lança `DomainError`, nunca atualiza status "na mão".
9. **Multi-tenant:** toda query de dados operacionais filtra por `organization_id`. Guard de RBAC em todo controller.
10. **LGPD:** placa, CPF, e-mail e telefone são dados pessoais — não logar em claro; usar `maskPlate()` etc.
    Imagens de câmera: só recortes, bucket privado, retenção com expurgo, acesso auditado.
11. **Leituras de câmera (LPR):** o horário que vale é o `captured_at` da borda; ingestão idempotente pelo ID gerado na borda;
    pareamento processado em ordem de `captured_at` por estacionamento, para que tempo real e lote do fim do dia deem o
    mesmo resultado (ADR-0012). Saída lida pela câmera nunca é recusada — vira exceção se não estiver paga.

## Convenções de código

- Identificadores em **inglês**; UI, docs e mensagens ao usuário em **pt-BR** (i18n preparado).
- Sem `any` (use `unknown` + narrowing). Sem `// @ts-ignore`. `eslint --max-warnings 0`.
- Arquivos `kebab-case.ts`; componentes React `PascalCase.tsx`; um componente por arquivo.
- Web: componentes MUI + `sx`/`styled`; tema centralizado em `apps/web/src/theme`. Sem CSS solto.
- Estado de servidor via TanStack Query; estado local via `useState`/Zustand só se necessário. Sem Redux.
- Erros HTTP no formato RFC 9457 (`application/problem+json`).
- Placas: normalize com `normalizePlate()` (aceita Mercosul `ABC1D23` e antiga `ABC1234`).
- Commits: Conventional Commits (`feat(sessions): ...`, `fix(pricing): ...`). Um assunto por commit.

## Testes (Definition of Done)

Uma tarefa do ULTRAPLAN só é marcada `[x]` quando:
- [ ] Critérios de aceite da tarefa atendidos
- [ ] `domain/` e `packages/pricing` com testes unitários (cobertura ≥ 90% nessas pastas)
- [ ] Casos de uso com teste de integração (banco real via Testcontainers) cobrindo caminho feliz + erros
- [ ] Fluxo de UI crítico com teste (RTL ou Playwright)
- [ ] `pnpm lint && pnpm typecheck && pnpm test` verdes
- [ ] Docs/ADR atualizados se a decisão ou contrato mudou

## Fluxo de trabalho com agentes

Use o skill `/next-task` para pegar a próxima tarefa do ULTRAPLAN. Delegue ao subagente dono da área:

| Agente | Área |
|---|---|
| `architect` | Design, ADRs, fronteiras de módulos, revisão de decisões estruturais |
| `backend-engineer` | Módulos NestJS, casos de uso, controllers, workers |
| `database-engineer` | Schema Drizzle, migrations, índices, PostGIS, queries de performance |
| `payments-engineer` | Pagamentos, Pix/cartão, webhooks, conciliação, idempotência |
| `web-engineer` | Painel React + MUI v5 |
| `mobile-engineer` | App Expo do motorista |
| `vision-engineer` | Agente de borda Python: câmera, reconhecimento de placa, store-and-forward, upload |
| `qa-engineer` | Estratégia e escrita de testes, e2e, testes de carga |
| `devops-engineer` | Docker, CI/CD, Terraform/AWS, observabilidade |
| `security-reviewer` | Revisão de auth, RBAC, OWASP, LGPD (somente leitura) |
| `code-reviewer` | Revisão de diff antes de commit (somente leitura) |

Regras: tarefas que cruzam API + UI começam por `contracts` → API → UI. Antes de commitar mudanças em
auth/pagamentos/autenticação de dispositivos/imagens, rode `security-reviewer`. Antes de fechar uma fase, rode `code-reviewer` no diff da fase.

## Não faça

- Não adicione dependência sem justificar no PR/commit (e ADR se for estrutural).
- Não altere migration já aplicada — crie uma nova.
- Não mocke o banco em teste de integração; use Testcontainers.
- Não edite à mão os modelos Pydantic em `apps/edge-agent/src/edge_agent/contracts/` — são gerados.
- Não coloque segredo em código; use `.env` (há `.env.example`) e Secrets Manager em produção.
- Não pule fases do ULTRAPLAN sem registrar o motivo no próprio arquivo.
