import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

import { requestBuffer, signals } from '../../store.js'
import {
    getHistoryBounds,
    getNearestSample,
    getWindowStats,
} from '../../utils/chartHelpers'
import { formatValue2 } from '../../utils/telemetryUtils.js'
import ReferenceRpmChart from './ReferenceRpmChart'
import WindowSignalChart from './WindowSignalChart'
import WindowStatsTable from './WindowStatsTable'
import {
    DEFAULT_RPM_SIGNALS,
    formatDuration,
    uniqueSignals,
} from './historyUtils'
import './HistoryReferenceChart.css'

function HistoryReferenceChart(props) {
    let refreshTimer = null
    let isDisposed = false
    let cachedBuffers = new Map()

    const rpmSignals = createMemo(() => props.referenceSignals ?? DEFAULT_RPM_SIGNALS)
    const analysisSignals = createMemo(() => uniqueSignals(props.signals ?? []))
    const visibleSignals = createMemo(() =>
        uniqueSignals([
            ...rpmSignals(),
            ...analysisSignals(),
        ])
    )

    const [hasReferenceData, setHasReferenceData] = createSignal(false)
    const [hasDetailData, setHasDetailData] = createSignal(false)
    const [isLoading, setIsLoading] = createSignal(false)
    const [buffersVersion, setBuffersVersion] = createSignal(0)
    const [sessionBounds, setSessionBounds] = createSignal({
        startTimestamp: null,
        endTimestamp: null,
        durationSeconds: 0,
    })
    const [cursorSeconds, setCursorSeconds] = createSignal(null)
    const [selectedRange, setSelectedRange] = createSignal(null)
    const [sampleRows, setSampleRows] = createSignal([])
    const [windowRows, setWindowRows] = createSignal([])

    function updateSampleRows(relativeSeconds = cursorSeconds()) {
        const bounds = sessionBounds()
        if (bounds.startTimestamp == null || relativeSeconds == null) {
            setSampleRows([])
            return
        }

        const targetTimestamp = bounds.startTimestamp + relativeSeconds
        const rows = analysisSignals().map((name) => {
            const sample = getNearestSample(cachedBuffers.get(name), targetTimestamp)
            const entry = signals[name]

            return {
                name,
                value: sample?.value ?? null,
                unit: entry?.unit ?? '',
                deltaSeconds: sample ? sample.timestamp - bounds.startTimestamp : null,
            }
        })

        setSampleRows(rows)
    }

    function updateWindowRows(range = selectedRange()) {
        const bounds = sessionBounds()

        if (
            bounds.startTimestamp == null ||
            !range ||
            analysisSignals().length === 0
        ) {
            setWindowRows([])
            return
        }

        const startTimestamp = bounds.startTimestamp + range.startSeconds
        const endTimestamp = bounds.startTimestamp + range.endSeconds
        const rows = analysisSignals().map((name) => {
            const stats = getWindowStats(
                cachedBuffers.get(name),
                startTimestamp,
                endTimestamp
            )
            const entry = signals[name]

            return {
                name,
                unit: entry?.unit ?? '',
                stats,
            }
        })

        setWindowRows(rows)
    }

    function handleCursor(relativeSeconds) {
        const duration = sessionBounds().durationSeconds
        const clamped = Math.max(0, Math.min(relativeSeconds, duration))
        setCursorSeconds(clamped)
        updateSampleRows(clamped)
    }

    function handleSelect(range) {
        setSelectedRange(range)
        handleCursor(range.startSeconds)
        updateWindowRows(range)
    }

    async function loadHistory() {
        const names = visibleSignals()
        if (!names.length || isLoading()) return

        setIsLoading(true)

        try {
            const results = await Promise.all(
                names.map((name) => requestBuffer(name, 3900, null))
            )

            if (isDisposed) return

            cachedBuffers.clear()
            names.forEach((name, index) => {
                cachedBuffers.set(name, results[index])
            })

            setSessionBounds(getHistoryBounds(results))
            setBuffersVersion((version) => version + 1)

            if (cursorSeconds() == null) {
                handleCursor(0)
            } else {
                updateSampleRows(cursorSeconds())
            }

            updateWindowRows()
        } finally {
            if (!isDisposed) setIsLoading(false)
        }
    }

    function scheduleLoadHistory() {
        if (refreshTimer) return

        refreshTimer = window.setTimeout(() => {
            refreshTimer = null
            loadHistory()
        }, 350)
    }

    onMount(loadHistory)

    createEffect(() => {
        for (const name of visibleSignals()) {
            signals[name]?.timestamp
        }

        scheduleLoadHistory()
    })

    onCleanup(() => {
        isDisposed = true

        if (refreshTimer) {
            clearTimeout(refreshTimer)
            refreshTimer = null
        }
    })

    return (
        <section class="history-reference" aria-label="Analise historica por RPM">
            <header class="history-reference__header">
                <div>
                    <h2 class="history-reference__title">Historico relativo por RPM</h2>
                    <span class="history-reference__subtitle">
                        Boot 00:00.000 · Stop {formatDuration(sessionBounds().durationSeconds)}
                    </span>
                </div>

                <div class="history-reference__readout">
                    <span>Cursor</span>
                    <strong>{cursorSeconds() == null ? '-' : formatDuration(cursorSeconds())}</strong>
                </div>

                <Show when={selectedRange()}>
                    {(range) => (
                        <div class="history-reference__readout">
                            <span>Janela</span>
                            <strong>
                                {formatDuration(range().startSeconds)} - {formatDuration(range().endSeconds)}
                            </strong>
                        </div>
                    )}
                </Show>
            </header>

            <ReferenceRpmChart
                buffers={cachedBuffers}
                buffersVersion={buffersVersion()}
                height={props.height ?? 260}
                signals={rpmSignals()}
                sessionBounds={sessionBounds()}
                onCursor={handleCursor}
                onSelect={handleSelect}
                onDataState={setHasReferenceData}
            />

            <Show when={!hasReferenceData()}>
                <div class="history-reference__empty">
                    <strong>Sem historico de RPM para referencia</strong>
                    <span>Aguardando amostras de {rpmSignals().join(', ')}</span>
                </div>
            </Show>

            <div class="history-reference__samples">
                <Show
                    when={sampleRows().length > 0}
                    fallback={<span class="history-reference__samples-empty">Selecione sinais para comparar no instante do historico.</span>}
                >
                    <For each={sampleRows()}>
                        {(row) => (
                            <div class="history-reference__sample" title={row.name}>
                                <span class="history-reference__sample-name">{row.name}</span>
                                <strong>
                                    {formatValue2(row.value)}
                                    <span>{row.unit}</span>
                                </strong>
                                <small>{row.deltaSeconds == null ? '-' : formatDuration(row.deltaSeconds)}</small>
                            </div>
                        )}
                    </For>
                </Show>
            </div>

            <Show when={selectedRange()}>
                <WindowStatsTable
                    range={selectedRange()}
                    rows={windowRows()}
                />

                <WindowSignalChart
                    buffers={cachedBuffers}
                    buffersVersion={buffersVersion()}
                    hasData={hasDetailData()}
                    range={selectedRange()}
                    signals={analysisSignals()}
                    sessionBounds={sessionBounds()}
                    onDataState={setHasDetailData}
                />
            </Show>
        </section>
    )
}

export default HistoryReferenceChart
