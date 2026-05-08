import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { connect, disconnect } from './store.js'
import TopBar from './components/TopBar/TopBar.jsx'
import TabBar from './components/TabBar/TabBar.jsx'
import StatusBar from './components/StatusBar/StatusBar.jsx'
import SignalSelector from './components/SignalSelector/SignalSelector.jsx'
import MotecChart from './components/MotecChart/MotecChart.jsx'
import Gauge from './components/Gauge/Gauge.jsx'
import { DEFAULT_CHART_LAYOUT, GAUGE_CONFIG } from './config/dashboardConfig.js'

const TABS = [
  { id: 'analise',  label: 'Análise' },
  { id: 'cockpit',  label: 'Cockpit' },
]

function App() {
  const [selectedSignals, setSelectedSignals] = createSignal([])
  const customChartKey = createMemo(() => selectedSignals().join('|'))

  onMount(() => {
    const token = localStorage.getItem('jwt')
    if (token) connect(`ws://localhost:8081/ws?token=${token}`)
  })

  function handleLogout() {
    localStorage.removeItem('jwt')
    disconnect()
  }

  function toggleSignal(signalName) {
    setSelectedSignals((current) =>
      current.includes(signalName)
        ? current.filter((name) => name !== signalName)
        : [...current, signalName]
    )
  }

  function clearSignalSelection() {
    setSelectedSignals([])
  }

  return (
    <>
      <TopBar onLogout={handleLogout} />
      <TabBar tabs={TABS} activeTab="analise" />
      <StatusBar />
      <SignalSelector
        selectedSignals={selectedSignals()}
        onToggleSignal={toggleSignal}
        onClearSelection={clearSignalSelection}
      />

      <div class="gauge-row">
        <For each={GAUGE_CONFIG}>
          {(g) => (
            <Gauge
              signalName={g.signalName}
              label={g.label}
              min={g.min}
              max={g.max}
              unit={g.unit}
              warnMax={g.warnMax}
              critMax={g.critMax}
              size={160}
            />
          )}
        </For>
      </div>

      <div class="chart-area">
        <Show when={selectedSignals().length > 0}>
          <For each={[customChartKey()]}>
            {() => (
              <MotecChart
                label="Seleção customizada"
                signals={selectedSignals()}
              />
            )}
          </For>
        </Show>

        <For each={DEFAULT_CHART_LAYOUT}>
          {({ label, signals }) => (
            <MotecChart label={label} signals={signals} />
          )}
        </For>
      </div>
    </>
  )
}

export default App
