# Dashboard E-Racing Telemetria — Planejamento Técnico

**Versão:** 1.0  
**Data:** Maio 2025  
**Status:** Em planejamento

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

| Camada | Tecnologia |
|--------|-----------|
| Framework | React 18 + Vite |
| Runtime | Node.js 20+ |
| Gráficos | Recharts ou uPlot (decidir conforme performance) |
| WebSocket | API nativa do browser (`WebSocket`) |
| Estilização | Tailwind CSS + CSS Variables |
| Estado global | Zustand (leve, sem boilerplate) |
| Roteamento | React Router v6 |

---

## 3. Contrato com o Backend (WebSocket)

O frontend **não altera** o servidor Rust existente. O time de backend precisa saber apenas o seguinte sobre como os dados serão usados.

### 3.1 URL de Conexão

```
ws://<servidor>:8081/ws?token=<JWT>
```

O token JWT é obtido via `POST /login` com `{ username, password }` e tem validade de 8 horas.

### 3.2 Formato de Mensagem Esperado (por frame WebSocket)

Cada mensagem é um JSON com um único sinal:

```json
{
  "timestamp": 1716300000.123,
  "device_id": "car_192_168_1_10",
  "can_id": 415006592,
  "signal_name": "act_Speed_A0",
  "value": 3200.0,
  "unit": "rpm"
}
```

| Campo | Tipo | Uso no Frontend |
|-------|------|-----------------|
| `timestamp` | `float` (Unix epoch, segundos) | Eixo X dos gráficos; timestamp de última leitura |
| `device_id` | `string` | Filtro por dispositivo (futuro multi-carro) |
| `can_id` | `uint32` | Agrupamento por subsistema (BMS, VCU, IMU…) |
| `signal_name` | `string` | Chave primária para identificar o parâmetro |
| `value` | `float` | Valor a plotar / exibir na status bar |
| `unit` | `string` | Exibido ao lado do valor (rpm, V, °C, m/s², %) |

### 3.3 Comportamento de Reconexão

O frontend reconecta automaticamente em até 3 segundos em caso de queda. Não há estado no servidor por conexão — cada reconexão recebe apenas frames novos.

### 3.4 O que o Backend NÃO precisa implementar (por ora)

- Snapshots iniciais ou histórico ao conectar — o dashboard mostra dados a partir da conexão
- Agrupamento por subsistema — o frontend faz isso via `signal_name`
- Throttling — o frontend aceita qualquer taxa e descarta frames antigos da janela de visualização

---

## 4. Fase 1 — Aba "Análise" (MoTeC-style)

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TOPBAR: Logo | Status WS | Taxa msg/s | Última atualização │
├─────────────────────────────────────────────────────────────┤
│  TABS: [ Análise ] [ Mapa & Cockpit (em breve) ]            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  STATUS BAR (parâmetros pinados)                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ PARAM 1  │ │ PARAM 2  │ │ PARAM 3  │ │ PARAM N  │      │
│  │ 3200 rpm │ │ 87.2 °C  │ │ 4.12 V   │ │  ...     │      │
│  │ max/min  │ │ max/min  │ │ max/min  │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ÁREA DE GRÁFICOS (grid configurável)                       │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │  Gráfico A           │  │  Gráfico B           │        │
│  │  (sinal vs tempo)    │  │  (sinal vs sinal)    │        │
│  └──────────────────────┘  └──────────────────────┘        │
│  ┌──────────────────────────────────────────────────┐      │
│  │  Gráfico C (largura total, ex: velocidade)       │      │
│  └──────────────────────────────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Componentes

#### `StatusBar`
- Cards para cada parâmetro "pinado"
- Cada card exibe: valor atual, unidade, máximo histórico (sessão), mínimo histórico, média (janela deslizante de N amostras)
- Cor do card muda conforme limites configuráveis (verde → amarelo → vermelho)
- Lista de parâmetros pinados: **a ser definida pelo time** — o sistema suporta qualquer `signal_name` recebido via WS

#### `ChartGrid`
- Grid responsivo de 1, 2 ou 3 colunas
- Cada célula é um `ChartPanel` independente
- O engenheiro pode selecionar qual sinal vai em cada painel via dropdown
- Suporta múltiplos sinais no mesmo gráfico (eixo Y duplo opcional)

#### `ChartPanel`
- Janela temporal configurável: últimos 10s / 30s / 60s / 5min
- Eixo X: tempo relativo (segundos atrás)
- Eixo Y: automático com margem de 10%, ou com limites fixos vindos do CSV CAN
- Legenda inline (clique para mostrar/ocultar sinal)
- Linha de referência horizontal (limite crítico) — configurável

#### `SignalSelector`
- Dropdown que lista todos os `signal_name` recebidos na sessão
- Organizado por subsistema inferido do prefixo do nome (`act_Speed_A0` → VCU / Motor)
- Busca por texto

### 4.3 Gerenciamento de Dados em Tempo Real

```
WebSocket frame
      │
      ▼
 signalStore (Zustand)
      │
      ├── ringBuffer[signal_name] → últimas N amostras (ex: 3000 pontos)
      │   usado pelos ChartPanels
      │
      └── latestValues[signal_name] → { value, timestamp, min, max, sum, count }
          usado pela StatusBar
```

- **Ring buffer por sinal:** descarta amostras mais antigas quando cheio — sem crescimento de memória
- **Subscrição granular:** cada componente subscreve apenas os sinais que renderiza
- **Throttle de render:** gráficos re-renderizam no máximo a 10 Hz via `requestAnimationFrame`

### 4.4 Configuração de Parâmetros (a definir pelo time)

Os parâmetros da StatusBar e os layouts de gráfico padrão serão definidos num arquivo de configuração:

```js
// src/config/dashboardConfig.js  (a ser preenchido)
export const PINNED_SIGNALS = [
  // { signalName: 'act_Speed_A0', label: 'RPM Motor A', warnMin: null, warnMax: 10000, critMax: 12000 },
  // ...
];

export const DEFAULT_CHART_LAYOUT = [
  // { signals: ['act_Speed_A0', 'act_Speed_B0'], label: 'Velocidade Motores' },
  // ...
];
```

**A lista de sinais prioritários será definida pelo time de engenharia após análise dos CSVs CAN.**

---

## 5. Fase 2 — Aba "Mapa & Cockpit" (implementação futura)

> Esta aba está planejada mas **não será implementada na Fase 1**. Documentada aqui para alinhar dependências de backend.

### 5.1 Subcomponentes planejados

| Componente | Descrição | Dependência de backend |
|-----------|-----------|----------------------|
| **TrackMap** | SVG/Canvas da pista com posição do carro em tempo real | Precisa de `lat/lon` ou coordenadas locais via IMU integrada |
| **LiveCamera** | Stream de vídeo ao vivo (MJPEG ou WebRTC) | Endpoint de vídeo separado do WS de telemetria |
| **RPM Gauge** | Tacômetro analógico estilo cockpit | `act_Speed_*` já disponível no WS |
| **SpeedDisplay** | Velocidade em km/h grande em destaque | `ventor_linear_speed_x` do IMU já disponível no WS |
| **GForceVector** | Vetor de aceleração G em 2D | `ventor_linear_acc_*` já disponível no WS |

### 5.2 Requisitos adicionais para o backend (Fase 2)

- Endpoint de vídeo (a definir: MJPEG stream ou WebRTC signaling)
- Integração de GPS ou estimativa de posição por odometria para o mapa de trajetória
- Possível endpoint REST para buscar o SVG/imagem da pista configurada

---

## 6. Estrutura de Pastas do Projeto

```
telemetry-dashboard/
├── public/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TopBar.jsx
│   │   │   └── TabNav.jsx
│   │   ├── analysis/
│   │   │   ├── StatusBar.jsx
│   │   │   ├── StatusCard.jsx
│   │   │   ├── ChartGrid.jsx
│   │   │   ├── ChartPanel.jsx
│   │   │   └── SignalSelector.jsx
│   │   └── cockpit/           ← Fase 2 (stubs apenas)
│   │       ├── TrackMap.jsx
│   │       ├── LiveCamera.jsx
│   │       └── Gauges.jsx
│   ├── store/
│   │   └── signalStore.js     ← Zustand: ring buffers + latest values
│   ├── hooks/
│   │   ├── useWebSocket.js    ← Gerenciamento de conexão + reconexão
│   │   └── useSignalHistory.js
│   ├── config/
│   │   └── dashboardConfig.js ← Parâmetros pinados + layouts padrão (A DEFINIR)
│   ├── utils/
│   │   ├── ringBuffer.js
│   │   └── signalGrouping.js  ← Inferência de subsistema por prefixo
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   └── DashboardPage.jsx
│   ├── App.jsx
│   └── main.jsx
├── package.json
└── vite.config.js
```

---

## 7. Próximos Passos

### Time Frontend

1. Bootstrapar o projeto com `npm create vite@latest telemetry-dashboard -- --template react`
2. Implementar `useWebSocket.js` e `signalStore.js` com ring buffer
3. Implementar `StatusBar` com cards genéricos (parâmetros configuráveis via `dashboardConfig.js`)
4. Implementar `ChartPanel` com janela temporal configurável
5. Implementar `ChartGrid` com layout de 2 colunas padrão
6. **Aguardar definição do time de engenharia** para preencher `dashboardConfig.js`

### Time de Engenharia (dependência para Fase 1)

- Definir lista de sinais prioritários para a `StatusBar` (nome, unidade, limites de alerta)
- Definir layouts de gráficos padrão para os 2-3 painéis principais
- Definir janela temporal padrão desejada (últimos 30s? 60s?)

### Time Backend

- Confirmar que o contrato de mensagem WS descrito na Seção 3 reflete o que será enviado
- Confirmar porta e autenticação (JWT via query param `?token=` está documentado no `main.rs` e é o mecanismo suportado pelo browser)

---

## 8. Observações Técnicas

- **Performance:** Gráficos com alta taxa de dados (>100 frames/s) podem exigir migração de Recharts para `uPlot` (Canvas nativo). Validar na integração.
- **Multi-carro:** A arquitetura com `device_id` no store já permite filtrar por carro. A UI de seleção de dispositivo não está planejada para Fase 1 mas a estrutura suporta.
- **Offline/histórico:** Não está no escopo. O dashboard exibe apenas dados da sessão atual (desde a conexão WS).
- **Segurança:** O token JWT expira em 8h. O frontend detecta expiração localmente (decodificando o payload sem verificar assinatura) e redireciona para login antes de tentar reconectar com token inválido.