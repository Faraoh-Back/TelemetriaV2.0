import { For, Show } from 'solid-js'
import { signals } from '../../store.js'

function hasValue(value) {
    return value != null && Number.isFinite(Number(value))
}

function isActive(value) {
    return hasValue(value) && Number(value) !== 0
}

function formatStatusValue(value) {
    if (!hasValue(value)) return 'Sem dado'
    return Number(value).toFixed(0)
}

function getStateText(config) {
    const value = signals[config.signalName]?.value

    if (config.kind === 'brake') {
        if (!hasValue(value)) return 'Sem dado'
        return isActive(value) ? 'Acionado' : 'Livre'
    }

    if (config.kind === 'state') {
        return hasValue(value) ? `Estado ${formatStatusValue(value)}` : 'Sem dado'
    }

    return formatStatusValue(value)
}

function getActiveFaults(config) {
    return (config.signals ?? [])
        .filter((signalName) => isActive(signals[signalName]?.value))
}

function getIndicatorState(config) {
    if (config.kind === 'faultGroup') {
        const activeFaults = getActiveFaults(config)
        if (activeFaults.length > 0) return 'alert'
        const hasAnySignal = (config.signals ?? []).some((signalName) => signals[signalName]?.value != null)
        return hasAnySignal ? 'ok' : 'idle'
    }

    if (config.kind === 'brake') {
        const value = signals[config.signalName]?.value
        if (!hasValue(value)) return 'idle'
        return isActive(value) ? 'active' : 'ok'
    }

    return signals[config.signalName]?.value == null ? 'idle' : 'active'
}

function StatusIndicator({ config }) {
    const activeFaults = () => getActiveFaults(config)
    const indicatorState = () => getIndicatorState(config)

    return (
        <div class={`status-indicator status-indicator--${indicatorState()}`}>
            <span class="status-indicator__dot" aria-hidden="true" />
            <div class="status-indicator__body">
                <div class="status-indicator__label">{config.label}</div>
                <Show
                    when={config.kind === 'faultGroup'}
                    fallback={<div class="status-indicator__value">{getStateText(config)}</div>}
                >
                    <div class="status-indicator__value">
                        {activeFaults().length > 0 ? `${activeFaults().length} ativo(s)` : 'OK'}
                    </div>
                    <Show when={activeFaults().length > 0}>
                        <div class="status-indicator__faults">
                            <For each={activeFaults()}>
                                {(signalName) => <span>{signalName.replace(/^BMS_/, '').replace(/_/g, ' ')}</span>}
                            </For>
                        </div>
                    </Show>
                </Show>
            </div>
        </div>
    )
}

export default StatusIndicator
