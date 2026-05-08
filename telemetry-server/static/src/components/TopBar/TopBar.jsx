import { status } from '../../store.js'
import './TopBar.css'

function TopBar({ user, sessionMode, onLogout }) {
    const dotClass = () => {
        if (sessionMode === 'ui') return 'ws-dot ws-dot--preview'

        const s = status.state
        if (s === 'connected')  return 'ws-dot ws-dot--connected'
        if (s === 'error')      return 'ws-dot ws-dot--error'
        if (s === 'connecting') return 'ws-dot ws-dot--connecting'
        return 'ws-dot'
    }

    const connectionLabel = () => {
        if (sessionMode === 'ui') return 'modo UI'

        return status.state
    }

    return (
        <div class="topbar">
            <div class="topbar__left">
                <span class="topbar__title">E-Racing Telemetria</span>

                <div class="ws-badge">
                    <div class={dotClass()} />
                    {connectionLabel()}
                </div>

                <span class="framerate">
                    {sessionMode === 'live' && status.frameRate > 0 ? `${status.frameRate} fr/s` : ''}
                </span>
            </div>

            <div class="topbar__right">
                <div class="session-chip" title="Sessao atual">
                    <span class="session-chip__label">Usuario</span>
                    <strong>{user}</strong>
                </div>

                <button class="btn" onclick={onLogout}>Sair</button>
            </div>
        </div>
    )
}

export default TopBar
