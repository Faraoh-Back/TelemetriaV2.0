import { status } from '../store.js'
import '../styles/components.css'

function Topbar({ onLogout }) {
    const dotClass = () => {
        const s = status.state
        if (s === 'connected')  return 'ws-dot ws-dot--connected'
        if (s === 'error')      return 'ws-dot ws-dot--error'
        if (s === 'connecting') return 'ws-dot ws-dot--connecting'
        return 'ws-dot'
    }

    return (
        <div class="topbar">
        <div class="topbar__left">
            <span class="topbar__title">E-Racing Telemetria</span>

            <div class="ws-badge">
            <div class={dotClass()} />
            {status.state}
            </div>

            <span class="framerate">
            {status.frameRate > 0 ? `${status.frameRate} fr/s` : ''}
            </span>
        </div>

        <button class="btn" onclick={onLogout}>Sair</button>
        </div>
    )
}

export default Topbar