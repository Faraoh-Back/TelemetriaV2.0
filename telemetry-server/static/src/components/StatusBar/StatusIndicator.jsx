import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
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

function getSignalEntry(config) {
    const names = config.signalNames ?? [config.signalName]
    return names
        .map((signalName) => ({ signalName, value: signals[signalName]?.value }))
        .find(({ value }) => hasValue(value))
}

function getStateText(config) {
    const value = getSignalEntry(config)?.value

    if (config.kind === 'brake') {
        if (!hasValue(value)) return 'Sem dado'
        return isActive(value) ? 'Acionado' : 'Livre'
    }

    if (config.kind === 'state') {
        if (!hasValue(value)) return 'Sem dado'
        return config.valueLabels?.[Number(value)] ?? `Estado ${formatStatusValue(value)}`
    }

    if (config.kind === 'binary') {
        if (!hasValue(value)) return 'Sem dado'
        return isActive(value)
            ? (config.activeText ?? 'Ativo')
            : (config.inactiveText ?? 'Inativo')
    }

    return formatStatusValue(value)
}

function normalizeFaultSignal(signal) {
    return typeof signal === 'string'
        ? { signalName: signal }
        : signal
}

function isFaultActive(fault) {
    const value = signals[fault.signalName]?.value
    if (!hasValue(value)) return false

    return fault.activeWhen != null
        ? Number(value) === Number(fault.activeWhen)
        : isActive(value)
}

function getActiveFaults(config) {
    return (config.signals ?? [])
        .map(normalizeFaultSignal)
        .filter(isFaultActive)
}

function hasAnyFaultSignal(config) {
    return (config.signals ?? [])
        .map(normalizeFaultSignal)
        .some((fault) => signals[fault.signalName]?.value != null)
}

function getFaultGroupState(config, activeFaults = getActiveFaults(config)) {
    if (activeFaults.length > 0) return config.severity === 'warning' ? 'warning' : 'critical'
    return hasAnyFaultSignal(config) ? 'ok' : 'idle'
}

function getIndicatorState(config) {
    if (config.kind === 'faultGroup') return getFaultGroupState(config)

    if (config.kind === 'brake') {
        const value = getSignalEntry(config)?.value
        if (!hasValue(value)) return 'idle'
        return isActive(value) ? 'active' : 'ok'
    }

    if (config.kind === 'state') {
        const value = getSignalEntry(config)?.value
        if (!hasValue(value)) return 'idle'
        return (config.alertValues ?? []).includes(Number(value)) ? 'critical' : 'active'
    }

    const value = getSignalEntry(config)?.value
    if (!hasValue(value)) return 'idle'
    return isActive(value) ? 'active' : 'ok'
}

function getFaultLabel(fault) {
    return fault.label ?? fault.signalName.replace(/^BMS_/, '').replace(/^Fault_/, '').replace(/_/g, ' ')
}

function getFaultSummary(config, count) {
    if (count === 0) return 'OK'
    return config.severity === 'warning'
        ? `${count} atenção`
        : `${count} crítico(s)`
}

function createFaultSnapshot(config) {
    const activeFaults = getActiveFaults(config)
    return {
        activeFaults,
        state: getFaultGroupState(config, activeFaults),
    }
}

function StatusIndicator({ config }) {
    const [sampledFaultSnapshot, setSampledFaultSnapshot] = createSignal(null)
    let sampleTimer = null

    createEffect(() => {
        if (sampleTimer) {
            clearInterval(sampleTimer)
            sampleTimer = null
        }

        setSampledFaultSnapshot(null)

        if (config.kind !== 'faultGroup') return

        const sampleMs = Number(config.sampleMs ?? config.stabilityMs ?? 0)
        if (!Number.isFinite(sampleMs) || sampleMs <= 0) return

        setSampledFaultSnapshot(createFaultSnapshot(config))
        sampleTimer = setInterval(() => {
            setSampledFaultSnapshot(createFaultSnapshot(config))
        }, sampleMs)
    })

    onCleanup(() => {
        if (sampleTimer) clearInterval(sampleTimer)
    })

    const activeFaults = () => sampledFaultSnapshot()?.activeFaults ?? getActiveFaults(config)
    const indicatorState = () => sampledFaultSnapshot()?.state ?? getIndicatorState(config)

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
                        {getFaultSummary(config, activeFaults().length)}
                    </div>
                    <Show when={activeFaults().length > 0}>
                        <div class="status-indicator__faults">
                            <For each={activeFaults()}>
                                {(fault) => <span>{getFaultLabel(fault)}</span>}
                            </For>
                        </div>
                    </Show>
                </Show>
            </div>
        </div>
    )
}

export default StatusIndicator
