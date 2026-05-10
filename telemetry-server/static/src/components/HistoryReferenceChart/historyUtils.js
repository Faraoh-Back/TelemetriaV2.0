export const DEFAULT_RPM_SIGNALS = [
    'act_Speed_A0',
    'act_Speed_B0',
    'act_Speed_A13',
    'act_Speed_B13',
]

export function formatDuration(totalSeconds) {
    if (totalSeconds == null || !isFinite(totalSeconds)) return '00:00'

    const clamped = Math.max(0, totalSeconds)
    const minutes = Math.floor(clamped / 60)
    const seconds = Math.floor(clamped % 60)
    const millis = Math.floor((clamped % 1) * 1000)

    return `${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

export function uniqueSignals(names) {
    return [...new Set((names ?? []).filter(Boolean))]
}
