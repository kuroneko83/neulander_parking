# ADR-0018 — Rate limit distribuído (Redis) em auth/convites, com tiers por IP e por identificador

- **Status:** Aceito
- **Data:** 2026-09-29

## Contexto
A tarefa 1.6 pede rate limit em `POST /v1/auth/login`/`register` (brute-force/credential stuffing) e nas rotas
de convite (`POST /v1/invitations/:token/accept`, `GET /v1/invitations/:token`, `POST /v1/orgs/:orgId/members`)
contra scraping/enumeração de token. O ADR-0009 já fixou o alvo de produção como múltiplas tasks ECS Fargate
atrás de um ALB — qualquer contador em memória por processo (o storage padrão do `@nestjs/throttler`) não
compartilha estado entre instâncias, então o limite real vira `limite × nº de tasks`.

Durante a implementação e as sucessivas rodadas de `code-reviewer`/`security-reviewer`, dois problemas de
concorrência apareceram e foram corrigidos antes de fechar a tarefa (detalhados aqui porque moldaram a decisão
final, não só o código):
1. Um bucket por identificador (e-mail) que contava login **bem-sucedido** também virava arma de DoS de conta —
   quem soubesse o e-mail de alguém conseguia bloqueá-la por 15 min repetidamente.
2. A primeira correção do item 1 (só contar falha, via `peek()` antes do handler + `increment()` depois) abriu uma
   race: `N` requisições concorrentes com o mesmo identificador liam "0 hits" e passavam todas — o limite só
   valia serialmente, não sob concorrência (reproduzido: 60 tentativas paralelas de senha errada, 0 bloqueadas).

## Decisão
1. **Backend Redis customizado para o `ThrottlerStorage`** (`RedisThrottlerStorage`,
   `apps/api/src/modules/shared/infra/redis-throttler-storage.ts`): `ioredis` + um script Lua único
   (`INCREMENT_SCRIPT`) que faz o check de bloqueio (`PTTL`), o `INCR` e o `PEXPIRE`/`SET` da chave de bloqueio
   numa única operação atômica no Redis — não no processo Node. É isso que fecha a race de concorrência: `N`
   requisições simultâneas serializam dentro do Redis.
2. **Duas categorias de tier** (`rate-limit.config.ts`):
   - **`strict`** (`login`, `register`, `invitations/:token/accept`): combina um limite por IP (`strictIp`,
     tier padrão do `@nestjs/throttler`, guard global) **e** um por identificador (`strictIdentifier`, e-mail ou
     token do convite — interceptor dedicado, não guard, porque precisa observar o resultado do handler).
     Identificador nunca fica em claro no Redis: chave é `sha256(rota:identificador)`.
   - **`moderate`** (`refresh`, preview de convite, criação de convite): só por IP, janela mais curta/limite mais
     alto — anti-scraping, não anti-brute-force.
3. **`strictIdentifier` usa a MESMA operação atômica `increment()` do IP, antes do handler** — não um
   `peek()`/`increment()` em dois passos. A garantia de "sucesso não pesa contra a própria vítima" vem de outro
   lugar: um login bem-sucedido **reseta** o bucket (`storage.reset()`) depois do handler, apagando inclusive o
   hit que a própria requisição acabou de registrar. Residual aceito e documentado no código: um atacante que
   sabe o e-mail de alguém ainda consegue manter a conta "bloqueada" enviando tentativas erradas
   indefinidamente — nenhum rate limit por identificador não-autenticado fecha isso sem um sinal ortogonal
   (CAPTCHA, throttling adaptativo), fora do escopo desta tarefa.
4. **`app.set("trust proxy", 1)`** (Express, `configure-app.ts`) — nunca `trust proxy: true`. Só é seguro porque
   o Fargate task, em produção, só deve ser alcançável pelo ALB (security group). **Isso ainda não está garantido
   por código/infra** — não há `infra/terraform` neste repositório ainda (só `infra/docker` local). Registrado
   aqui como dependência pendente da Fase 0/infra AWS (tarefas de Terraform/ECS, ADR-0009): quando a infra de
   produção for criada, a tarefa correspondente deve (a) restringir o security group da task a só aceitar
   tráfego do ALB, e (b) considerar tornar o número de hops configurável via env (`TRUST_PROXY_HOPS`) em vez de
   constante `1`, caso um CDN/WAF (ex.: CloudFront) entre na frente do ALB depois.
5. **Fail-open, não fail-closed, quando o Redis está inacessível:** `RedisThrottlerStorage` captura qualquer
   erro do Redis e devolve um registro "nunca bloqueado" em vez de propagar — uma instabilidade do Redis não
   pode travar/derrubar login para todo mundo. Trade-off deliberado: degrada temporariamente a proteção
   contra brute-force, nunca a disponibilidade do auth. Cliente `ioredis` usa `commandTimeout` curto para que
   essa degradação seja rápida (falha em milissegundos, não trava a requisição). Logs de falha do Redis (e de
   requisição bloqueada) passam por um sampler (`SampledWarnLogger`, no máx. 1 warn/5s por chave) para que uma
   instabilidade sustentada ou um atacante gerando bloqueios em volume não inundem o log.
6. **`OnApplicationShutdown`, não `OnModuleDestroy`**, para desconectar o cliente Redis — garante que a conexão
   sobrevive ao dreno de requisições em voo no `SIGTERM`/deploy, em vez de derrubá-las com 500.

## Consequências
- Rate limit correto entre múltiplas tasks ECS sem depender de sticky sessions ou de um único processo.
- Um script Lua a mais para manter/entender além do código TypeScript, mas é pequeno (~25 linhas) e testado
  (unitário + integração contra Redis real, incluindo o caso "Redis inacessível").
- `strictIdentifier` no `invitations/:token/accept` e no `register` não protege de fato contra um atacante que
  varia o valor guessado (cada tentativa cai num bucket novo) — só o `strictIp` protege ali. Aceito, não é
  regressão desta tarefa, mas fica registrado para não ser redescoberto como bug depois.
- Aumenta cada request app-wide em até 3 round-trips Lua ao Redis (uma por tier ativo, incluindo tiers inertes
  em rotas sem `@Throttle()`), incluindo rotas de health check. Não medido como problema no volume atual do
  projeto; se `/health/*` sofrer com isso, a saída é `@SkipThrottle()` nessas rotas.
- `app.set("trust proxy", 1)` é uma invariante acoplada à topologia de deploy que **nenhum código valida hoje**
  — só o security group da VPC (ainda não criado) a torna segura. Ver item 4 da Decisão.

## Alternativas consideradas
- **Storage em memória padrão do `@nestjs/throttler`:** descartado — não compartilha contadores entre as
  múltiplas tasks Fargate (ADR-0009), o limite real seria `limite × nº de tasks`.
- **Rate limit só por IP, sem tier por identificador:** descartado — não protege uma conta específica contra um
  atacante distribuído em muitos IPs (exatamente o cenário que motivou o tier `strictIdentifier`).
- **`peek()` antes do handler + `increment()` só na falha** (primeira tentativa de resolver o DoS de conta por
  e-mail): descartado depois de reintroduzir a race de concorrência descrita no Contexto — ver item 3 da Decisão
  para a solução adotada no lugar.
- **Fail-closed no Redis inacessível** (bloquear todo login se o Redis cair): descartado — trocaria uma
  instabilidade de infraestrutura secundária (Redis, usado só como cache/fila, ADR-0006/0007) por uma
  indisponibilidade total do auth, desproporcional ao risco que se está mitigando.
