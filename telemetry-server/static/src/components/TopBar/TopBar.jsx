import { status } from '../../store.js'
import BrandLogo from '../BrandLogo/BrandLogo.jsx'
import EmergencyButton from '../EmergencyButton/EmergencyButton.jsx'
import './TopBar.css'

function TopBar(props) {
    const isLive = () => props.telemetryMode === 'live'
    const isStopped = () => props.telemetryMode === 'stopped'
    const canStartTelemetry = () => props.canStartTelemetry ?? props.canControlTelemetry ?? false
    const canStopTelemetry = () => props.canStopTelemetry ?? props.canControlTelemetry ?? false
    const canUseCurrentAction = () => isLive() ? canStopTelemetry() : canStartTelemetry()

    const dotClass = () => {
        const s = status.state
        if (s === 'connected')  return 'ws-dot ws-dot--connected'
        if (s === 'error')      return 'ws-dot ws-dot--error'
        if (s === 'connecting') return 'ws-dot ws-dot--connecting'
        return 'ws-dot'
    }

    const connectionLabel = () => status.state
    const collectionLabel = () => {
        if (isLive()) return 'Tempo real'
        if (isStopped()) return 'Historico'
        return 'Aguardando'
    }
    const actionLabel = () => {
        if (props.telemetryActionPending) return 'Enviando'
        return isLive() ? 'Encerrar coleta' : 'Iniciar coleta'
    }
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
                    {isLive() && status.frameRate > 0
                        ? `${status.frameRate} fr/s`
                        : ''}
                </span>
            </div>

            <div class="topbar__right">
                <div
                    classList={{
                        'telemetry-control': true,
                        'telemetry-control--readonly': !canUseCurrentAction(),
                        'telemetry-control--live': isLive(),
                        'telemetry-control--stopped': isStopped(),
                    }}
                    title={canUseCurrentAction() ? 'Controle de telemetria' : 'Controle restrito a administradores'}
                >
                    <span class="telemetry-control__status">
                        <span class="telemetry-control__dot" />
                        {collectionLabel()}
                    </span>

                    {canUseCurrentAction() && (
                        <button
                            class="telemetry-control__button"
                            type="button"
                            disabled={props.telemetryActionPending}
                            onClick={() => telemetryAction()?.()}
                        >
                            {actionLabel()}
                        </button>
                    )}
                </div>

                {canUseCurrentAction() && (
                    <EmergencyButton
                        onEmergencyStop={props.onEmergencyStop}
                        disabled={props.telemetryActionPending}
                    />
                )}

                <div class="session-chip" title="Sessao atual">
                    <span class="session-chip__label">Usuario</span>
                    <strong>{props.user}</strong>
                    <span class="session-chip__role">{props.role}</span>
                </div>

                <button class="btn" onClick={props.onLogout}>Sair</button>
            </div>
        </div>
    )
}

export default TopBar
