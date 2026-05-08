import { createEffect } from 'solid-js'
import { For } from 'solid-js'
import { createStore } from 'solid-js/store'
import { signals } from '../../store.js'
import { PINNED_SIGNALS } from '../../config/dashboardConfig.js'
import './StatusBar.css'

const [stats, setStats] = createStore({})

function StatusBar() {
    for (const { signalName } of PINNED_SIGNALS) {
        createEffect(() => {
        const entry = signals[signalName]
        if (!entry) return
        const val = entry.value
        setStats(signalName, (prev) => {
            if (!prev) return { max: val, min: val, sum: val, count: 1 }
            return {
            max:   Math.max(prev.max, val),
            min:   Math.min(prev.min, val),
            sum:   prev.sum + val,
            count: prev.count + 1,
            }
        })
        })
    }

    return (
        <div class="status-bar">
        <For each={PINNED_SIGNALS}>
            {({ signalName, label }) => (
            <SignalCard signalName={signalName} label={label} />
            )}
        </For>
        </div>
    )
}

function SignalCard({ signalName, label }) {
    const entry = () => signals[signalName]
    const stat  = () => stats[signalName]
    const fmt   = (v) => v == null ? '—' : (Number.isInteger(v) ? v : v.toFixed(2))
    const avg   = () => stat() ? stat().sum / stat().count : null

    return (
        <div class="signal-card">
        <div class="signal-card__label">{label}</div>
        <div class="signal-card__value">
            {fmt(entry()?.value)}
            <span class="signal-card__unit">{entry()?.unit ?? ''}</span>
        </div>
        <div class="signal-card__stats">
            <span>↑ {fmt(stat()?.max)}</span>
            <span>↓ {fmt(stat()?.min)}</span>
            <span>~ {fmt(avg())}</span>
        </div>
        </div>
    )
}

export default StatusBar