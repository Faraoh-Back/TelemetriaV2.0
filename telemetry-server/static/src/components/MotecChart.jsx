// src/components/MotecChart.jsx
//
// FLUXO:
//
//   onMount → requestBuffer(signal) para cada sinal → uPlot.setData()
//       │
//       ▼
//   worker { type: 'signal' } → store signals[name] muda
//       │
//       ▼
//   createEffect detecta mudança → agenda flush via rAF
//       │
//       ▼
//   flushPending() → requestBuffer() → uPlot.setData() a cada ~200ms
//
// CURSOR SYNC:
//   Todas as instâncias compartilham o mesmo objeto `cursorSync` (uPlot.sync).
//   Quando o cursor move em um gráfico, os demais seguem automaticamente.

import { onMount, onCleanup, createEffect } from 'solid-js'
import { requestBuffer, signals } from '../store.js'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

    // ─── CURSOR SYNC ──────────────────────────────────────────────────────────────
    // Instância única compartilhada por todos os MotecCharts na página.
    // Exportada para que outros componentes possam participar se necessário.
    export const cursorSync = uPlot.sync('eracing-telemetry')

    // ─── PALETA DE CORES ──────────────────────────────────────────────────────────
    // Cores suficientes para 8 sinais por gráfico.
    const COLORS = [
        '#1fb68e', // accent (verde)
        '#3d8ef0', // blue
        '#e09b2f', // amber
        '#e05252', // red
        '#a78bfa', // purple
        '#34d399', // green
        '#f472b6', // pink
        '#60a5fa', // light blue
    ]

    // Intervalo mínimo entre refreshes do gráfico (ms).
    // 200ms = 5fps de atualização de dados — mais que suficiente para análise.
    const REFRESH_INTERVAL = 200

    // ─── COMPONENTE ───────────────────────────────────────────────────────────────
    // Props:
    //   label   — string, título exibido acima do gráfico
    //   signals — string[], lista de signal_names a plotar
    //   window  — number (segundos), janela temporal padrão (default: 30)
    //   height  — number (px), altura do canvas (default: 200)

    function MotecChart(props) {
        let containerRef
        let chart = null
        let rafHandle = null
        let lastRefresh = 0

        // ─── BUILD uPlot ───────────────────────────────────────────────────────────
        async function initChart() {
            if (!containerRef) return

            const sigNames = props.signals ?? []
            if (sigNames.length === 0) return

            // Carrega buffers iniciais para todos os sinais em paralelo
            const results = await Promise.all(
            sigNames.map(name => requestBuffer(name, 500))
            )

            // Monta séries: a primeira é sempre o eixo X (timestamps)
            // uPlot espera data como [timestamps, ...values]
            const { alignedTs, valueArrays } = mergeBuffers(results, sigNames)

            const series = [
            {}, // eixo X — uPlot reserva o índice 0
            ...sigNames.map((name, i) => ({
                label: name,
                stroke: COLORS[i % COLORS.length],
                width: 1.5,
                points: { show: false },
            })),
            ]

            const opts = {
            width:  containerRef.clientWidth || 600,
            height: props.height ?? 200,
            cursor: {
                sync: { key: cursorSync.key },
            },
            scales: {
                x: { time: true },
                y: { auto: true },
            },
            axes: [
                {
                // eixo X — hora local
                values: (_, ticks) =>
                    ticks.map(t => {
                    const d = new Date(t * 1000)
                    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
                    }),
                stroke: '#8b92a8',
                ticks: { stroke: 'rgba(255,255,255,0.06)' },
                grid:  { stroke: 'rgba(255,255,255,0.06)' },
                },
                {
                stroke: '#8b92a8',
                ticks: { stroke: 'rgba(255,255,255,0.06)' },
                grid:  { stroke: 'rgba(255,255,255,0.06)' },
                },
            ],
            series,
            legend: { show: true },
            }

            chart = new uPlot(opts, [alignedTs, ...valueArrays], containerRef)
        }

        // ─── MERGE DE BUFFERS ──────────────────────────────────────────────────────
        // uPlot requer um eixo X único compartilhado por todas as séries.
        // Estratégia simples: usa o timestamp do sinal com mais pontos como eixo X
        // e interpola (ou deixa null) os demais. Para sinais do mesmo CAN ID os
        // timestamps já são idênticos, então na prática não há lacunas.
        function mergeBuffers(results, sigNames) {
            // Encontra o buffer com mais pontos para usar como eixo X de referência
            let refIdx = 0
            let maxLen = 0
            for (let i = 0; i < results.length; i++) {
            const len = results[i]?.ts?.length ?? 0
            if (len > maxLen) { maxLen = len; refIdx = i }
            }

            if (maxLen === 0) {
            return { alignedTs: new Float64Array(0), valueArrays: sigNames.map(() => new Float64Array(0)) }
            }

            const alignedTs = results[refIdx].ts

            // Para cada sinal, alinha ao eixo X de referência por busca binária
            const valueArrays = results.map((res) => {
            if (!res?.ts || res.ts.length === 0) return new Float64Array(alignedTs.length)

            // Se os timestamps são idênticos ao de referência (caso mais comum), usa direto
            if (res.ts === alignedTs || res.ts.length === alignedTs.length) return res.val

            // Caso contrário, interpola linearmente
            const out = new Float64Array(alignedTs.length)
            let j = 0
            for (let i = 0; i < alignedTs.length; i++) {
                const t = alignedTs[i]
                while (j < res.ts.length - 1 && res.ts[j + 1] <= t) j++
                out[i] = res.val[j] ?? 0
            }
            return out
            })

            return { alignedTs, valueArrays }
        }

        // ─── REFRESH PERIÓDICO ─────────────────────────────────────────────────────
        // createEffect observa qualquer sinal da lista. Quando algum atualiza,
        // agenda um flush via rAF com throttle de REFRESH_INTERVAL ms.
        function scheduleFlush() {
            if (rafHandle) return
            rafHandle = requestAnimationFrame(async () => {
            rafHandle = null
            const now = performance.now()
            if (now - lastRefresh < REFRESH_INTERVAL) {
                rafHandle = requestAnimationFrame(scheduleFlush)
                return
            }
            lastRefresh = now
            await flushChart()
            })
        }

        async function flushChart() {
            if (!chart) return
            const sigNames = props.signals ?? []
            const results = await Promise.all(
            sigNames.map(name => requestBuffer(name, 500))
            )
            const { alignedTs, valueArrays } = mergeBuffers(results, sigNames)
            if (alignedTs.length > 0) {
            chart.setData([alignedTs, ...valueArrays])
            }
        }

        // ─── LIFECYCLE ────────────────────────────────────────────────────────────
        onMount(async () => {
            await initChart()

            // Observa mudanças nos sinais para disparar refresh
            // createEffect fora do JSX precisa estar dentro do onMount para ter
            // acesso ao chart já construído
            createEffect(() => {
            const sigNames = props.signals ?? []
            // Acessa cada sinal do store para registrar a dependência reativa
            for (const name of sigNames) {
                // eslint-disable-next-line no-unused-expressions
                signals[name]?.timestamp
            }
            if (chart) scheduleFlush()
            })

            // Redimensiona o gráfico quando o container muda de tamanho
            const ro = new ResizeObserver(() => {
            if (chart && containerRef) {
                chart.setSize({ width: containerRef.clientWidth, height: props.height ?? 200 })
            }
            })
            ro.observe(containerRef)
            onCleanup(() => ro.disconnect())
        })

        onCleanup(() => {
            if (rafHandle) cancelAnimationFrame(rafHandle)
            if (chart) { chart.destroy(); chart = null }
        })

        // ─── RENDER ───────────────────────────────────────────────────────────────
        return (
            <div style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            'border-radius': '8px',
            padding: '12px',
            'margin-bottom': '12px',
            }}>
            <div style={{
                color: 'var(--text2)',
                'font-size': '11px',
                'text-transform': 'uppercase',
                'letter-spacing': '0.06em',
                'margin-bottom': '8px',
            }}>
                {props.label}
            </div>
            <div ref={containerRef} />
            </div>
        )
    }

export default MotecChart