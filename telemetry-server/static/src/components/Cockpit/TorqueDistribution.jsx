import { For, createMemo } from 'solid-js'
import { signals } from '../../store.js'

const TORQUE_SIGNALS = [
    { name: 'TORQUE_0A', label: '0A' },
    { name: 'TORQUE_0B', label: '0B' },
    { name: 'TORQUE_13A', label: '13A' },
    { name: 'TORQUE_13B', label: '13B' },
]

function TorqueDistribution() {
    const maxTorque = createMemo(() => {
        let max = 50
        for (const { name } of TORQUE_SIGNALS) {
            const entry = signals[name]
            if (entry?.value != null && isFinite(entry.value)) {
                max = Math.max(max, Math.abs(entry.value))
            }
        }
        return max || 50
    })

    const barData = createMemo(() =>
        TORQUE_SIGNALS.map(({ name, label }) => {
            const entry = signals[name]
            const value = entry?.value ?? 0
            const abs = Math.abs(value)
            const pct = maxTorque() > 0 ? Math.min(abs / maxTorque(), 1) : 0
            return { label, value, pct, isPositive: value >= 0 }
        })
    )

    return (
        <section class="torque-dist" aria-label="Distribuição de torque">
            <header class="cockpit-panel__header">
                <span>Torque</span>
            </header>

            <div class="torque-dist__body">
                <div class="torque-dist__chart">
                    <For each={barData()}>
                        {(bar) => (
                            <div class="torque-dist__col">
                                <div
                                    class="torque-dist__bar"
                                    classList={{
                                        'torque-dist__bar--pos': bar.isPositive,
                                        'torque-dist__bar--neg': !bar.isPositive,
                                    }}
                                    style={{ height: `${(bar.pct * 50).toFixed(1)}%` }}
                                />
                                <span class="torque-dist__value">{Math.round(bar.value)}</span>
                                <span class="torque-dist__label">{bar.label}</span>
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </section>
    )
}

export default TorqueDistribution
