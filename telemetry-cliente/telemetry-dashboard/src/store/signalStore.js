/**
 * @file signalStore.js
 * @description Estado central de telemetria usando Zustand.
 *
 * Fluxo de dados:
 *   WebSocket frame → ingestFrame() → ringBuffers + latestValues → componentes
 *
 * Cada sinal recebido via WS é armazenado em duas estruturas paralelas:
 *   - ringBuffers: histórico dos últimos N pontos (para gráficos)
 *   - latestValues: valor mais recente + estatísticas (para StatusBar)
 *
 * Memória: cada sinal ocupa no máximo RING_CAPACITY * ~16 bytes ≈ 48KB.
 * Com 50 sinais ativos → ~2.4MB total. Sem crescimento indefinido.
 */

import { create } from 'zustand'

/** Máximo de pontos por sinal. A 10Hz = ~5min de histórico. */
const RING_CAPACITY = 3000

    /**
     * Buffer circular de tamanho fixo.
     * Push é O(1). Não realoca memória após atingir capacidade.
     */
    class RingBuffer {
        constructor(capacity) {
            this.capacity = capacity
            this.buf = new Array(capacity)
            this.head = 0  // próximo índice a escrever
            this.size = 0  // quantos itens válidos existem
        }

        /** Insere um item. Sobrescreve o mais antigo se cheio. */
        push(item) {
            this.buf[this.head] = item
            this.head = (this.head + 1) % this.capacity
            if (this.size < this.capacity) this.size++
        }

        /** Retorna todos os itens em ordem cronológica (mais antigo → mais recente). */
        toArray() {
            if (this.size === 0) return []
            if (this.size < this.capacity) return this.buf.slice(0, this.size)
            // Buffer cheio: reconstrói a ordem correta a partir do head
            return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)]
        }

        /** Retorna apenas pontos com timestamp >= minTs (segundos Unix). */
        toArraySince(minTs) {
            return this.toArray().filter(p => p.timestamp >= minTs)
        }
}

    export const useSignalStore = create((set, get) => ({
        /** @type {Object.<string, RingBuffer>} histórico por signal_name */
        ringBuffers: {},

        /**
         * Último valor recebido + estatísticas acumuladas da sessão.
         * @type {Object.<string, {value, timestamp, unit, min, max, sum, count}>}
         */
        latestValues: {},

        /** Lista de todos os signal_names recebidos na sessão atual. */
        signalNames: [],

        /** Taxa de mensagens recebidas (msgs/s), janela deslizante de 2s. */
        msgRate: 0,

        /** Timestamp Unix (float) da última mensagem recebida. */
        lastTs: null,

        /** @private timestamps recentes para cálculo de msgRate */
        _rateWindow: [],

        /**
         * Processa um frame recebido do WebSocket.
         * Chamado pelo useWebSocket a cada mensagem.
         *
         * @param {{ timestamp: number, device_id: string, can_id: number,
         *            signal_name: string, value: number, unit: string }} frame
         */
    ingestFrame(frame) {
            const { signal_name, value, timestamp, unit } = frame
            const state = get()

            // Atualiza ou cria o ring buffer do sinal
            let rb = state.ringBuffers[signal_name]
            if (!rb) rb = new RingBuffer(RING_CAPACITY)
            rb.push({ timestamp, value })

            // Atualiza estatísticas acumuladas
            const prev = state.latestValues[signal_name]
            const updated = {
            value, timestamp, unit,
            min:   prev ? Math.min(prev.min, value) : value,
            max:   prev ? Math.max(prev.max, value) : value,
            sum:   prev ? prev.sum + value : value,
            count: prev ? prev.count + 1 : 1,
            }

            // Registra o nome do sinal se for novo na sessão
            const signalNames = state.signalNames.includes(signal_name)
            ? state.signalNames
            : [...state.signalNames, signal_name]

            // Recalcula taxa de mensagens (descarta eventos > 2s atrás)
            const now = Date.now()
            const rateWindow = [...state._rateWindow, now].filter(t => now - t < 2000)

            set({
            ringBuffers:  { ...state.ringBuffers, [signal_name]: rb },
            latestValues: { ...state.latestValues, [signal_name]: updated },
            signalNames,
            lastTs:      timestamp,
            msgRate:     rateWindow.length / 2,
            _rateWindow: rateWindow,
            })
    },

    /**
     * Retorna o histórico de um sinal dentro de uma janela temporal.
     * Usado pelo ChartPanel para montar o gráfico.
     *
     * @param {string} signalName
     * @param {number} windowMs - janela em ms (ex: 30000 = últimos 30s)
     * @returns {{ timestamp: number, value: number }[]}
     */
    getHistory(signalName, windowMs) {
        const rb = get().ringBuffers[signalName]
        if (!rb) return []
        const minTs = (Date.now() / 1000) - (windowMs / 1000)
        return rb.toArraySince(minTs)
    },

    /**
     * Média deslizante das últimas N amostras de um sinal.
     * Usado pelo StatusBar.
     *
     * @param {string} signalName
     * @param {number} n - número de amostras (default 50)
     * @returns {number|null}
     */
    getAvg(signalName, n = 50) {
        const rb = get().ringBuffers[signalName]
        if (!rb) return null
        const slice = rb.toArray().slice(-n)
        if (!slice.length) return null
        return slice.reduce((s, p) => s + p.value, 0) / slice.length
    },

    /**
     * Limpa toda a sessão. Chamado no logout ou reconexão.
     */
    clearSession() {
        set({
        ringBuffers: {}, latestValues: {}, signalNames: [],
        msgRate: 0, lastTs: null, _rateWindow: [],
        })
    },
}))