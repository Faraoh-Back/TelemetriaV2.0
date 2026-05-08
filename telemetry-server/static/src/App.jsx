import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import { connect, disconnect } from './store.js'
import TopBar from './components/TopBar/TopBar.jsx'
import TabBar from './components/TabBar/TabBar.jsx'
import StatusBar from './components/StatusBar/StatusBar.jsx'
import SignalSelector from './components/SignalSelector/SignalSelector.jsx'
import TimeWindowControl from './components/TimeWindowControl/TimeWindowControl.jsx'
import MotecChart from './components/MotecChart/MotecChart.jsx'
import Cockpit from './components/Cockpit/Cockpit.jsx'
import { DEFAULT_CHART_LAYOUT, GAUGE_CONFIG } from './config/dashboardConfig.js'

const TABS = [
  { id: 'analise',  label: 'Análise' },
  { id: 'cockpit',  label: 'Cockpit' },
]

function App() {
  const [activeTab, setActiveTab] = createSignal('analise')
  const [selectedSignals, setSelectedSignals] = createSignal([])
  const [windowSeconds, setWindowSeconds] = createSignal(30)
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
      <TabBar tabs={TABS} activeTab={activeTab()} onSelect={setActiveTab} />

      <Show
        when={activeTab() === 'cockpit'}
        fallback={
          <>
            <StatusBar />
            <SignalSelector
              selectedSignals={selectedSignals()}
              onToggleSignal={toggleSignal}
              onClearSelection={clearSignalSelection}
            />
            <TimeWindowControl
              value={windowSeconds()}
              onChange={setWindowSeconds}
            />

            <div class="chart-area">
              <Show when={selectedSignals().length > 0}>
                <For each={[customChartKey()]}>
                  {() => (
                    <MotecChart
                      label="Seleção customizada"
                      signals={selectedSignals()}
                      windowSeconds={windowSeconds()}
                    />
                  )}
                </For>
              </Show>

              <For each={DEFAULT_CHART_LAYOUT}>
                {({ label, signals }) => (
                  <MotecChart
                    label={label}
                    signals={signals}
                    windowSeconds={windowSeconds()}
                  />
                )}
              </For>
            </div>
          </>
        }
      >
        <Cockpit gauges={GAUGE_CONFIG} />
      </Show>
    </>
  )
}

export default App
