# ADR-0011 — Leitura de placas por agente de borda em Python

- **Status:** Aceito
- **Data:** 2026-09-24

## Contexto
O dono do estacionamento precisa que uma câmera na entrada/saída registre automaticamente a hora de entrada e de saída de
cada veículo pela placa e que isso vire um relatório. Os estacionamentos costumam ter internet instável e sem garantia de
banda para enviar vídeo. Há câmeras com LPR embarcado (ANPR) e câmeras IP comuns (RTSP). Não temos câmera física durante o desenvolvimento.

## Decisão
Criar `apps/edge-agent`, um serviço **Python 3.12** que roda num mini PC no estacionamento:
- Fontes plugáveis: `anpr_push` (câmera já reconhece a placa e envia evento HTTP), `rtsp` (pipeline próprio) e `simulator` (pasta de imagens/vídeo).
- Pipeline RTSP: OpenCV para captura, modelos **ONNX Runtime** para detecção de veículo/placa e OCR de placa
  (modelos abertos para placas Mercosul/antigas, com fine-tune se necessário), rastreamento para direção e votação entre frames.
- Envia só **leituras + recortes JPEG**, nunca vídeo contínuo. Armazena tudo em **SQLite** local antes de enviar (store-and-forward).
- Contratos: JSON Schema exportado dos schemas Zod de `packages/contracts` → modelos Pydantic gerados (`datamodel-code-generator`).
  Um teste de contrato no CI garante que os modelos gerados estão atualizados.
- Ferramentas: `uv` (dependências), ruff, mypy `--strict`, pytest. Distribuído como imagem Docker multi-arch (amd64/arm64).

## Consequências
- Funciona com a internet caída e custa pouca banda; o servidor não precisa de GPU.
- Segunda linguagem no monorepo (exceção consciente à stack TypeScript): justificável porque o ecossistema de visão computacional é Python.
  O restante continua TypeScript. Scripts de `package.json` em `apps/edge-agent` delegam para `uv` para o Turborepo orquestrar lint/test.
- Precisamos operar software em hardware do cliente: versionamento de imagem, heartbeat, métricas de saúde e atualização remota controlada.
- Acurácia depende de instalação física (ângulo, iluminação IR): documentar guia de instalação.

## Alternativas consideradas
- **Enviar vídeo para processar na nuvem (ex.: AWS Kinesis Video + Rekognition):** banda e custo altos, depende de internet estável; Rekognition não é especializado em placas brasileiras.
- **Só câmeras ANPR:** mais simples e mais preciso, mas caro para o cliente e pouco valor técnico no portfólio. Mantido como adapter preferencial em produção.
- **Agente em Node/TypeScript:** manteria uma só linguagem, mas bibliotecas de visão/ONNX/rastreamento são bem mais maduras em Python.
- **APIs pagas de LPR (Plate Recognizer, OpenALPR Cloud):** boa acurácia, porém custo por leitura e dependência de internet; pode entrar como mais um adapter.
