import { For, createMemo } from 'solid-js'
import { signals } from '../../store.js'

const MOTOR_GROUPS = [
    {
        up: { name: 'TORQUE_13B', label: '13B' },
        down: { name: 'TORQUE_13A', label: '13A' },
    },
    {
        up: { name: 'TORQUE_0B', label: '0B' },
        down: { name: 'TORQUE_0A', label: '0A' },
    },
]

function TorqueDistribution() {
    const maxTorque = createMemo(() => {
        let max = 50
        for (const group of MOTOR_GROUPS) {
            for (const key of ['up', 'down']) {
                const entry = signals[group[key].name]
                if (entry?.value != null && isFinite(entry.value)) {
                    max = Math.max(max, Math.abs(entry.value))
                }
            }
        }
        return max || 50
    })

    const groups = createMemo(() =>
        MOTOR_GROUPS.map((group) => {
            const upEntry = signals[group.up.name]
            const downEntry = signals[group.down.name]
            const upVal = upEntry?.value ?? 0
            const downVal = downEntry?.value ?? 0
            const upPct = maxTorque() > 0 ? Math.min(Math.abs(upVal) / maxTorque(), 1) : 0
            const downPct = maxTorque() > 0 ? Math.min(Math.abs(downVal) / maxTorque(), 1) : 0
            return {
                up: { ...group.up, value: upVal, pct: upPct, isPositive: upVal >= 0 },
                down: { ...group.down, value: downVal, pct: downPct, isPositive: downVal >= 0 },
            }
        })
    )

    return (
        <section class="torque-dist" aria-label="Distribuição de torque">
            <header class="cockpit-panel__header">
                <span>Torque</span>
            </header>

            <div class="torque-dist__body">
                <For each={groups()}>
                    {(group) => (
                        <div class="torque-dist__col">
                            <div class="torque-dist__half torque-dist__half--top">
                                <div
                                    class="torque-dist__bar"
                                    classList={{
                                        'torque-dist__bar--pos': group.up.isPositive,
                                        'torque-dist__bar--neg': !group.up.isPositive,
                                    }}
                                    style={{ height: `${(group.up.pct * 100).toFixed(1)}%` }}
                                />
                                <span class="torque-dist__val">{Math.round(group.up.value)}</span>
                                <span class="torque-dist__tag">{group.up.label}</span>
                            </div>

                            <div class="torque-dist__center" />

                            <div class="torque-dist__half torque-dist__half--bot">
                                <span class="torque-dist__tag">{group.down.label}</span>
                                <span class="torque-dist__val">{Math.round(group.down.value)}</span>
                                <div
                                    class="torque-dist__bar"
                                    classList={{
                                        'torque-dist__bar--pos': group.down.isPositive,
                                        'torque-dist__bar--neg': !group.down.isPositive,
                                    }}
                                    style={{ height: `${(group.down.pct * 100).toFixed(1)}%` }}
                                />
                            </div>
                        </div>
                    )}
                </For>
            </div>
        </section>
    )
}

export default TorqueDistribution
