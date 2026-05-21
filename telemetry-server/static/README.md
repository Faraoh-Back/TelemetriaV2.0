# Telemetria Frontend

Frontend da interface de telemetria em SolidJS, com:

- autenticacao simples;
- stream WebSocket binario;
- decodificacao CAN em Web Worker;
- graficos de analise com uPlot;
- cockpit com gauges em canvas.

## Scripts

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

## Documentacao

- [Implementacao do frontend](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/frontend-implementation.md)
- [Decisoes pendentes de telemetria](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/frontend-telemetry-decisions.md)
- [Guia de integracao do backend](/Users/joaogabriel/Documents/TelemetriaV2.0/telemetry-server/static/docs/backend-integration-guide.md)

## Estrutura principal

- `src/App.jsx`: orquestracao da sessao e das telas
- `src/store.js`: store reativo + ponte com o worker
- `src/workers/worker.js`: WebSocket, buffers e decodificacao CAN
- `src/components/MotecChart/*`: graficos
- `src/components/Gauge/*`: gauges
- `src/components/Cockpit/*`: cockpit
- `src/components/StatusBar/*`: cards e estatisticas
- `src/components/SignalSelector/*`: busca e selecao de sinais

## Observacao

O `CAN_MAP` ainda esta definido no frontend. Se o backend alterar contrato de
decodificacao, o frontend precisara ser atualizado junto.
