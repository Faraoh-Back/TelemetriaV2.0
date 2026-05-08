/**
 * ============================================================================
 * MotecChart.jsx
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Este arquivo é o "orquestrador" do gráfico.
 *
 * Ele NÃO contém lógica pesada de dados nem configuração detalhada do uPlot.
 * Seu papel é:
 *
 *   1. Criar/destruir o gráfico
 *   2. Integrar SolidJS + uPlot
 *   3. Observar mudanças reativas
 *   4. Atualizar o gráfico quando necessário
 *   5. Renderizar o container visual
 *
 * ARQUITETURA:
 * -------------
 *
 * MotecChart.jsx
 *    │
 *    ├── useChartData.js
 *    │      ├── requestBuffer()
 *    │      ├── mergeBuffers()
 *    │      └── throttle/rAF
 *    │
 *    ├── chartOptions.js
 *    │      └── buildUPlotOptions()
 *    │
 *    └── MotecChart.css
 *
 * FLUXO:
 * ------
 *
 * onMount()
 *    │
 *    ├── ensureChart()
 *    │      ├── tenta carregar buffers iniciais
 *    │      └── cria uPlot somente quando houver dados
 *    │
 *    └── createEffect()
 *           └── observa signals[name].timestamp
 *                    │
 *                    ▼
 *               scheduleFlush()
 *                    │
 *                    ▼
 *               updateOrCreateChart()
 *                    │
 *                    ▼
 *               chart.setData() ou cria chart tardio
 *
 * ============================================================================
 */

import { onMount, onCleanup, createEffect } from 'solid-js'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

/**
 * Store reativo global.
 *
 * signals[name].timestamp muda sempre que um sinal recebe novos dados.
 * Isso é usado como gatilho reativo.
 */
import { signals } from '../../store.js'

/**
 * Hook responsável pela camada de dados.
 *
 * Ele encapsula:
 *
 *   - requestBuffer()
 *   - mergeBuffers()
 *   - throttling
 *   - requestAnimationFrame
 */
import { useChartData } from './useChartData'

/**
 * Configuração visual pura do uPlot.
 *
 * Separar isso reduz acoplamento e deixa
 * o componente principal mais limpo.
 */
import {
    buildUPlotOptions,
    cursorSync,
} from './chartOptions'

import './MotecChart.css'

function MotecChart(props) {
    /**
     * Referência do div onde o uPlot será montado.
     */
    let containerRef

    /**
     * Instância do uPlot.
     *
     * IMPORTANTE:
     * O uPlot é imperativo.
     * Ele existe fora do sistema reativo do Solid.
     */
    let chart = null

    /**
     * ResizeObserver usado para responsividade.
     */
    let resizeObserver = null
    let isInitializing = false
    let isDisposed = false

    /**
     * Hook de dados.
     */
    const {
        cancelScheduledFlush,
        flushChart,
        scheduleFlush,
    } = useChartData(props)

    /**
     * ==========================================================================
     * ENSURE CHART
     * ==========================================================================
     *
     * Responsável por:
     *
     *   1. Buscar buffers iniciais
     *   2. Criar opções do uPlot
     *   3. Instanciar o gráfico
     *
     * Pode rodar no onMount() ou depois, quando o primeiro buffer chegar.
     * Isso é importante para gráficos customizados: o usuário pode selecionar um
     * sinal antes de o worker já ter histórico suficiente para montar o uPlot.
     */
    async function ensureChart() {
        if (chart || isInitializing || isDisposed || !containerRef) return false

        isInitializing = true

        /**
         * flushChart() já retorna os dados alinhados.
         */
        let chartData

        try {
        chartData = await flushChart()
        } finally {
        isInitializing = false
        }

        const {
        alignedTs,
        valueArrays,
        sigNames,
        } = chartData

        /**
         * Evita criar gráfico vazio. O próximo timestamp observado tentará de novo.
         */
        if (isDisposed || chart || !alignedTs.length) return false

        /**
         * Configuração visual do gráfico.
         */
        const opts = buildUPlotOptions({
        width: containerRef.clientWidth || 600,
        height: props.height ?? 200,
        signals: sigNames,
        cursorSync,
        })

        /**
         * Cria o gráfico.
         *
         * uPlot espera:
         *
         * [
         *   timestamps,
         *   serie1,
         *   serie2,
         *   ...
         * ]
         */
        chart = new uPlot(
        opts,
        [alignedTs, ...valueArrays],
        containerRef
        )

        return true
    }

    /**
     * ==========================================================================
     * UPDATE OR CREATE CHART
     * ==========================================================================
     *
     * Atualiza dados do gráfico existente ou tenta criar o gráfico tardiamente.
     *
     * IMPORTANTE:
     * Uma vez que o uPlot existe, não recriamos em cada atualização; apenas
     * trocamos os dados usando chart.setData().
     */
    async function updateOrCreateChart() {
        if (!chart) {
        await ensureChart()
        return
        }

        const {
        alignedTs,
        valueArrays,
        } = await flushChart()

        if (alignedTs.length > 0) {
        chart.setData([
            alignedTs,
            ...valueArrays,
        ])
        }
    }

    /**
     * ==========================================================================
     * LIFECYCLE
     * ==========================================================================
     */
    onMount(async () => {
        /**
         * Cria gráfico inicial.
         */
        await initChart()

        /**
         * ========================================================================
         * REATIVIDADE
         * ========================================================================
         *
         * Este effect observa:
         *
         *   signals[name]?.timestamp
         *
         * Sempre que um sinal recebe novos dados,
         * o effect é reexecutado.
         *
         * Porém:
         *
         * NÃO atualizamos imediatamente.
         *
         * Em vez disso:
         *
         *   scheduleFlush()
         *
         * faz throttling via requestAnimationFrame.
         *
         * Isso evita:
         *
         *   - excesso de render
         *   - excesso de setData()
         *   - stutter visual
         *   - uso excessivo de CPU
         */
        createEffect(() => {
        const sigNames = props.signals ?? []

        /**
         * Apenas acessar a propriedade já registra
         * dependência reativa no Solid.
         */
        for (const name of sigNames) {
            signals[name]?.timestamp
        }

        scheduleFlush(updateOrCreateChart)
        })

        /**
         * ========================================================================
         * RESPONSIVIDADE
         * ========================================================================
         *
         * ResizeObserver detecta mudanças no tamanho do container.
         *
         * Quando isso ocorre:
         *
         *   chart.setSize()
         *
         * evita precisar recriar o gráfico.
         */
        resizeObserver = new ResizeObserver(() => {
        if (!chart || !containerRef) return

        chart.setSize({
            width: containerRef.clientWidth,
            height: props.height ?? 200,
        })
        })

        resizeObserver.observe(containerRef)
    })

    /**
     * ==========================================================================
     * CLEANUP
     * ==========================================================================
     *
     * Importante para evitar:
     *
     *   - memory leaks
     *   - observers órfãos
     *   - RAFs pendurados
     *   - instâncias uPlot vazando
     */
    onCleanup(() => {
        resizeObserver?.disconnect()
        cancelScheduledFlush()
        isDisposed = true

        if (chart) {
        chart.destroy()
        chart = null
        }
    })

    /**
     * ==========================================================================
     * RENDER
     * ==========================================================================
     */
    return (
        <div class="motec-chart">
        <div class="motec-chart-title">
            {props.label}
        </div>

        <div
            ref={containerRef}
            class="motec-chart-canvas"
        />
        </div>
    )
}

export default MotecChart
