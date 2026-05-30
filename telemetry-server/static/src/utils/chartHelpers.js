/**
 * ============================================================================
 * chartHelpers.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Helpers puros para preparar dados de gráfico.
 *
 * O uPlot trabalha melhor com um eixo X compartilhado. Como cada sinal pode
 * chegar com timestamps próprios, este módulo alinha séries diferentes em um
 * único eixo temporal antes do render.
 */

export function mergeBuffers(results, signalNames) {
    let refIdx = 0
    let maxLen = 0

    for (let i = 0; i < results.length; i++) {
        const len = results[i]?.ts?.length ?? 0

        if (len > maxLen) {
            maxLen = len
            refIdx = i
        }
    }

    if (maxLen === 0) {
        return {
            alignedTs: new Float64Array(0),
            valueArrays: signalNames.map(() => new Float64Array(0)),
        }
    }

    const alignedTs = results[refIdx].ts
    const valueArrays = results.map((result) => {
        if (!result?.ts || result.ts.length === 0) {
            return new Float64Array(alignedTs.length)
        }

        if (
            result.ts === alignedTs ||
            result.ts.length === alignedTs.length
        ) {
            return result.val
        }

        const out = new Float64Array(alignedTs.length)
        let j = 0

        for (let i = 0; i < alignedTs.length; i++) {
            const timestamp = alignedTs[i]

            while (
                j < result.ts.length - 1 &&
                result.ts[j + 1] <= timestamp
            ) {
                j++
            }

            out[i] = result.val[j] ?? 0
        }

        return out
    })

    return {
        alignedTs,
        valueArrays,
    }
}

export function getHistoryBounds(results) {
    let startTimestamp = Infinity
    let endTimestamp = -Infinity

    for (const result of results) {
        if (!result?.ts?.length) continue

        startTimestamp = Math.min(startTimestamp, result.ts[0])
        endTimestamp = Math.max(endTimestamp, result.ts[result.ts.length - 1])
    }

    if (!isFinite(startTimestamp) || !isFinite(endTimestamp)) {
        return {
            startTimestamp: null,
            endTimestamp: null,
            durationSeconds: 0,
        }
    }

    return {
        startTimestamp,
        endTimestamp,
        durationSeconds: Math.max(0, endTimestamp - startTimestamp),
    }
}

export function toRelativeTimestamps(timestamps, startTimestamp) {
    if (!timestamps?.length || startTimestamp == null) {
        return new Float64Array(0)
    }

    const out = new Float64Array(timestamps.length)

    for (let i = 0; i < timestamps.length; i++) {
        out[i] = Math.max(0, timestamps[i] - startTimestamp)
    }

    return out
}

export function getNearestSample(buffer, targetTimestamp) {
    if (!buffer?.ts?.length || targetTimestamp == null) return null

    const { ts, val } = buffer
    let lo = 0
    let hi = ts.length - 1

    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)

        if (ts[mid] < targetTimestamp) {
            lo = mid + 1
        } else if (ts[mid] > targetTimestamp) {
            hi = mid - 1
        } else {
            return {
                timestamp: ts[mid],
                value: val[mid],
            }
        }
    }

    const nextIdx = Math.min(lo, ts.length - 1)
    const prevIdx = Math.max(0, lo - 1)
    const nextDistance = Math.abs(ts[nextIdx] - targetTimestamp)
    const prevDistance = Math.abs(ts[prevIdx] - targetTimestamp)
    const idx = prevDistance <= nextDistance ? prevIdx : nextIdx

    return {
        timestamp: ts[idx],
        value: val[idx],
    }
}

export function getWindowStats(buffer, startTimestamp, endTimestamp) {
    if (
        !buffer?.ts?.length ||
        startTimestamp == null ||
        endTimestamp == null
    ) {
        return null
    }

    const start = Math.min(startTimestamp, endTimestamp)
    const end = Math.max(startTimestamp, endTimestamp)
    const { ts, val } = buffer
    let count = 0
    let sum = 0
    let min = Infinity
    let max = -Infinity

    for (let i = 0; i < ts.length; i++) {
        const timestamp = ts[i]
        if (timestamp < start) continue
        if (timestamp > end) break

        const value = val[i]
        if (value == null || !isFinite(value)) continue

        count++
        sum += value
        min = Math.min(min, value)
        max = Math.max(max, value)
    }

    if (count === 0) return null

    return {
        count,
        min,
        max,
        avg: sum / count,
    }
}

export function sliceBufferByWindow(buffer, startTimestamp, endTimestamp) {
    if (
        !buffer?.ts?.length ||
        startTimestamp == null ||
        endTimestamp == null
    ) {
        return {
            ts: new Float64Array(0),
            val: new Float64Array(0),
        }
    }

    const start = Math.min(startTimestamp, endTimestamp)
    const end = Math.max(startTimestamp, endTimestamp)
    const { ts, val } = buffer
    let startIdx = 0
    let endIdx = ts.length

    while (startIdx < ts.length && ts[startIdx] < start) {
        startIdx++
    }

    endIdx = startIdx
    while (endIdx < ts.length && ts[endIdx] <= end) {
        endIdx++
    }

    return {
        ts: ts.slice(startIdx, endIdx),
        val: val.slice(startIdx, endIdx),
    }
}
