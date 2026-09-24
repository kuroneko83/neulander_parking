# Glossário de domínio (pt-BR ↔ código)

| Termo (UI / negócio) | No código | Definição |
|---|---|---|
| Estacionamento | `ParkingLot` / `parking_lots` | Unidade física operada por uma organização |
| Organização | `Organization` | Empresa (CNPJ) dona de um ou mais estacionamentos — o *tenant* |
| Setor / Andar | `Zone` | Agrupamento de vagas (piso, bloco, tipo) |
| Vaga | `Spot` | Posição individual, com código (`A-001`) e tipo |
| Vaga PCD / Idoso / Elétrico | `SpotKind.pcd` / `elderly` / `ev` | Tipos especiais de vaga |
| Rotativo / Avulso | `ParkingSession` (sem `subscriptionId`) | Cliente que paga por tempo de permanência |
| Permanência / Estadia | `ParkingSession` | Período entre entrada e saída de um veículo |
| Ticket / Comprovante de entrada | `ticketCode` (+ QR) | Identificador curto da sessão entregue ao motorista |
| Entrada / Saída | `StartSession` / `ExitSession` | Casos de uso do operador |
| Tabela de preço | `RatePlan` / `RatePlanVersion` | Regras de cobrança versionadas |
| Tolerância | `graceMinutes` | Minutos iniciais sem cobrança |
| Fração | `first` / `additional` | Bloco de tempo cobrado (ex.: 1ª hora, 30 min adicionais) |
| Diária / Teto diário | `dailyCapCents` | Valor máximo cobrado por 24 h |
| Pernoite | `overnight` | Tarifa fixa para período noturno |
| Perda de ticket | `lostTicketFeeCents` | Multa quando o ticket não é apresentado |
| Janela de saída | `exitDeadlineAt` | Tempo após o pagamento para sair sem nova cobrança |
| Convênio / Validação | `Validation` *(futuro)* | Desconto concedido por loja parceira |
| Mensalista | `Subscription` | Cliente com plano mensal e placas autorizadas |
| Plano mensal | `SubscriptionPlan` | Oferta de mensalidade de um estacionamento |
| Inadimplente | `SubscriptionStatus.past_due` | Mensalista com fatura vencida |
| Reserva | `Reservation` | Vaga garantida numa janela de tempo, paga antecipadamente |
| Não comparecimento | `no_show` | Reserva cujo motorista não entrou na tolerância |
| Operador / Manobrista / Caixa | `operator` | Usuário que registra entradas/saídas e recebe pagamentos |
| Gestor | `manager` | Configura estacionamento, preços, mensalistas; vê relatórios |
| Proprietário | `owner` | Gestor com poder sobre membros e dados da organização |
| Motorista | `driver` | Usuário do app mobile |
| Cancela | `Device` (`kind = gate`) | Barreira física de entrada/saída (Fase 12) |
| Leitura de placa (LPR/OCR) | `PlateRead` | Uma passagem de veículo reconhecida pela câmera: placa, horário, direção, confiança |
| Câmera / Dispositivo | `Device` | Câmera cadastrada no estacionamento, com sua chave de acesso |
| Agente de borda | `edge-agent` | Software no mini PC do estacionamento que lê a câmera e envia as leituras |
| Câmera ANPR | `source = anpr_push` | Câmera que já reconhece a placa sozinha e envia o resultado |
| Modo de envio | `uploadMode` (`realtime` / `end_of_day`) | Enviar leituras na hora ou em lote no fechamento do dia |
| Fila de revisão | `PlateReadStatus.needs_review` | Leituras duvidosas que um operador precisa confirmar/corrigir |
| Pareamento | `PlateMatcher` | Ligar a leitura de saída à entrada do mesmo veículo |
| Horário de corte / Fechamento | `businessDayCutoff` | Hora em que o dia operacional fecha e o relatório é gerado |
| Relatório diário | `DailyReport` | Resumo do dia enviado ao dono (entradas/saídas por placa, permanência, faturamento, exceções) |
| Modo LPR | `lprMode` (`off` / `record_only` / `enforced`) | Se a câmera só registra ou também exige pagamento para a saída ser regular |
| Câmera única / bidirecional | `lane = bidirectional` | Uma câmera na faixa lê quem entra (placa dianteira) e quem sai (placa traseira) |
| Destinatário do relatório | `ReportRecipient` | Pessoa que recebe o relatório por e-mail ou WhatsApp (com opt-in) |
| Saída sem pagamento | `settlementStatus.unpaid_exit` | Veículo saiu (lido pela câmera) sem sessão paga |
| Placa Mercosul | `ABC1D23` | Formato atual; antigo `ABC1234`. Ambos via `normalizePlate()` |
| Pix copia e cola | `pix.copyPaste` | Código EMV do Pix |
| Estorno | `Refund` | Devolução parcial/total de pagamento |
| Ocupação | `Occupancy` | Vagas livres/ocupadas/reservadas em tempo real |
