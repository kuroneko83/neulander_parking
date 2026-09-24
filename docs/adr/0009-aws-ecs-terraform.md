# ADR-0009 — AWS (ECS Fargate) com Terraform

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
Portfólio com foco em cloud engineering; precisa ser reproduzível e barato.

## Decisão
Produção em AWS: ECS Fargate (api, worker), RDS PostgreSQL, ElastiCache Redis, S3 + CloudFront para web, ALB + WAF, Secrets Manager, ECR. IaC com Terraform (módulos por componente, state remoto S3 + DynamoDB lock). CI/CD por GitHub Actions com OIDC (sem chaves estáticas). Demo de baixo custo opcional em Render/Fly.

## Consequências
- Infra como código demonstrável; custo mensal mínimo estimado ~US$ 60–90 (pode ser desligado fora de demos).
- Mais trabalho que PaaS; compensado pelo valor de portfólio.

## Alternativas consideradas
- **Kubernetes (EKS):** caro e complexo para o escopo. **Serverless (Lambda):** WebSocket e conexões de banco complicam. **Só PaaS:** menos aprendizado de cloud.
