/**
 * ============================================================================
 * useChartData.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Este arquivo encapsula TODA a lógica relacionada a:
 *
 *   - aquisição de dados
 *   - merge/alinhamento temporal
 *   - throttle
 *   - requestAnimationFrame
 *   - preparação para uPlot
 *
 * O objetivo é:
 *
 *   "tirar inteligência do componente visual"
 *
 * Assim:
 *
 *   MotecChart.jsx
 *      → apenas coordena lifecycle/render
 *
 *   useChartData.js
 *      → faz trabalho pesado de dados
 *
 * ============================================================================
 */

import { requestBuffer } from '../../store.js'
import { mergeBuffers } from '../../utils/chartHelpers'

/**
 * Tempo mínimo entre atualizações do gráfico.
 *
 * 200ms ≈ 5 FPS
 *
 * Mais que suficiente para telemetria.
 *
 * Isso reduz:
 *
 *   - uso de CPU
 *   - GC pressure
 *   - stutter
 *   - redraw excessivo
 */
const REFRESH_INTERVAL = 200

export function useChartData(props) {
    /**
     * Handle do RAF atual.
     *
     * Usado para evitar múltiplos RAF simultâneos.
     */
    let rafHandle = null

    /**
     * Timestamp da última atualização real.
     */
    let lastRefresh = 0

    /**
     * ==========================================================================
     * FLUSH CHART
     * ==========================================================================
     *
     * Busca buffers atualizados para todos os sinais.
     *
     * Fluxo:
     *
     *   signal names
     *       │
     *       ▼
     *   requestBuffer()
     *       │
     *       ▼
     *   mergeBuffers()
     *       │
     *       ▼
     *   retorno pronto para uPlot
     */
    async function flushChart() {
        const sigNames = props.signals ?? []

        /**
         * Busca paralela dos buffers.
         */
        const results = await Promise.all(
        sigNames.map((name) =>
            requestBuffer(name, 500)
        )
        )

        const {
        alignedTs,
        valueArrays,
        } = mergeBuffers(results, sigNames)

        return {
        alignedTs,
        valueArrays,
        sigNames,
        }
    }

    /**
     * ==========================================================================
     * SCHEDULE FLUSH
     * ==========================================================================
     *
     * Faz:
     *
     *   - throttle
     *   - batching
     *   - RAF scheduling
     *
     * PROBLEMA:
     * ---------
     *
     * sinais CAN podem atualizar MUITO rápido.
     *
     * Sem throttle:
     *
     *   chart.setData()
     *
     * poderia rodar dezenas/centenas de vezes por segundo.
     *
     * SOLUÇÃO:
     * --------
     *
     * requestAnimationFrame + REFRESH_INTERVAL
     *
     * Resultado:
     *
     * updates suaves
     * sem saturar CPU.
     */
    function scheduleFlush(cb) {
        /**
         * Já existe RAF pendente.
         */
        if (rafHandle) return

        rafHandle = requestAnimationFrame(async () => {
        rafHandle = null

        const now = performance.now()

        /**
         * Ainda dentro do intervalo mínimo.
         */
        if (
            now - lastRefresh <
            REFRESH_INTERVAL
        ) {
            scheduleFlush(cb)
            return
        }

        lastRefresh = now

        await cb()
        })
    }

    function cancelScheduledFlush() {
        if (!rafHandle) return

        cancelAnimationFrame(rafHandle)
        rafHandle = null
    }

    return {
        cancelScheduledFlush,
        flushChart,
        scheduleFlush,
    }
}
