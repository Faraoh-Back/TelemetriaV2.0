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

function getSignalConfigKey(config) {
    return config.signalName
}

function getFiniteSignalValues(signalNames = []) {
    return signalNames
        .map((name) => signals[name]?.value)
        .filter((value) => value != null && Number.isFinite(Number(value)))
        .map(Number)
}

function getConfigValue(config) {
    if (config.signalNames?.length > 0) {
        const values = getFiniteSignalValues(config.signalNames)
        if (values.length === 0) return signals[config.signalName]?.value
        if (config.aggregate === 'min') return Math.min(...values)
        if (config.aggregate === 'max') return Math.max(...values)
        return values[values.length - 1]
    }

    return signals[config.signalName]?.value
}

export function useSignalStats(signalConfigs) {
    const [stats, setStats] = createStore({})

    for (const config of signalConfigs) {
        createEffect(() => {
        const value = getConfigValue(config)
        if (value == null || !Number.isFinite(Number(value))) return

        const key = getSignalConfigKey(config)
        const numericValue = Number(value)

        setStats(key, (prev) => {
            if (!prev) {
            return {
                max: numericValue,
                min: numericValue,
                sum: numericValue,
                count: 1,
            }
            }

            return {
            max: Math.max(prev.max, numericValue),
            min: Math.min(prev.min, numericValue),
            sum: prev.sum + numericValue,
            count: prev.count + 1,
            }
        })
        })
    }

    return stats
}
