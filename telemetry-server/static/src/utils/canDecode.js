/**
 * ============================================================================
 * canDecode.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Decodificação binária de sinais CAN.
 *
 * canDecode.js — decodificação binária de sinais CAN
 * Suporta Intel (LSB-first) e Motorola (MSB-first)
 */
export function extractBits(data, startBit, length, byteOrder) {
    let value = 0

    if (byteOrder === 'Motorola') {
        // MSB-first: startBit é o bit mais significativo
        for (let i = 0; i < length; i++) {
            const bitPos = startBit - i
            const byteIdx = Math.floor(bitPos / 8)
            const bitIdx = 7 - (bitPos % 8)
            if (byteIdx >= 0 && byteIdx < data.length) {
                const bit = (data[byteIdx] >> bitIdx) & 1
                value |= bit << (length - 1 - i)
            }
        }
    } else {
        // Intel / LSB-first (comportamento original)
        for (let i = 0; i < length; i++) {
            const globalBit = startBit + i
            const byteIdx = globalBit >> 3
            const bitIdx = globalBit & 7
            if (byteIdx < data.length) {
                const bit = (data[byteIdx] >> bitIdx) & 1
                value |= bit << i
            }
        }
    }

    return value >>> 0
}

export function decodeSignal(rawData, signal) {
    const byteOrder = signal.bo || 'Intel'
    let raw = extractBits(rawData, signal.sb, signal.len, byteOrder)
    const isSigned = signal.signed === true || signal.t === 'sint'
    if (isSigned && signal.len > 1) {
        const signBit = 1 << (signal.len - 1)
        if (raw & signBit) raw = raw - (1 << signal.len)
    }
    return raw * signal.f + signal.o
}