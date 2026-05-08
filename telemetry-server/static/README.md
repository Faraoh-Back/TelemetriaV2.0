## Usage

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Available Scripts

In the project directory, you can run:

### `npm run dev`

Runs the app in the development mode.<br>
Open [http://localhost:5173](http://localhost:5173) to view it in the browser.

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## Deployment

Learn more about deploying your application with the [documentations](https://vite.dev/guide/static-deploy.html)


src/
├── index.css                    # vars globais + reset (já existe)
├── index.jsx
├── App.jsx
│
├── styles/
│   ├── components.css           # já existe — manter, expandir
│   └── gauge.css                # novo
│
├── config/
│   └── dashboardConfig.js       # já existe
│
├── store.js                     # já existe
│
├── utils/
│   ├── circularBuffer.js        # extrair de worker.js (reutilizável em testes)
│   ├── lttb.js                  # extrair de worker.js
│   ├── canDecode.js             # extractBits + decodeSignal
│   ├── signalGrouping.js        # placeholder (Fase 1 próxima etapa)
│   └── chartHelpers.js          # mergeBuffers (extraído de MotecChart)
│
├── workers/
│   └── worker.js                # mantém CAN_MAP + orquestra utils acima
│                                # (importa via bundler ou copia — ver nota)
│
└── components/
    ├── TopBar/
    │   ├── TopBar.jsx
    │   └── TopBar.css           # ou manter em components.css
    │
    ├── TabBar/
    │   ├── TabBar.jsx
    │   └── TabBar.css
    │
    ├── StatusBar/
    │   ├── StatusBar.jsx        # render only — For + SignalCard
    │   ├── SignalCard.jsx       # card isolado
    │   ├── useSignalStats.js    # hook: acumula max/min/avg
    │   └── StatusBar.css
    │
    ├── MotecChart/
    │   ├── MotecChart.jsx       # render + lifecycle
    │   ├── useChartData.js      # hook: requestBuffer + flushChart
    │   ├── chartOptions.js      # buildUPlotOptions() — config uPlot pura
    │   └── MotecChart.css
    │
    └── Gauge/
        ├── Gauge.jsx            # lifecycle + refs + rAF
        ├── gaugeCanvas.js       # drawStatic() + drawDynamic() — sem JSX
        ├── gaugeUtils.js        # valueToAngle() + pointerColor()
        └── Gauge.css