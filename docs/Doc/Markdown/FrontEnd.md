# Sistema de Telemetria em Tempo Real — Unicamp E-Racing
## Design Briefing Técnico · FSAE 2026

---

## 1. Visão Geral do Sistema

O sistema de telemetria da Unicamp E-Racing foi projetado para capturar, transmitir, decodificar e visualizar dados do veículo elétrico em tempo real. A arquitetura abrange desde o barramento CAN do carro até a interface gráfica operada pela equipe à beira da pista.

O foco desta documentação é o **frontend** — a camada de visualização responsável por receber o stream binário do servidor, decodificar sinais CAN, manter histórico e apresentar os dados para os engenheiros de corrida com latência mínima e sem perda de resolução analítica.

---

## 2. Fluxo de Dados: do CAN à Tela

```
Barramento CAN do veículo
        │
        ▼
  Servidor Rust (backend)
  — recebe frames físicos do carro
  — encapsula em frames binários de 20 bytes
  — transmite via WebSocket autenticado
        │  ws://host:8081/ws?token=<JWT>
        ▼
  Web Worker (thread isolada no browser)
  — recebe ArrayBuffer bruto
  — lê can_id, timestamp e raw_data via DataView
  — decodifica sinais usando CAN_MAP (LSB-first, fator, offset)
  — empurra amostras em CircularBuffers por sinal
  — notifica a UI com o valor mais recente
        │  postMessage (Transferable — zero-copy)
        ▼
  Store reativo SolidJS
  — mantém signals[nome] = { value, unit, timestamp }
  — atualiza apenas o nó DOM do sinal que mudou
        │
        ▼
  Componentes de visualização
  — StatusBar: cards de valor instantâneo com estatísticas
  — MotecChart: gráficos uPlot com cursor sincronizado
  — Cockpit: gauges em Canvas, vídeo onboard, mapa de pista
```

### Protocolo binário (frame WebSocket)

| Bytes | Tipo | Conteúdo |
|-------|------|----------|
| 0–3 | `u32` little-endian | `can_id` |
| 4–11 | `f64` little-endian | `timestamp` (Unix epoch, segundos) |
| 12–19 | `u8 × 8` | payload CAN bruto (8 bytes) |

Cada frame tem **exatamente 20 bytes**. A decodificação é determinística e opera via `DataView` diretamente sobre o `ArrayBuffer` transferido pelo WebSocket, sem serialização JSON em nenhum ponto do caminho crítico.

---

## 3. Por que a Stack do Frontend Preserva a Velocidade do Backend

O servidor Rust foi escolhido pela equipe justamente por sua performance: processamento de frames CAN sem overhead de garbage collector e latência de rede mínima. Uma escolha ingênua de frontend desperdiçaria esse investimento. Cada decisão tecnológica no frontend foi tomada com o mesmo critério de não ser o gargalo.

### 3.1 Web Worker — isolamento da thread principal

O WebSocket **não roda na thread principal** do browser. Ele vive em um Web Worker dedicado, em thread separada do sistema operacional.

Isso significa que um pico de render — um gráfico recalculando escala, um gauge redesenhando ponteiro — não atrasa o recebimento de frames do carro. O Worker processa dados a qualquer taxa que o backend entregue, independentemente do que a UI estiver fazendo.

Sem o Worker, a 130 Hz (taxa máxima do stream), um único frame de render lento de 16ms acumularia dezenas de mensagens na fila de eventos e causaria jank visível nos gráficos.

### 3.2 Transferable Objects — zero-copy entre threads

Quando o Worker envia buffers históricos para os gráficos, ele usa **Transferable Objects**:

```js
self.postMessage(
  { type: 'buffer', ts: reduced.ts, val: reduced.val },
  [reduced.ts.buffer, reduced.val.buffer]  // transferência de propriedade
);
```

O `ArrayBuffer` não é copiado. A propriedade do bloco de memória é transferida atomicamente para a thread receptora. Para buffers de 3.900 amostras por sinal, isso evita megabytes de cópia por requisição de gráfico.

### 3.3 SolidJS — reatividade sem reconciliação

React e Vue reconstroem uma árvore virtual a cada mudança e comparam com a anterior para descobrir o que atualizar. A 130 Hz, com dezenas de sinais chegando simultaneamente, esse overhead de reconciliação causa quedas de frame.

SolidJS compila o JSX em atualizações DOM precisas em tempo de build. Quando `signals['act_Speed_A0'].value` muda, **apenas o nó de texto daquele valor é tocado** — sem diff, sem reconciliação global, com custo de CPU equivalente ao Vanilla JS.

### 3.4 uPlot — gráficos em Canvas puro

Bibliotecas como Recharts e Chart.js renderizam séries temporais em SVG, gerando um nó DOM por ponto de dado. Para uma série de 3.900 amostras, isso resulta em milhares de elementos no DOM que o browser precisa gerir a cada atualização.

O uPlot desenha diretamente em Canvas 2D. Uma série completa é um único `<canvas>` — o browser não mantém estado interno por ponto. A diferença de performance para séries densas é de **ordens de grandeza**: o uPlot processa 100k pontos em ~8ms; equivalentes em SVG levam centenas de milissegundos.

### 3.5 LTTB — resolução analítica preservada, volume reduzido

O Worker aplica o algoritmo **Largest-Triangle-Three-Buckets** antes de transferir dados ao gráfico:

```
Buffer circular (3.900 amostras) → LTTB (threshold: 500 pts) → uPlot
```

O LTTB reduz o número de pontos mantendo os que maximizam a área do triângulo formado com os vizinhos — ou seja, preserva **picos, vales e inflexões** da curva. Um engenheiro de corrida vendo um gráfico de RPM após LTTB enxerga exatamente o mesmo comportamento que com os dados brutos, mas o gráfico atualiza em frações de milissegundo em vez de dezenas.

### 3.6 CircularBuffer — memória constante por sinal

Cada sinal CAN tem seu próprio `CircularBuffer` de tamanho fixo (3.900 amostras = ~30 segundos a 130 Hz). Quando o buffer enche, a amostra mais nova sobrescreve a mais antiga — sem alocação dinâmica, sem crescimento de heap, sem pressão de garbage collector durante a sessão.

---

## 4. Decodificação CAN: do Bit ao Valor Físico

O `CAN_MAP` do frontend espelha o DBC do veículo. Cada sinal é descrito por:

| Campo | Descrição |
|-------|-----------|
| `sb` | start_bit (LSB-first) |
| `len` | comprimento em bits |
| `f` | fator (valor_físico = raw × f + o) |
| `o` | offset |
| `u` | unidade exibida na UI |
| `t` | tipo (`int`, `float`, `bool`) |
| `signed` | se o valor raw é com sinal |

Exemplo — Motor A0 (CAN ID `0x18FF01EA`):

```js
{ n: 'act_Speed_A0',    sb: 8,  len: 16, f: 1,     o: -32000, u: 'rpm' }
{ n: 'act_Torque_A0',   sb: 24, len: 16, f: 0.2,   o: -6400,  u: 'Nm'  }
{ n: 'act_Power_A0',    sb: 40, len: 16, f: 0.005, o: -160,   u: 'kW'  }
{ n: 'act_MotorTemperature_A0', sb: 56, len: 8, f: 1, o: -40, u: '°C'  }
```

A função `extractBits` opera em LSB-first, consistente com o decoder do servidor Rust, garantindo que o frontend e o backend leiam o mesmo valor bruto para qualquer posição de bit.

---

## 5. Superfícies de Análise

### 5.1 StatusBar — monitoramento operacional contínuo

Exibe sinais fixos escolhidos pela equipe (temperaturas, tensões, potências, faults). Cada card mostra:

- Valor instantâneo com 2 casas decimais
- Unidade do sinal
- Máximo, mínimo e média acumulados da sessão

Os cards são atualizados pelo SolidJS de forma granular: apenas o nó de texto do valor que mudou é retocado. O card inteiro não re-renderiza.

**Sinais monitorados na StatusBar:**

| Família | Exemplos |
|---------|---------|
| Temperatura de motor | `act_MotorTemperature_A0/B0/A13/B13` |
| Tensão DC bus | `act_DCBusVoltage_M0/M13` |
| Potência DC bus | `act_DCBusPower_M0/M13` |
| Potência por motor | `act_Power_A0/B0/A13/B13` |
| Faults críticos | `Fault_IMD`, `Fault_BMS`, `Fault_BSPD` |
| BMS | `BMS_Over_voltage`, `BMS_Under_voltage`, `BMS_Cell_Overheat` |

### 5.2 SignalSelector — exploração ad hoc

Lista todos os sinais recebidos na sessão, agrupados semanticamente por subsistema (Motores, Inversores, BMS, VCU, IMU, Chassis). Suporta busca por texto. O operador seleciona sinais para compor gráficos customizados durante a análise.

**Subsistemas e padrões de agrupamento:**

| Grupo | Padrão de nome |
|-------|---------------|
| Motores | `act_(Speed\|Torque\|Power\|MotorTemperature)_[AB](0\|13)` |
| Inversores | `act_(DCBus\|Device)_*`, `DeviceState_*` |
| BMS | `BMS_*`, `LV_*` |
| Faults | `Fault_*`, `*_ERROR` |
| VCU | `APS_*`, `VCU_*`, `SAFETY_*` |
| IMU | `ventor_*` |
| Chassis | `susp_*`, `brake_*`, `arref_*`, `fluid_*` |

### 5.3 MotecChart — análise temporal sincronizada

Gráficos uPlot com cursor sincronizado entre múltiplas instâncias. O cursor cruzado aparece simultaneamente em todos os gráficos ao passar o mouse sobre qualquer um deles — funcionalidade idêntica ao software MoTeC i2 usado em equipes profissionais de motorsport.

Janela temporal configurável: 10s, 30s, 60s ou 5min. O eixo X pode operar em tempo absoluto (HH:MM:SS) ou tempo relativo ao boot da coleta (MM:SS.mmm).

Domínio do eixo Y:

| Família de sinal | Domínio fixo |
|-----------------|-------------|
| RPM | 0 – 10.000 rpm |
| Aceleração | -15 – 15 m/s² |
| Temperatura | 0 – 120 °C |
| Tensão | 0 – 500 V |
| Potência | -100 – 100 kW |
| Demais sinais | Dinâmico com margem de 10% |

### 5.4 HistoryReferenceChart — análise de sessão encerrada

Quando o operador encerra a coleta, os buffers locais são congelados e um gráfico de histórico relativo é apresentado. O eixo X mostra tempo relativo ao primeiro frame válido da sessão (`00:00.000 = boot`).

Funcionalidades:

- **Gráfico de referência por RPM**: plota `act_Speed_A0/B0/A13/B13` como canal de referência temporal
- **Cursor de instante**: ao passar o cursor, exibe o valor de cada sinal selecionado no instante mais próximo, com delta de tempo em relação ao boot
- **Seleção de janela**: o operador arrasta um intervalo no gráfico; o sistema calcula min, média e max de cada sinal na janela
- **Gráfico de detalhe**: plota os sinais selecionados recortados na janela arrastada, com eixos Y independentes por sinal

---

## 6. Superfície de Cockpit

Tela operacional em tempo real, organizada em três colunas:

```
┌──────────────┬─────────────────────────────┬──────────────┐
│  Gauges (par)│     Vídeo onboard           │  Gauges (ímpar)│
│              ├─────────────────────────────┤              │
│  RPM A0      │     Mapa de pista           │  RPM B0      │
│  RPM B0      │     (posição do veículo)    │  Acelerador  │
└──────────────┴─────────────────────────────┴──────────────┘
```

Os gauges são desenhados em Canvas 2D com duas camadas:

- **Camada estática**: arco de fundo, ticks, labels — desenhada uma vez no mount
- **Camada dinâmica**: ponteiro, valor central, cor de alerta — redesenhada via `requestAnimationFrame` somente quando o valor muda

Isso elimina redraw desnecessário: se o RPM não mudou entre dois frames de 60Hz, o Canvas não é tocado.

**Configuração dos gauges (dashboardConfig.js):**

| Sinal | Label | Min | Max | Alerta | Crítico |
|-------|-------|-----|-----|--------|---------|
| `act_Speed_A0` | RPM A0 | 0 | 10.000 | 8.500 | 9.500 |
| `act_Speed_B0` | RPM B0 | 0 | 10.000 | 8.500 | 9.500 |
| `APS_PERC` | Acelerador | 0 | 100% | — | — |

---

## 7. Gestão de Sessão

### Estados da coleta

| Estado | Descrição | Superfície ativa |
|--------|-----------|-----------------|
| `idle` | Autenticado, WebSocket conectado, sem coleta | Nenhum gráfico |
| `live` | Coleta ativa; dados chegando em tempo real | Gráficos ao vivo, Cockpit |
| `stopped` | Coleta encerrada; buffers congelados | HistoryReferenceChart |

### Fluxo de autenticação

1. Operador entra com credenciais em `POST /login`
2. Backend retorna token JWT
3. Frontend conecta o WebSocket com `?token=<JWT>`
4. Worker valida a conexão e inicia recebimento de frames
5. Ao clicar em "Iniciar coleta", o Worker começa a gravar amostras nos buffers
6. Ao clicar em "Encerrar coleta", os buffers são congelados e o modo de análise histórica é ativado

A sessão WebSocket permanece aberta durante toda a operação — encerrar a coleta não fecha a conexão, permitindo iniciar nova coleta sem novo login.

---

## 8. Resumo das Decisões de Performance

| Problema | Solução adotada | Alternativa descartada |
|----------|-----------------|----------------------|
| WebSocket bloqueando a UI | Web Worker em thread separada | WebSocket na thread principal |
| Cópia de memória entre threads | Transferable Objects (zero-copy) | `JSON.stringify` / `postMessage` com cópia |
| Re-render global a cada frame | SolidJS com reatividade granular | React (reconciliação virtual DOM) |
| Gráfico lento com muitos pontos | uPlot (Canvas) + LTTB | Recharts/Chart.js (SVG) |
| Crescimento de memória por sinal | CircularBuffer de tamanho fixo | Array com `push()` ilimitado |
| Redraw desnecessário de gauge | Canvas em duas camadas + rAF | Re-render de componente por tick |
| Serialização no caminho crítico | Frames binários (DataView) | JSON sobre WebSocket |

---

## 9. Capacidades Técnicas Demonstradas

- Recepção e decodificação de stream CAN binário a até **130 Hz** sem perda de frames
- Manutenção de **histórico de ~30 segundos** por sinal em memória constante
- Visualização de **múltiplos sinais sincronizados** com cursor cruzado entre gráficos
- Análise de janela com **estatísticas em tempo real** (min, média, max, n amostras)
- **Tempo relativo de sessão** com resolução de milissegundos
- Operação **offline do WebSocket** durante análise histórica (buffers locais)
- Interface responsiva que opera em **laptops à beira de pista**, sem dependência de cloud

---

*Unicamp E-Racing — Telemetria V2.0 · Frontend SolidJS + Web Worker + uPlot*