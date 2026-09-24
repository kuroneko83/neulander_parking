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
| Cancela | `GateDevice` | Barreira física de entrada/saída (pós-MVP) |
| Leitura de placa (LPR/OCR) | `PlateRead` | Evento de câmera que reconhece a placa |
| Placa Mercosul | `ABC1D23` | Formato atual; antigo `ABC1234`. Ambos via `normalizePlate()` |
| Pix copia e cola | `pix.copyPaste` | Código EMV do Pix |
| Estorno | `Refund` | Devolução parcial/total de pagamento |
| Ocupação | `Occupancy` | Vagas livres/ocupadas/reservadas em tempo real |
