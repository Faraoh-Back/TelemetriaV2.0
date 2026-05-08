/**
 * ============================================================================
 * canDecode.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Decodificação binária de sinais CAN.
 *
 * Este módulo espelha a lógica esperada pelo backend: extrai bits em ordem
 * LSB-first e aplica fator/offset definidos pelo mapa CAN.
 */

export function extractBits(data, startBit, length) {
    let value = 0

    for (let i = 0; i < length; i++) {
        const globalBit = startBit + i
        const byteIdx = globalBit >> 3
        const bitIdx = globalBit & 7

        if (byteIdx < data.length) {
            const bit = (data[byteIdx] >> bitIdx) & 1
            value |= bit << i
        }
    }

    return value >>> 0
}

export function decodeSignal(rawData, signal) {
    let raw = extractBits(rawData, signal.sb, signal.len)

    if (signal.t === 'int' && signal.len > 1) {
        const signBit = 1 << (signal.len - 1)

        if (raw & signBit) raw = raw - (1 << signal.len)
    }

    return raw * signal.f + signal.o
}
