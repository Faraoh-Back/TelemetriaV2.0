/**
 * ============================================================================
 * chartOptions.js  (atualizado)
 * ============================================================================
 *
 * Alterações:
 *   - Séries usam getSignalColor(index) — paleta fixa por índice,
 *     consistente com cards e legenda.
 *   - Domínio do eixo Y: fixo para sinais conhecidos (rpm, acc, temp, voltage,
 *     power); dinâmico com margem 10% para demais, via getYDomain().
 *   - Tooltip/legenda formata valores com 2 casas decimais.
 *   - points.show: false, espessura de linha uniforme 1.5px.
 */

import uPlot from 'uplot'
import { getSignalColor, getYDomain } from '../../utils/telemetryUtils.js'

export const cursorSync = uPlot.sync('eracing-telemetry')

export function buildUPlotOptions({ width, height, signals, cursorSync }) {
    const series = [
        {},
        ...signals.map((name, i) => ({
            label: name,
            stroke: getSignalColor(i),
            width: 1.5,
            points: { show: false },
        })),
    ]

    // Pré-calcula domínio; getYDomain retorna null para tipo 'default'
    // (indica que devemos calcular dinamicamente com os dados reais)
    const [fixedMin, fixedMax] = getYDomain(signals, null)
    const isFixedDomain = fixedMin !== null && fixedMax !== null
    const yAxisLabelSize = isFixedDomain ? 88 : 72

    return {
        width,
        height,

        cursor: {
            sync: { key: cursorSync.key },
        },

        scales: {
            x: { time: true },
            y: {
                auto: true,
                range: (_u, dataMin, dataMax) => {
                    if (isFixedDomain) {
                        return [fixedMin, fixedMax]
                    }

                    if (dataMin == null || dataMax == null) return [-1, 1]

                    if (dataMin === dataMax) {
                        const margin = Math.abs(dataMin) * 0.1 || 1
                        return [dataMin - margin, dataMax + margin]
                    }

                    const range = dataMax - dataMin
                    const margin = range * 0.10
                    return [dataMin - margin, dataMax + margin]
                },
            },
        },

        axes: [
            {
                values: (_, ticks) =>
                    ticks.map((t) => {
                        const d = new Date(t * 1000)
                        return [
                            d.getHours().toString().padStart(2, '0'),
                            d.getMinutes().toString().padStart(2, '0'),
                            d.getSeconds().toString().padStart(2, '0'),
                        ].join(':')
                    }),
                stroke: '#8b92a8',
                ticks:  { stroke: 'rgba(255,255,255,0.06)' },
                grid:   { stroke: 'rgba(255,255,255,0.06)' },
            },
            {
                values: (_, ticks) =>
                    ticks.map((v) =>
                        v == null ? '' : Number(v).toFixed(2)
                    ),
                size: yAxisLabelSize,
                stroke: '#8b92a8',
                ticks:  { stroke: 'rgba(255,255,255,0.06)' },
                grid:   { stroke: 'rgba(255,255,255,0.06)' },
            },
        ],

        legend: {
            show: true,
            values: [
                {},
                ...signals.map(() => ({
                    value: (u, seriesIdx, dataIdx) => {
                        if (dataIdx == null) return '—'
                        const val = u.data?.[seriesIdx]?.[dataIdx]
                        if (val == null || !isFinite(val)) return '—'
                        return Number(val).toFixed(2)
                    },
                })),
            ],
        },

        series,
    }
}
