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
     * Timestamp da amostra mais recente, ou null se o buffer estiver vazio.
     */
    get lastTimestamp() {
        if (this.count === 0) return null
        return this.ts[(this.head - 1 + this.size) % this.size]
    }

    /**
     * Retorna os dados em ordem cronológica, do mais antigo para o mais recente.
     *
     * Com `sinceTimestamp`, copia só a cauda dentro da janela. Isso importa no
     * caminho quente do gráfico: o buffer guarda 3900 amostras, mas a janela
     * padrão é de 30 s (~600 amostras a 20 Hz). Copiar as 3900 para o chamador
     * fatiar depois desperdiçava ~60 KB por sinal por atualização — com 12
     * séries a 5 Hz, alguns MB/s de lixo só para o GC recolher.
     *
     * @param {number|null} sinceTimestamp — corta amostras anteriores a este instante.
     */
    toArrays(sinceTimestamp = null) {
        const total = this.count
        const start = total < this.size ? 0 : this.head

        let n = total
        if (sinceTimestamp != null && total > 0) {
            n = 0
            for (let i = total - 1; i >= 0; i--) {
                if (this.ts[(start + i) % this.size] < sinceTimestamp) break
                n++
            }
        }

        const offset = total - n
        const ts = new Float64Array(n)
        const val = new Float64Array(n)

        for (let i = 0; i < n; i++) {
            const idx = (start + offset + i) % this.size
            ts[i] = this.ts[idx]
            val[i] = this.val[idx]
        }

        return { ts, val }
    }
}
