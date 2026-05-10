import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import {
  connect,
  disconnect,
  resetTelemetryData,
  setTelemetryCollectionEnabled,
  signals,
  telemetrySession,
} from './store.js'
import { getServerConfig } from './config/serverConfig.js'
import {
  clearStoredUiSession,
  clearStoredToken,
  createUiSession,
  getStoredUiSession,
  getValidStoredToken,
  login,
} from './utils/auth.js'
import LoginScreen from './components/Login/LoginScreen.jsx'
import TopBar from './components/TopBar/TopBar.jsx'
import TabBar from './components/TabBar/TabBar.jsx'
import StatusBar from './components/StatusBar/StatusBar.jsx'
import SignalSelector from './components/SignalSelector/SignalSelector.jsx'
import DashboardEmptyState from './components/DashboardEmptyState/DashboardEmptyState.jsx'
import './components/DashboardEmptyState/DashboardEmptyState.css'
import TimeWindowControl from './components/TimeWindowControl/TimeWindowControl.jsx'
import MotecChart from './components/MotecChart/MotecChart.jsx'
import HistoryReferenceChart from './components/HistoryReferenceChart/HistoryReferenceChart.jsx'
import Cockpit from './components/Cockpit/Cockpit.jsx'
import { DEFAULT_CHART_LAYOUT, GAUGE_CONFIG } from './config/dashboardConfig.js'

const TABS = [
  { id: 'analise',  label: 'Análise' },
  { id: 'cockpit',  label: 'Cockpit' },
]

const TELEMETRY_MODE = {
  idle: 'idle',
  live: 'live',
  stopped: 'stopped',
}

function App() {
  const [session, setSession] = createSignal(null)
  const [activeTab, setActiveTab] = createSignal('analise')
  const [selectedSignals, setSelectedSignals] = createSignal([])
  const [windowSeconds, setWindowSeconds] = createSignal(30)
  const [telemetryMode, setTelemetryMode] = createSignal(TELEMETRY_MODE.idle)
  const customChartKey = createMemo(() => selectedSignals().join('|'))
  const hasSignals = createMemo(() => Object.keys(signals).length > 0)

  onMount(() => {
    // Modo UI permite trabalhar a experiencia sem depender do backend.
    const uiSession = getStoredUiSession()
    if (uiSession?.mode === 'ui') {
      setSession(uiSession)
      return
    }

    // Recupera sessoes reais ainda validas antes de exibir a area operacional.
    const token = getValidStoredToken()
    if (token) authenticateDashboard({ token, username: 'eracing', mode: 'live' })
  })

  function buildWsUrl(token) {
    const { wsBase } = getServerConfig()
    return `${wsBase}/ws?token=${encodeURIComponent(token)}`
  }

  function authenticateDashboard(nextSession) {
    if (nextSession.mode === 'live') {
      connect(buildWsUrl(nextSession.token))
      setTelemetryCollectionEnabled(false)
      setTelemetryMode(TELEMETRY_MODE.idle)
    } else {
      setTelemetryMode(TELEMETRY_MODE.idle)
    }

    setSession(nextSession)
  }

  async function handleLogin(username, password) {
    const token = await login(username, password)
    authenticateDashboard({ token, username, mode: 'live' })
  }

  function handleUiPreview() {
    authenticateDashboard(createUiSession('eracing'))
  }

  function handleLogout() {
    clearStoredToken()
    clearStoredUiSession()
    disconnect()
    setSession(null)
    setTelemetryMode(TELEMETRY_MODE.idle)
    setActiveTab('analise')
    setSelectedSignals([])
  }

  function handleStartTelemetry() {
    const currentSession = session()
    if (!currentSession || currentSession.mode !== 'live') return

    resetTelemetryData()
    setTelemetryCollectionEnabled(true)
    setTelemetryMode(TELEMETRY_MODE.live)
  }

  function handleStopTelemetry() {
    setTelemetryCollectionEnabled(false)
    setTelemetryMode(TELEMETRY_MODE.stopped)
    setActiveTab('analise')
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
    <Show
      when={session()}
      fallback={<LoginScreen onLogin={handleLogin} onUiPreview={handleUiPreview} />}
    >
      {/* Dashboard fica isolado do login; daqui para baixo so existe sessao autenticada. */}
      <TopBar
        user={session().username}
        sessionMode={session().mode}
        telemetryMode={telemetryMode()}
        onStartTelemetry={handleStartTelemetry}
        onStopTelemetry={handleStopTelemetry}
        onLogout={handleLogout}
      />
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
            <Show when={!hasSignals()}>
              <DashboardEmptyState mode={session().mode} />
            </Show>
            <Show when={telemetryMode() === TELEMETRY_MODE.live}>
              <TimeWindowControl
                value={windowSeconds()}
                onChange={setWindowSeconds}
              />
            </Show>

            <div class="chart-area">
              <Show
                when={telemetryMode() === TELEMETRY_MODE.stopped}
                fallback={
                  <Show
                    when={telemetryMode() === TELEMETRY_MODE.live}
                  >
                      <Show when={selectedSignals().length > 0}>
                        <For each={[customChartKey()]}>
                          {() => (
                            <MotecChart
                              label="Seleção customizada"
                            signals={selectedSignals()}
                            windowSeconds={windowSeconds()}
                            relativeTime
                            relativeStartTimestamp={telemetrySession.startTimestamp}
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
                          relativeTime
                          relativeStartTimestamp={telemetrySession.startTimestamp}
                        />
                        )}
                      </For>
                  </Show>
                }
              >
                <HistoryReferenceChart
                  signals={selectedSignals()}
                />
              </Show>
            </div>
          </>
        }
      >
        <Cockpit gauges={GAUGE_CONFIG} />
      </Show>
    </Show>
  )
}

export default App
