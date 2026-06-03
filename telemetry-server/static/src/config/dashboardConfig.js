export const PINNED_SIGNALS = [
    { signalName: 'RPM_0A',    label: 'RPM Motor 0A',  dataClass: 'rpm'         },
    { signalName: 'RPM_0B',    label: 'RPM Motor 0B',  dataClass: 'rpm'         },
    { signalName: 'RPM_13A',   label: 'RPM Motor 13A', dataClass: 'rpm'         },
    { signalName: 'RPM_13B',   label: 'RPM Motor 13B', dataClass: 'rpm'         },
    { signalName: 'TORQUE_0B', label: 'Torque 0B',     dataClass: 'torque'      },
    { signalName: 'TORQUE_13A',label: 'Torque 13A',    dataClass: 'torque'      },
    { signalName: 'TORQUE_13B',label: 'Torque 13B',    dataClass: 'torque'      },
    { signalName: 'APS_PERC',  label: 'Acelerador',    dataClass: 'power'       },
    { signalName: 'BRAKE',     label: 'Freio',         dataClass: 'state'       },
    { signalName: 'VCU_STATE', label: 'VCU State',     dataClass: 'state'       },
    { signalName: 'IMD',       label: 'Fault IMD',     dataClass: 'state'       },
    { signalName: 'BMS',       label: 'Fault BMS',     dataClass: 'state'       },
    { signalName: 'BSPD',      label: 'Fault BSPD',    dataClass: 'state'       },
    { signalName: 'BMS_CellOverVoltage',  label: 'BMS OV',       dataClass: 'state' },
    { signalName: 'BMS_CellUnderVoltage', label: 'BMS UV',       dataClass: 'state' },
    { signalName: 'BMS_CellOverHeat',     label: 'BMS Overheat', dataClass: 'state' },
]

export const GAUGE_CONFIG = [
    { signalName: 'RPM_0A',   label: 'RPM 0A',     min: 0, max: 10000, unit: 'rpm', warnMax: 8500, critMax: 9500 },
    { signalName: 'RPM_13A',  label: 'RPM 13A',    min: 0, max: 10000, unit: 'rpm', warnMax: 8500, critMax: 9500 },
    { signalName: 'APS_PERC', label: 'Acelerador', min: 0, max: 100,   unit: '%'   },
]

export const DEFAULT_CHART_LAYOUT = [
    { label: 'RPM Motores',    signals: ['RPM_0A', 'RPM_0B', 'RPM_13A', 'RPM_13B'] },
    { label: 'Torque Motores', signals: ['TORQUE_0B', 'TORQUE_13A', 'TORQUE_13B']  },
    { label: 'Aceleração',     signals: ['Accel_Linear_X', 'Accel_Linear_Y', 'Accel_Linear_Z'] },
]