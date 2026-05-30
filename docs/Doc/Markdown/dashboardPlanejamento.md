# Dashboard E-Racing Telemetria — Planejamento Técnico

**Versão:** 2.0  
**Data:** Maio 2025  
**Status:** Em desenvolvimento

---

## 1. Visão Geral

Dashboard web de telemetria em tempo real para a equipe E-Racing, consumindo dados via WebSocket do servidor Rust existente (`telemetry-server`). O frontend é independente do backend — o time de backend expõe os dados e o frontend os consome e visualiza.

A aplicação terá duas abas principais:

| Aba | Status | Descrição |
|-----|--------|-----------|
| **Análise (MoTeC-style)** | Fase 1 — implementar agora | Gráficos cruzados + status bar de parâmetros |
| **Mapa & Cockpit** | Fase 2 — implementação futura | Trajetória em tempo real, câmera, RPM, velocidade |

---

## 2. Stack Técnica

A arquitetura foi redesenhada para eliminar os três gargalos de telemetria web (rede, processamento e renderização), suportando até 130Hz de forma estável.

| Camada | Tecnologia | Motivo |
|--------|-----------|--------|
| Framework UI | SolidJS | Reatividade granular — atualiza apenas o nó DOM do sinal que mudou, sem reconciliação global |
| Build | Vite + pnpm | Vite: ESM nativo, hot-reload, bundle de Worker. pnpm: instalação rápida via hard links, economia de disco e lockfile determinístico |
| WebSocket | Web Worker isolado | Mantém a conexão fora da thread principal — sem jank de render |
| Comunicação Worker → UI | SharedArrayBuffer / Transferable Objects | Zero-copy — sem serialização entre threads |
| Buffer de dados | Circular Buffer (tamanho fixo por sinal) | Sem crescimento de memória; sobrescreve amostras antigas |
| Gráficos | uPlot | Canvas 2D puro — ordens de grandeza mais rápido que SVG para séries temporais densas |
| Gauges / Cockpit | Canvas API via componente SolidJS | Redesenho do ponteiro por frame, throttle a 60fps via `requestAnimationFrame` |
| Estado global | Sinais do SolidJS (`createSignal` / `createStore`) | Substitui Zustand — alinhado ao runtime do framework |
| Decodificação binária | `DataView` / buffer parsing no Worker | Dados chegam em formato binário (Protobuf/FlatBuffers) — decodificação acontece fora da thread principal |
| Downsampling | LTTB (Largest-Triangle-Three-Buckets) no Worker | Reduz pontos enviados ao gráfico sem perder a forma da curva |
| Estilização | CSS Variables | Compatível com o tema escuro já definido |

---

## 3. Contrato com o Backend (WebSocket)

O frontend **não altera** o servidor Rust existente. O time de backend precisa saber apenas o seguinte sobre como os dados serão usados.

### 3.1 URL de Conexão

```
ws://<servidor>:8081/ws?token=<JWT>
```

O token JWT é obtido via `POST /login` com `{ username, password }` e tem validade de 8 horas.

### 3.2 Formato de Mensagem (binário por frame WebSocket)

Os dados chegam em formato binário (Protobuf/FlatBuffers). A decodificação é responsabilidade do `worker.js`, que expõe os campos abaixo para o restante do frontend:

| Campo | Tipo | Uso no Frontend |
|-------|------|-----------------|
| `timestamp` | `f64` (Unix epoch, segundos) | Eixo X dos gráficos; timestamp de última leitura |
| `device_id` | `string` | Filtro por dispositivo (futuro multi-carro) |
| `can_id` | `u32` | Agrupamento por subsistema (BMS, VCU, IMU…) |
| `signal_name` | `string` | Chave primária para identificar o parâmetro |
| `value` | `f64` | Valor a plotar / exibir na status bar |
| `unit` | `string` | Exibido ao lado do valor (rpm, V, °C, m/s², %) |

### 3.3 Comportamento de Reconexão

O Worker reconecta automaticamente em até 3 segundos em caso de queda. Não há estado no servidor por conexão — cada reconexão recebe apenas frames novos.

### 3.4 O que o Backend NÃO precisa implementar (por ora)

- Snapshots iniciais ou histórico ao conectar
- Agrupamento por subsistema (feito no frontend via `signal_name`)
- Throttling de taxa (o Worker aplica LTTB antes de enviar à UI)

---

## 4. Arquitetura de Dados em Tempo Real

```
Servidor Rust (binário — Protobuf/FlatBuffers)
      │
      │  WebSocket
      ▼
 worker.js  ──────────────────────────────────────────────────
  │  Recebe frames binários, decodifica via DataView         │ Thread do Worker
  │  Aplica LTTB, mantém CircularBuffer[signal_name]         │
  │  Mantém latestValues[signal_name] → { value, unit, ts }  │
  └──── SharedArrayBuffer / postMessage(Transferable) ────────
      │
      ▼
 store.js (SolidJS createStore)
  │  Expõe sinais reativos para cada signal_name
  └──── Componentes subscrevem apenas o que renderizam
      │
      ▼
 App.jsx → StatusBar / MotecChart / Gauge
```

**Regras do buffer:**
- Tamanho fixo por sinal (ex: 3.000 pontos = ~23s a 130Hz)
- Worker aplica LTTB antes de transferir para o gráfico (ex: reduz para 500 pontos para visualização de volta completa)
- `requestAnimationFrame` limita updates de Canvas a 60fps — dados a 130Hz são amostrados, não descartados

---

## 5. Fase 1 — Aba "Análise" (MoTeC-style)

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TOPBAR: Logo | Status WS | Taxa msg/s | Latência | Alertas │
├─────────────────────────────────────────────────────────────┤
│  TABS: [ Análise ] [ Dashboard / Cockpit (em breve) ]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  STATUS BAR (parâmetros pinados)                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ PARAM 1  │ │ PARAM 2  │ │ PARAM 3  │ │ PARAM N  │      │
│  │ 3200 rpm │ │ 87.2 °C  │ │ 4.12 V   │ │  ...     │      │
│  │ max/min  │ │ max/min  │ │ max/min  │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ÁREA DE GRÁFICOS uPlot (grid configurável)                 │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │  Gráfico A           │  │  Gráfico B           │        │
│  │  Canvas — sinal×tempo│  │  Canvas — sinal×sinal│        │
│  └──────────────────────┘  └──────────────────────┘        │
│  ┌──────────────────────────────────────────────────┐      │
│  │  Gráfico C (largura total — cursor sincronizado) │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Componentes

#### `StatusBar.jsx`
- Cards para cada parâmetro "pinado"
- Cada card: valor atual, unidade, máximo/mínimo da sessão, média (janela deslizante)
- Cor do card via CSS variable: verde → amarelo → vermelho conforme limites configuráveis
- SolidJS atualiza **apenas o nó de texto** do sinal que mudou — sem re-render do card inteiro

#### `MotecChart.jsx`
- Wrapper do uPlot com cursor sincronizado entre instâncias (`cursor.sync`)
- Instâncias separadas por grupo de sinais (Velocidade, RPM, Suspensão, etc.)
- Janela temporal configurável: últimos 10s / 30s / 60s / 5min
- Eixo Y automático com margem de 10%, ou com limites fixos vindos do CSV CAN
- O Worker aplica LTTB antes de enviar dados ao gráfico para visualização de longo prazo

#### `Gauge.jsx`
- Componente Canvas para tacômetros e velocímetros estilo cockpit
- Camada estática: imagem de fundo (carro/escala) carregada uma vez
- Camada dinâmica: ponteiro redesenhado via `clearRect` + `drawImage` a cada frame
- Throttle obrigatório via `requestAnimationFrame` — máximo 60fps independente da taxa de entrada

#### `SignalSelector`
- Lista todos os `signal_name` recebidos na sessão
- Organizado por subsistema inferido do prefixo (`act_Speed_A0` → VCU / Motor)
- Busca por texto

### 5.3 Configuração de Parâmetros (a definir pelo time)

```js
// src/config/dashboardConfig.js  (a ser preenchido pelo time de engenharia)
export const PINNED_SIGNALS = [
  // { signalName: 'act_Speed_A0', label: 'RPM Motor A', warnMax: 10000, critMax: 12000 },
  // { signalName: 'act_MotorTemperature_A0', label: 'Temp Motor A', warnMax: 80, critMax: 100 },
];

export const DEFAULT_CHART_LAYOUT = [
  // { signals: ['act_Speed_A0', 'act_Speed_B0'], label: 'Velocidade Motores' },
];
```

---

## 6. Fase 2 — Aba "Dashboard / Cockpit" (implementação futura)

| Componente | Descrição | Dependência de backend |
|-----------|-----------|----------------------|
| **TrackMap** | Canvas com posição do carro em tempo real | `lat/lon` ou odometria via IMU |
| **LiveCamera** | Stream de vídeo ao vivo (MJPEG ou WebRTC) | Endpoint de vídeo separado do WS |
| **RPM Gauge** | Tacômetro Canvas estilo cockpit | `act_Speed_*` já disponível |
| **SpeedDisplay** | Velocidade em destaque | `ventor_linear_speed_x` já disponível |
| **GForceVector** | Vetor de aceleração 2D | `ventor_linear_acc_*` já disponível |

---

## 7. Estrutura de Arquivos

```
telemetry-dashboard/
├── public/
├── src/
│   ├── worker.js               ← WebSocket client + decodificação + CircularBuffer + LTTB
│   ├── store.js                ← SolidJS createStore: sinais reativos globais
│   ├── App.jsx                 ← Estrutura principal, Tabs, StatusBar
│   ├── components/
│   │   ├── StatusBar.jsx       ← Cards de parâmetros pinados
│   │   ├── MotecChart.jsx      ← Wrapper uPlot com cursor.sync
│   │   ├── Gauge.jsx           ← Canvas gauge (RPM, Velocidade)
│   │   └── cockpit/            ← Fase 2 (stubs)
│   │       ├── TrackMap.jsx
│   │       └── LiveCamera.jsx
│   ├── config/
│   │   └── dashboardConfig.js  ← Sinais pinados + layouts padrão (A DEFINIR)
│   └── utils/
│       ├── circularBuffer.js
│       ├── lttb.js             ← Algoritmo Largest-Triangle-Three-Buckets
│       └── signalGrouping.js   ← Inferência de subsistema por prefixo
├── package.json
└── vite.config.js
```

---

## 8. Próximos Passos

### Time Frontend

1. Bootstrapar o projeto: `pnpm create vite telemetry-dashboard -- --template` com SolidJS
2. Implementar `worker.js`: WebSocket + decodificação binária + CircularBuffer + postMessage com Transferable
3. Implementar `store.js` com `createStore` do SolidJS
4. Implementar `StatusBar.jsx` com atualização granular por sinal
5. Implementar `MotecChart.jsx` com uPlot e cursor.sync
6. Implementar `Gauge.jsx` com Canvas + rAF throttle
7. Aguardar definição do time de engenharia para preencher `dashboardConfig.js`

### Time de Engenharia (dependência para Fase 1)

- Definir lista de sinais prioritários para a StatusBar (nome, unidade, limites de alerta)
- Definir layouts de gráficos padrão
- Definir janela temporal padrão desejada

### Time Backend

- Confirmar que o schema binário (Protobuf/FlatBuffers) da Seção 3 reflete o que é enviado
- Endpoint de vídeo para a Fase 2 (MJPEG ou WebRTC signaling)

---

## 9. Observações Técnicas

- **Por que SolidJS em vez de React:** a 130Hz, o custo de reconciliação do React causa quedas de frame (stuttering). O SolidJS tem impacto na CPU equivalente ao Vanilla JS, com o código organizado em componentes.
- **Por que uPlot em vez de Recharts:** o uPlot desenha diretamente em Canvas, evitando a manipulação de milhares de nós SVG. Para séries temporais densas, a diferença de performance é de ordens de grandeza.
- **Por que Web Worker:** isola a conexão WebSocket da thread principal. Se o navegador processar um layout pesado, o recebimento de dados não é afetado.
- **Multi-carro:** a arquitetura com `device_id` no store já suporta filtrar por carro. A UI de seleção não está na Fase 1.
- **Segurança:** o token JWT expira em 8h. O frontend detecta expiração localmente e redireciona para login antes de reconectar com token inválido.
- **`requestAnimationFrame` como throttle:** tentar atualizar gauges a 130Hz é desperdício — o monitor opera a 60Hz (ou 120Hz no máximo). O rAF garante que o Canvas só redesenha quando o monitor está pronto para exibir.