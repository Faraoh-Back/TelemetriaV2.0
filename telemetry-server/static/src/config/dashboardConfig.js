export const PINNED_SIGNALS = [
    { signalName: 'act_MotorTemperature_A0',  label: 'Temp Motor A0',  dataClass: 'temperature' },
    { signalName: 'act_MotorTemperature_B0',  label: 'Temp Motor B0',  dataClass: 'temperature' },
    { signalName: 'act_MotorTemperature_A13', label: 'Temp Motor A13', dataClass: 'temperature' },
    { signalName: 'act_MotorTemperature_B13', label: 'Temp Motor B13', dataClass: 'temperature' },
    { signalName: 'act_DCBusVoltage_M0',      label: 'Tensão DC M0',   dataClass: 'voltage'     },
    { signalName: 'act_DCBusVoltage_M13',     label: 'Tensão DC M13',  dataClass: 'voltage'     },
    { signalName: 'act_DCBusPower_M0',        label: 'Potência M0',    dataClass: 'power'       },
    { signalName: 'act_DCBusPower_M13',       label: 'Potência M13',   dataClass: 'power'       },
    { signalName: 'act_Power_A0',             label: 'Potência A0',    dataClass: 'power'       },
    { signalName: 'act_Power_B0',             label: 'Potência B0',    dataClass: 'power'       },
    { signalName: 'act_Power_A13',            label: 'Potência A13',   dataClass: 'power'       },
    { signalName: 'act_Power_B13',            label: 'Potência B13',   dataClass: 'power'       },
    { signalName: 'Fault_IMD',                label: 'Fault IMD',      dataClass: 'state'       },
    { signalName: 'Fault_BMS',                label: 'Fault BMS',      dataClass: 'state'       },
    { signalName: 'Fault_BSPD',               label: 'Fault BSPD',     dataClass: 'state'       },
    { signalName: 'BMS_Over_voltage',         label: 'BMS OV',         dataClass: 'state'       },
    { signalName: 'BMS_Under_voltage',        label: 'BMS UV',         dataClass: 'state'       },
    { signalName: 'BMS_Cell_Overheat',        label: 'BMS Overheat',   dataClass: 'state'       },
]

export const GAUGE_CONFIG = [
    { signalName: 'act_Speed_A0', label: 'RPM A0',      min: -32000, max: 32000, unit: 'rpm' },
    { signalName: 'act_Speed_B0', label: 'RPM B0',      min: -32000, max: 32000, unit: 'rpm' },
    { signalName: 'APS_PERC',     label: 'Acelerador',  min: 0,      max: 100,   unit: '%'   },
]

export const DEFAULT_CHART_LAYOUT = [
    { label: 'RPM Motores', signals: ['act_Speed_A0', 'act_Speed_B0', 'act_Speed_A13', 'act_Speed_B13'] },
    { label: 'Aceleração Linear', signals: ['ventor_linear_acc_x', 'ventor_linear_acc_y', 'ventor_linear_acc_z'] },
    ]
