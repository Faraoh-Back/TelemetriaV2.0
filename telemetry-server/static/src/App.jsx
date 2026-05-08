import { onMount } from 'solid-js'
import { For } from 'solid-js'
import { connect, disconnect } from './store.js'
import Topbar from './components/TopBar.jsx'
import TabBar from './components/TabBar.jsx'
import StatusBar from './components/StatusBar.jsx'
import MotecChart from './components/MotecChart.jsx'
import { DEFAULT_CHART_LAYOUT } from './config/dashboardConfig.js'

const TABS = [
  { id: 'analise',  label: 'Análise' },
  { id: 'cockpit',  label: 'Dashboard / Cockpit (em breve)', disabled: true },
]

function App() {
  onMount(() => {
    const token = localStorage.getItem('jwt')
    if (token) connect(`ws://localhost:8081/ws?token=${token}`)
  })

  function handleLogout() {
    localStorage.removeItem('jwt')
    disconnect()
  }

  return (
    <>
      <Topbar onLogout={handleLogout} />
      <TabBar tabs={TABS} activeTab="analise" />
      <StatusBar />
      <div class="chart-area">
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