# Implementacao do frontend

Este documento descreve como o frontend de telemetria esta implementado hoje,
quais sao seus modulos principais e onde alterar cada tipo de comportamento.

## 1. Stack

- SolidJS para UI reativa
- Vite para build e dev server
- Web Worker para ingestao e preparo da telemetria
- uPlot para os graficos
- Canvas 2D para os gauges do cockpit

## 2. Estrutura geral

Entradas principais:

- [src/index.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/index.jsx)
- [src/App.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/App.jsx)

Areas principais da aplicacao:

1. autenticacao e sessao
2. store reativo + worker
3. superficie de analise
4. superficie de cockpit

## 3. Fluxo de dados

O fluxo principal hoje e este:

1. usuario faz login;
2. frontend recebe token;
3. `store.js` abre WebSocket autenticado;
4. `worker.js` recebe frames binarios CAN;
5. worker decodifica sinais e popula buffers;
6. worker envia ultimo valor de cada sinal para a UI;
7. componentes reativos atualizam cards, gauges, selector e graficos.

Resumo visual:

```text
Login -> token -> WebSocket -> worker -> store reativo -> componentes
```

## 4. Modulos principais

### 4.1 App e navegacao

Arquivo:

- [App.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/App.jsx)

Responsabilidades:

- restaurar sessao;
- login/logout;
- alternar abas `analise` e `cockpit`;
- manter `selectedSignals`;
- manter `windowSeconds`.

O `App` funciona como orquestrador de alto nivel. A logica especifica fica
delegada aos componentes e utils especializados.

### 4.2 Store e worker

Arquivos:

- [store.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/store.js)
- [worker.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/workers/worker.js)

Responsabilidades do `store.js`:

- manter `signals` e `status`;
- conectar/desconectar do worker;
- expor `requestBuffer()` para os graficos;
- expor `requestLatest()` para snapshots.

Responsabilidades do `worker.js`:

- abrir WebSocket;
- receber frames binarios;
- decodificar sinais CAN;
- manter buffers circulares;
- responder requests de historico.

Arquivos de apoio:

- [circularBuffer.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/circularBuffer.js)
- [lttb.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/lttb.js)
- [canDecode.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/canDecode.js)

### 4.3 Configuracao

Arquivos:

- [serverConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/serverConfig.js)
- [dashboardConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/dashboardConfig.js)
- [brandConfig.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/config/brandConfig.js)

Uso:

- `serverConfig.js`: origem HTTP/WS
- `dashboardConfig.js`: sinais fixos, gauges, layouts default
- `brandConfig.js`: logo e identidade basica da equipe

### 4.4 Superficie de analise

Componentes:

- [StatusBar.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/StatusBar/StatusBar.jsx)
- [SignalSelector.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/SignalSelector/SignalSelector.jsx)
- [TimeWindowControl.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/TimeWindowControl/TimeWindowControl.jsx)
- [MotecChart.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/MotecChart/MotecChart.jsx)

#### StatusBar

Mostra sinais fixos e estatisticas simples.

Arquivos de apoio:

- [SignalCard.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/StatusBar/SignalCard.jsx)
- [useSignalStats.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/StatusBar/useSignalStats.js)

#### SignalSelector

Lista sinais recebidos, permite busca, agrupamento e selecao para grafico
customizado.

Arquivo de apoio:

- [signalGrouping.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/signalGrouping.js)

#### MotecChart

Orquestra o uPlot.

Arquivos de apoio:

- [useChartData.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/MotecChart/useChartData.js)
- [chartOptions.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/MotecChart/chartOptions.js)
- [chartHelpers.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/chartHelpers.js)
- [telemetryUtils.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/utils/telemetryUtils.js)

## 5. Superficie de cockpit

Componentes:

- [Cockpit.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/Cockpit.jsx)
- [CockpitGauge.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/CockpitGauge.jsx)
- [RaceVideoPanel.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/RaceVideoPanel.jsx)
- [TrackMapPanel.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Cockpit/TrackMapPanel.jsx)

O cockpit hoje ja entrega:

- gauges operacionais;
- painel de onboard;
- painel de mapa.

Os dois ultimos ainda dependem de dados/feeds reais do backend.

## 6. Sistema de gauges

Arquivos:

- [Gauge.jsx](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Gauge/Gauge.jsx)
- [gaugeCanvas.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Gauge/gaugeCanvas.js)
- [gaugeUtils.js](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/components/Gauge/gaugeUtils.js)

Separacao atual:

- `Gauge.jsx`: lifecycle e leitura reativa do sinal
- `gaugeCanvas.js`: desenho do gauge
- `gaugeUtils.js`: geometria, formatacao e regras puras

Essa divisao esta boa e ja evita acoplamento desnecessario entre UI e canvas.

## 7. Estilo

Arquivos:

- [index.css](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/index.css)
- [components.css](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/src/styles/components.css)

Regra atual:

- tokens globais em `index.css`;
- estilos compartilhados em `components.css`;
- estilos especificos ao lado dos componentes.

## 8. O que ainda vale modularizar?

No estado atual, eu nao vejo uma modularizacao obrigatoria pendente. A maioria
das responsabilidades ja esta em fronteiras razoaveis.

Os candidatos possiveis seriam:

1. extrair o `CAN_MAP` do worker para um modulo proprio;
2. extrair configuracoes de dominio/limites para um modulo semantico separado;
3. criar uma camada de "view models" para selector, status bar e cockpit.

### Avaliacao

#### 8.1 Extrair `CAN_MAP`

Pode fazer sentido quando:

- backend e frontend passarem a compartilhar uma fonte unica de verdade;
- o mapa crescer muito;
- o time quiser testar a decodificacao isoladamente.

Hoje isso e uma modularizacao razoavel, mas nao urgente.

#### 8.2 Extrair limites semanticos

Pode fazer sentido se:

- o numero de familias de sinais crescer;
- houver muito ajuste fino de faixa operacional.

Hoje `dashboardConfig.js` + `telemetryUtils.js` ainda dao conta bem.

#### 8.3 Criar camada adicional de view model

Hoje isso seria over-engineering.

Os componentes ja sao relativamente focados, e inserir mais uma camada agora
provavelmente aumentaria atrito sem ganho claro.

## 9. Veredito sobre modularizacao

Minha leitura e:

- ha espaco para extrair `CAN_MAP` no futuro;
- ha espaco para consolidar limites semanticos se a matriz de sinais crescer;
- qualquer modularizacao alem disso, agora, tende a ser over-engineering.

Ou seja: o front esta num ponto bom de estrutura. O valor maior agora esta em
integrar com dados reais e estabilizar contrato com o backend, nao em abrir mais
camadas.

## 10. Como rodar

Instalacao:

```bash
pnpm install
```

Desenvolvimento:

```bash
pnpm dev
```

Mock backend:

```bash
pnpm mock:backend
```

Build:

```bash
pnpm build
```

## 11. Documentos relacionados

- [frontend-telemetry-decisions.md](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/frontend-telemetry-decisions.md)
- [backend-integration-guide.md](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/backend-integration-guide.md)
