/**
 * ============================================================================
 * lttb.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Reduzir uma série temporal preservando a forma visual da curva.
 *
 * LTTB (Largest-Triangle-Three-Buckets) é usado antes de enviar dados ao uPlot
 * para evitar desenhar milhares de pontos quando algumas centenas preservam os
 * picos, vales e tendências que importam para análise.
 */

export function lttb(ts, val, threshold) {
    const len = ts.length

    if (threshold >= len || threshold <= 2) return { ts, val }

    const outTs = new Float64Array(threshold)
    const outVal = new Float64Array(threshold)
    let outIdx = 0

    outTs[outIdx] = ts[0]
    outVal[outIdx] = val[0]
    outIdx++

    const bucketSize = (len - 2) / (threshold - 2)
    let a = 0

    for (let i = 0; i < threshold - 2; i++) {
        const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1
        const nextBucketEnd = Math.min(
            Math.floor((i + 2) * bucketSize) + 1,
            len
        )

        let avgTs = 0
        let avgVal = 0
        const nextLen = nextBucketEnd - nextBucketStart

        for (let j = nextBucketStart; j < nextBucketEnd; j++) {
            avgTs += ts[j]
            avgVal += val[j]
        }

        avgTs /= nextLen
        avgVal /= nextLen

        const currBucketStart = Math.floor(i * bucketSize) + 1
        const currBucketEnd = Math.floor((i + 1) * bucketSize) + 1
        const aTs = ts[a]
        const aVal = val[a]
        let maxArea = -1
        let maxIdx = currBucketStart

        for (let j = currBucketStart; j < currBucketEnd; j++) {
            const area = Math.abs(
                (aTs - avgTs) * (val[j] - aVal) -
                (aTs - ts[j]) * (avgVal - aVal)
            ) * 0.5

            if (area > maxArea) {
                maxArea = area
                maxIdx = j
            }
        }

        outTs[outIdx] = ts[maxIdx]
        outVal[outIdx] = val[maxIdx]
        outIdx++
        a = maxIdx
    }

    outTs[outIdx] = ts[len - 1]
    outVal[outIdx] = val[len - 1]

    return { ts: outTs, val: outVal }
}
