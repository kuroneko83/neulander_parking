# Neulander Parking

Plataforma SaaS para estacionamentos: **câmera com leitura de placa** na entrada/saída que registra automaticamente
a hora de entrada e saída de cada carro (em tempo real ou enviando no fim do dia) e manda um **relatório diário ao dono por e-mail e WhatsApp**;
**painel web** para operadores e gestores (entrada/saída, tarifas, mensalistas,
relatórios, ocupação em tempo real) e **app mobile** para motoristas (buscar vagas no mapa, reservar, pagar com Pix/cartão,
ticket digital).

> 🚧 Em construção — desenvolvido fase a fase com Claude Code seguindo o [ULTRAPLAN](docs/ULTRAPLAN.md).

## Stack

| Camada | Tecnologias |
|---|---|
| API | NestJS (monólito modular), Drizzle ORM, PostgreSQL 16 + PostGIS, Redis, BullMQ, Socket.IO |
| Web | React 18, Vite, MUI v5, TanStack Query, React Hook Form + Zod |
| Mobile | Expo, expo-router, React Native Paper, react-native-maps |
| Câmera (borda) | Python, OpenCV, ONNX Runtime, SQLite store-and-forward, suporte a câmeras RTSP e ANPR |
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
- [Equipamentos e custos (kit de câmera)](docs/hardware/equipamentos-e-custos.md)

## Desenvolvimento com Claude Code

Este repositório é preparado para ser construído com [Claude Code](https://claude.com/claude-code):

- [`CLAUDE.md`](CLAUDE.md) — regras de arquitetura, convenções e Definition of Done
- [`.claude/agents/`](.claude/agents) — subagentes especializados (architect, backend, database, payments, web, mobile, vision/LPR, qa, devops, security, code review)
- [`.claude/skills/`](.claude/skills) — `/next-task` (executa a próxima tarefa do plano), `/new-adr`, `/new-module`

Para começar: abra o Claude Code na raiz e rode `/next-task`.

## Rodando localmente

A infra local (Postgres+PostGIS, Redis, Mailpit e LocalStack) já está disponível via Docker Compose:

```bash
cp .env.example .env                                # só na primeira vez
docker compose -f infra/docker/compose.yml up -d
```

Isso sobe Postgres 16+PostGIS na porta `5433` (a `5432` local pode já estar em uso por outro projeto),
Redis 7 na `6379`, e cria automaticamente os buckets S3 (**LocalStack**, substituto local da AWS S3 —
MinIO foi descontinuado, ver ADR-0015) usados para imagens de placa e relatórios. Para ver os e-mails
capturados em dev (relatório diário), abra a UI do **Mailpit** em <http://localhost:8025>; para navegar
nos buckets do **LocalStack** (S3 local, sem console web nesta edição), use a AWS CLI apontada para o
endpoint local: `aws --endpoint-url=http://localhost:4566 s3 ls s3://neulander-plate-images-dev`
(credenciais dummy `test`/`test`, já em `.env.example`).

> ⚠️ **Passo manual único, LocalStack:** desde 23/03/2026 a LocalStack exige uma conta gratuita mesmo
> para uso "community". Crie uma conta no plano **Hobby** (uso não comercial) em
> <https://app.localstack.cloud>, gere um token e coloque em `LOCALSTACK_AUTH_TOKEN` no seu `.env`
> (nunca commitado) antes de subir o compose — sem isso o container `localstack` fecha com
> "License activation failed". Ver ADR-0015.

Os comandos de `apps/api` (`pnpm dev`, migrations etc.) chegam nas tarefas 0.3/0.4 da Fase 0.
