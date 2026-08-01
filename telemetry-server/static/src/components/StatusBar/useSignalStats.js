/**
 * ============================================================================
 * useSignalStats.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Resolver a fonte de cada card da StatusBar e acumular suas estatísticas.
 *
 * POR QUE A FONTE VIVE AQUI (e não no SignalCard):
 * ------------------------------------------------
 * Quatro cards agregam 96 sinais cada (vcell_0..95 / tcell_0..95). Antes cada
 * consumidor refazia a varredura por conta própria: o efeito de estatísticas
 * uma vez e o SignalCard mais três (valor, nome da fonte e unidade eram três
 * expressões reativas independentes). Eram ~16 varreduras de 96 sinais por
 * atualização, e qualquer uma das 192 células disparava todas elas.
 *
 * Agora `createSignalSources` monta UM memo por card. A varredura acontece uma
 * vez por atualização e o resultado é compartilhado. O memo devolve um snapshot
 * de primitivos ({ name, value, unit }) com comparação por igualdade — então
 * uma célula que oscila sem mexer no mínimo/máximo nem propaga render.
 */

import { createEffect, createMemo } from 'solid-js'
import { createStore } from 'solid-js/store'
import { signals } from '../../store.js'

function isFiniteValue(value) {
    return value != null && Number.isFinite(Number(value))
}

/**
 * Resolve qual sinal o card exibe e qual o valor corrente.
 *
 * Cards simples leem `config.signalName` direto. Cards agregados varrem
 * `config.signalNames` uma única vez procurando min/max/último valor finito, e
 * caem de volta em `config.signalName` quando nenhuma célula reportou ainda.
 *
 * @returns {{ name: string, value: number, unit: string } | null}
 */
function resolveSource(config) {
    const names = config.signalNames

    if (!names?.length) {
        const entry = signals[config.signalName]
        return isFiniteValue(entry?.value)
            ? { name: config.signalName, value: Number(entry.value), unit: entry.unit ?? '' }
            : null
    }

    let bestName = null
    let bestValue = 0
    let bestUnit = ''

    for (const name of names) {
        const entry = signals[name]
        if (!isFiniteValue(entry?.value)) continue

        const value = Number(entry.value)

        if (bestName === null
            || (config.aggregate === 'min' && value < bestValue)
            || (config.aggregate === 'max' && value > bestValue)
            || (config.aggregate !== 'min' && config.aggregate !== 'max')) {
            bestName = name
            bestValue = value
            bestUnit = entry.unit ?? ''
        }
    }

    if (bestName !== null) {
        return { name: bestName, value: bestValue, unit: bestUnit }
    }

    // Nenhuma célula com valor finito — o servidor ainda pode publicar o
    // agregado pronto (CELL_VOLTAGE_MIN e afins) pelo próprio signalName.
    const fallback = signals[config.signalName]
    return isFiniteValue(fallback?.value)
        ? { name: config.signalName, value: Number(fallback.value), unit: fallback.unit ?? '' }
        : null
}

function sameSource(a, b) {
    if (a === b) return true
    if (!a || !b) return false
    return a.name === b.name && a.value === b.value && a.unit === b.unit
}

/**
 * Monta o memo de fonte de cada card, indexado por `config.signalName`.
 *
 * @returns {Map<string, () => ({ name, value, unit } | null)>}
 */
export function createSignalSources(signalConfigs) {
    const sources = new Map()

    for (const config of signalConfigs) {
        sources.set(
            config.signalName,
            createMemo(() => resolveSource(config), null, { equals: sameSource })
        )
    }

    return sources
}

/**
 * Acumula max/min/sum/count por card. A média é derivada no componente visual
 * para manter este hook focado em estado.
 */
export function useSignalStats(signalConfigs, sources) {
    const [stats, setStats] = createStore({})

    for (const config of signalConfigs) {
        const source = sources.get(config.signalName)

        createEffect(() => {
            const value = source()?.value
            if (value == null) return

            setStats(config.signalName, (prev) => {
                if (!prev) {
                    return { max: value, min: value, sum: value, count: 1 }
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
