/**
 * ============================================================================
 * useSignalStats.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Acumular estatísticas simples dos sinais exibidos na StatusBar.
 *
 * O hook observa cada signals[name].value e mantém:
 *
 *   - max
 *   - min
 *   - sum
 *   - count
 *
 * A média é derivada no componente visual para manter este hook focado em estado.
 */

import { createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import { signals } from '../../store.js'

export function useSignalStats(signalConfigs) {
    const [stats, setStats] = createStore({})

    for (const { signalName } of signalConfigs) {
        createEffect(() => {
        const entry = signals[signalName]
        if (!entry) return

        const value = entry.value

        setStats(signalName, (prev) => {
            if (!prev) {
            return {
                max: value,
                min: value,
                sum: value,
                count: 1,
            }
            }

            return {
            max: Math.max(prev.max, value),
            min: Math.min(prev.min, value),
            sum: prev.sum + value,
            count: prev.count + 1,
            }
        })
        })
    }

    return stats
}
