import { createEffect, onCleanup, onMount } from 'solid-js'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import {
    mergeBuffers,
    toRelativeTimestamps,
} from '../../utils/chartHelpers'
import { buildUPlotOptions, cursorSync } from '../MotecChart/chartOptions'

function ReferenceRpmChart(props) {
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
        const signals = props.signals ?? []
        const sigKey = signals.join('|')

        if (
            !containerRef ||
            bounds?.startTimestamp == null ||
            signals.length === 0
        ) {
            destroyChart()
            props.onDataState?.(false)
            return
        }

        if (chart && chartSignalsKey !== sigKey) {
            destroyChart()
        }

        const buffers = signals.map((name) => props.buffers?.get(name))
        const { alignedTs, valueArrays } = mergeBuffers(buffers, signals)
        const relativeTs = toRelativeTimestamps(alignedTs, bounds.startTimestamp)

        if (!relativeTs.length) {
            destroyChart()
            props.onDataState?.(false)
            return
        }

        const opts = buildUPlotOptions({
            width: containerRef.clientWidth || 800,
            height: props.height ?? 260,
            signals,
            cursorSync,
            relativeTime: true,
            onCursor: props.onCursor,
            onSelect: props.onSelect,
        })
        const data = [relativeTs, ...valueArrays]

        if (!chart) {
            chart = new uPlot(opts, data, containerRef)
            chartSignalsKey = sigKey
        } else {
            chart.setData(data)
        }

        props.onDataState?.(true)
    }

    onMount(() => {
        resizeObserver = new ResizeObserver(() => {
            if (!chart || !containerRef) return

            chart.setSize({
                width: containerRef.clientWidth,
                height: props.height ?? 260,
            })
        })

        resizeObserver.observe(containerRef)
    })

    createEffect(() => {
        props.buffersVersion
        props.height
        props.sessionBounds?.startTimestamp
        props.sessionBounds?.endTimestamp
        ;(props.signals ?? []).join('|')

        renderChart()
    })

    onCleanup(() => {
        resizeObserver?.disconnect()
        destroyChart()
    })

    return <div ref={containerRef} class="history-reference__chart" />
}

export default ReferenceRpmChart
