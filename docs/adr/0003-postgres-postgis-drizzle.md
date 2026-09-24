# ADR-0003 — PostgreSQL + PostGIS com Drizzle ORM

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Busca geográfica, consistência forte e restrições avançadas (exclusion constraint, unique parcial, trigram).

## Decisão
PostgreSQL 16 com extensões postgis, btree_gist, pg_trgm, citext. ORM Drizzle (SQL-like, tipagem forte, suporte a tipos customizados como geography e tstzrange, migrations em SQL legível).

## Consequências
- Recursos do Postgres usados diretamente (menos portabilidade, mais garantias).
- SQL cru permitido em repositórios para queries geográficas/relatórios, sempre com testes de integração.

## Alternativas consideradas
- **Prisma:** suporte fraco a PostGIS/ranges (`Unsupported`), client pesado. **TypeORM:** tipagem mais fraca. **MongoDB:** perderíamos transações/constraints relacionais.
