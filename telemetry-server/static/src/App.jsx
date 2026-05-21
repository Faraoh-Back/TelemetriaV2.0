import { createSignal, Show, onMount } from 'solid-js'
import { For } from 'solid-js'
import { connect, disconnect, status } from './store.js'
import { getServerConfig } from './config/serverConfig.js'
import LoginScreen from './components/Login/LoginScreen.jsx'
import StatusBar from './components/StatusBar/StatusBar.jsx'
import MotecChart from './components/MotecChart/MotecChart.jsx'
import { DEFAULT_CHART_LAYOUT } from './config/dashboardConfig.js'

function App() {
  const [authed, setAuthed] = createSignal(false)

  onMount(() => {
    const token = localStorage.getItem('jwt')
    if (!token) return
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      if (payload.exp * 1000 > Date.now()) {
        setAuthed(true)
        const { wsBase } = getServerConfig()
        connect(`${wsBase}/ws?token=${token}`)
      } else {
        localStorage.removeItem('jwt')
      }
    } catch (_) {
      localStorage.removeItem('jwt')
    }
  })

  async function handleLogin(username, password) {
    const { apiBase } = getServerConfig()
    const res = await fetch(`${apiBase}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (data.ok && data.token) {
      localStorage.setItem('jwt', data.token)
      setAuthed(true)
      const { wsBase } = getServerConfig()
      connect(`${wsBase}/ws?token=${data.token}`)
    } else {
      throw new Error(data.message || 'Credenciais inválidas.')
    }
  }

  function handleUiPreview() {
    setAuthed(true)
  }

  function handleLogout() {
    localStorage.removeItem('jwt')
    disconnect()
    setAuthed(false)
  }

  return (
    <Show when={authed()} fallback={
      <LoginScreen onLogin={handleLogin} onUiPreview={handleUiPreview} />
    }>
      <div style={{ display: 'flex', 'flex-direction': 'column', 'min-height': '100vh' }}>
        <div style={{ padding: '8px 16px', background: 'var(--bg2)', 'border-bottom': '1px solid var(--border)', display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
          <span style={{ 'font-size': '13px', color: 'var(--text2)' }}>
            WebSocket: <strong style={{ color: status.state === 'connected' ? 'var(--accent)' : 'var(--red)' }}>{status.state}</strong>
            {' · '}{status.frameRate} fps
          </span>
          <button onclick={handleLogout} style={{ background: 'none', border: '1px solid var(--border)', 'border-radius': '6px', color: 'var(--text2)', padding: '4px 12px', cursor: 'pointer', 'font-size': '12px' }}>
            Sair
          </button>
        </div>
        <StatusBar />
        <div style={{ padding: '16px' }}>
          <For each={DEFAULT_CHART_LAYOUT}>
            {({ label, signals }) => (
              <MotecChart label={label} signals={signals} />
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

export default App
