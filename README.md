# Neulander Parking

Plataforma SaaS para estacionamentos: **painel web** para operadores e gestores (entrada/saída, tarifas, mensalistas,
relatórios, ocupação em tempo real) e **app mobile** para motoristas (buscar vagas no mapa, reservar, pagar com Pix/cartão,
ticket digital).

> 🚧 Em construção — desenvolvido fase a fase com Claude Code seguindo o [ULTRAPLAN](docs/ULTRAPLAN.md).

## Stack

| Camada | Tecnologias |
|---|---|
| API | NestJS (monólito modular), Drizzle ORM, PostgreSQL 16 + PostGIS, Redis, BullMQ, Socket.IO |
| Web | React 18, Vite, MUI v5, TanStack Query, React Hook Form + Zod |
| Mobile | Expo, expo-router, React Native Paper, react-native-maps |
| Compartilhado | Contratos Zod, motor de tarifação puro (TypeScript) |
| Infra | Docker Compose, AWS ECS Fargate/RDS/ElastiCache, Terraform, GitHub Actions |
| Qualidade | Vitest, Testcontainers, Playwright, k6 |

## Documentação

- [ULTRAPLAN — roadmap em fases](docs/ULTRAPLAN.md)
- [System design](docs/architecture/system-design.md)
- [Modelo de dados](docs/architecture/data-model.md)
- [API, WebSocket e eventos](docs/architecture/api-and-events.md)
- [Fluxos e máquinas de estado](docs/architecture/flows.md)
- [ADRs](docs/adr/README.md)
- [Glossário de domínio](docs/domain/glossary.md)

## Desenvolvimento com Claude Code

Este repositório é preparado para ser construído com [Claude Code](https://claude.com/claude-code):

- [`CLAUDE.md`](CLAUDE.md) — regras de arquitetura, convenções e Definition of Done
- [`.claude/agents/`](.claude/agents) — subagentes especializados (architect, backend, database, payments, web, mobile, qa, devops, security, code review)
- [`.claude/skills/`](.claude/skills) — `/next-task` (executa a próxima tarefa do plano), `/new-adr`, `/new-module`

Para começar: abra o Claude Code na raiz e rode `/next-task`.

## Rodando localmente

_Disponível ao fim da Fase 0._
