/**
 * ============================================================================
 * signalClasses.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Classificação visual de sinais por natureza do dado.
 *
 * Diferente de alertas, estas cores não julgam valor alto/baixo. Elas apenas
 * ajudam a reconhecer rapidamente famílias de dados no dashboard.
 */

export const DATA_CLASS_COLORS = {
    rpm: '#1fb68e',
    acceleration: '#3d8ef0',
    temperature: '#e09b2f',
    voltage: '#60a5fa',
    power: '#a78bfa',
    state: '#8b92a8',
    default: '#34d399',
}

export function inferSignalDataClass(signalName) {
    if (/^act_Speed_/.test(signalName)) return 'rpm'
    if (/acc_/.test(signalName) || /^ventor_linear_acc_/.test(signalName)) return 'acceleration'
    if (/Temperature|temp/i.test(signalName)) return 'temperature'
    if (/Voltage|voltage/i.test(signalName)) return 'voltage'
    if (/Power|power/i.test(signalName)) return 'power'
    if (/^Fault_|^BMS_|^LV_|ERROR|STATE|State/.test(signalName)) return 'state'

    return 'default'
}

export function getSignalClassColor(signalName, fallbackIndex = 0) {
    const fallbackColors = [
        DATA_CLASS_COLORS.default,
        '#f472b6',
        '#22d3ee',
        '#f59e0b',
    ]
    const dataClass = inferSignalDataClass(signalName)

    return DATA_CLASS_COLORS[dataClass] ?? fallbackColors[fallbackIndex % fallbackColors.length]
}
