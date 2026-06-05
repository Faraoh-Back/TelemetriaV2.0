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
    { signalName: 'APS_PERC',  label: 'Acelerador',    dataClass: 'power'       },
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
        unit: 'V',
    },
]

export const STATUS_INDICATORS = [
    { signalName: 'BRAKE', label: 'Freio', kind: 'brake' },
    { signalName: 'VCU_STATE', label: 'VCU State', kind: 'state' },
    {
        signalName: 'FAULTS_GENERAL',
        label: 'Faults',
        kind: 'faultGroup',
        signals: ['IMD', 'BMS', 'BSPD', 'BMS_TIMEOUT', 'PRE_CHARGE_TIME_EXCEEDED', 'GENERAL ERROR'],
    },
    {
        signalName: 'BMS_CELL_ALERTS',
        label: 'BMS Celulas',
        kind: 'faultGroup',
        signals: ['BMS_CellUnderVoltage', 'BMS_CellOverVoltage', 'BMS_CellUnderHeat', 'BMS_CellOverHeat'],
    },
]

export const PINNED_SIGNALS = METRIC_SIGNAL_CARDS

export const GAUGE_CONFIG = [
    { signalName: 'RPM_0A',   label: 'RPM 0A',     min: 0, max: 10000, unit: 'rpm', warnMax: 8500, critMax: 9500 },
    { signalName: 'RPM_13A',  label: 'RPM 13A',    min: 0, max: 10000, unit: 'rpm', warnMax: 8500, critMax: 9500 },
    { signalName: 'APS_PERC', label: 'Acelerador', min: 0, max: 100,   unit: '%'   },
]

export const DEFAULT_CHART_LAYOUT = [
    { label: 'RPM Motores',    signals: ['RPM_0A', 'RPM_0B', 'RPM_13A', 'RPM_13B'] },
    { label: 'Torque Motores', signals: ['TORQUE_0A', 'TORQUE_0B', 'TORQUE_13A', 'TORQUE_13B']  },
    { label: 'Aceleração',     signals: ['Accel_Linear_X', 'Accel_Linear_Y', 'Accel_Linear_Z'] },
]
