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

function formatRelativeSeconds(totalSeconds) {
    if (totalSeconds == null || !isFinite(totalSeconds)) return '00:00'

    const clamped = Math.max(0, totalSeconds)
    const minutes = Math.floor(clamped / 60)
    const seconds = Math.floor(clamped % 60)

    return [
        minutes.toString().padStart(2, '0'),
        seconds.toString().padStart(2, '0'),
    ].join(':')
}

function dynamicRange(_u, dataMin, dataMax) {
    if (dataMin == null || dataMax == null) return [-1, 1]

    if (dataMin === dataMax) {
        const margin = Math.abs(dataMin) * 0.1 || 1
        return [dataMin - margin, dataMax + margin]
    }

    const range = dataMax - dataMin
    const margin = range * 0.10
    return [dataMin - margin, dataMax + margin]
}

export function buildUPlotOptions({
    width,
    height,
    signals,
    cursorSync,
    relativeTime = false,
    multiAxis = false,
    onCursor,
    onSelect,
}) {
    const series = [
        {},
        ...signals.map((name, i) => ({
            label: name,
            scale: multiAxis ? `y${i}` : 'y',
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
    const scales = multiAxis
        ? {
            x: { time: !relativeTime },
            ...Object.fromEntries(
                signals.map((_, i) => [
                    `y${i}`,
                    {
                        auto: true,
                        range: dynamicRange,
                    },
                ])
            ),
        }
        : {
            x: { time: !relativeTime },
            y: {
                auto: true,
                range: (_u, dataMin, dataMax) => {
                    if (isFixedDomain) {
                        return [fixedMin, fixedMax]
                    }

                    return dynamicRange(_u, dataMin, dataMax)
                },
            },
        }
    const xAxis = {
        values: (_, ticks) =>
            ticks.map((t) => {
                if (relativeTime) return formatRelativeSeconds(t)

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
    }
    const axes = multiAxis
        ? [
            xAxis,
            ...signals.map((_, i) => {
                const color = getSignalColor(i)

                return {
                    scale: `y${i}`,
                    side: 3,
                    size: 48,
                    values: (_u, ticks) =>
                        ticks.map((v) =>
                            v == null ? '' : Number(v).toFixed(0)
                        ),
                    stroke: color,
                    ticks: { stroke: color },
                    grid: {
                        show: i === 0,
                        stroke: 'rgba(255,255,255,0.06)',
                    },
                }
            }),
        ]
        : [
            xAxis,
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
        ]

    return {
        width,
        height,

        cursor: {
            sync: { key: cursorSync.key },
            drag: {
                x: !!onSelect,
                y: false,
                setScale: false,
            },
        },

        hooks: {
            setCursor: onCursor ? [
                (u) => {
                    if (u.cursor.left == null) return
                    onCursor(u.posToVal(u.cursor.left, 'x'))
                },
            ] : [],
            setSelect: onSelect ? [
                (u) => {
                    const left = u.select.left ?? 0
                    const width = u.select.width ?? 0

                    if (width <= 0) return

                    const start = u.posToVal(left, 'x')
                    const end = u.posToVal(left + width, 'x')
                    onSelect({
                        startSeconds: Math.max(0, Math.min(start, end)),
                        endSeconds: Math.max(0, Math.max(start, end)),
                    })
                },
            ] : [],
        },

        scales,

        axes,

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
