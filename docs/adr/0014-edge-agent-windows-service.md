# ADR-0014 — Agente de borda também como serviço nativo no Windows (PC do guichê)

- **Status:** Aceito
- **Data:** 2026-09-24
- **Complementa:** ADR-0011

## Contexto
Para reduzir o custo do kit por estacionamento (ver `docs/hardware/equipamentos-e-custos.md`, plano econômico), o agente de borda
precisa poder rodar no **computador que já existe no guichê**, geralmente com Windows 10/11, sem exigir mini PC dedicado.
Docker Desktop no Windows é pesado, exige virtualização e licença em empresas maiores.

## Decisão
- O agente passa a ter **dois alvos de distribuição**:
  1. **Linux/Docker** (mini PC dedicado) — como no ADR-0011;
  2. **Windows nativo** — executável empacotado (PyInstaller ou `uv` + Python embutido) instalado como **serviço do Windows**
     (via `pywin32`/NSSM), iniciando com o sistema e reiniciando sozinho em caso de falha.
- O código do agente não pode depender de nada específico de Linux: caminhos com `pathlib`, SQLite em `%PROGRAMDATA%\NeulanderEdge`,
  sincronização de horário verificada via NTP (o Windows Time Service costuma estar ativo).
- Perfil de recursos "compartilhado": limite de CPU/fps configurável (padrão 3 fps, 1 thread de inferência) para não atrapalhar o uso
  normal do PC pelo operador; processamento só quando há movimento na região da faixa.
- CI gera e testa os dois artefatos (job Windows no GitHub Actions).

## Consequências
- Custo de hardware por estacionamento cai para **~R$ 400 – 950** (câmera + cabos, com ou sem nobreak).
- Dependemos de um PC que o cliente controla: pode ser desligado ou reiniciado por atualizações. Mitigação: store-and-forward,
  heartbeat com alerta de "agente offline", instruções para desativar suspensão e ligar após queda de energia.
- Mais um alvo de build e teste para manter.

## Alternativas consideradas
- **Exigir mini PC dedicado:** mais controle, mas soma R$ 1.300 – 1.700 por estacionamento.
- **Raspberry Pi 5:** no Brasil a placa de 8 GB sozinha custa a partir de ~R$ 1.100 (mais fonte, case e SSD), sem vantagem de preço sobre um mini PC N100 e com CPU mais fraca.
- **Processar na nuvem enviando vídeo:** custo recorrente de banda e computação e dependência de internet (rejeitado no ADR-0011).
- **Usar um celular Android antigo como câmera + processador:** muito barato, mas exigiria um app nativo novo e é frágil para uso contínuo ao ar livre. Pode ser reavaliado como experimento.
