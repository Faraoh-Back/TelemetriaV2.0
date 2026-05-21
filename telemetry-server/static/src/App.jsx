import { onMount } from 'solid-js'
import { For } from 'solid-js'
import { connect, status } from './store.js'
import StatusBar from './components/StatusBar.jsx'
import MotecChart from './components/MotecChart.jsx'
import { DEFAULT_CHART_LAYOUT } from './config/dashboardConfig.js'

  function App() {
      onMount(() => {
        const token = localStorage.getItem('jwt')
        if (token) connect(`ws://localhost:8081/ws?token=${token}`)
      })

      return (
        <div>
          <p>Status: {status.state}</p>
          <StatusBar />
          <div style={{ padding: '16px' }}>
            <For each={DEFAULT_CHART_LAYOUT}>
              {({ label, signals }) => (
                <MotecChart label={label} signals={signals} />
              )}
            </For>
          </div>
        </div>
      )
  }

export default App