# ADR-0015 — LocalStack como substituto local de S3 (MinIO descontinuado)

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto

O `system-design.md` §5 e a tarefa ULTRAPLAN 0.2 previam `minio` como substituto local do S3 em `infra/docker/compose.yml`
(produção continua usando S3 real da AWS via Terraform, Fase 11, ADR-0009 — isto é só sobre o ambiente de
desenvolvimento/CI, nunca sobre o estacionamento ou o agente de borda, que não fala com S3 diretamente).

Ao implementar a tarefa 0.2, `docker pull minio/minio` e `docker pull minio/mc` falharam com "acesso negado" —
a MinIO Inc. removeu as imagens Docker oficiais e os binários pré-compilados gratuitos:

- Mai/2025: console web removido da Community Edition (mesmo compilando do código-fonte).
- Out/2025: pararam de publicar imagens Docker/binários pré-compilados da Community Edition.
- O mirror em `quay.io/minio/*` também está bloqueado (`unauthorized`); o download direto em `dl.min.io` retorna `410 Gone`.
- Fev/2026: README do repositório passou a dizer "não mais mantido".
- 25/04/2026: repositório `minio/minio` no GitHub foi **arquivado** (somente leitura, sem novos patches de segurança).

Compilar do código-fonte arquivado continuaria tecnicamente possível (Dockerfile multi-stage com Go), mas herdaria
um projeto morto (sem console, sem patches futuros) só para o ambiente local — manutenção nossa sobre algo que a
própria empresa abandonou, sem ganho real.

## Decisão

Usar **LocalStack** (`localstack/localstack`, Community Edition, Apache-2.0, ativamente mantido e publicado
oficialmente no Docker Hub) como o serviço S3-compatível do `infra/docker/compose.yml`, no lugar do MinIO.

- Porta padrão do LocalStack (`4566`, "edge port") substitui a `9000` do MinIO; `S3_ENDPOINT` no `.env.example`
  passa a `http://localhost:4566`.
- Credenciais dummy (`test`/`test`, convenção do próprio LocalStack) substituem `minioadmin`/`minioadmin`.
- Criação dos buckets (`neulander-plate-images-dev`, `neulander-reports-dev`) via **init hook** do próprio
  LocalStack (`/etc/localstack/init/ready.d/*.sh` rodando `awslocal s3 mb`), eliminando o container efêmero
  `minio-init` (`mc`) que existia no desenho anterior.
- Persistência entre `docker compose down`/`up` habilitada via `PERSISTENCE=1` + volume nomeado
  (`localstack_data:/var/lib/localstack`), mantendo o requisito de "volume nomeado" da tarefa 0.2.
- Interface: sem console web equivalente ao antigo MinIO nesta escolha; inspeção de bucket via CLI
  (`aws --endpoint-url=http://localhost:4566 s3 ls` ou `awslocal` dentro do container).
- **Atualização (25/09/2026):** desde 23/03/2026 a própria LocalStack passou a exigir conta + token
  (`LOCALSTACK_AUTH_TOKEN`) mesmo para o uso "community" — mesmo padrão do MinIO que motivou este ADR.
  Decisão mantida (LocalStack continua ativamente mantido, ao contrário do MinIO arquivado), mas cada
  desenvolvedor precisa criar uma conta gratuita (plano Hobby, uso não comercial) em
  <https://app.localstack.cloud> e colocar o token em `LOCALSTACK_AUTH_TOKEN` no seu `.env` local
  (nunca commitado). Alternativas descartadas nesse momento: fixar em `localstack/localstack:4.4.0`
  (última versão sem exigência de token, mas congelada) ou migrar para o Garage (ver seção abaixo) —
  optou-se por manter a versão atual + conta gratuita para não ficar preso a uma versão desatualizada.

## Consequências

- `S3_ENDPOINT`, credenciais e nome do serviço no compose mudam; qualquer doc/código que assumir "MinIO" por nome
  (em vez de "um endpoint S3-compatível") precisa ser atualizado (`README.md`, `CLAUDE.md`, `docs/hardware/*` não citam
  MinIO por nome — só `ULTRAPLAN.md` e `README.md`, já ajustados nesta mudança).
- Ganha-se: emulação mais fiel da API real da AWS (é o propósito do LocalStack, reduz risco de "funciona local,
  quebra em produção" com URLs pré-assinadas e lifecycle de expurgo de imagens) e suporte oficial no ecossistema
  Testcontainers (relevante para a tarefa 0.10 e os testes de integração de upload de imagem LPR na Fase 5).
- Perde-se: uma UI de console pronta para inspecionar buckets durante o desenvolvimento (mitigável com um alias de
  `aws s3` no `README.md`, ou reavaliar uma ferramenta de UI genérica S3 depois, se sentirmos falta).
- Imagem mais pesada que o MinIO original (~600 MB, emulador multi-serviço mesmo rodando só o S3) — aceitável para
  ambiente local/CI, não afeta produção.
- Reversível: se o LocalStack também mudar de rumo, a troca fica isolada em `infra/docker/compose.yml` e nas poucas
  variáveis de ambiente de S3 — nenhum código de aplicação depende do nome "MinIO" (sempre falamos com S3 via SDK
  genérico + `S3_FORCE_PATH_STYLE`).

## Alternativas consideradas

- **Compilar o MinIO do código-fonte arquivado:** descartado — projeto morto (sem patches, sem console mesmo
  compilando), custo de manutenção nosso sem ganho sobre as alternativas ativas.
- **Garage** (`dxflrs/garage`, Rust, AGPLv3, ativamente mantido): mais leve que o LocalStack e também S3-compatível.
  Ficou em segundo lugar — é um sistema de armazenamento próprio (pensado para rodar como storage real), não um
  emulador de AWS, então tende a divergir mais do comportamento do S3 real em casos de borda (multipart, algumas
  nuances de assinatura/lifecycle) e não tem módulo oficial no Testcontainers. Reavaliar se o peso do LocalStack
  incomodar no dia a dia.
- **Zenko CloudServer / Adobe S3Mock:** menos adotados para este caso de uso específico (S3 local para testes de
  integração), descartados sem investigação profunda por não superarem o LocalStack em nenhum critério relevante aqui.
