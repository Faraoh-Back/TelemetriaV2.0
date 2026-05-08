export const PINNED_SIGNALS = [
    { signalName: 'act_MotorTemperature_A0',  label: 'Temp Motor A0'  },
    { signalName: 'act_MotorTemperature_B0',  label: 'Temp Motor B0'  },
    { signalName: 'act_MotorTemperature_A13', label: 'Temp Motor A13' },
    { signalName: 'act_MotorTemperature_B13', label: 'Temp Motor B13' },
    { signalName: 'act_DCBusVoltage_M0',      label: 'Tensão DC M0'   },
    { signalName: 'act_DCBusVoltage_M13',     label: 'Tensão DC M13'  },
    { signalName: 'act_DCBusPower_M0',        label: 'Potência M0'    },
    { signalName: 'act_DCBusPower_M13',       label: 'Potência M13'   },
    { signalName: 'act_Power_A0',             label: 'Potência A0'    },
    { signalName: 'act_Power_B0',             label: 'Potência B0'    },
    { signalName: 'act_Power_A13',            label: 'Potência A13'   },
    { signalName: 'act_Power_B13',            label: 'Potência B13'   },
    { signalName: 'Fault_IMD',               label: 'Fault IMD'      },
    { signalName: 'Fault_BMS',               label: 'Fault BMS'      },
    { signalName: 'Fault_BSPD',              label: 'Fault BSPD'     },
    { signalName: 'BMS_Over_voltage',        label: 'BMS OV'         },
    { signalName: 'BMS_Under_voltage',       label: 'BMS UV'         },
    { signalName: 'BMS_Cell_Overheat',       label: 'BMS Overheat'   },
]

export const GAUGE_CONFIG = [
    { signalName: 'act_Speed_A0',            label: 'RPM A0',    min: -32000, max: 32000, unit: 'rpm' },
    { signalName: 'act_Speed_B0',            label: 'RPM B0',    min: -32000, max: 32000, unit: 'rpm' },
    { signalName: 'act_MotorTemperature_A0', label: 'Temp A0',   min: 0,      max: 150,   unit: '°C',  warnMax: 90,  critMax: 120 },
    { signalName: 'act_MotorTemperature_B0', label: 'Temp B0',   min: 0,      max: 150,   unit: '°C',  warnMax: 90,  critMax: 120 },
    { signalName: 'act_DCBusVoltage_M0',     label: 'V DC M0',   min: 0,      max: 400,   unit: 'V',   warnMax: 350, critMax: 380 },
    { signalName: 'APS_PERC',               label: 'Acelerador', min: 0,      max: 100,   unit: '%' },
]

export const DEFAULT_CHART_LAYOUT = [
    { label: 'Temperatura Motores', signals: ['act_MotorTemperature_A0', 'act_MotorTemperature_B0', 'act_MotorTemperature_A13', 'act_MotorTemperature_B13'] },
    { label: 'Tensão DC',           signals: ['act_DCBusVoltage_M0', 'act_DCBusVoltage_M13'] },
    { label: 'Potência',            signals: ['act_DCBusPower_M0', 'act_DCBusPower_M13', 'act_Power_A0', 'act_Power_B0', 'act_Power_A13', 'act_Power_B13'] },
    ]