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
