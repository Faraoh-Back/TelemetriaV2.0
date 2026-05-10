import { status } from '../../store.js'
import BrandLogo from '../BrandLogo/BrandLogo.jsx'
import './TopBar.css'

function TopBar(props) {
    const isLive = () => props.telemetryMode === 'live'
    const isStopped = () => props.telemetryMode === 'stopped'

    const dotClass = () => {
        if (props.sessionMode === 'ui') return 'ws-dot ws-dot--preview'

        const s = status.state
        if (s === 'connected')  return 'ws-dot ws-dot--connected'
        if (s === 'error')      return 'ws-dot ws-dot--error'
        if (s === 'connecting') return 'ws-dot ws-dot--connecting'
        return 'ws-dot'
    }

    const connectionLabel = () => {
        if (props.sessionMode === 'ui') return 'modo UI'

        return status.state
    }

    const canControlTelemetry = () => props.sessionMode === 'live'
    const collectionLabel = () => {
        if (isLive()) return 'Tempo real'
        if (isStopped()) return 'Historico'
        return 'Aguardando'
    }
    const actionLabel = () => isLive() ? 'Encerrar coleta' : 'Iniciar coleta'
    const telemetryAction = () => isLive() ? props.onStopTelemetry : props.onStartTelemetry

    return (
        <div class="topbar">
            <div class="topbar__left">
                <BrandLogo className="brand-logo brand-logo--topbar" />
                <span class="topbar__title">Unicamp E-Racing Telemetria</span>

                <div class="ws-badge">
                    <div class={dotClass()} />
                    {connectionLabel()}
                </div>

                <span class="framerate">
                    {props.sessionMode === 'live' && isLive() && status.frameRate > 0
                        ? `${status.frameRate} fr/s`
                        : ''}
                </span>
            </div>

            <div class="topbar__right">
                {canControlTelemetry() && (
                    <div
                        classList={{
                            'telemetry-control': true,
                            'telemetry-control--live': isLive(),
                            'telemetry-control--stopped': isStopped(),
                        }}
                    >
                        <span class="telemetry-control__status">
                            <span class="telemetry-control__dot" />
                            {collectionLabel()}
                        </span>

                        <button
                            class="telemetry-control__button"
                            type="button"
                            onClick={() => telemetryAction()?.()}
                        >
                            {actionLabel()}
                        </button>
                    </div>
                )}

                <div class="session-chip" title="Sessao atual">
                    <span class="session-chip__label">Usuario</span>
                    <strong>{props.user}</strong>
                </div>

                <button class="btn" onClick={props.onLogout}>Sair</button>
            </div>
        </div>
    )
}

export default TopBar
