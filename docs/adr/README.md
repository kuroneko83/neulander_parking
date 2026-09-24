# Architecture Decision Records

Formato: contexto → decisão → consequências → alternativas. ADR aceito é imutável; para mudar, crie um novo que o **substitui** (e marque o antigo como `Substituído por ADR-XXXX`). Use o skill `/new-adr`.

| # | Decisão |
|---|---|
| [0001](0001-modular-monolith-nestjs.md) | Monólito modular com NestJS |
| [0002](0002-monorepo-pnpm-turborepo.md) | Monorepo pnpm + Turborepo |
| [0003](0003-postgres-postgis-drizzle.md) | PostgreSQL + PostGIS + Drizzle |
| [0004](0004-auth-jwt-refresh-rotation.md) | Auth própria: JWT + refresh rotativo |
| [0005](0005-payments-provider-adapter.md) | Pagamentos por adapter + webhook |
| [0006](0006-realtime-socketio-redis.md) | Tempo real com Socket.IO + Redis |
| [0007](0007-outbox-bullmq.md) | Outbox transacional + BullMQ |
| [0008](0008-frontend-stack.md) | Web React + MUI v5; Mobile Expo + RN Paper |
| [0009](0009-aws-ecs-terraform.md) | AWS ECS Fargate + Terraform |
| [0010](0010-reservation-exclusion-constraint.md) | Exclusion constraint para reservas |
