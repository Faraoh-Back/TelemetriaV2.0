import { For, Show, createMemo, createSignal, onMount } from 'solid-js'
import {
  connect,
  disconnect,
  resetTelemetryData,
  setTelemetryCollectionEnabled,
  signals,
  trackState,
  telemetrySession,
} from './store.js'
import { getServerConfig } from './config/serverConfig.js'
import {
  buildSessionFromToken,
  clearStoredToken,
  getValidStoredToken,
  login,
} from './utils/auth.js'
import {
  PERMISSIONS,
  canControlTelemetry,
  hasPermission,
} from './utils/permissions.js'
import {
  persistTelemetryLogBounds,
  sendEmergencyStop,
  startTelemetryCollection,
  stopTelemetryCollection,
  getTelemetryCollectionStatus,
} from './services/telemetryCollection.js'
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
import DownloadsPage from './components/Downloads/DownloadsPage.jsx'
import { DEFAULT_CHART_LAYOUT, GAUGE_CONFIG } from './config/dashboardConfig.js'

const TABS = [
  { id: 'analise',  label: 'Análise' },
  { id: 'cockpit',  label: 'Cockpit' },
  { id: 'downloads', label: 'Downloads' },
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
  const [telemetryActionPending, setTelemetryActionPending] = createSignal(false)
  const [telemetryActionError, setTelemetryActionError] = createSignal('')
  const [isStopModalOpen, setIsStopModalOpen] = createSignal(false)
  const [stopSessionName, setStopSessionName] = createSignal('')
  const customChartKey = createMemo(() => selectedSignals().join('|'))
  const hasSignals = createMemo(() => Object.keys(signals).length > 0)
  const canStartTelemetry = createMemo(() =>
    hasPermission(session(), PERMISSIONS.telemetryStart)
  )
  const canStopTelemetry = createMemo(() =>
    hasPermission(session(), PERMISSIONS.telemetryStop)
  )
  const canUseTelemetryControls = createMemo(() =>
    canControlTelemetry(session())
  )

  onMount(() => {
    // Recupera sessoes reais ainda validas antes de exibir a area operacional.
    const token = getValidStoredToken()
    const storedSession = token ? buildSessionFromToken(token) : null
    if (storedSession) authenticateDashboard(storedSession)
  })

  function buildWsUrl(token) {
    const { wsBase } = getServerConfig()
    return `${wsBase}/ws?token=${encodeURIComponent(token)}`
  }

  async function authenticateDashboard(nextSession) {
    connect(buildWsUrl(nextSession.token))
    
    // Sincroniza o estado da coleta com o servidor ao conectar (F5 ou Login)
    try {
      const status = await getTelemetryCollectionStatus(nextSession.token)
      if (status.ok && status.state === 'live') {
        setTelemetryCollectionEnabled(true)
        setTelemetryMode(TELEMETRY_MODE.live)
      } else {
        setTelemetryCollectionEnabled(false)
        setTelemetryMode(TELEMETRY_MODE.idle)
      }
    } catch (error) {
      console.error('Falha ao sincronizar status da telemetria:', error)
      setTelemetryCollectionEnabled(false)
      setTelemetryMode(TELEMETRY_MODE.idle)
    }

    setSession(nextSession)
  }

  async function handleLogin(username, password) {
    const nextSession = await login(username, password)
    authenticateDashboard(nextSession)
  }

  function handleLogout() {
    clearStoredToken()
    disconnect()
    setSession(null)
    setTelemetryMode(TELEMETRY_MODE.idle)
    setTelemetryActionPending(false)
    setTelemetryActionError('')
    setIsStopModalOpen(false)
    setStopSessionName('')
    setActiveTab('analise')
    setSelectedSignals([])
  }

  function handleTelemetryActionError(error) {
    if (error.status === 401) {
      handleLogout()
      return
    }

    setTelemetryActionError(error.message || 'Nao foi possivel atualizar a coleta.')
  }

  async function handleStartTelemetry() {
    const currentSession = session()
    if (
      !currentSession ||
      currentSession.mode !== 'live' ||
      !canStartTelemetry() ||
      telemetryActionPending()
    ) return

    setTelemetryActionPending(true)
    setTelemetryActionError('')

    try {
      await startTelemetryCollection(currentSession.token)
      resetTelemetryData()
      setTelemetryCollectionEnabled(true)
      setTelemetryMode(TELEMETRY_MODE.live)
    } catch (error) {
      handleTelemetryActionError(error)
    } finally {
      setTelemetryActionPending(false)
    }
  }

  function handleStopTelemetryRequest() {
    if (!canStopTelemetry() || telemetryActionPending()) return

    setTelemetryActionError('')
    setStopSessionName('')
    setIsStopModalOpen(true)
  }

  function closeStopTelemetryModal() {
    if (telemetryActionPending()) return

    setIsStopModalOpen(false)
    setStopSessionName('')
  }

  async function handleStopTelemetry(event) {
    event?.preventDefault()
    const currentSession = session()
    if (!currentSession || !canStopTelemetry() || telemetryActionPending()) return

    const logName = stopSessionName().trim()
    if (!logName) {
      setTelemetryActionError('Informe um nome para a sessao antes de encerrar a coleta.')
      return
    }

    setTelemetryActionPending(true)
    setTelemetryActionError('')

    try {
      await stopTelemetryCollection(currentSession.token, null, logName)
      const bounds = await setTelemetryCollectionEnabled(false)
      let boundsError = null

      if (
        currentSession.mode === 'live' &&
        bounds.log_start_unix != null &&
        bounds.log_stop_unix != null
      ) {
        try {
          await persistTelemetryLogBounds(bounds, currentSession.token, logName)
        } catch (error) {
          boundsError = error
        }
      }

      setTelemetryMode(TELEMETRY_MODE.stopped)
      setIsStopModalOpen(false)
      setStopSessionName('')
      setActiveTab('analise')

      if (boundsError) {
        setTelemetryActionError(boundsError.message || 'Coleta encerrada, mas nao foi possivel registrar os limites do log.')
      }
    } catch (error) {
      handleTelemetryActionError(error)
    } finally {
      setTelemetryActionPending(false)
    }
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

  async function handleEmergencyStop() {
    const currentSession = session()
    if (!currentSession) return
    await sendEmergencyStop(currentSession.token)
  }

  return (
    <Show
      when={session()}
      fallback={<LoginScreen onLogin={handleLogin} />}
    >
      {/* Dashboard fica isolado do login; daqui para baixo so existe sessao autenticada. */}
      <TopBar
        user={session().username}
        role={session().role}
        sessionMode={session().mode}
        telemetryMode={telemetryMode()}
        canControlTelemetry={canUseTelemetryControls()}
        canStartTelemetry={canStartTelemetry()}
        canStopTelemetry={canStopTelemetry()}
        telemetryActionPending={telemetryActionPending()}
        onStartTelemetry={handleStartTelemetry}
        onStopTelemetry={handleStopTelemetryRequest}
        onEmergencyStop={handleEmergencyStop}
        onLogout={handleLogout}
      />
      <TabBar tabs={TABS} activeTab={activeTab()} onSelect={setActiveTab} />
      <Show when={telemetryActionError()}>
        <div class="app-alert app-alert--error" role="alert">
          {telemetryActionError()}
        </div>
      </Show>
      <Show when={isStopModalOpen()}>
        <div class="modal-backdrop" role="presentation">
          <form
            class="telemetry-stop-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="telemetry-stop-title"
            onSubmit={handleStopTelemetry}
          >
            <div>
              <h2 id="telemetry-stop-title">Nome da sessao</h2>
              <p>Identifique a coleta antes de encerrar a telemetria.</p>
            </div>

            <label class="telemetry-stop-modal__field">
              <span>Sessao</span>
              <input
                type="text"
                value={stopSessionName()}
                placeholder="FSAE Brasil - Treino Livre 1"
                maxLength="120"
                required
                disabled={telemetryActionPending()}
                autofocus
                onInput={(event) => setStopSessionName(event.currentTarget.value)}
              />
            </label>

            <div class="telemetry-stop-modal__actions">
              <button
                class="modal-button"
                type="button"
                disabled={telemetryActionPending()}
                onClick={closeStopTelemetryModal}
              >
                Cancelar
              </button>
              <button
                class="modal-button modal-button--danger"
                type="submit"
                disabled={telemetryActionPending() || !stopSessionName().trim()}
              >
                {telemetryActionPending() ? 'Encerrando' : 'Parar telemetria'}
              </button>
            </div>
          </form>
        </div>
      </Show>

      <Show
        when={activeTab() === 'downloads'}
        fallback={
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
                  <DashboardEmptyState />
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
            <Cockpit
              gauges={GAUGE_CONFIG}
              trackMap={trackState}
              isTelemetryLive={telemetryMode() === TELEMETRY_MODE.live}
              videoSource="http://143.106.207.21:8555/cam"
            />
          </Show>
        }
      >
        <DownloadsPage session={session()} />
      </Show>
    </Show>
  )
}

export default App
