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
        let bitPos = startBit
        for (let i = 0; i < length; i += 1) {
            if (bitPos < 0) break

            const byteIdx = Math.floor(bitPos / 8)
            const bitIdx = bitPos % 8
            if (byteIdx >= data.length) break

            const bit = (data[byteIdx] >> bitIdx) & 1
            value = (value * 2) + bit

            bitPos = bitIdx === 0 ? bitPos + 15 : bitPos - 1
        }
    } else {
        // Intel / LSB-first (comportamento original)
        for (let i = 0; i < length; i += 1) {
            const globalBit = startBit + i
            const byteIdx = globalBit >> 3
            const bitIdx = globalBit & 7
            if (byteIdx < data.length) {
                const bit = (data[byteIdx] >> bitIdx) & 1
                value += bit * (2 ** i)
            }
        }
    }

    return value
}

export function decodeSignal(rawData, signal) {
    const byteOrder = signal.bo || 'Intel'
    let raw = extractBits(rawData, signal.sb, signal.len, byteOrder)
    const isSigned = signal.signed === true || signal.t === 'sint'
    if (isSigned && signal.len > 1) {
        const signBit = 2 ** (signal.len - 1)
        if (raw >= signBit) raw -= 2 ** signal.len
    }
    return raw * signal.f + signal.o
}
