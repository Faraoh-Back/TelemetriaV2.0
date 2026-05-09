/**
 * ============================================================================
 * circularBuffer.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Histórico fixo de telemetria por sinal.
 *
 * O buffer circular evita crescimento infinito de memória durante uma sessão
 * longa: quando fica cheio, a próxima amostra sobrescreve a mais antiga.
 */

export const DEFAULT_BUFFER_SIZE = 3900

export class CircularBuffer {
    constructor(size = DEFAULT_BUFFER_SIZE) {
        this.size = size
        this.ts = new Float64Array(size)
        this.val = new Float64Array(size)
        this.head = 0
        this.count = 0
    }

    push(timestamp, value) {
        this.ts[this.head] = timestamp
        this.val[this.head] = value
        this.head = (this.head + 1) % this.size

        if (this.count < this.size) this.count++
    }

    /**
     * Retorna os dados em ordem cronológica, do mais antigo para o mais recente.
     */
    toArrays() {
        const n = this.count
        const ts = new Float64Array(n)
        const val = new Float64Array(n)
        const start = this.count < this.size ? 0 : this.head

        for (let i = 0; i < n; i++) {
            const idx = (start + i) % this.size
            ts[i] = this.ts[idx]
            val[i] = this.val[idx]
        }

        return { ts, val }
    }
}
