const CELL_VOLTAGE_SIGNALS = Array.from({ length: 96 }, (_, index) => `vcell_${index}`)
const CELL_TEMPERATURE_SIGNALS = Array.from({ length: 96 }, (_, index) => `tcell_${index}`)

export const METRIC_SIGNAL_CARDS = [
    { signalName: 'RPM_0A',    label: 'RPM Motor 0A',  dataClass: 'rpm'         },
    { signalName: 'RPM_0B',    label: 'RPM Motor 0B',  dataClass: 'rpm'         },
    { signalName: 'RPM_13A',   label: 'RPM Motor 13A', dataClass: 'rpm'         },
    { signalName: 'RPM_13B',   label: 'RPM Motor 13B', dataClass: 'rpm'         },
    { signalName: 'TORQUE_0A', label: 'Torque 0A',     dataClass: 'torque'      },
    { signalName: 'TORQUE_0B', label: 'Torque 0B',     dataClass: 'torque'      },
    { signalName: 'TORQUE_13A',label: 'Torque 13A',    dataClass: 'torque'      },
    { signalName: 'TORQUE_13B',label: 'Torque 13B',    dataClass: 'torque'      },
    { signalName: 'INS_SPEED', label: 'Vel. INS',      dataClass: 'speed',      unit: 'm/s' },
    { signalName: 'ACCEL_X',  label: 'Acelerador',    dataClass: 'acceleration', unit: 'm/s²' },
    {
        signalName: 'CELL_TEMP_MIN',
        signalNames: CELL_TEMPERATURE_SIGNALS,
        label: 'Temp. celulas baixa',
        dataClass: 'temperature',
        aggregate: 'min',
        unit: '°C',
    },
    {
        signalName: 'CELL_VOLTAGE_MIN',
        signalNames: CELL_VOLTAGE_SIGNALS,
        label: 'Voltagem celulas baixa',
        dataClass: 'voltage',
        aggregate: 'min',
        unit: 'V',
    },
    {
        signalName: 'CELL_TEMP_MAX',
        signalNames: CELL_TEMPERATURE_SIGNALS,
        label: 'Temp. celulas alta',
        dataClass: 'temperature',
        aggregate: 'max',
        unit: '°C',
    },
    {
        signalName: 'CELL_VOLTAGE_MAX',
        signalNames: CELL_VOLTAGE_SIGNALS,
        label: 'Voltagem celulas alta',
        dataClass: 'voltage',
        aggregate: 'max',
        totalSignalNames: CELL_VOLTAGE_SIGNALS,
        totalRequiredCount: CELL_VOLTAGE_SIGNALS.length,
        totalLabel: 'total',
        unit: 'V',
    },
]

export const STATUS_INDICATOR_GROUPS = [
    {
        id: 'operation',
        label: 'Operação',
        tone: 'secondary',
        indicators: [
            { signalName: 'BRAKE', label: 'Freio', kind: 'brake' },
            {
                signalName: 'VCU_STATE',
                label: 'VCU',
                kind: 'state',
                valueLabels: {
                    0: 'Inicial',
                    1: 'Pre-charge',
                    2: 'Buzzer',
                    3: 'Operando',
                    4: 'Erro',
                },
                alertValues: [4],
            },
            {
                signalName: 'HV_ON',
                signalNames: ['HV_ON', 'HV_on'],
                label: 'HV',
                kind: 'binary',
                activeText: 'Ligado',
                inactiveText: 'Desligado',
            },
            {
                signalName: 'PreCharge_ST',
                label: 'Pre-charge',
                kind: 'binary',
                activeText: 'OK',
                inactiveText: 'Aguardando',
            },
            {
                signalName: 'AIR_MAIS',
                signalNames: ['AIR_mais'],
                label: 'AIR+',
                kind: 'binary',
                activeText: 'Fechado',
                inactiveText: 'Aberto',
            },
            {
                signalName: 'AIR_MENOS',
                signalNames: ['AIR_menos'],
                label: 'AIR-',
                kind: 'binary',
                activeText: 'Fechado',
                inactiveText: 'Aberto',
            },
            {
                signalName: 'Buzzer',
                label: 'Buzzer',
                kind: 'binary',
                activeText: 'Ativo',
                inactiveText: 'Parado',
            },
        ],
    },
    {
        id: 'faults',
        label: 'Faltas',
        tone: 'critical',
        indicators: [
            {
                signalName: 'SAFETY_NOT_OK',
                label: 'Safety',
                kind: 'faultGroup',
                severity: 'critical',
                signals: [
                    { signalName: 'SAFETY_NOT_OK', label: 'Safety' },
                    { signalName: 'Fault_Safety_OK', label: 'Safety', activeWhen: 1 },
                    { signalName: 'APPS_RANGE_ERROR', label: 'APPS range' },
                ],
            },
            {
                signalName: 'ACD_FAULTS',
                label: 'ACD',
                kind: 'faultGroup',
                severity: 'critical',
                sampleMs: 1000,
                signals: [
                    { signalName: 'Fault_IMD', label: 'IMD' },
                    { signalName: 'Fault_BMS', label: 'BMS' },
                    { signalName: 'Fault_BSPD', label: 'BSPD' },
                    { signalName: 'Fault_General_Error', label: 'Geral' },
                    { signalName: 'Fault_PreCharge_Time_Exceeded', label: 'Pre-charge' },
                    { signalName: 'Fault_BMS_Timeout', label: 'BMS timeout' },
                    { signalName: 'IMD_OK', label: 'IMD', activeWhen: 0 },
                    { signalName: 'BMS_PIN_OK', label: 'BMS pin', activeWhen: 0 },
                    { signalName: 'BSPD_OK', label: 'BSPD', activeWhen: 0 },
                    { signalName: 'GENERAL_ERROR_OK', label: 'Erro geral', activeWhen: 0 },
                    { signalName: 'AIRS_OK', label: 'AIRs', activeWhen: 0 },
                ],
            },
            {
                signalName: 'BMS_FAULTS',
                label: 'BMS HV',
                kind: 'faultGroup',
                severity: 'critical',
                signals: [
                    { signalName: 'BMS_Under_voltage', label: 'Subtensão' },
                    { signalName: 'BMS_Over_voltage', label: 'Sobretensão' },
                    { signalName: 'BMS_Discharge_OC', label: 'Descarga OC' },
                    { signalName: 'BMS_Charge_OC', label: 'Carga OC' },
                    { signalName: 'BMS_Cell_Overheat', label: 'Célula quente' },
                    { signalName: 'BMS_Leakage', label: 'Fuga' },
                    { signalName: 'BMS_No_Cell_Comm', label: 'Sem célula' },
                    { signalName: 'BMS_Pack_Under_Voltage', label: 'Pack baixo' },
                    { signalName: 'BMS_CellUnderVoltage', label: 'Célula baixa' },
                    { signalName: 'BMS_CellOverVoltage', label: 'Célula alta' },
                    { signalName: 'BMS_CellUnderHeat', label: 'Célula fria' },
                    { signalName: 'BMS_CellOverHeat', label: 'Célula quente' },
                ],
            },
            {
                signalName: 'LV_FAULTS',
                label: 'BMS LV',
                kind: 'faultGroup',
                severity: 'warning',
                signals: [
                    { signalName: 'LV_Under_voltage', label: 'Subtensão' },
                    { signalName: 'LV_Over_voltage', label: 'Sobretensão' },
                    { signalName: 'LV_Discharge_OC', label: 'Descarga OC' },
                    { signalName: 'LV_Charge_OC', label: 'Carga OC' },
                    { signalName: 'LV_Cell_Overheat', label: 'Célula quente' },
                    { signalName: 'LV_Pack_Under_Voltage', label: 'Pack baixo' },
                ],
            },
        ],
    },
]

export const STATUS_INDICATORS = STATUS_INDICATOR_GROUPS.flatMap((group) => group.indicators)

export const PINNED_SIGNALS = METRIC_SIGNAL_CARDS

export const GAUGE_CONFIG = [
    { signalName: 'RPM_0A',   label: 'RPM 0A',     min: 0, max: 10000, unit: 'rpm', warnMax: 8500, critMax: 9500 },
    { signalName: 'RPM_13A',  label: 'RPM 13A',    min: 0, max: 10000, unit: 'rpm', warnMax: 8500, critMax: 9500 },
    { signalName: 'INS_SPEED', label: 'Vel. INS',  min: 0, max: 40,    unit: 'm/s' },
    { signalName: 'ACCEL_X', label: 'Acelerador', min: 0, max: 15,   unit: 'm/s²' },
]

export const DEFAULT_CHART_LAYOUT = [
    { label: 'RPM Motores',    signals: ['RPM_0A', 'RPM_0B', 'RPM_13A', 'RPM_13B'] },
    { label: 'Torque Motores', signals: ['TORQUE_0A', 'TORQUE_0B', 'TORQUE_13A', 'TORQUE_13B']  },
    { label: 'Velocidade INS', signals: ['INS_SPEED', 'VELOCITY_N', 'VELOCITY_E', 'VELOCITY_X', 'VELOCITY_Y', 'GPS1_VEL_N', 'GPS1_VEL_E', 'Speed_Linear_X', 'Speed_Linear_Y'] },
    { label: 'Aceleração',     signals: ['ACCEL_X', 'ACCEL_Y', 'ACCEL_Z'] },
]
