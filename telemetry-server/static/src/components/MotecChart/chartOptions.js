/**
 * ============================================================================
 * chartOptions.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Este arquivo contém APENAS:
 *
 *   - configuração visual do uPlot
 *   - sync compartilhado
 *   - estilos
 *   - axes
 *   - séries
 *
 * A ideia é:
 *
 * manter configuração PURA e desacoplada.
 *
 * Isso facilita:
 *
 *   - manutenção
 *   - testes
 *   - reuso
 *   - criação de temas
 *   - múltiplos tipos de gráfico
 *
 * ============================================================================
 */

import uPlot from 'uplot'
import { getSignalClassColor } from '../../utils/signalClasses'

/**
 * ============================================================================
 * CURSOR SYNC
 * ============================================================================
 *
 * Todas as instâncias de gráficos compartilham
 * o MESMO sync object.
 *
 * Resultado:
 *
 * mover cursor em um gráfico
 * move cursor nos demais.
 *
 * Isso é EXTREMAMENTE útil para análise de telemetria.
 */
export const cursorSync = uPlot.sync(
    'eracing-telemetry'
)

/**
 * ============================================================================
 * BUILD OPTIONS
 * ============================================================================
 *
 * Gera objeto de configuração do uPlot.
 *
 * IMPORTANTE:
 * -----------
 *
 * Essa função é PURA.
 *
 * Ela:
 *
 *   recebe inputs
 *   → retorna config
 *
 * sem side effects.
 */
export function buildUPlotOptions({
    width,
    height,
    signals,
    cursorSync,
    }) {
/**
   * ==========================================================================
   * SERIES
   * ==========================================================================
   *
   * uPlot exige:
   *
   * série 0 = eixo X
   *
   * As demais são dados.
   */
    const series = [
        {},

        ...signals.map((name, i) => ({
        label: name,

        stroke:
            getSignalClassColor(name, i),

        width: 1.5,

        points: {
            show: false,
        },
        })),
    ]

    return {
        width,
        height,

    /**
     * ========================================================================
     * CURSOR SYNC
     * ========================================================================
     */
        cursor: {
        sync: {
            key: cursorSync.key,
        },
        },

    /**
     * ========================================================================
     * SCALES
     * ========================================================================
     */
        scales: {
        x: { time: true },
        y: {
            auto: true,
            range: (_, min, max) => {
                if (min == null || max == null) return [min, max]
                if (min === max) return [min - 1, max + 1]

                const padding = (max - min) * 0.10

                return [min - padding, max + padding]
            },
        },
        },

    /**
     * ========================================================================
     * AXES
     * ========================================================================
     */
    axes: [
        {
            /**
             * Formatação do timestamp.
             */
            values: (_, ticks) =>
            ticks.map((t) => {
                const d = new Date(t * 1000)

                return [
                d
                    .getHours()
                    .toString()
                    .padStart(2, '0'),

                d
                    .getMinutes()
                    .toString()
                    .padStart(2, '0'),

                d
                    .getSeconds()
                    .toString()
                    .padStart(2, '0'),
                ].join(':')
            }),

            stroke: '#8b92a8',

            ticks: {
            stroke:
                'rgba(255,255,255,0.06)',
            },

            grid: {
            stroke:
                'rgba(255,255,255,0.06)',
            },
        },

        /**
       * Eixo Y
       */
        {
            stroke: '#8b92a8',

            ticks: {
            stroke:
                'rgba(255,255,255,0.06)',
            },

            grid: {
            stroke:
                'rgba(255,255,255,0.06)',
            },
        },
    ],

    /**
     * Séries configuradas.
     */
    series,

    /**
     * Legenda.
     */
    legend: {
        show: true,
        },
    }
}
