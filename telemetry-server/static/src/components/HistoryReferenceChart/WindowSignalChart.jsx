import { Show, createEffect, onCleanup, onMount } from 'solid-js'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import {
    mergeBuffers,
    sliceBufferByWindow,
    toRelativeTimestamps,
} from '../../utils/chartHelpers'
import { buildUPlotOptions, cursorSync } from '../MotecChart/chartOptions'
import { formatDuration } from './historyUtils'

function WindowSignalChart(props) {
    let containerRef
    let chart = null
    let chartSignalsKey = ''
    let resizeObserver = null

    function destroyChart() {
        if (!chart) return

        chart.destroy()
        chart = null
        chartSignalsKey = ''
    }

    function renderChart() {
        const bounds = props.sessionBounds
        const range = props.range
        const signals = props.signals ?? []
        const sigKey = signals.join('|')

        if (
            bounds?.startTimestamp == null ||
            !range ||
            signals.length === 0 ||
            !containerRef
        ) {
            destroyChart()
            props.onDataState?.(false)
            return
        }

        if (chart && chartSignalsKey !== sigKey) {
            destroyChart()
        }

        const startTimestamp = bounds.startTimestamp + range.startSeconds
        const endTimestamp = bounds.startTimestamp + range.endSeconds
        const windowBuffers = signals.map((name) =>
            sliceBufferByWindow(props.buffers?.get(name), startTimestamp, endTimestamp)
        )
        const { alignedTs, valueArrays } = mergeBuffers(windowBuffers, signals)
        const relativeTs = toRelativeTimestamps(alignedTs, bounds.startTimestamp)

        if (!relativeTs.length) {
            destroyChart()
            props.onDataState?.(false)
            return
        }

        const opts = buildUPlotOptions({
            width: containerRef.clientWidth || 800,
            height: 220,
            signals,
            cursorSync,
            relativeTime: true,
            multiAxis: signals.length > 1,
        })
        const data = [relativeTs, ...valueArrays]

        if (!chart) {
            chart = new uPlot(opts, data, containerRef)
            chartSignalsKey = sigKey
        } else {
            chart.setData(data)
        }

        chart.setScale('x', {
            min: range.startSeconds,
            max: range.endSeconds,
        })
        props.onDataState?.(true)
    }

    onMount(() => {
        resizeObserver = new ResizeObserver(() => {
            if (!chart || !containerRef) return

            chart.setSize({
                width: containerRef.clientWidth,
                height: 220,
            })
        })

        resizeObserver.observe(containerRef)
    })

    createEffect(() => {
        props.buffersVersion
        props.sessionBounds?.startTimestamp
        props.range?.startSeconds
        props.range?.endSeconds
        ;(props.signals ?? []).join('|')

        renderChart()
    })

    onCleanup(() => {
        resizeObserver?.disconnect()
        destroyChart()
    })

    return (
        <div class="history-reference__detail">
            <div class="history-reference__window-header">
                <span>Grafico dos sinais na janela</span>
                <Show when={props.range}>
                    <strong>
                        {formatDuration(props.range.startSeconds)} - {formatDuration(props.range.endSeconds)}
                    </strong>
                </Show>
            </div>

            <div ref={containerRef} class="history-reference__detail-chart" />

            <Show when={!props.hasData}>
                <div class="history-reference__detail-empty">
                    Selecione sinais com dados nessa janela para plotar o detalhe.
                </div>
            </Show>
        </div>
    )
}

export default WindowSignalChart
