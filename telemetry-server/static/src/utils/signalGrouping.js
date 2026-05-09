/**
 * ============================================================================
 * signalGrouping.js
 * ============================================================================
 *
 * RESPONSABILIDADE:
 * -----------------
 * Agrupamento semântico de sinais.
 *
 * O SignalSelector usa estas regras para transformar nomes crus do CAN em grupos
 * navegáveis. As regras são heurísticas e ficam isoladas aqui para que o time de
 * engenharia possa refiná-las sem tocar nos componentes visuais.
 */

const GROUPS = [
    {
        id: 'motors',
        label: 'Motores',
        matches: [
            /^act_(Speed|Torque|Power|MotorTemperature)_[AB](0|13)$/,
        ],
    },
    {
        id: 'inverters',
        label: 'Inversores',
        matches: [
            /^act_(DCBus|Device)/,
            /^DeviceState_/,
            /^ErrorLamp_/,
        ],
    },
    {
        id: 'bms',
        label: 'BMS',
        matches: [
            /^BMS_/,
            /^LV_/,
        ],
    },
    {
        id: 'faults',
        label: 'Faults',
        matches: [
            /^Fault_/,
            /_ERROR$/,
        ],
    },
    {
        id: 'vcu',
        label: 'VCU',
        matches: [
            /^APS_/,
            /^BRAKE$/,
            /^SAFETY_/,
            /^VCU_/,
            /^SystemEnable$/,
            /^Clamp15_/,
            /^setp_/,
            /^VoltagePrechargeDemand$/,
        ],
    },
    {
        id: 'imu',
        label: 'IMU',
        matches: [
            /^ventor_/,
        ],
    },
    {
        id: 'chassis',
        label: 'Chassis',
        matches: [
            /^susp_/,
            /^brake_/,
            /^arref_/,
            /^fluid_/,
        ],
    },
]

const FALLBACK_GROUP = {
    id: 'other',
    label: 'Outros',
}

export function inferSignalGroup(signalName) {
    const group = GROUPS.find(({ matches }) =>
        matches.some((pattern) => pattern.test(signalName))
    )

    return group
        ? { id: group.id, label: group.label }
        : FALLBACK_GROUP
}

export function groupSignals(signalEntries) {
    const groups = new Map()

    for (const signal of signalEntries) {
        const group = inferSignalGroup(signal.name)

        if (!groups.has(group.id)) {
            groups.set(group.id, {
                id: group.id,
                label: group.label,
                signals: [],
            })
        }

        groups.get(group.id).signals.push(signal)
    }

    return [...groups.values()]
        .map((group) => ({
            ...group,
            signals: group.signals.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
}
